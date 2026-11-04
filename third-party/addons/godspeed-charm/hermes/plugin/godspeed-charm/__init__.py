"""godspeed-charm: the Charm Challenge, handed to the model before each turn, and on Telegram the
slip question as its own message with Yes and No under it.

pre_llm_call runs `godspeed-charm context` and returns its output as injected context; that run
also leaves the turn marker (.godspeed/charm-turns) the command falls back on. pre_tool_call adds
this session's --conversation to a `godspeed-charm asked|start|answer` typed without one
(Hermes v2026.9.24 applies a hook's {"action": "modify"} args and passes them to post_tool_call).
post_tool_call notices a successful `godspeed-charm asked` for this very Telegram conversation;
transform_llm_output then takes the question out of the reply, and the question goes out as its
own message with two buttons (telegram_question.py). Every failure returns None, so a broken
challenge never breaks the assistant and the reply goes as the model wrote it.

The slip question is the program's, not the model's choice: pre_llm_call starts `godspeed-charm
judge` on the person's message while the model works, and transform_llm_output acts on its verdict
on every platform: it records the question (`asked`) and ends the reply with it, or records a plain
yes or no the model did not (`answer`).
"""
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import types
import hashlib
import collections

HERE = os.path.dirname(os.path.abspath(__file__))
STICKERS = "hermes-telegram-stickers"
SILENT = ("[SILENT]", "SILENT", "[NO_REPLY]", "NO_REPLY")
# The coach's named output bus (godspeed-coach's __init__.py): the coach puts its picture step
# there as `append`, the owner's optional voice filter (mc-voice) as `voice_transform`.
_output_bus = sys.modules.setdefault("godspeed_progress_output_v1", types.ModuleType("godspeed_progress_output_v1"))
_pending_lock = threading.Lock()
_pending = {}  # (session_id, turn_id) -> the question asked in that turn
_model_asked_turns = {}  # (session_id, turn_id) -> the conversation of the question the model itself asked in that turn
_asked_before = {}  # (session_id, turn_id) -> (conversation, moment of its open question before an `asked` call)
_platforms = {}  # session_id -> the platform of its latest turn (never a scheduled one)
_turns = collections.OrderedDict()  # session_id -> the judged turn in flight (see _start_judge)
LOG_LIMIT = 1_000_000


