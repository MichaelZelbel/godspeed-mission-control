"""godspeed-journal: the open journal tasks, handed to the model before each turn.

Runs `godspeed-journal context` and returns its output as injected context. Every failure returns
None, so a broken journal never breaks the assistant.
"""
import os
import shutil
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))


def _mission_control():
    if os.environ.get("GODSPEED_JOURNAL_DIR"):
        return os.environ["GODSPEED_JOURNAL_DIR"]
    try:
        with open(os.path.join(HERE, "mission-control.txt"), encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return ""


def _bin():
    godspeed_bin = os.path.expanduser("~/.godspeed/bin/godspeed-journal")
    if os.path.exists(godspeed_bin):
        return godspeed_bin
    return shutil.which("godspeed-journal") or os.path.expanduser("~/.local/bin/godspeed-journal")


def on_pre_llm_call(**kwargs):
    try:
        script = os.environ.get("GODSPEED_JOURNAL_SCRIPT")
        args = [os.environ["GODSPEED_NODE"], script, "context"] if script else [_bin(), "context"]
        mc_dir = _mission_control()
        if mc_dir:
            args += ["--godspeed", mc_dir]
        r = subprocess.run(args, capture_output=True, text=True, timeout=5)
        out = (r.stdout or "").strip()
        return {"context": out} if out else None
    except Exception:
        return None


def register(ctx):
    ctx.register_hook("pre_llm_call", on_pre_llm_call)
