"""godspeed-context: the getting-to-know-you chat, as far as the model needs it before each turn.

Installed by the Godspeed Mission Control notebook (notebook/scripts/wire-assistant.mjs) into
HERMES_HOME/plugins/godspeed-context and enabled there. It reads the chat's state, which the notebook
keeps in <mission control>/.godspeed/context-setup.json (notebook/core/context-setup.mjs).

Why it exists (16 October 2026): about ten minutes after the technical setup a scheduled job sends
the owner one invitation to tell the assistant about themselves. Hermes does not put a message a
scheduled job delivered into the chat the assistant sees next (only with cron.mirror_delivery or a
job's attach_to_session, which its command line cannot set), so a plain "ok" to the invitation
reached an assistant that never saw the invitation. While the invitation waits for an answer, or
the chat is under way, this says so. Every failure returns None: it never breaks the assistant.
"""
import json
import os
import time

HERE = os.path.dirname(os.path.abspath(__file__))
INVITED_DAYS = 14   # the invitation says "today or next week"
STARTED_HOURS = 24  # a chat left half way is not followed for ever


def _mission_control():
    try:
        with open(os.path.join(HERE, "mission-control.txt"), encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return ""


def _seconds_since(stamp):
    from datetime import datetime
    return time.time() - datetime.fromisoformat(str(stamp).replace("Z", "+00:00")).timestamp()


def context_block(state):
    """The block for one state of the chat, or None."""
    if not isinstance(state, dict):
        return None
    if state.get("state") == "invited" and _seconds_since(state.get("invited_at")) < INVITED_DAYS * 86400:
        return ("[godspeed-context] You sent your owner one invitation in Telegram, at %s (UTC), to the "
                "getting-to-know-you chat:\n\"%s\"\nThey have not answered it yet. If this message answers it "
                "(\"ok\", \"yes\", \"let's go\", \"sure\", a city, or something about themselves), follow the "
                "context-setup recipe now. If it is about something else, answer that and do not bring the "
                "invitation up." % (str(state.get("invited_at", ""))[:16].replace("T", " "),
                                    state.get("invitation") or "Shall we take five minutes so I get to know you?"))
    if state.get("state") == "started" and _seconds_since(state.get("updated_at") or state.get("started_at")) < STARTED_HOURS * 3600:
        return ("[godspeed-context] You are in the getting-to-know-you chat with your owner (the context-setup "
                "recipe). If this message answers your last question there, go on as that recipe says.")
    return None


def on_pre_llm_call(**kwargs):
    try:
        # A scheduled run is not a conversation with the owner.
        if str(kwargs.get("platform") or "") == "cron" or os.environ.get("GODSPEED_SCHEDULED_RUN"):
            return None
        root = _mission_control()
        if not root:
            return None
        with open(os.path.join(root, ".godspeed", "context-setup.json"), encoding="utf-8") as f:
            block = context_block(json.load(f))
        return {"context": block} if block else None
    except Exception:
        return None


def register(ctx):
    ctx.register_hook("pre_llm_call", on_pre_llm_call)
