"""The slip question as its own Telegram message, with Yes and No under it, on Hermes' own Telegram
client. No polling, no second bot.

The buttons themselves (owner check, tokens, one claim per message, the tap) are Godspeed's shared
Yes/No buttons, notebook/assistant-files/godspeed-buttons/buttons.py. This file is Charm's use of
them: its tokens live in .godspeed/charm-buttons/ under the prefix gsc1:, and a tap runs the
add-on's own command (`godspeed-charm answer yes|no --conversation <C> --words "(button)"`), which
alone decides whether a question is open.
"""
import importlib.util
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SHARED = "godspeed_buttons_v1"
# Installed next to this plugin by the notebook's wire-assistant; in a checkout, in the notebook's
# assistant-files. Without it Charm has no buttons and the question stays in the reply.
_SHARED_PLACES = (os.path.join(HERE, "..", "godspeed-buttons"),
                  os.path.join(HERE, "..", "..", "..", "..", "..", "..", "notebook", "assistant-files", "godspeed-buttons"))


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
PREFIX = "gsc1:"
FOLDER = "charm-buttons"
CALLBACK = "charm-slip"
# A reply that was nothing but the question would come back empty, and Hermes then sends the
# original text, question included. This points at the question below instead, in any language.
POINTER = "\U0001F447"
# The same few emphasis marks the model may wrap a sentence in ("**...**", "_..._").
_EMPHASIS = r"(\*\*|__|\*|_)?"


def remove_question(text, questions):
    """`text` without the exact question sentence, and the language whose question was found.

    `questions` maps a language to its question, word for word as the add-on says it. Every
    occurrence goes, with emphasis around it; the blank lines it leaves are closed up. Returns
    (text, None) unchanged when no question is in it."""
    found, out = None, text
    for lang, question in questions.items():
        pattern = re.compile(r"[ \t]*" + _EMPHASIS + re.escape(question) + r"(?(1)\1)")
        if pattern.search(out):
            out, found = pattern.sub("", out), lang
    if found is None:
        return text, None
    out = re.sub(r"[ \t]+\n", "\n", out)
    out = re.sub(r"\n{3,}", "\n\n", out)
    return out.strip(), found


class QuestionTelegram(buttons.YesNoButtons):
    def __init__(self, root, command):
        # root(): the mission control folder; command(*args): the add-on command as a list.
        super().__init__(root, {CALLBACK: self.answer}, prefix=PREFIX, folder=FOLDER, default_id=CALLBACK)
        self.command = command
        self._texts = None

    # ---- the add-on's own words and command -------------------------------------------------
    def run(self, *args, timeout=5):
        return subprocess.run(self.command(*args), capture_output=True, text=True, encoding="utf-8",
                              errors="replace", stdin=subprocess.DEVNULL, timeout=timeout)

    def texts(self):
        """{language: {question, buttonYes, buttonNo, noOpenQuestion, buttonFailed}}, or None."""
        if self._texts:
            return self._texts
        try:
            r = self.run("texts")
            value = json.loads(r.stdout) if r.returncode == 0 else None
        except (OSError, ValueError, subprocess.SubprocessError):
            return None
        keys = ("question", "buttonYes", "buttonNo", "noOpenQuestion", "buttonFailed")
        if not isinstance(value, dict) or "en" not in value or not all(
                isinstance(words, dict) and all(isinstance(words.get(k), str) and words[k] for k in keys)
                for words in value.values()):
            return None
        self._texts = value
        return value

    @staticmethod
    def report(stdout):
        """The last {ok, reply, state} object a `--json` command printed, or None."""
        for line in reversed((stdout or "").splitlines()):
            if line.strip().startswith("{"):
                try:
                    value = json.loads(line)
                except ValueError:
                    continue
                if isinstance(value, dict) and "ok" in value and "reply" in value:
                    return value
        return None

    def asked_when(self, conversation):
        """The moment the question open in `conversation` was asked, from the record, or None."""
        try:
            r = self.run("status", "--json")
            value = self.report(r.stdout) if r.returncode == 0 else None
            questions = ((value or {}).get("state") or {}).get("open") or []
            return next((q.get("when") for q in questions if isinstance(q, dict)
                         and q.get("conversation") == conversation and isinstance(q.get("when"), str)), None)
        except (OSError, ValueError, subprocess.SubprocessError):
            return None

    def answer(self, token):
        """The command's reply to a tap: what happened, or why nothing did (exit 2). The question
        is named by the moment it was asked, so the tap answers that question or none."""
        r = self.run("answer", token["answer"], "--conversation", token["conversation"],
                     "--asked-when", token["askedWhen"], "--words", "(button)", "--json",
                     "--language", token["language"], timeout=25)
        if r.returncode not in (0, 2):
            raise RuntimeError("godspeed-charm answer failed")
        value = self.report(r.stdout)
        if not value or not isinstance(value.get("reply"), str) or not value["reply"]:
            raise RuntimeError("godspeed-charm answer gave no reply")
        return value["reply"]

    def prepare(self, entry, text):
        """What the reply becomes when the question goes as its own message:
        {"text", "found", "language", "question"}. None when no button can be sent here (no
        owner's private chat, no single Telegram client, the add-on's words or the question's
        moment unknown): the reply then goes as written, question and all. Sends nothing yet."""
        route = entry.get("route")
        if not self.active or not route or not entry.get("askedWhen") or not self.client():
            return None
        words = self.texts()
        if not words:
            return None
        cleaned, found = remove_question(text, {lang: w["question"] for lang, w in words.items()})
        reply = str(entry.get("reply") or "")
        language = found or entry.get("language") or next(
            (lang for lang, w in words.items() if w["question"] in reply), None) or "en"
        if language not in words:
            language = "en"
        return {"text": (cleaned or POINTER) if found else text, "found": found is not None,
                "language": language, "question": words[language]["question"]}

    def post(self, entry, language):
        """Last of all, once the reply is known to go out: the question's message, with the
        conversation and the moment it was asked kept behind its buttons."""
        fields = {"conversation": entry["conversation"], "askedWhen": entry.get("askedWhen")}
        return self.offer(CALLBACK, fields, entry["route"], language)
