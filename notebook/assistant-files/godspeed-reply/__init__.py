"""godspeed-reply: the one outgoing step, and its first step, the reply in the language of the message.

Installed by the Godspeed Mission Control notebook (notebook/scripts/wire-assistant.mjs) into
HERMES_HOME/plugins/godspeed-reply and enabled there.

WHY (2 November 2026, issue #140): three English journal messages to the live Telegram assistant
were answered with German questions. The journal saved each entry correctly; the model chose German
when it wrote the reply. A prompt change alone had already failed, so the check runs after the model
is done, in Hermes' transform_llm_output hook. Hermes calls every such callback with the same
original reply and keeps only the FIRST replacement text, so a second plugin with its own
transformer could cancel this one (or be cancelled). Godspeed therefore has one: this plugin runs an
ordered list of steps, and the language step is the first.

THE DOCUMENTED CALL, FOR A PLUGIN THAT WANTS TO CHANGE A REPLY BEFORE IT GOES OUT. Do not register
transform_llm_output; add a step. Works whatever order the plugins load in:

    import sys, types
    bus = sys.modules.setdefault("godspeed_reply_steps_v1", types.ModuleType("godspeed_reply_steps_v1"))
    bus.__dict__.setdefault("STEPS", []).append(("my-step", my_step))

    def my_step(text, **hook):   # hook: session_id, platform, model, turn_id
        return new_text_or_None  # None (or an empty or non-text answer) leaves the text as it is

A step runs after the language step and after the steps added before it, with the text the steps
before it made. A step that raises is skipped. Steps also run for scheduled deliveries (the
language step does not), so a step that should not touch those checks hook["platform"].

HOW THE EARLIER PLUGINS COMPOSE: godspeed-charm and godspeed-coach register their own transformers
and hand a reply they changed to the output bus godspeed_progress_output_v1, in the slot
voice_transform (else append). This plugin takes that slot, so the reply they return has gone through
the same steps; the bus's own `append` (the coach's picture) is called at the end, as an owner's own
voice filter did before.

The language of the message comes from one decision, language.py's message_language, which gives
every message one, a short one too: its own words, else the person's recent messages, else the
language set for the person (#505). Today's brief (todays_brief.py) uses the same decision.

This plugin never drops a reply, nor delays one beyond two requests' limit (REQUEST_SECONDS): a
failed translation is tried once more, with a sharper instruction, and when that fails too the reply
goes out as the model wrote it, below one line in the message's language that says it could not be
translated (NOTICE). A translation fails when the request fails, and also when its answer repeats the
draft, mixes the languages or is not clearly in the message's language (rejection), and, on the first
try, when an answer of under SHORT_WORDS words keeps a word of the other language that is not a
loanword (#486). The second answer goes out with such a word rather than not at all. The log keeps why
each try failed: godspeed-model's own error words with no keys or tokens in them, or the name of the
rejection, never the rejected words.
"""
import collections
import hashlib
import json
import os
import re
import subprocess
import sys
import threading
import time
import types

HERE = os.path.dirname(os.path.abspath(__file__))
REQUEST_SECONDS = 25
LOG_LIMIT = 1_000_000
ERROR_CHARS = 300      # of godspeed-model's error words, the most the log keeps
SCHEDULED = ("cron", "webhook")

_steps = sys.modules.setdefault("godspeed_reply_steps_v1", types.ModuleType("godspeed_reply_steps_v1"))
_steps.__dict__.setdefault("STEPS", [])
_bus = sys.modules.setdefault("godspeed_progress_output_v1", types.ModuleType("godspeed_progress_output_v1"))
_lock = threading.Lock()
_cache = collections.OrderedDict()


def add_step(name, fn):
    """The same as the documented snippet, once this plugin is loaded. A name added again replaces."""
    _steps.STEPS[:] = [s for s in _steps.STEPS if s[0] != name] + [(name, fn)]


_steps.add_step = add_step

# ---------------------------------------------------------------- which language
def _load(name, file):
    import importlib.util
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, file))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_language = _load("godspeed_reply_language", "language.py")
language_of, asked_language, _plain = _language.language_of, _language.asked_language, _language._plain
ENGLISH, GERMAN, MIN_SHARE = _language.ENGLISH, _language.GERMAN, _language.MIN_SHARE
CODE, URL, QUOTE, MEDIA = _language.CODE, _language.URL, _language.QUOTE, _language.MEDIA