def _mission_control():
    if os.environ.get("GODSPEED_CHARM_DIR"):
        return os.environ["GODSPEED_CHARM_DIR"]
    try:
        with open(os.path.join(HERE, "mission-control.txt"), encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return ""


def _bin():
    godspeed_bin = os.path.expanduser("~/.godspeed/bin/godspeed-charm")
    if os.path.exists(godspeed_bin):
        return godspeed_bin
    return shutil.which("godspeed-charm") or os.path.expanduser("~/.local/bin/godspeed-charm")


def _base():
    # The Godspeed notebook names the command it ships (GODSPEED_CHARM_SCRIPT) and its node.
    script = os.environ.get("GODSPEED_CHARM_SCRIPT")
    return [os.environ.get("GODSPEED_NODE", "node"), script] if script else [_bin()]


def _command(*args):
    """The add-on command with these arguments, for this mission control."""
    mc_dir = _mission_control()
    return _base() + list(args) + (["--godspeed", mc_dir] if mc_dir else [])


def _timeout():
    # Five seconds is Hermes' own patience with this hook; the variable exists for the tests.
    try:
        return float(os.environ.get("GODSPEED_CHARM_PLUGIN_TIMEOUT") or 5)
    except ValueError:
        return 5.0


try:
    _telegram_spec = importlib.util.spec_from_file_location("godspeed_charm_telegram_question", os.path.join(HERE, "telegram_question.py"))
    _telegram_module = importlib.util.module_from_spec(_telegram_spec)
    _telegram_spec.loader.exec_module(_telegram_module)
    _question = _telegram_module.QuestionTelegram(lambda: _mission_control(), _command)
except Exception:
    # Without the buttons the challenge still works: the question stays in the reply.
    _telegram_module, _question = None, None


def _enabled_plugins(config_path):
    """The names under plugins.enabled in Hermes' config.yaml, or None when it cannot be read.
    Both ways of writing the list count: one name per `- name` line, and the one-line
    `enabled: ["a", "b"]` the notebook's wire-assistant writes."""
    try:
        with open(config_path, encoding="utf-8") as f:
            lines = f.read().splitlines()
    except OSError:
        return None
    names, in_plugins, in_enabled = set(), False, False
    for raw in lines:
        line = raw.split("#", 1)[0].rstrip()
        if not line.strip():
            continue
        indent = len(line) - len(line.lstrip())
        text = line.strip()
        if indent == 0:
            in_plugins, in_enabled = text == "plugins:", False
        elif in_plugins and text.startswith("enabled:"):
            rest = text[len("enabled:"):].strip()
            in_enabled = not rest
            if rest.startswith("[") and rest.endswith("]"):
                names.update(n.strip().strip("'\"") for n in rest[1:-1].split(",") if n.strip().strip("'\""))
        elif in_plugins and in_enabled and text.startswith("- "):
            names.add(text[2:].strip().strip("'\""))
        elif in_plugins and not text.startswith("- "):
            in_enabled = False
    return names


def _stickers_available():
    """True when the hermes-telegram-stickers plugin sits next to this one and, if Hermes' config
    can be read, is enabled there. Never raises: any doubt means no sticker."""
    try:
        plugins_dir = os.path.dirname(HERE)
        if not os.path.isdir(os.path.join(plugins_dir, STICKERS)):
            return False
        enabled = _enabled_plugins(os.path.join(os.path.dirname(plugins_dir), "config.yaml"))
        return True if enabled is None else STICKERS in enabled
    except Exception:
        return False


def _remember_platform(session_id, platform, scheduled):
    if not session_id:
        return
    with _pending_lock:
        if scheduled or not platform:
            _platforms.pop(session_id, None)
            return
        _platforms.pop(session_id, None)
        _platforms[session_id] = platform
        while len(_platforms) > 200:
            _platforms.pop(next(iter(_platforms)))


def on_pre_llm_call(**kwargs):
    try:
        args = _base() + ["context"]
        mc_dir = _mission_control()
        if mc_dir:
            args += ["--godspeed", mc_dir]
        platform = str(kwargs.get("platform") or "")
        session_id = str(kwargs.get("session_id") or "")
        if platform and session_id:
            args += ["--conversation", f"{platform}:{session_id}", "--program-asks"]
        # A scheduled run is not a conversation with the person: no block at all, no turn marker
        # (the command writes it) and no conversation for its commands (_remember_platform). It
        # leaves the session's interactive turn alone: on_charm_reply ignores scheduled replies.
        scheduled = platform == "cron" or bool(os.environ.get("GODSPEED_SCHEDULED_RUN"))
        _remember_platform(session_id, platform, scheduled)
        if scheduled:
            args.append("--scheduled")
        else:
            _start_judge(session_id, platform, kwargs.get("user_message"))
        if platform == "telegram" and _stickers_available():
            args.append("--stickers")
        r = subprocess.run(args, capture_output=True, text=True, timeout=_timeout())
        if r.returncode != 0:
            return None
        out = (r.stdout or "").strip()
        return {"context": out} if out else None
    except Exception:
        return None


# ---- The program's judgement of the message ----------------------------------------------------
def _home():
    return os.environ.get("HERMES_HOME") or os.path.dirname(os.path.dirname(HERE))


def _model_command():
    """The installation's own godspeed-model, or None where it is not installed."""
    path = os.path.join(_home(), "bin", "godspeed-model" + (".cmd" if os.name == "nt" else ""))
    return path if os.path.isfile(path) else None


def _judge_seconds():
    # Until 25 seconds after the turn began; the variable exists for the tests.
    try:
        return float(os.environ.get("GODSPEED_CHARM_JUDGE_SECONDS") or 25)
    except ValueError:
        return 25.0


def _words_of(message):
    if isinstance(message, list):
        message = " ".join(str(p.get("text", "")) for p in message if isinstance(p, dict))
    return message.strip() if isinstance(message, str) else ""


def _judge_command(turn, *extra):
    return _command("judge", "--conversation", turn["conversation"], "--words-file", turn["file"], "--json", *extra)


def _verdict_of(stdout):
    for line in reversed((stdout or "").splitlines()):
        if line.strip().startswith("{"):
            try:
                value = json.loads(line)
            except ValueError:
                continue
            if isinstance(value, dict) and value.get("ok") is True and value.get("verdict") in ("ask", "answer", "none"):
                return value
    return None


def _run_judge(turn, extra, timeout):
    try:
        r = subprocess.run(_judge_command(turn, *extra), capture_output=True, text=True, encoding="utf-8",
                           errors="replace", stdin=subprocess.DEVNULL, timeout=timeout)
        return _verdict_of(r.stdout) if r.returncode == 0 else None
    except Exception:
        return None


def _forget(turn):
    try:
        os.remove(turn["file"])
    except OSError:
        pass


def _start_judge(session_id, platform, message):
    """Start the judgement of this turn's message on a thread, so it runs while the model works.
    Hermes runs one turn per session at a time, so the session id is the key."""
    words = _words_of(message)
    if not session_id or not platform or not words:
        return
    digest = hashlib.sha256(words.encode("utf-8")).hexdigest()
    with _pending_lock:
        old = _turns.pop(session_id, None)
        if old and old["hash"] == digest and not old["replied"]:
            _turns[session_id] = old
            return
    if old:
        _forget(old)
    handle, file = tempfile.mkstemp(prefix="godspeed-charm-", suffix=".txt")
    with os.fdopen(handle, "w", encoding="utf-8") as f:
        f.write(words)
    model = _model_command()
    turn = {"conversation": f"{platform}:{session_id}", "file": file, "hash": digest, "began": time.monotonic(),
            "result": None, "replied": False, "done": {}}
    deadline = _judge_seconds()

    def work():
        turn["result"] = _run_judge(turn, ["--model-command", model] if model else ["--no-model"], deadline)

    turn["thread"] = threading.Thread(target=work, daemon=True)
    with _pending_lock:
        _turns[session_id] = turn
        while len(_turns) > 200:
            _forget(_turns.pop(next(iter(_turns))))
    turn["thread"].start()


def _verdict(turn):
    """The verdict, waiting for it until at most the judge's seconds after the turn began; after
    that the word check alone (`judge --no-model`)."""
    turn["thread"].join(max(0.0, turn["began"] + _judge_seconds() - time.monotonic()))
    return turn["result"] or _run_judge(turn, ["--no-model"], _timeout())


def _log(turn, verdict, did):
    try:
        folder = os.path.join(_home(), "logs")
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, "godspeed-charm.log")
        if os.path.exists(path) and os.path.getsize(path) > LOG_LIMIT:
            os.replace(path, path + ".1")
        entry = {"at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "conversation": turn["conversation"],
                 "verdict": (verdict or {}).get("verdict"), "source": (verdict or {}).get("source"),
                 "why": (verdict or {}).get("why"), "did": did}
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception:
        pass


