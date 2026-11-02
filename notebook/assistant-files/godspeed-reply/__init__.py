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

Every failure sends the reply as the model wrote it: this plugin never drops or delays a reply
beyond the one request's limit (REQUEST_SECONDS).
"""
import collections
import hashlib
import json
import os
import re
import sqlite3
import subprocess
import sys
import threading
import time
import types

HERE = os.path.dirname(os.path.abspath(__file__))
REQUEST_SECONDS = 25
MIN_SIGNALS = 3        # words that tell the language, in the text, before it counts as clearly one
MIN_SHARE = 0.8        # of those words, the share that must belong to the one language
LOG_LIMIT = 1_000_000
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
ENGLISH = set("""the a and or but is are be to of on at for with from by i you we it this that my your what how
when where why do does did done have has had not would can could should just then if about me us they he she
his our their there here these those been get got make let now new look like which more some any much next
today thanks please yes tell finished starting working""".split())
GERMAN = set("""der die das den dem des ein eine einen einem einer und oder aber ist sind nicht ich du wir ihr
es mit von für auf zu zum zur im dass wie wo woran wann warum hat habe haben bin auch noch schon mir mich
dich dir kein keine mein meine dein deine fertig heute bitte danke ja nein merkst jetzt nur wenn dann bei
aus nach über kann können soll muss werden wird gerade heißt woher wieso welche""".split())
GERMAN_LETTERS = re.compile(r"[äöüßÄÖÜ]")
WORD = re.compile(r"[A-Za-zÄÖÜäöüß']+")
URL = re.compile(r"https?://[^\s<>()\[\]]+|www\.[^\s<>()\[\]]+")
CODE = re.compile(r"```.*?```|`[^`\n]+`", re.S)
QUOTE = re.compile(r'"[^"\n]{2,}"|“[^”\n]{2,}”|„[^“”\n]{2,}[“”]|«[^»\n]{2,}»')
MEDIA = re.compile(r"^[ \t]*MEDIA:[^\n]*$", re.M)


def _plain(text):
    for pattern in (CODE, URL, MEDIA, QUOTE):
        text = pattern.sub(" ", text)
    return text


def language_of(text):
    """"en", "de" or None. Only clear text has a language: enough words of one language that the
    other's are a small part. Mixed text, a word or two, and everything in a quote or link: None."""
    if not isinstance(text, str):
        return None
    plain = _plain(text)
    words = [w.lower().strip("'") for w in WORD.findall(plain)]
    en = sum(w in ENGLISH for w in words)
    de = sum(w in GERMAN for w in words) + len(GERMAN_LETTERS.findall(plain))
    total = en + de
    if total < MIN_SIGNALS:
        return None
    if en / total >= MIN_SHARE:
        return "en"
    if de / total >= MIN_SHARE:
        return "de"
    return None


REQUEST_VERB = re.compile(r"\b(?:answer|reply|respond|write|speak|say|tell|translate|talk|antworte\w*|schreib\w*|"
                          r"sag\w*|sprich\w*|übersetz\w*|rede\w*|bitte|please)\b", re.I)
ASKED = {"de": re.compile(r"\b(?:in|into|to|auf)\s+(?:german|deutsch)\b|\bins\s+deutsche\b|\bdeutsch\s+bitte\b", re.I),
         "en": re.compile(r"\b(?:in|into|to|auf)\s+(?:english|englisch)\b|\bins\s+englische\b|\benglish\s+please\b", re.I)}


def asked_language(message):
    """The language the latest message asks for ("answer in German", "translate this into English"),
    the later request when it names both, else None."""
    if not isinstance(message, str) or not REQUEST_VERB.search(message):
        return None
    found = [(m.start(), lang) for lang, pattern in ASKED.items() for m in pattern.finditer(message)]
    return max(found)[1] if found else None


# ---------------------------------------------------------------- the person's latest message
def _home():
    return os.environ.get("HERMES_HOME") or os.path.dirname(os.path.dirname(HERE))


def _text_of(content):
    if isinstance(content, str) and content.lstrip().startswith("["):
        try:
            content = json.loads(content)
        except ValueError:
            return content
    if isinstance(content, list):
        return " ".join(str(p.get("text", "")) for p in content if isinstance(p, dict))
    return content if isinstance(content, str) else ""


def latest_message(session_id):
    """(the person's latest message in the session, the session's source) from Hermes' own store.
    Hermes writes the turn's inbound message before it runs the model."""
    if not session_id:
        return "", ""
    db = os.path.join(_home(), "state.db")
    if not os.path.exists(db):
        return "", ""
    conn = sqlite3.connect("file:%s?mode=ro" % db.replace("\\", "/"), uri=True, timeout=2)
    try:
        row = conn.execute("SELECT content FROM messages WHERE session_id=? AND role='user' "
                           "ORDER BY id DESC LIMIT 1", (session_id,)).fetchone()
        src = conn.execute("SELECT source FROM sessions WHERE id=?", (session_id,)).fetchone()
    finally:
        conn.close()
    return _text_of(row[0]) if row else "", str(src[0] if src and src[0] else "")


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


def translate(text, target):
    """(the translation, "") or (None, why not). One request through the notebook's godspeed-model."""
    command = _model_command()
    if not command:
        return None, "no-model-command"
    held, kept = _protect(text)
    system = ("You translate faithfully, nothing else. Keep the meaning, tone and layout (line breaks, lists, "
              "emoji) exactly. Keep every name, number, date and time as it is. Every marker like {{1}} stays "
              "in the translation exactly once, unchanged, in the right place. Add nothing, explain nothing, "
              "answer nothing: reply with the translated text only.")
    prompt = "Translate into %s:\n\n%s" % (NAMES[target], held)
    request = {"system": system, "prompt": prompt, "timeout_ms": REQUEST_SECONDS * 1000,
               "max_tokens": max(256, min(8192, len(held) // 2 + 512))}
    try:
        done = subprocess.run([command], input=json.dumps(request), capture_output=True, text=True,
                              encoding="utf-8", timeout=REQUEST_SECONDS + 5)
    except Exception as error:
        return None, "request-failed:" + type(error).__name__
    if done.returncode != 0:
        return None, "request-failed"
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
    if language_of(answer) == language_of(text) or answer == text:
        return None, "still-the-wrong-language"
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
        message, source = latest_message(session)
        key = (session, hashlib.sha256(text.encode("utf-8")).hexdigest(), hashlib.sha256(message.encode("utf-8")).hexdigest())
        with _lock:
            known = _cache.get(key)
        if platform in SCHEDULED or source in SCHEDULED or os.environ.get("GODSPEED_SCHEDULED_RUN"):
            entry["result"] = "scheduled"
        elif known is not None:
            out, entry["result"] = known
        else:
            asked = asked_language(message)
            target = asked or language_of(message)
            draft = language_of(text)
            entry.update(message_language=target, asked=bool(asked), draft_language=draft)
            if target and draft and target != draft:
                fixed, why = translate(text, target)
                if fixed:
                    out, entry["result"] = fixed, "corrected"
                else:
                    entry["result"] = "correction-failed:" + why
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
    if callable(getattr(ctx, "on_unload", None)):
        def detach():
            if getattr(_bus, "voice_transform", None) is on_bus:
                del _bus.voice_transform
        ctx.on_unload(detach)