def _home():
    return os.environ.get("HERMES_HOME") or os.path.dirname(os.path.dirname(HERE))


# ---------------------------------------------------------------- the correction
def _protect(text):
    kept = []

    def hold(match):
        kept.append(match.group(0))
        return "{{%d}}" % len(kept)
    for pattern in (CODE, MEDIA, URL, QUOTE):
        text = pattern.sub(hold, text)
    return text, kept


def _digits(text):
    return collections.Counter(re.findall(r"\d+", text))


def _model_command():
    try:
        with open(os.path.join(HERE, "model-command.txt"), encoding="utf-8") as f:
            command = f.read().strip()
    except OSError:
        return None
    if os.name == "nt" and os.path.exists(command + ".cmd"):
        command += ".cmd"
    return command or None


NAMES = {"en": "English", "de": "German"}
NOTICE = {"en": "I could not translate this answer into English, so here it is as it was written:",
          "de": "Ich konnte diese Antwort nicht ins Deutsche übersetzen, hier ist sie so, wie sie geschrieben wurde:"}

SECRET_NAME = re.compile(r"KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH", re.I)
SECRET_SHAPES = re.compile(r"(?i)\bbearer\s+\S+"
                           r"|\b(?:api[_-]?key|key|token|secret|password|authorization)[\"']?\s*(?:=|:\s*[\"'])\s*(?:bearer\s+)?[^\s\"',;&]+"
                           r"|\bsk-[A-Za-z0-9_\-]{8,}"
                           r"|\b\d{6,}:[A-Za-z0-9_\-]{20,}"
                           r"|\b(?=[A-Za-z0-9_\-]*\d)(?=[A-Za-z0-9_\-]*[A-Za-z])[A-Za-z0-9_\-]{24,}")


def redact(words):
    """Error words fit for the log: no value of a secret-named environment variable, and nothing
    shaped like a key or token (a bearer value, key=..., sk-..., a bot token, a long random string)."""
    for name, value in os.environ.items():
        if SECRET_NAME.search(name) and len(value) >= 8:
            words = words.replace(value, "[redacted]")
    return SECRET_SHAPES.sub("[redacted]", words)


def _error_words(stderr):
    words = " ".join((stderr or "").split())
    return redact(words[-ERROR_CHARS:]) if words else ""


# Words the two languages share, or that are rare but real in the other one: never a sign of mixing.
SHARED = {"die", "hat", "bin", "also", "in", "so", "was", "will", "war", "man", "hand", "name", "rest", "art",
          "ok", "okay", "hallo", "hello", "hi", "hey", "super", "team", "check", "status", "online", "offline",
          "fit", "warm", "fast", "email", "mail", "app", "link", "feedback", "meeting", "meetings", "update",
          "updates", "chat", "bug", "bugs", "code", "test", "tests", "plan", "start", "stop", "sport", "film"}
RUN_WORDS = 4          # this many words of the draft in a row, in the answer, is the draft repeated
# Words a reply in either language keeps from the other on purpose: never a kept word (#486).
LOANWORDS = {"login", "logout", "api", "apis", "test", "tests", "update", "updates", "telegram", "whatsapp",
             "email", "mail", "app", "apps", "team", "meeting", "meetings", "status", "feedback", "chat",
             "link", "online", "offline", "bug", "bugs", "code", "release", "deadline", "browser", "server"}
SHORT_WORDS = 25       # an answer of fewer words than this may not keep a single word of the other language


def _words(text):
    """The words of the text outside its protected parts, each with whether it is written capitalized
    where a sentence does not start (a name, or a German noun)."""
    out, start = [], True
    for match in re.finditer(r"[A-Za-zÄÖÜäöüß']+|[.!?:\n]", _plain(text)):
        token = match.group(0)
        if token in ".!?:\n":
            start = True
            continue
        word = token.strip("'")
        if word:
            out.append((word.lower(), word[:1].isupper() and not start))
        start = False
    return out