def _record(turn, verdict, *args):
    """A `godspeed-charm asked|answer` for this turn's conversation and words: its {ok, reply, state}
    report on success (exit 0), else None."""
    language = verdict.get("language")
    r = subprocess.run(_command(*args, "--conversation", turn["conversation"], "--words-file", turn["file"], "--json",
                                *(["--language", language] if language == "de" else [])),
                       capture_output=True, text=True, encoding="utf-8", errors="replace", stdin=subprocess.DEVNULL, timeout=_timeout())
    reports = _reports(r.stdout) if r.returncode == 0 else []
    return reports[-1] if reports and reports[-1].get("ok") is True and reports[-1].get("reply") else None


def _ending(out, reply):
    return out if reply in out else out.rstrip() + "\n\n" + reply


def _judged_reply(turn, session_id, text, kwargs, model_asked=False):
    """What the judged turn makes of the reply `text`, and what was done: (text or None, did)."""
    verdict = _verdict(turn)
    if verdict is None or verdict["verdict"] == "none":
        return None, "nothing"
    if verdict["verdict"] == "answer":
        report = _record(turn, verdict, "answer", verdict["answer"])
        if report is None:
            return None, "no answer recorded (the model had, or none was open)"
        return _ending(_compose(text, kwargs), report["reply"]), "answered " + verdict["answer"]
    if model_asked:
        return None, "the model asked itself"
    report = _record(turn, verdict, "asked")
    if report is None:
        return None, "asked refused"
    reply = str(report["reply"])
    if str(kwargs.get("platform") or "") == "telegram" and _question is not None:
        conversation = turn["conversation"]
        language = verdict.get("language")
        entry = {"conversation": conversation, "askedWhen": _asked_when(report, conversation), "reply": reply,
                 "language": language if language in (_question.texts() or {}) else None,
                 "route": _question.route(session_id), "at": time.monotonic()}
        plan = _question.prepare(entry, text)
        if plan is not None:
            out = _compose(plan["text"], kwargs)
            if out.strip() in SILENT:
                return out, "asked"
            if _question.post(entry, plan["language"]):
                return (out if plan["found"] or out != text else None), "asked with buttons"
    return _ending(_compose(text, kwargs), reply), "asked"


