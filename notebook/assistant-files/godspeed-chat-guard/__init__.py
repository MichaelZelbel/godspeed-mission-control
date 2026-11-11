"""godspeed-chat-guard: the Telegram chat never goes silent because the Hermes code under it changed.

Installed by the Godspeed Mission Control notebook (notebook/scripts/wire-assistant.mjs) into
HERMES_HOME/plugins/godspeed-chat-guard and enabled there.

Why it exists (issue #384): on 10 November 2026 something outside Godspeed updated the Hermes copy the
chat runs on. The gateway process kept the old code in memory, every later turn loaded new files into
it and failed, an incoming message failed inside the Telegram handler ("No error handlers are
registered"), and the owner heard nothing for hours. So, inside the gateway only (its Telegram factory
runs nowhere else):

- Code watch: the revision of the Hermes checkout this process was loaded from is read once, then
  every minute. Once a different readable revision is seen twice in a row, the process sends itself
  SIGUSR1, Hermes' own drain-aware restart, which exits 75 so the service starts the new code. If it is
  still alive five minutes later it exits 75 itself. The revision is read from the .git files, as
  Hermes does, never with git: git refuses a checkout another account owns, which is exactly the
  layout this happened on. An unreadable revision never restarts anything.
- A failed message or turn of the owner's gets one plain sentence (PLAIN) in the chat it came from,
  their private chat or a group, and is saved
  to <mission control>/.godspeed/chat-guard/unanswered.jsonl, or logged where it cannot be saved. Only
  the standard library and already loaded modules are used on that path: a lazy Hermes import is what
  fails in a stale process.

A file named self-restart-off beside this one turns the restart off (it is how the broken state is
reproduced on purpose to check the chat's health check).
"""
import inspect
import json
import logging
import os
import re
import signal
import sys
import threading
import time
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
EVERY = 60          # seconds between reads of the checkout's revision
GRACE = 300         # seconds Hermes' own restart gets before the process exits by itself
RESTART_EXIT = 75   # the exit code Hermes' service restarts on
KEEP = 500          # unanswered messages kept
PLAIN = ("Sorry, something went wrong on my side and I could not answer that. "
         "Your message is saved, and the problem is being fixed.")
PLAIN_UNSAVED = ("Sorry, something went wrong on my side and I could not answer that. "
                 "Please send it again a little later.")
SHA = re.compile(r"^[0-9a-f]{40}([0-9a-f]{24})?$")

log = logging.getLogger("godspeed-chat-guard")


def _read(file):
    with open(file, encoding="utf-8") as f:
        return f.read().strip()


def checkout_revision(root):
    """The commit the checkout at root is on, from its .git files, or None. Never raises."""
    try:
        git = os.path.join(root, ".git")
        if os.path.isfile(git):
            line = _read(git)
            if not line.startswith("gitdir:"):
                return None
            gitdir = os.path.join(root, line[len("gitdir:"):].strip())
        elif os.path.isdir(git):
            gitdir = git
        else:
            return None
        common = gitdir
        if os.path.isfile(os.path.join(gitdir, "commondir")):
            common = os.path.join(gitdir, _read(os.path.join(gitdir, "commondir")))
        head = _read(os.path.join(gitdir, "HEAD"))
        if not head.startswith("ref:"):
            return head if SHA.match(head) else None
        ref = head[len("ref:"):].strip()
        for base in (gitdir, common):
            loose = os.path.join(base, *ref.split("/"))
            if os.path.isfile(loose):
                sha = _read(loose)
                return sha if SHA.match(sha) else None
        packed = os.path.join(common, "packed-refs")
        if os.path.isfile(packed):
            with open(packed, encoding="utf-8") as f:
                for line in f:
                    parts = line.strip().split(" ", 1)
                    if len(parts) == 2 and parts[1] == ref and SHA.match(parts[0]):
                        return parts[0]
        return None
    except Exception:
        return None


def hermes_root():
    """The folder of the Hermes code this process loaded, or None."""
    module = sys.modules.get("hermes_constants")
    file = getattr(module, "__file__", None)
    return os.path.dirname(os.path.abspath(file)) if file else None


def owner_ids():
    return {part.strip() for part in os.environ.get("TELEGRAM_ALLOWED_USERS", "").split(",")
            if re.fullmatch(r"[1-9][0-9]*", part.strip())}


def allowed(user_id):
    return user_id is not None and str(user_id) in owner_ids()