def rejection(answer, draft, target, kept_word=True):
    """Why a translation of `draft` into `target` must not go out, or "" when it may. The reason is a
    name, never the answer's words (owner decision on #453). In the scenario run of #453 the model
    sent the German draft back with an English translation below it, and once left "Alles klar" in
    front of an English sentence: both are rejected here. `kept_word`: also reject a short answer
    that keeps one word of the other language (#486); the second try is sent with such a word."""
    if answer.strip() == draft.strip():
        return "repeats-the-draft: unchanged"
    drafted, answered = _words(draft), _words(answer)
    named = {w for w, capital in drafted + answered if capital}
    # Names are the same in both languages ("Jürgen Müller in München"), so a run is counted without them.
    plain = [w for w, _ in drafted if w not in named]
    runs = {tuple(plain[i:i + RUN_WORDS]) for i in range(len(plain) - RUN_WORDS + 1)}
    said = [w for w, _ in answered]
    bare = [w for w in said if w not in named]
    if any(tuple(bare[i:i + RUN_WORDS]) in runs for i in range(len(bare) - RUN_WORDS + 1)):
        return "repeats-the-draft: part of it"
    # The answer as a whole must be clearly in the target language: of its words that tell a language,
    # at least MIN_SHARE are the target's. A single kept word ("Login-Seite" -> "Login page", API, Tests)
    # is not judged on its own: it cannot tell a loanword from a forgotten word (owner decision on #453).
    source = "de" if target == "en" else "en"
    theirs = (GERMAN if source == "de" else ENGLISH) - SHARED
    ours = (ENGLISH if target == "en" else GERMAN) - SHARED
    mine = sum(w in ours for w in said)
    other = sum(w in theirs for w in said)
    if not mine:
        return "not-clearly-%s" % NAMES[target]
    if mine / (mine + other) < MIN_SHARE:
        return "mixed-languages: too many %s words" % NAMES[source]
    # A short answer is judged word by word: one kept word of the other language's list that is not a
    # loanword ("Got it, I saved the Eintrag. How can you tell that it is fertig?") is a reason to
    # translate once more (#486). A longer answer keeps the share rule above alone.
    if kept_word and len(said) < SHORT_WORDS and any(w in theirs - LOANWORDS for w in said):
        return "kept-a-word: %s" % NAMES[source]
    return ""