# ---- The slip question on Telegram ------------------------------------------------------------
# `godspeed-charm asked`, as the model types it in Hermes' terminal tool: the launcher, the .mjs
# script run by node, or the Windows .cmd.
_ASKED = re.compile(r"(?:^|[/\\\s'\"&;|(])godspeed-charm(?:\.mjs|\.cmd)?['\"]?\s+asked(?=\s|$)")


def _flag(command, name):
    m = re.search(r"--" + re.escape(name) + r"\s+(?:\"([^\"]*)\"|'([^']*)'|([^\s\"';|&]+))", command)
    return next((g for g in m.groups() if g is not None), None) if m else None


def _tool_output(result):
    """(exit code, output) of Hermes' terminal tool result."""
    if isinstance(result, str):
        try:
            result = json.loads(result)
        except ValueError:
            return None, result
    if not isinstance(result, dict):
        return None, ""
    return result.get("exit_code"), str(result.get("output") or "")


def _reports(output):
    """The {ok, reply, state} objects `--json` printed, in order."""
    found = []
    for line in output.splitlines():
        line = line.strip()
        if line.startswith("{"):
            try:
                value = json.loads(line)
            except ValueError:
                continue
            if isinstance(value, dict) and "ok" in value and "reply" in value:
                found.append(value)
    return found


def _asked_when(report, conversation):
    """The moment the question open in `conversation` was asked, from a command's report."""
    questions = (report.get("state") or {}).get("open") or []
    return next((q.get("when") for q in reversed(questions)
                 if isinstance(q, dict) and q.get("conversation") == conversation), None)


def _open_asked(conversation):
    """The moment the question open in `conversation` was asked, read from the record itself
    (`godspeed-charm status --json`), or None. The one reader of that fact, on every platform."""
    try:
        r = subprocess.run(_command("status", "--json"), capture_output=True, text=True, encoding="utf-8",
                           errors="replace", stdin=subprocess.DEVNULL, timeout=_timeout())
        reports = _reports(r.stdout) if r.returncode == 0 else []
        questions = ((reports[-1] if reports else {}).get("state") or {}).get("open") or []
        return next((q.get("when") for q in questions if isinstance(q, dict)
                     and q.get("conversation") == conversation and isinstance(q.get("when"), str)), None)
    except (OSError, ValueError, subprocess.SubprocessError):
        return None


def _asked_by_this_call(session_id, turn_id, conversation):
    """The moment of the question this very `asked` call recorded for `conversation`, or None.
    Only the record counts, and only a change since pre_tool_call: terminal output and the command
    line are text anyone can print, and an older open question is not this call's."""
    with _pending_lock:
        before = _asked_before.pop((session_id, turn_id), None)
    if before is None or before[0] != conversation:
        return None
    now = _open_asked(conversation)
    return now if now is not None and now != before[1] else None


