"""godspeed-context: the getting-to-know-you chat, as far as the model needs it before each turn.

Installed by the Godspeed Mission Control notebook (notebook/scripts/wire-assistant.mjs) into
HERMES_HOME/plugins/godspeed-context and enabled there. It reads the chat's state, which the notebook
keeps in <mission control>/.godspeed/context-setup.json (notebook/core/context-setup.mjs).

Why it exists (16 October 2026): about ten minutes after the technical setup a scheduled job sends
the owner one invitation to tell the assistant about themselves. Hermes does not put a message a
scheduled job delivered into the chat the assistant sees next (only with cron.mirror_delivery or a
job's attach_to_session, which its command line cannot set), so a plain "ok" to the invitation
reached an assistant that never saw the invitation. While the invitation waits for an answer, or
the chat is under way, this says so. It also hands the owner's plain yes or no in their private Telegram
chat to `godspeed-step`, which answers the waiting step it belongs to (see waiting_step_block). Every
failure returns None: it never breaks the assistant.

Reports (4 November 2026, #198): for the same reason, every message background work sends is
recorded by the notebook (core/background-reports.mjs) as a conversation_messages record named
background-report-*, and the last few of a day are listed before each reply (reports_block), so
"what is this about?" can be answered from the message itself.

Buttons: a waiting step's question in Telegram is sent once, as one message with Yes and No buttons (step_buttons.py).
"""
import importlib.util
import json
import logging
import os
import re
import subprocess
import time

HERE = os.path.dirname(os.path.abspath(__file__))
# One line per owner turn in the gateway log says what the waiting-step match did, never the words (#372).
log = logging.getLogger("godspeed-step")
INVITED_DAYS = 14   # the invitation says "today or next week"
STARTED_HOURS = 24  # a chat left half way is not followed for ever