def mission_control():
    try:
        return _read(os.path.join(HERE, "mission-control.txt"))
    except OSError:
        return ""


def save_unanswered(root, entry):
    """Appends one message to the unanswered list, keeping the newest KEEP. Returns whether it was saved."""
    if not root:
        return False
    try:
        folder = os.path.join(root, ".godspeed", "chat-guard")
        os.makedirs(folder, exist_ok=True)
        file = os.path.join(folder, "unanswered.jsonl")
        try:
            with open(file, encoding="utf-8") as f:
                lines = [line for line in f.read().splitlines() if line.strip()]
        except FileNotFoundError:
            lines = []
        lines = (lines + [json.dumps(entry, ensure_ascii=False)])[-KEEP:]
        temporary = file + ".tmp"
        with open(temporary, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
        os.replace(temporary, file)
        return True
    except Exception:
        log.exception("godspeed-chat-guard: an unanswered message could not be saved")
        return False


def unanswered(chat_id, message_id, text, why):
    return {"at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"), "source": "telegram",
            "chat_id": str(chat_id), "message_id": message_id, "text": text or "[a message without text]", "why": why}


def keep(chat_id, message_id, text, why):
    """Saves a message that got no answer, or logs it where it cannot be saved, and returns the
    sentence to answer it with."""
    entry = unanswered(chat_id, message_id, text, why)
    if save_unanswered(mission_control(), entry):
        return PLAIN
    log.error("godspeed-chat-guard: an unanswered message that could not be saved: %s", json.dumps(entry, ensure_ascii=False))
    return PLAIN_UNSAVED


class Watch:
    def __init__(self, root, read=checkout_revision, signal_self=None, hard_exit=None, sleep=time.sleep, off=None):
        self.root, self.read, self.sleep = root, read, sleep
        self.signal_self = signal_self or (lambda: os.kill(os.getpid(), signal.SIGUSR1))
        self.hard_exit = hard_exit or os._exit
        self.off = off or (lambda: os.path.exists(os.path.join(HERE, "self-restart-off")))
        self.boot = read(root)
        self.seen, self.count, self.reported = None, 0, None

    def step(self):
        """One look at the checkout: "restart" once it changed on two looks in a row, else None."""
        now = self.read(self.root)
        if now is None or now == self.boot:
            self.seen, self.count = None, 0
            return None
        self.count = self.count + 1 if now == self.seen else 1
        self.seen = now
        if self.count < 2:
            return None
        if self.off():
            if self.reported != now:
                self.reported = now
                log.warning("godspeed-chat-guard: the Hermes code changed (%s -> %s); restarting is switched off here",
                            self.boot[:10], now[:10])
            return None
        log.warning("godspeed-chat-guard: the Hermes code changed (%s -> %s); restarting the chat", self.boot[:10], now[:10])
        if self.foreign():
            log.warning("godspeed-chat-guard: this Hermes copy belongs to another account, so Godspeed cannot finish its update")
        self.signal_self()
        return "restart"

    def foreign(self):
        try:
            return os.stat(self.root).st_uid != os.getuid()
        except (OSError, AttributeError):
            return False

    def run(self):
        while True:
            self.sleep(EVERY)
            try:
                restarting = self.step() == "restart"
            except Exception:
                log.exception("godspeed-chat-guard: the Hermes code could not be checked")
                continue
            if restarting:
                self.sleep(GRACE)
                self.hard_exit(RESTART_EXIT)
                return


_watching = False


def start_watch(root=None):
    """Starts the code watch once per process, where a restart signal exists and the revision is readable."""
    global _watching
    if _watching or not hasattr(signal, "SIGUSR1"):
        return None
    root = root or hermes_root()
    watch = Watch(root) if root else None
    if watch is None or watch.boot is None:
        return None
    _watching = True
    threading.Thread(target=watch.run, name="godspeed-chat-guard", daemon=True).start()
    return watch


_answered = set()


def first_answer(chat_id, message_id):
    """True once per message, so a message both failure paths see gets one sentence. Without a
    message id there is nothing to tell two failures apart by, so each is answered."""
    if message_id is None:
        return True
    key = (str(chat_id), str(message_id))
    if key in _answered:
        return False
    if len(_answered) > 1000:
        _answered.clear()
    _answered.add(key)
    return True


