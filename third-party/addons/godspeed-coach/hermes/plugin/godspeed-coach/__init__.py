"""godspeed-coach: the open talk and the habit check, handed to the model before each turn.

Runs `godspeed-coach context` and returns its output as injected context. Every failure returns
None, so a broken coach never breaks the assistant.
"""
import os
import shutil
import subprocess
import json
import threading
import time
import sys
import types
import re

HERE = os.path.dirname(os.path.abspath(__file__))
_progress_lock = threading.Lock()
_progress_pending = {}
_output_bus = sys.modules.setdefault("godspeed_progress_output_v1", types.ModuleType("godspeed_progress_output_v1"))


def _progress_values(result):
    """Unwrap only the result of the trusted notebook operation, not searched records."""
    if isinstance(result, str):
        try:
            result = json.loads(result)
        except (ValueError, TypeError):
            return []
    if not isinstance(result, dict) or result.get("isError") or result.get("ok") is False or result.get("success") is False:
        return []
    if isinstance(result.get("result"), dict):
        return _progress_values(result["result"])
    if isinstance(result.get("content"), list):
        return [value for block in result["content"] if block.get("type") == "text"
                for value in _progress_values(block.get("text", ""))]
    if result.get("exit_code", 0) != 0:
        return []
    if isinstance(result.get("output"), str):
        return _progress_values(result["output"])
    if isinstance(result.get("habits"), list):
        return [habit for habit in result["habits"] if isinstance(habit, dict) and habit.get("progress", {}).get("version") == 1]
    habit = result.get("progressCard") or result.get("habit")
    if isinstance(habit, dict) and isinstance(habit.get("progress"), dict) and habit["progress"].get("version") == 1:
        return [habit]
    return []


def on_progress_tool(**kwargs):
    """Remember local pictures for this turn. Hermes owns the actual reply and delivery."""
    name = str(kwargs.get("tool_name") or "")
    args = kwargs.get("args") or {}
    if kwargs.get("status") not in (None, "success", "ok"):
        return None
    notebook = name.endswith("personal_operation") and args.get("type") in ("track", "tracker-correct", "habit-observe", "habit-progress")
    command = str(args.get("command") or "")
    coach_cli = name == "terminal" and "--json" in command and re.search(
        r"(?:^|[/\\\s'\"])godspeed-coach(?:\.mjs)?['\"]?\s+habit\s+(?:track|untrack|answer|progress|display|pause|resume|exempt)\b", command)
    if not notebook and not coach_cli:
        return None
    key = (str(kwargs.get("session_id") or ""), str(kwargs.get("turn_id") or ""))
    if not all(key):
        return None
    try:
        with open(os.path.join(HERE, "progress-renderer.txt"), encoding="utf-8") as f:
            script = f.read().strip()
        node = os.environ.get("GODSPEED_NODE") or shutil.which("node")
        if not script or not node:
            return None
        for habit in _progress_values(kwargs.get("result")):
            env = dict(os.environ, GODSPEED_WORKSPACE=_mission_control())
            render = subprocess.run([node, script], input=json.dumps({"habit": habit, "requestId": ":".join(key), "locale": args.get("language") or os.environ.get("GODSPEED_PROGRESS_LOCALE") or "en"}),
                                    env=env, capture_output=True, text=True, timeout=12)
            if render.returncode:
                continue
            image = json.loads(render.stdout)
            file = os.path.realpath(image["path"])
            cache = os.path.realpath(os.path.join(_mission_control(), ".godspeed", "habit-progress"))
            if os.path.commonpath([cache, file]) != cache or not file.endswith(".png") or not os.path.isfile(file):
                continue
            with _progress_lock:
                now = time.monotonic()
                for old, entry in list(_progress_pending.items()):
                    if now - entry["at"] > 900:
                        _progress_pending.pop(old, None)
                while len(_progress_pending) > 200:
                    _progress_pending.pop(next(iter(_progress_pending)))
                entry = _progress_pending.setdefault(key, {"at": now, "paths": {}})
                entry["paths"][habit.get("id") or habit.get("name")] = file
        return None
    except Exception:
        # The operation already succeeded. A picture failure must keep the ordinary text reply.
        return None


def on_progress_reply(**kwargs):
    key = (str(kwargs.get("session_id") or ""), str(kwargs.get("turn_id") or ""))
    with _progress_lock:
        entry = _progress_pending.pop(key, None)
    if str(kwargs.get("platform") or "") != "telegram" or not entry:
        return None
    response = str(kwargs.get("response_text") or "")
    if response.strip() in ("[SILENT]", "[NO_REPLY]", "NO_REPLY"):
        return None
    paths = list(entry["paths"].values())
    # A repeated finalizer call cannot append twice, and the gateway deduplicates existing tags.
    tags = ["MEDIA:" + file for file in paths if file not in response]
    return response + ("\n\n" + "\n".join(tags) if tags else "")


def on_progress_transform(**kwargs):
    """Compose with Michael's optional voice filter without relying on plugin load order.

    This small named module is an explicit integration API, not Hermes manager introspection.
    mc-voice registers its transformer and calls append after repairing the text. Standalone
    installations have no voice transformer and simply append their own progress picture.
    """
    key = (str(kwargs.get("session_id") or ""), str(kwargs.get("turn_id") or ""))
    with _progress_lock:
        pending = key in _progress_pending
    voice = getattr(_output_bus, "voice_transform", None)
    if pending and callable(voice):
        return voice(**kwargs)
    return on_progress_reply(**kwargs)


def _mission_control():
    if os.environ.get("GODSPEED_COACH_DIR"):
        return os.environ["GODSPEED_COACH_DIR"]
    try:
        with open(os.path.join(HERE, "mission-control.txt"), encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return ""


def _bin():
    godspeed_bin = os.path.expanduser("~/.godspeed/bin/godspeed-coach")
    if os.path.exists(godspeed_bin):
        return godspeed_bin
    return shutil.which("godspeed-coach") or os.path.expanduser("~/.local/bin/godspeed-coach")


def on_pre_llm_call(**kwargs):
    try:
        script = os.environ.get("GODSPEED_COACH_SCRIPT")
        args = [os.environ["GODSPEED_NODE"], script, "context"] if script else [_bin(), "context"]
        mc_dir = _mission_control()
        if mc_dir:
            args += ["--godspeed", mc_dir]
        # A scheduled run is not a conversation with them: a talk waiting for the chat (no
        # messenger) must not be used up by a routine nobody reads.
        if str(kwargs.get("platform") or "") == "cron" or os.environ.get("GODSPEED_SCHEDULED_RUN"):
            args.append("--scheduled")
        r = subprocess.run(args, capture_output=True, text=True, timeout=5)
        out = (r.stdout or "").strip()
        return {"context": out} if out else None
    except Exception:
        return None


def register(ctx):
    ctx.register_hook("pre_llm_call", on_pre_llm_call)
    ctx.register_hook("post_tool_call", on_progress_tool)
    _output_bus.append = on_progress_reply
    ctx.register_hook("transform_llm_output", on_progress_transform)
    if callable(getattr(ctx, "on_unload", None)):
        def detach_progress():
            if getattr(_output_bus, "append", None) is on_progress_reply:
                del _output_bus.append
            with _progress_lock:
                _progress_pending.clear()
        ctx.on_unload(detach_progress)