def on_charm_tool(**kwargs):
    """Remember a slip question asked in this turn, in this Telegram conversation. Hermes owns
    the reply; on_charm_reply acts on it."""
    try:
        if str(kwargs.get("tool_name") or "") != "terminal":
            return None
        if kwargs.get("status") not in (None, "success", "ok"):
            return None
        command = str((kwargs.get("args") or {}).get("command") or "")
        m = _ASKED.search(command)
        if not m:
            return None
        session_id, turn_id = str(kwargs.get("session_id") or ""), str(kwargs.get("turn_id") or "")
        if not session_id or not turn_id:
            return None
        rest = command[m.end():]
        conversation = _flag(rest, "conversation")
        code, output = _tool_output(kwargs.get("result"))
        if code != 0:
            return None
        asked_when = _asked_by_this_call(session_id, turn_id, conversation)
        if asked_when is None:
            return None
        # On any platform a question the model asked itself is that conversation's one question.
        with _pending_lock:
            _model_asked_turns[(session_id, turn_id)] = conversation
            while len(_model_asked_turns) > 200:
                _model_asked_turns.pop(next(iter(_model_asked_turns)))
        # The question belongs to the conversation that asked it: only this chat gets buttons.
        if _question is None or conversation != "telegram:" + session_id:
            return None
        words = _question.texts()
        if not words:
            return None
        reports = _reports(output)
        reply = str(reports[-1].get("reply") or "") if reports else output
        if not any(w["question"] in reply for w in words.values()):
            return None
        language = _flag(rest, "language")
        entry = {"conversation": conversation, "askedWhen": asked_when, "reply": reply,
                 "language": language if language in words else None,
                 "route": _question.route(session_id), "at": time.monotonic()}
        with _pending_lock:
            now = time.monotonic()
            for old, value in list(_pending.items()):
                if now - value["at"] > 900:
                    _pending.pop(old, None)
            while len(_pending) > 200:
                _pending.pop(next(iter(_pending)))
            _pending[(session_id, turn_id)] = entry
        return None
    except Exception:
        return None


_COMMAND = re.compile(r"(?:^|[/\\\s'\"&;|(])godspeed-charm(?:\.mjs|\.cmd)?['\"]?\s+(?:asked|start|answer)(?=\s|$)")
_SAFE = re.compile(r"^[A-Za-z0-9_.:-]+$")


def on_charm_before_tool(**kwargs):
    """Hermes' pre_tool_call: a `godspeed-charm asked|start|answer` the model types in the terminal
    without --conversation gets this session's conversation, so the model never copies the id.
    An explicit --conversation is left alone; a scheduled run has no conversation. None otherwise."""
    try:
        if str(kwargs.get("tool_name") or "") != "terminal" or os.environ.get("GODSPEED_SCHEDULED_RUN"):
            return None
        args = kwargs.get("args") or {}
        command = str(args.get("command") or "")
        m = _COMMAND.search(command)
        if not m:
            return None
        session_id, turn_id = str(kwargs.get("session_id") or ""), str(kwargs.get("turn_id") or "")
        result = None
        if not re.search(r"--conversation(?:\s|=)", command):
            with _pending_lock:
                platform = _platforms.get(session_id)
            conversation = f"{platform}:{session_id}" if platform and session_id else ""
            if not conversation or not _SAFE.match(conversation):
                return None
            command = command[:m.end()] + f' --conversation "{conversation}"' + command[m.end():]
            result = {"action": "modify", "args": {**args, "command": command}}
        asked = _ASKED.search(command)
        conversation = _flag(command[asked.end():], "conversation") if asked else None
        if conversation and session_id and turn_id:
            before = _open_asked(conversation)
            with _pending_lock:
                _asked_before[(session_id, turn_id)] = (conversation, before)
                while len(_asked_before) > 200:
                    _asked_before.pop(next(iter(_asked_before)))
        return result
    except Exception:
        return None


def _sticker_plugin():
    """The hermes-telegram-stickers plugin's own module, when Hermes loaded it in this process."""
    for module in list(sys.modules.values()):
        try:
            if getattr(module, "NAME", None) == STICKERS and callable(getattr(module, "strip_tags", None)):
                return module
        except Exception:
            continue  # a module whose attributes cannot be read is not the sticker plugin
    return None


def _compose(text, kwargs):
    """What the other plugins' transforms would have made of `text`, minus what they already did.

    Hermes calls every transform_llm_output callback with the same original reply and keeps only
    the FIRST non-empty string they return, in plugin load order (sorted by key, requires_plugins first; checked in v0.22.7, so godspeed-charm
    runs before godspeed-coach, hermes-telegram-stickers and mc-voice). The results are not
    chained. So when this plugin returns a reply, it carries their work itself:
    - the coach's picture and the owner's voice filter through the coach's own named bus, exactly
      as the coach composes with the voice filter: the voice filter when there is one (it hands
      on to the coach itself), else the coach's step. The coach's step runs once per turn, so its
      own later call adds nothing twice.
    - the sticker plugin's tags, removed with its own strip_tags. It already sent the sticker in
      its own call, from the original reply; only its returned text would have been lost.
    """
    payload = dict(kwargs, response_text=text)
    voice = getattr(_output_bus, "voice_transform", None)
    append = getattr(_output_bus, "append", None)
    try:
        out = voice(**payload) if callable(voice) else append(**payload) if callable(append) else None
        if isinstance(out, str) and out:
            text = out
    except Exception:
        pass
    try:
        stickers = _sticker_plugin()
        if stickers:
            text = stickers.strip_tags(text) or _telegram_module.POINTER
    except Exception:
        pass
    return text


