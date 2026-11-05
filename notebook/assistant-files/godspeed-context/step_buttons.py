"""A waiting step's question in Telegram, with Yes and No buttons under it.

The buttons themselves (owner check, tokens, one claim per message, the tap) are Godspeed's shared
Yes/No buttons, notebook/assistant-files/godspeed-buttons/buttons.py. This file is the waiting step's
use of them: tokens live in .godspeed/step-buttons/ under the prefix gss1:, and a tap runs
`godspeed-step press <step> yes|no`, which answers that one step and no other.

Why a folder: the process that delivers a report often has no Telegram client (the notebook runs
`hermes cron tick` itself), and the buttons can only be sent from the gateway. So when the notebook
makes a Telegram step answerable it leaves {id, text, expires_at} in .godspeed/step-questions/<id>.json
(notebook/core/waiting-steps.mjs), and the gateway posts the button message for each file it finds.
"""
import asyncio
import importlib.util
import json
import os
import re
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
SHARED = "godspeed_buttons_v1"
# Installed next to this plugin by the notebook's wire-assistant, and next to it in assistant-files too.
_SHARED_PLACES = (os.path.join(HERE, "..", "godspeed-buttons"),)


def _shared():
    if SHARED not in sys.modules:
        file = next(f for f in (os.path.join(d, "buttons.py") for d in _SHARED_PLACES) if os.path.isfile(f))
        spec = importlib.util.spec_from_file_location(SHARED, file)
        module = importlib.util.module_from_spec(spec)
        sys.modules[SHARED] = module
        try:
            spec.loader.exec_module(module)
        except BaseException:
            del sys.modules[SHARED]
            raise
    return sys.modules[SHARED]


buttons = _shared()
PREFIX = "gss1:"
FOLDER = "step-buttons"
CALLBACK = "waiting-step"
QUEUE = "step-questions"
EVERY = 5            # seconds between looks at the hand-off folder
SENT_WITHIN = 60     # seconds to wait for the scheduled send before keeping the file for the next look
STEP_ID = re.compile(r"^step-[0-9a-f-]{36}$")
GENERIC = {"en": "A question is waiting for your answer."}
WORDS = {
    "en": {"buttonYes": "Yes", "buttonNo": "No",
           "noOpenQuestion": "This question has already been answered. Nothing changed.",
           "buttonFailed": "That did not go through. Try again in a moment."},
}


def expiry(item):
    """When the notebook says a hand-off stops being worth posting (epoch seconds); None if it names no time."""
    try:
        when = datetime.fromisoformat(item["expires_at"].replace("Z", "+00:00"))
        return (when if when.tzinfo else when.replace(tzinfo=timezone.utc)).timestamp()
    except (KeyError, ValueError, TypeError, AttributeError):
        return None


class StepButtons(buttons.YesNoButtons):
    def __init__(self, root, command):
        # root(): the mission control folder; command(): the godspeed-step command as a list, or None.
        super().__init__(root, {CALLBACK: self.answer}, prefix=PREFIX, folder=FOLDER)
        self.command = command
        self._local = threading.local()
        self._watching = False

    def texts(self):
        # The shared library takes a message's text from here; `post` sets this step's own question
        # for the thread that calls `offer`.
        question = getattr(self._local, "question", None)
        return {lang: {**words, "question": question or GENERIC[lang]} for lang, words in WORDS.items()}

    def post(self, step_id, text):
        owner = self.owner()
        if not owner:
            return False
        self._local.question = text
        self._local.sending = None
        try:
            if not self.offer(CALLBACK, {"step": step_id}, {"ownerId": owner, "chatId": owner}, "en"):
                return False
            # offer only schedules the send; the question counts as posted once the send itself succeeded.
            return self._local.sending.result(SENT_WITHIN) is True
        except Exception:
            return False
        finally:
            self._local.question = None
            self._local.sending = None

    def deliver(self, app, loop, route, tokens, words):
        sending = super().deliver(app, loop, route, tokens, words)
        self._local.sending = sending
        return sending

    def post_waiting(self):
        """Posts the buttons for every question the notebook handed over; a file stays until it is posted."""
        root = self.root()
        folder = os.path.join(root, ".godspeed", QUEUE) if root else None
        if not folder or not os.path.isdir(folder):
            return
        files = []
        for name in os.listdir(folder):
            file = os.path.join(folder, name)
            try:
                files.append((os.path.getmtime(file), file))
            except OSError:
                continue
        for _, file in sorted(files):
            try:
                with open(file, encoding="utf-8") as f:
                    item = json.load(f)
                if not (isinstance(item, dict) and STEP_ID.match(str(item.get("id"))) and isinstance(item.get("text"), str)
                        and item["text"] and expiry(item) is not None):
                    os.remove(file)
                elif expiry(item) < time.time():
                    os.remove(file)
                elif self.post(item["id"], item["text"]):
                    os.remove(file)
            except Exception:
                continue

    def factory(self, native, adapter):
        super().factory(native, adapter)
        if not self._watching:
            self._watching = True
            asyncio.get_running_loop().create_task(self.watch())

    async def watch(self):
        while self.active:
            await asyncio.sleep(EVERY)
            try:
                await asyncio.to_thread(self.post_waiting)
            except Exception:
                pass

    def answer(self, token):
        """The command's reply to a press: what happened, or why nothing did (exit 2)."""
        command = self.command()
        if not command:
            raise RuntimeError("No godspeed-step command")
        run = subprocess.run(command[:2] + ["press", token["step"], token["answer"]] + command[2:],
                             capture_output=True, text=True, encoding="utf-8", errors="replace",
                             stdin=subprocess.DEVNULL, timeout=25)
        if run.returncode not in (0, 2):
            raise RuntimeError("godspeed-step press failed")
        reply = json.loads(run.stdout).get("reply")
        if not isinstance(reply, str) or not reply:
            raise RuntimeError("godspeed-step press gave no reply")
        return reply

    async def failed(self, context, message, words, language):
        """The press did not go through: the question stays, with its buttons, and says so."""
        notice = WORDS[language if language in WORDS else "en"]["buttonFailed"]
        text = (getattr(message, "text", None) or GENERIC["en"]).removesuffix("\n\n" + notice)
        await self.edit(context, message, text + "\n\n" + notice, reply_markup=getattr(message, "reply_markup", None))