def forget(chat_id, message_id):
    """The sentence for this message was not delivered, so the next failure path may try again."""
    _answered.discard((str(chat_id), str(message_id)))


def owner_turn(event):
    """Whether a Hermes event is the owner's own message, in their private chat or a group (not an
    internal wake or notice Hermes made itself)."""
    try:
        source = getattr(event, "source", None)
        return (not getattr(event, "internal", False) and getattr(source, "chat_id", None) is not None
                and allowed(getattr(source, "user_id", None)))
    except Exception:
        return False


async def on_error(update, context):
    """python-telegram-bot's error handler: logs the error, and a message from the owner gets PLAIN in
    the chat it came from."""
    try:
        log.error("godspeed-chat-guard: a Telegram update failed", exc_info=getattr(context, "error", None))
        message, chat, user = (getattr(update, name, None) for name in ("effective_message", "effective_chat", "effective_user"))
        if message is None or chat is None or not allowed(getattr(user, "id", None)):
            return
        if not first_answer(chat.id, message.message_id):
            return
        sentence = keep(chat.id, message.message_id, getattr(message, "text", None) or getattr(message, "caption", None), "handler")
        try:
            await context.bot.send_message(chat_id=chat.id, text=sentence)
        except Exception:
            forget(chat.id, message.message_id)
            raise
    except Exception:
        log.exception("godspeed-chat-guard: the plain reply could not be sent")


def wrap_turn_error(adapter, native):
    """Replaces adapter._notify_turn_error so a turn whose error escaped Hermes' turn handler gets PLAIN
    for the owner, and no error name. An error inside the model turn itself never comes
    here: Hermes answers it with its own reply, which wrap_agent_error_reply replaces."""
    current = getattr(adapter, "_notify_turn_error", None)
    if getattr(current, "godspeed_wrapped", False):
        current.godspeed_native = native
        return True
    if not callable(current):
        log.warning("godspeed-chat-guard: this Hermes has no failed-turn notice to replace; failed turns keep Hermes' own")
        return False

    async def notify(event, error, *args, **kwargs):
        if not owner_turn(event):
            result = current(event, error, *args, **kwargs)
            return await result if inspect.isawaitable(result) else result
        chat_id, message_id = event.source.chat_id, getattr(event, "message_id", None)
        try:
            if not first_answer(chat_id, message_id):
                return None
            sentence = keep(chat_id, message_id, getattr(event, "text", None), "turn")
            try:
                await notify.godspeed_native.bot.send_message(chat_id=int(chat_id), text=sentence)
            except Exception:
                forget(chat_id, message_id)
                raise
        except Exception:
            log.exception("godspeed-chat-guard: the plain reply could not be sent")
        return None

    notify.godspeed_wrapped = True
    notify.godspeed_native = native
    adapter._notify_turn_error = notify
    return True


def wrap_agent_error_reply(runner_class):
    """Replaces the reply Hermes gives when a model turn raises (it names commands and the log) with
    PLAIN for the owner. Hermes' own handling still runs first: it logs the error, keeps
    the message in the conversation and marks the turn failed."""
    current = getattr(runner_class, "_hmwa_agent_error_reply", None)
    if getattr(current, "godspeed_wrapped", False):
        return True
    if not callable(current):
        log.warning("godspeed-chat-guard: this Hermes has no reply for a failed model turn to replace; it keeps its own")
        return False

    async def reply(self, error, event, *args, **kwargs):
        if not owner_turn(event):
            return await current(self, error, event, *args, **kwargs)
        try:
            await current(self, error, event, *args, **kwargs)
        except Exception:
            log.exception("godspeed-chat-guard: Hermes' handling of a failed model turn failed too")
        return keep(event.source.chat_id, getattr(event, "message_id", None), getattr(event, "text", None), "model turn")

    reply.godspeed_wrapped = True
    runner_class._hmwa_agent_error_reply = reply
    return True


def factory(native, adapter):
    start_watch()
    native.add_error_handler(on_error)
    wrap_turn_error(adapter, native)
    # The gateway this factory runs in has loaded its runner already; importing it here could fail in a stale process.
    wrap_agent_error_reply(getattr(sys.modules.get("gateway.run"), "GatewayRunner", None))


def register(ctx):
    # Nothing starts at import: a command-line Hermes or a cron worker loads plugins too.
    if callable(getattr(ctx, "register_telegram_handler", None)):
        ctx.register_telegram_handler(factory)