def on_charm_reply(**kwargs):
    """The reply with the slip question the program asks, or a yes or no it records, and the
    Telegram buttons for the question. None (the reply as written) whenever there is nothing to
    add, and on every failure, so the question is never lost and the reply is never held back.

    A question the model itself asked in this Telegram turn (on_charm_tool) goes on as before
    (_model_asked); otherwise the turn's judgement decides (_judged_reply). A second call for the
    same reply returns what the first one did and records nothing again."""
    try:
        session_id, turn_id = str(kwargs.get("session_id") or ""), str(kwargs.get("turn_id") or "")
        if str(kwargs.get("platform") or "") == "cron" or os.environ.get("GODSPEED_SCHEDULED_RUN"):
            return None
        with _pending_lock:
            entry = _pending.pop((session_id, turn_id), None)
            asked_in = _model_asked_turns.pop((session_id, turn_id), None)
            turn = _turns.get(session_id)
        model_asked = turn is not None and asked_in == turn["conversation"]
        text = str(kwargs.get("response_text") or "")
        key = hashlib.sha256(text.encode("utf-8")).hexdigest()
        if turn is not None and key in turn["done"]:
            return turn["done"][key]
        if entry is not None:
            out, did = _model_asked(entry, text, kwargs), "the model's own question"
        elif turn is None or not text.strip() or text.strip() in SILENT:
            return None
        else:
            try:
                out, did = _judged_reply(turn, session_id, text, kwargs, model_asked)
            except Exception as error:
                out, did = None, "failed: " + type(error).__name__
        if turn is not None:
            _log(turn, turn["result"], did)
            turn["replied"] = True
            turn["done"][key] = out
            _forget(turn)
        return out
    except Exception:
        return None


def _model_asked(entry, text, kwargs):
    """On Telegram, after the model itself asked the slip question in this turn: the reply without
    the question, which comes as its own message with Yes and No. None otherwise, and whenever no
    button can be sent, so the question is never lost.

    The order matters: take the question out, let the other plugins' work in (_compose), and
    only when the reply is known to go out make the tokens and schedule the question's message.
    A reply held back (a SILENT marker) sends no question: a slip question never arrives alone,
    without the work it belongs to."""
    if _question is None or str(kwargs.get("platform") or "") != "telegram":
        return None
    if not text.strip() or text.strip() in SILENT:
        return None
    plan = _question.prepare(entry, text)
    if plan is None:
        return None
    out = _compose(plan["text"], kwargs)
    if out.strip() in SILENT:
        return out
    if not _question.post(entry, plan["language"]):
        # No buttons after all: the question stays in the reply.
        if not plan["found"]:
            return out if out != text else None
        if out == plan["text"]:
            return None  # nothing else changed it: the reply exactly as the model wrote it
        return out.rstrip() + "\n\n" + plan["question"]
    return out if plan["found"] or out != text else None


def register(ctx):
    ctx.register_hook("pre_llm_call", on_pre_llm_call)
    ctx.register_hook("pre_tool_call", on_charm_before_tool)
    ctx.register_hook("post_tool_call", on_charm_tool)
    ctx.register_hook("transform_llm_output", on_charm_reply)
    if _question is not None and callable(getattr(ctx, "register_telegram_handler", None)):
        ctx.register_telegram_handler(_question.factory)
    if callable(getattr(ctx, "on_unload", None)):
        def detach():
            with _pending_lock:
                _pending.clear()
                _asked_before.clear()
                _platforms.clear()
                for turn in _turns.values():
                    _forget(turn)
                _turns.clear()
            if _question is not None:
                _question.close()
        ctx.on_unload(detach)
