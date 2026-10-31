"""godspeed-charm: the Charm Challenge, handed to the model before each turn, and on Telegram the
slip question as its own message with Yes and No under it.

pre_llm_call runs `godspeed-charm context` and returns its output as injected context.
post_tool_call notices a successful `godspeed-charm asked` for this very Telegram conversation;
transform_llm_output then takes the question out of the reply, and the question goes out as its
own message with two buttons (telegram_question.py). Every failure returns None, so a broken
challenge never breaks the assistant and the reply goes as the model wrote it.
"""
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import types

HERE = os.path.dirname(os.path.abspath(__file__))
STICKERS = "hermes-telegram-stickers"
SILENT = ("[SILENT]", "SILENT", "[NO_REPLY]", "NO_REPLY")
# The coach's named output bus (godspeed-coach's __init__.py): the coach puts its picture step
# there as `append`, the owner's optional voice filter (mc-voice) as `voice_transform`.
_output_bus = sys.modules.setdefault("godspeed_progress_output_v1", types.ModuleType("godspeed_progress_output_v1"))
_pending_lock = threading.Lock()
_pending = {}  # (session_id, turn_id) -> the question asked in that turn


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


def on_pre_llm_call(**kwargs):
    try:
        args = _base() + ["context"]
        mc_dir = _mission_control()
        if mc_dir:
            args += ["--godspeed", mc_dir]
        platform = str(kwargs.get("platform") or "")
        session_id = str(kwargs.get("session_id") or "")
        if platform and session_id:
            args += ["--conversation", f"{platform}:{session_id}"]
        # A scheduled run is not a conversation with the person: no block at all.
        if platform == "cron" or os.environ.get("GODSPEED_SCHEDULED_RUN"):
            args.append("--scheduled")
        if platform == "telegram" and _stickers_available():
            args.append("--stickers")
        r = subprocess.run(args, capture_output=True, text=True, timeout=_timeout())
        if r.returncode != 0:
            return None
        out = (r.stdout or "").strip()
        return {"context": out} if out else None
    except Exception:
        return None


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


def on_charm_tool(**kwargs):
    """Remember a slip question asked in this turn, in this Telegram conversation. Hermes owns
    the reply; on_charm_reply acts on it."""
    try:
        if _question is None or str(kwargs.get("tool_name") or "") != "terminal":
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
        # The question belongs to the conversation that asked it: only this chat gets buttons.
        conversation = _flag(rest, "conversation")
        if conversation != "telegram:" + session_id:
            return None
        code, output = _tool_output(kwargs.get("result"))
        if code != 0:
            return None
        words = _question.texts()
        if not words:
            return None
        reports = _reports(output)
        asked_when = None
        if reports:
            if reports[-1].get("ok") is not True:
                return None
            reply = str(reports[-1].get("reply") or "")
            questions = ((reports[-1].get("state") or {}).get("open") or [])
            asked_when = next((q.get("when") for q in reversed(questions)
                               if isinstance(q, dict) and q.get("conversation") == conversation), None)
        else:
            reply = output
        if not any(w["question"] in reply for w in words.values()):
            return None
        # A button answers only its own question, named by the moment it was asked. Without
        # --json the command did not say that moment: the record does. No moment, no buttons.
        asked_when = asked_when or _question.asked_when(conversation)
        if not asked_when:
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
    the FIRST non-empty string they return, in plugin load order (alphabetical, so godspeed-charm
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
    """On Telegram, after a slip question was asked in this turn: the reply without the question,
    which comes as its own message with Yes and No. None (the reply as written) otherwise, and
    whenever no button can be sent, so the question is never lost.

    The order matters: take the question out, let the other plugins' work in (_compose), and
    only when the reply is known to go out make the tokens and schedule the question's message.
    A reply held back (a SILENT marker) sends no question: a slip question never arrives alone,
    without the work it belongs to."""
    try:
        key = (str(kwargs.get("session_id") or ""), str(kwargs.get("turn_id") or ""))
        with _pending_lock:
            entry = _pending.pop(key, None)
        if not entry or _question is None or str(kwargs.get("platform") or "") != "telegram":
            return None
        text = str(kwargs.get("response_text") or "")
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
    except Exception:
        return None


def register(ctx):
    ctx.register_hook("pre_llm_call", on_pre_llm_call)
    ctx.register_hook("post_tool_call", on_charm_tool)
    ctx.register_hook("transform_llm_output", on_charm_reply)
    if _question is not None and callable(getattr(ctx, "register_telegram_handler", None)):
        ctx.register_telegram_handler(_question.factory)
    if callable(getattr(ctx, "on_unload", None)):
        def detach():
            with _pending_lock:
                _pending.clear()
            if _question is not None:
                _question.close()
        ctx.on_unload(detach)
