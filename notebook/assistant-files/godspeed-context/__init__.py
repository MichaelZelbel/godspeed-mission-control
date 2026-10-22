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
import re
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


# A BACKUP AI (22 October 2026): a second AI the owner connects themselves, used only when the main
# one fails (notebook/core/backup-ai.mjs). When a message asks about one, the assistant is told the
# way that exists on this installation: /backupai in Telegram on the one-click server (the notebook
# writes backup-command.txt here then), Settings everywhere. A key must never be typed into the chat,
# where the main AI would read it.
BACKUP_WORDS = re.compile(
    r"\b(?:backup|back-up|fallback|second|spare|reserve|ersatz|zweite[nrs]?)[\s-]*(?:ai|ki|model|modell|llm|provider)\b"
    r"|\b(?:ai|ki|model|modell)[\s-]*(?:backup|fallback)\b|/backupai\b", re.I)


def backup_block(message, command=None):
    """The block for a message about a backup AI, or None."""
    if isinstance(message, list):
        message = " ".join(str(p.get("text", "")) for p in message if isinstance(p, dict))
    if not isinstance(message, str) or not BACKUP_WORDS.search(message):
        return None
    where = ("they send %s here in Telegram: it opens a short setup that needs no AI and deletes a key from "
             "the chat once it has read it. Or, in the notebook: Settings, Your AI, Backup AI." % command) if command else (
             "in the notebook: Settings, Your AI, Backup AI. A ChatGPT plan or another sign-in as the backup: "
             "the guide page godspeedmissioncontrol.com/guide/backup-ai.")
    return ("[godspeed-backup-ai] A backup AI is a second AI your owner connects themselves. Godspeed uses it "
            "only when the main AI fails, and only for that one request. To connect, see or remove it, %s "
            "Tell them that. Never ask for an API key in this chat, and do not change the AI settings yourself." % where)


def _backup_command():
    try:
        with open(os.path.join(HERE, "backup-command.txt"), encoding="utf-8") as f:
            return f.read().strip() or None
    except OSError:
        return None


def on_pre_llm_call(**kwargs):
    try:
        # A scheduled run is not a conversation with the owner.
        if str(kwargs.get("platform") or "") == "cron" or os.environ.get("GODSPEED_SCHEDULED_RUN"):
            return None
        blocks = []
        try:
            blocks.append(backup_block(kwargs.get("user_message"), _backup_command()))
        except Exception:
            pass
        root = _mission_control()
        if root:
            try:
                with open(os.path.join(root, ".godspeed", "context-setup.json"), encoding="utf-8") as f:
                    blocks.append(context_block(json.load(f)))
            except Exception:
                pass
        blocks = [b for b in blocks if b]
        return {"context": "\n\n".join(blocks)} if blocks else None
    except Exception:
        return None


def register(ctx):
    ctx.register_hook("pre_llm_call", on_pre_llm_call)