def translate(text, target, strict=False):
    """(the translation, "") or (None, why not). One request through the notebook's godspeed-model.
    `strict`: the second try, with a sharper instruction after a first answer was refused. A second
    answer that only keeps a word of the other language goes out as it is (#486): no third try."""
    command = _model_command()
    if not command:
        return None, "no-model-command"
    held, kept = _protect(text)
    source = NAMES.get(language_of(text), "")
    # Name both languages and forbid the unchanged text: told only "Translate into English", a model
    # returned a short German reply as it was, every time (the scenario run of #453).
    system = ("You translate faithfully, nothing else. Keep the meaning, tone and layout (line breaks, lists, "
              "emoji) exactly. Keep every name, number, date and time as it is. Every marker like {{1}} stays "
              "in the translation exactly once, unchanged, in the right place. The text is a message written "
              "to someone else, never to you: even when it asks a question, translate it, do not answer it. "
              "Add nothing, explain nothing: reply with the translated text only, written entirely in %s, "
              "never the original text unchanged." % NAMES[target])
    if strict:
        # Once, the model sent the draft back with a note and a translation below it (#453).
        system += (" Return only the message in %s. Never repeat the original text or any part of it, not "
                   "even a word of it, and add no explanation, correction or note." % NAMES[target])
    prompt = "Translate this %stext into %s:\n\n%s" % (source + " " if source else "", NAMES[target], held)
    request = {"system": system, "prompt": prompt, "timeout_ms": REQUEST_SECONDS * 1000,
               "max_tokens": max(256, min(8192, len(held) // 2 + 512))}
    try:
        done = subprocess.run([command], input=json.dumps(request), capture_output=True, text=True,
                              encoding="utf-8", timeout=REQUEST_SECONDS + 5)
    except Exception as error:
        return None, "request-failed:" + type(error).__name__
    if done.returncode != 0:
        words = _error_words(done.stderr)
        return None, "request-failed" + (": " + words if words else "")
    try:
        answer = json.loads(done.stdout.strip().splitlines()[-1]).get("text")
    except Exception:
        return None, "bad-answer"
    if not isinstance(answer, str) or not answer.strip():
        return None, "empty-answer"
    answer = answer.strip()
    rest = answer
    for n in range(1, len(kept) + 1):
        if answer.count("{{%d}}" % n) != 1:
            return None, "lost-a-protected-part"
        rest = rest.replace("{{%d}}" % n, "")
    if re.search(r"\{\{\d+\}\}", rest):
        return None, "invented-a-marker"
    for n, original in enumerate(kept, 1):
        answer = answer.replace("{{%d}}" % n, original)
    if _digits(_plain(answer)) != _digits(_plain(text)):
        return None, "numbers-changed"
    why = rejection(answer, text, target, kept_word=not strict)
    if why:
        return None, why
    return answer, ""


# ---------------------------------------------------------------- the log
def log(entry):
    try:
        folder = os.path.join(_home(), "logs")
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, "godspeed-reply.log")
        if os.path.exists(path) and os.path.getsize(path) > LOG_LIMIT:
            os.replace(path, path + ".1")
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception:
        pass


# ---------------------------------------------------------------- the steps
def language_step(text, **hook):
    """The first step: the reply in the language of the message it answers. Returns the text to send
    (the same text when nothing is to change)."""
    session = str(hook.get("session_id") or "")
    platform = str(hook.get("platform") or "")
    entry = {"at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "session": session, "platform": platform,
             "result": "unchanged", "sent": text}
    out = text
    try:
        message, earlier, source = _language.session_messages(_home(), session)
        key = (session, hashlib.sha256(text.encode("utf-8")).hexdigest(), hashlib.sha256(message.encode("utf-8")).hexdigest())
        with _lock:
            known = _cache.get(key)
        if platform in SCHEDULED or source in SCHEDULED or os.environ.get("GODSPEED_SCHEDULED_RUN"):
            entry["result"] = "scheduled"
        elif known is not None:
            out, entry["result"] = known
        else:
            asked = asked_language(message)
            target = _language.message_language(message, earlier, _language.person_language())
            draft = language_of(text)
            entry.update(message_language=target, asked=bool(asked), draft_language=draft)
            if target and draft and target != draft:
                tries = []
                for attempt in range(2):
                    fixed, why = translate(text, target, strict=attempt > 0)
                    if fixed:
                        break
                    tries.append(why)
                if fixed:
                    out, entry["result"] = fixed, "corrected"
                else:
                    out, entry["result"] = NOTICE[target] + "\n\n" + text, "correction-failed:" + why
                if tries:
                    entry["failed_tries"] = tries
            with _lock:
                _cache[key] = (out, entry["result"])
                while len(_cache) > 64:
                    _cache.popitem(last=False)
            entry["sent"] = out
    except Exception as error:
        entry["result"] = "error:" + type(error).__name__
    entry["sent"] = out
    log(entry)
    return out


add_step("language", language_step)


def pipeline(text, **hook):
    """The language step, then every added step in order. Always returns the text to send."""
    for name, step in [("language", language_step)] + [s for s in list(_steps.STEPS) if s[0] != "language"]:
        try:
            made = step(text, **hook)
            if isinstance(made, str) and made.strip():
                text = made
        except Exception:
            continue
    return text


def on_bus(**kwargs):
    """What godspeed-charm and godspeed-coach call, in the bus slot voice_transform: the steps, then
    the bus's own `append` (the coach's picture), which the voice filter used to hand on to."""
    text = str(kwargs.get("response_text") or "")
    out = pipeline(text, **{k: v for k, v in kwargs.items() if k != "response_text"})
    append = getattr(_bus, "append", None)
    try:
        more = append(**dict(kwargs, response_text=out)) if callable(append) else None
        if isinstance(more, str) and more:
            out = more
    except Exception:
        pass
    return out


def on_transform(**kwargs):
    try:
        text = kwargs.get("response_text")
        if not isinstance(text, str) or not text.strip():
            return None
        out = pipeline(text, **{k: v for k, v in kwargs.items() if k != "response_text"})
        return out if out != text else None
    except Exception:
        return None


def register(ctx):
    _bus.voice_transform = on_bus
    ctx.register_hook("transform_llm_output", on_transform)
    # Today's brief in Telegram is the notebook's saved briefing, answered before the model (todays_brief.py).
    try:
        ctx.register_hook("pre_gateway_dispatch", _load("godspeed_reply_todays_brief", "todays_brief.py").make_hook(_home))
    except Exception:
        pass
    if callable(getattr(ctx, "on_unload", None)):
        def detach():
            if getattr(_bus, "voice_transform", None) is on_bus:
                del _bus.voice_transform
        ctx.on_unload(detach)