def _mission_control():
    try:
        with open(os.path.join(HERE, "mission-control.txt"), encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return ""


def _stamp(stamp):
    from datetime import datetime
    return datetime.fromisoformat(str(stamp).replace("Z", "+00:00")).timestamp()


def _seconds_since(stamp):
    return time.time() - _stamp(stamp)


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


# VOICE REPLIES (25 October 2026, notebook/core/voice-replies.mjs): a voice note is answered with a
# voice note and the same text by Hermes itself. A written request for a spoken answer is the
# assistant's to do with its text_to_speech tool, and without this it sent the voice note with a
# line like "Here is your voice note" instead of the answer. When a message asks about voice replies,
# the assistant is told how they work here and where the voice is chosen.
VOICE_WORDS = re.compile(
    r"\b(?:voice|audio|spoken)[\s-]*(?:notes?|messages?|memos?|repl(?:y|ies)|answers?)\b"
    r"|\b(?:sprach|audio)[\s-]*(?:nachricht|memo|antwort)|\bgesprochene?n? antwort|\bvorles|\blies\b[^.?!]*\bvor\b"
    r"|\bread\b[^.?!]{0,40}\baloud\b|\bout loud\b|\bsprich\b|\bals audio\b|\belevenlabs\b|/voice\b", re.I)


def voice_block(message):
    """The block for a message that asks for a spoken answer or about voice replies, or None."""
    if isinstance(message, list):
        message = " ".join(str(p.get("text", "")) for p in message if isinstance(p, dict))
    if not isinstance(message, str) or not VOICE_WORDS.search(message):
        return None
    return ("[godspeed-voice] If this message asks for a spoken answer (a voice note, an audio message, "
            "reading aloud), write your whole answer as usual and also call text_to_speech once with the "
            "same words, so they get the voice note and the text. If it asks how voice replies work: a voice "
            "note they send is answered with a voice note and the same text; /voice off in a chat stops "
            "that there, /voice tts makes every answer spoken, /voice on goes back. The voice (the free one "
            "or their ElevenLabs voice) is chosen in the notebook: Settings, Voice replies. Never ask for "
            "an ElevenLabs key in this chat.")


REPORT_HOURS = 24  # a day's worth
REPORT_MAX = 5
REPORTS_HEADER = ("[godspeed-reports] Sent by background work, in your name, to this chat (newest first). These are "
                  "your own messages; when they ask about one (\"what is this about?\"), answer from it and its "
                  "facts. Never ask them to type a code.")


def reports_block(root, platform, now=None):
    """The block listing the reports sent to this kind of chat in the last day, or None."""
    folder = os.path.join(root, "notebook", "_system", "conversation_messages")
    to = "telegram" if platform == "telegram" else "notebook"
    now = now or time.time()
    found = []
    for name in os.listdir(folder):
        if not name.endswith(".json"):
            continue
        try:
            with open(os.path.join(folder, name), encoding="utf-8") as f:
                r = json.load(f)
            sent = r["sent_at"]
            if r.get("source_app") != "background" or r.get("delivered_to") != to or r.get("removed_at") or not 0 <= now - _stamp(sent) < REPORT_HOURS * 3600:
                continue
            found.append((sent, r))
        except Exception:
            continue
    found.sort(key=lambda p: _stamp(p[0]), reverse=True)
    lines = []
    for sent, r in found[:REPORT_MAX]:
        info = r.get("report") if isinstance(r.get("report"), dict) else {}
        line = "- %s UTC, about %s: \"%s\"" % (str(sent)[:16].replace("T", " "), info.get("about") or "something", str(r.get("content", ""))[:600])
        facts = [str(x) for x in info.get("facts") or [] if x]
        if facts and info.get("written") != "routine":
            line += "\n  Facts: " + "; ".join(facts)[:300]
        if info.get("steps") or info.get("step"):
            line += "\n  A step waits for their yes."
        lines.append(line)
    return REPORTS_HEADER + "\n" + "\n".join(lines) if lines else None


def _backup_command():
    try:
        with open(os.path.join(HERE, "backup-command.txt"), encoding="utf-8") as f:
            return f.read().strip() or None
    except OSError:
        return None


# A WAITING STEP (issue #196): background work asks the owner for a yes with `godspeed-step open`, and
# the owner answers with a plain yes or no. The program matches the answer to the step before the model
# runs (notebook/core/waiting-steps.mjs); this hands it the owner's message, in the owner's own private
# Telegram chat only, and tells the model what happened or to ask which one is meant.
def _owner_telegram(session_id):
    try:
        from gateway.session_context import get_session_env
        got = {field: str(get_session_env("HERMES_SESSION_" + field, "") or "")
               for field in ("PLATFORM", "CHAT_ID", "CHAT_TYPE", "USER_ID", "ID")}
        owner = os.environ.get("TELEGRAM_ALLOWED_USERS", "").strip()
        return (re.fullmatch(r"[1-9][0-9]*", owner) is not None and got["PLATFORM"] == "telegram"
                and got["CHAT_TYPE"] in ("dm", "private") and got["CHAT_ID"] == owner
                and got["USER_ID"] == owner and got["ID"] == session_id)
    except (ImportError, AttributeError):
        return False


def _step_command():
    try:
        with open(os.path.join(HERE, "step-command.txt"), encoding="utf-8") as f:
            command = json.load(f)
        return command if isinstance(command, list) and len(command) >= 3 else None
    except (OSError, ValueError):
        return None


# The match could not be made: a plain yes or no may have been meant for a waiting step, so the owner
# is asked to send it again rather than having it handled as an ordinary message. No diagnostics.
STEP_RETRY_BLOCK = ("[godspeed-step] Your waiting questions could not be checked just now. If your owner's message is only a "
                    "plain yes or no, tell them in one sentence that you could not process it and to send it again in a "
                    "moment, and do nothing else with it. Otherwise ignore this note.")


def step_block(report):
    """The context the step command returned, whatever kind of result carried it, or None."""
    if isinstance(report, dict) and isinstance(report.get("context"), str):
        return report["context"] or None
    return None


def _step_timeout():
    try:
        return float(os.environ.get("GODSPEED_STEP_PLUGIN_TIMEOUT") or 5)
    except ValueError:
        return 5


def _text(message):
    if isinstance(message, list):
        message = " ".join(str(p.get("text", "")) for p in message if isinstance(p, dict))
    return message if isinstance(message, str) else ""


def _note(line, *args):
    try:
        log.info("godspeed-step (telegram): " + line, *args)
    except Exception:
        pass


def waiting_step_block(message, session_id):
    command = _step_command()
    if not command or not _text(message).strip():
        return None
    words = len(_text(message).split())
    if not _owner_telegram(session_id):
        _note("a message of %d words was not matched: not the owner's private chat in this session", words)
        return None
    try:
        run = subprocess.run(command[:2] + ["heard", "--chat", "telegram"] + command[2:], input=_text(message),
                             capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=_step_timeout())
        if run.returncode == 0:
            report = json.loads(run.stdout)
            _note("a message of %d words was heard as %s", words, report.get("kind") if isinstance(report, dict) else "nothing")
            return step_block(report)
        last = (run.stderr or "").strip().splitlines()[-1:] or ["no error output"]
        _note("a message of %d words could not be matched: the step command exited %d (%s)", words, run.returncode, last[0][:200])
    except subprocess.TimeoutExpired:
        _note("a message of %d words could not be matched: the step command took longer than %ss", words, _step_timeout())
    except Exception as e:
        _note("a message of %d words could not be matched: %s", words, type(e).__name__)
    return STEP_RETRY_BLOCK


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
        try:
            blocks.append(voice_block(kwargs.get("user_message")))
        except Exception:
            pass
        try:
            if str(kwargs.get("platform") or "") == "telegram":
                blocks.append(waiting_step_block(kwargs.get("user_message"), str(kwargs.get("session_id") or "")))
        except Exception:
            pass
        root = _mission_control()
        if root:
            try:
                with open(os.path.join(root, ".godspeed", "context-setup.json"), encoding="utf-8") as f:
                    blocks.append(context_block(json.load(f)))
            except Exception:
                pass
            try:
                blocks.append(reports_block(root, kwargs.get("platform")))
            except Exception:
                pass
        blocks = [b for b in blocks if b]
        return {"context": "\n\n".join(blocks)} if blocks else None
    except Exception:
        return None


def _step_buttons():
    try:
        spec = importlib.util.spec_from_file_location("godspeed_context_step_buttons", os.path.join(HERE, "step_buttons.py"))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module.StepButtons(_mission_control, _step_command)
    except Exception:
        return None


_buttons = _step_buttons()


def register(ctx):
    ctx.register_hook("pre_llm_call", on_pre_llm_call)
    if _buttons is not None and callable(getattr(ctx, "register_telegram_handler", None)):
        ctx.register_telegram_handler(_buttons.factory)
        if callable(getattr(ctx, "on_unload", None)):
            ctx.on_unload(_buttons.close)
