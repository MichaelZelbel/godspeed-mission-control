"""godspeed-charm: the Charm Challenge, handed to the model before each turn.

Runs `godspeed-charm context` and returns its output as injected context. Every failure returns
None, so a broken challenge never breaks the assistant.
"""
import os
import shutil
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
STICKERS = "hermes-telegram-stickers"


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


def _timeout():
    # Five seconds is Hermes' own patience with this hook; the variable exists for the tests.
    try:
        return float(os.environ.get("GODSPEED_CHARM_PLUGIN_TIMEOUT") or 5)
    except ValueError:
        return 5.0


def _enabled_plugins(config_path):
    """The names under plugins.enabled in Hermes' config.yaml, or None when it cannot be read."""
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
        elif in_plugins and text == "enabled:":
            in_enabled = True
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
        # The Godspeed notebook names the command it ships (GODSPEED_CHARM_SCRIPT) and its node.
        script = os.environ.get("GODSPEED_CHARM_SCRIPT")
        args = [os.environ.get("GODSPEED_NODE", "node"), script, "context"] if script else [_bin(), "context"]
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


def register(ctx):
    ctx.register_hook("pre_llm_call", on_pre_llm_call)
