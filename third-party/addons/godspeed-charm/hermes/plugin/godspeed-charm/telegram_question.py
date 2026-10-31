"""The slip question as its own Telegram message, with Yes and No under it, on Hermes' own Telegram
client. No polling, no second bot.

The pattern is the coach's habit buttons (godspeed-coach's telegram_progress.py and the notebook's
habit-buttons.mjs): one owner (TELEGRAM_ALLOWED_USERS holds exactly one id), a private chat, the
bot's own message, and an opaque token behind each button, kept under the workspace in
.godspeed/charm-buttons/<token>.json. A token binds the conversation that asked, when it asked,
when the token was made and the answer its button gives. A tap runs the add-on's own command
(`godspeed-charm answer yes|no --conversation <C> --words "(button)"`), which alone decides
whether a question is open; the message then says what the command said, and the buttons go.
Both buttons of one message share one claim, so a message is answered at most once.
"""
import asyncio
import json
import os
import re
import secrets
import subprocess
import time

PREFIX = "gsc1:"
DATA = re.compile(r"^gsc1:([a-f0-9]{32})$")
HEX = re.compile(r"^[a-f0-9]{32}$")
RETENTION = 30 * 86400  # seconds; habit-button tokens are kept as long
MAX_TOKENS = 4096
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


class QuestionTelegram:
    def __init__(self, root, command):
        # root(): the mission control folder; command(*args): the add-on command as a list.
        self.root, self.command = root, command
        self.clients = {}
        self.active = True
        self._texts = None

    # ---- who may tap, and where the question goes -------------------------------------------
    @staticmethod
    def owner():
        # An open gateway or several allowed users cannot establish one owner.
        raw = os.environ.get("TELEGRAM_ALLOWED_USERS", "").strip()
        return raw if re.fullmatch(r"[1-9][0-9]*", raw) else None

    def route(self, session_id):
        """The owner's private chat this session answers, from Hermes' own record of the turn."""
        try:
            from gateway.session_context import get_session_env
            route = {key: str(get_session_env("HERMES_SESSION_" + field, "") or "")
                     for key, field in (("platform", "PLATFORM"), ("chatId", "CHAT_ID"),
                                        ("chatType", "CHAT_TYPE"), ("userId", "USER_ID"),
                                        ("sessionId", "ID"), ("replyTo", "MESSAGE_ID"),
                                        ("threadId", "THREAD_ID"))}
            owner = self.owner()
            if not owner or route["platform"] != "telegram" or route["chatType"] not in ("dm", "private"):
                return None
            if route["chatId"] != owner or route["userId"] != owner or route["sessionId"] != session_id:
                return None
            route["ownerId"] = owner
            route["chatType"] = "private"  # Hermes calls Telegram's private chat "dm".
            return route
        except (ImportError, AttributeError):
            return None

    def factory(self, native, adapter):
        from telegram.ext import CallbackQueryHandler
        loop = asyncio.get_running_loop()
        self.clients[id(native)] = (native, loop)
        # Scoped to this add-on's own buttons, so Hermes' and the other plugins' buttons keep working.
        native.add_handler(CallbackQueryHandler(self.callback, pattern=r"^gsc1:"))

    def client(self):
        live = [(app, loop) for app, loop in list(self.clients.values()) if not loop.is_closed()]
        if len(live) != 1:
            return None  # Several bots need an explicit choice, never a guess.
        app, loop = live[0]
        return (app, loop) if loop.is_running() else None

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

    # ---- the tokens --------------------------------------------------------------------------
    def folder(self):
        root = self.root()
        if not root:
            raise RuntimeError("No mission control folder for the button tokens")
        folder = os.path.join(root, ".godspeed", "charm-buttons")
        os.makedirs(folder, mode=0o700, exist_ok=True)
        return folder

    @staticmethod
    def save(file, value):
        temporary = file + ".tmp-" + secrets.token_hex(4)
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as out:
            json.dump(value, out)
            out.flush()
            os.fsync(out.fileno())
        os.replace(temporary, file)

    @staticmethod
    def gc(folder, now):
        count = 0
        for name in os.listdir(folder):
            file = os.path.join(folder, name)
            try:
                if now - os.path.getmtime(file) > RETENTION:
                    os.remove(file)
                elif name.endswith(".json"):
                    count += 1
            except OSError:
                continue
        if count >= MAX_TOKENS:
            raise RuntimeError("Too many charm buttons waiting")

    def issue(self, entry, route, bot_id, language):
        """Two tokens, Yes and No, sharing one claim. None when they cannot be kept."""
        try:
            folder, now = self.folder(), time.time()
            self.gc(folder, now)
            group = secrets.token_hex(16)
            tokens = {"group": group, "yes": secrets.token_hex(16), "no": secrets.token_hex(16)}
            for answer in ("yes", "no"):
                self.save(os.path.join(folder, tokens[answer] + ".json"), {
                    "version": 1, "key": tokens[answer], "group": group, "answer": answer,
                    "conversation": entry["conversation"], "askedWhen": entry.get("askedWhen"),
                    "created": int(now * 1000), "language": language,
                    "ownerId": route["ownerId"], "chatId": route["chatId"], "botId": str(bot_id),
                    "messageId": None,
                })
            return tokens
        except Exception:
            return None

    def load(self, key):
        """("ok", token), ("missing", None) when no such token was ever kept here (or it is past
        its 30 days), or ("error", None) when it is there but cannot be read or trusted: then the
        question may well be open, and the tap must not say that nothing is."""
        try:
            with open(os.path.join(self.folder(), key + ".json"), encoding="utf-8") as f:
                token = json.load(f)
        except FileNotFoundError:
            return "missing", None
        except Exception:
            return "error", None
        ok = (isinstance(token, dict) and token.get("version") == 1 and token.get("key") == key
              and HEX.match(str(token.get("group") or "")) and token.get("answer") in ("yes", "no")
              and isinstance(token.get("conversation"), str) and token["conversation"]
              and isinstance(token.get("askedWhen"), str) and token["askedWhen"]
              and isinstance(token.get("language"), str))
        return ("ok", token) if ok else ("error", None)

    def bind(self, tokens, message_id):
        folder = self.folder()
        for answer in ("yes", "no"):
            file = os.path.join(folder, tokens[answer] + ".json")
            with open(file, encoding="utf-8") as f:
                token = json.load(f)
            token["messageId"] = str(message_id)
            self.save(file, token)

    def discard(self, tokens):
        folder = self.folder()
        for answer in ("yes", "no"):
            try:
                os.remove(os.path.join(folder, tokens[answer] + ".json"))
            except OSError:
                pass

    def claim(self, token):
        """True for the first tap on either button of a message, False for every later one."""
        file = os.path.join(self.folder(), token["group"] + ".used")
        try:
            fd = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            return False
        with os.fdopen(fd, "w", encoding="utf-8") as out:
            json.dump({"key": token["key"], "answer": token["answer"], "at": int(time.time() * 1000)}, out)
            out.flush()
            os.fsync(out.fileno())
        return True

    def release(self, token):
        try:
            os.remove(os.path.join(self.folder(), token["group"] + ".used"))
        except OSError:
            pass

    # ---- sending -----------------------------------------------------------------------------
    @staticmethod
    def delay():
        # The question belongs after the reply. Hermes sends the reply once the transform is done,
        # so the question waits a moment; the variable exists for the tests.
        try:
            return max(0.0, float(os.environ.get("GODSPEED_CHARM_BUTTON_DELAY") or 2))
        except ValueError:
            return 2.0

    @staticmethod
    def markup(tokens, words):
        from telegram import InlineKeyboardButton, InlineKeyboardMarkup
        return InlineKeyboardMarkup([[InlineKeyboardButton(words["buttonYes"], callback_data=PREFIX + tokens["yes"]),
                                      InlineKeyboardButton(words["buttonNo"], callback_data=PREFIX + tokens["no"])]])

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
        """Last of all, once the reply is known to go out: the two tokens and the question's
        message, scheduled on the bot's own loop. False when it cannot be arranged."""
        client, words = self.client(), self.texts()
        if not client or not words or language not in words:
            return False
        app, loop = client
        try:
            bot_id = app.bot.id
        except Exception:
            return False
        tokens = self.issue(entry, entry["route"], bot_id, language)
        if not tokens:
            return False
        if self.deliver(app, loop, entry["route"], tokens, words[language]) is None:
            self.discard(tokens)
            return False
        return True

    def deliver(self, app, loop, route, tokens, words):
        """Schedules the question's message on the bot's own loop; never waits for it."""
        try:
            return asyncio.run_coroutine_threadsafe(self.send(app, route, tokens, words, self.delay()), loop)
        except Exception:
            return None

    async def send(self, app, route, tokens, words, delay):
        chat = None
        try:
            chat = int(route["chatId"])
            if delay:
                await asyncio.sleep(delay)
            kwargs = {"chat_id": chat, "text": words["question"], "reply_markup": self.markup(tokens, words)}
            if route.get("replyTo"):
                kwargs["reply_to_message_id"] = int(route["replyTo"])
            if route.get("threadId"):
                kwargs["message_thread_id"] = int(route["threadId"])
            message = await app.bot.send_message(**kwargs)
        except (Exception, asyncio.CancelledError) as error:
            # Whatever stopped it (the keyboard, the route, Telegram, a shutdown during the wait):
            # the question was taken out of the reply, so it must still arrive. Plain words are
            # enough, since a typed yes or no answers it everywhere.
            try:
                self.discard(tokens)
            except Exception:
                pass
            if chat is not None:
                try:
                    await app.bot.send_message(chat_id=chat, text=words["question"])
                except Exception:
                    pass
            if isinstance(error, asyncio.CancelledError):
                raise
            return False
        try:
            await asyncio.to_thread(self.bind, tokens, message.message_id)
        except Exception:
            # A button that is not bound to its message would fail every tap: take it away.
            try:
                await app.bot.edit_message_reply_markup(chat_id=chat, message_id=message.message_id, reply_markup=None)
            except Exception:
                pass
        return True

    # ---- a tap ---------------------------------------------------------------------------------
    async def edit(self, context, message, text, reply_markup=None):
        try:
            await context.bot.edit_message_text(chat_id=message.chat.id, message_id=message.message_id,
                                                text=str(text)[:4096], reply_markup=reply_markup)
        except Exception:
            pass

    async def failed(self, context, message, words, language):
        """The tap did not go through: the question stays, with its buttons, and says so."""
        if words:
            await self.edit(context, message, words[language]["question"] + "\n\n" + words[language]["buttonFailed"],
                            reply_markup=getattr(message, "reply_markup", None))

    async def callback(self, update, context):
        query = update.callback_query
        message = query.message if query else None
        if not query or not message or not self.active:
            return
        owner = self.owner()
        user_id, chat_id = str(query.from_user.id), str(message.chat.id)
        # Anyone but the owner, in any chat but theirs, on any message but this bot's: nothing at all.
        if not owner or user_id != owner or chat_id != owner or message.chat.type != "private":
            return
        if getattr(message, "forward_origin", None) or str(getattr(message.from_user, "id", "")) != str(context.bot.id):
            return
        match = DATA.match(str(query.data or ""))
        if not match:
            return
        try:
            await query.answer()  # Stops the spinner; says nothing about what happens next.
        except Exception:
            pass
        words = await asyncio.to_thread(self.texts)
        # The message's own text says its language when the token cannot.
        shown = next((lang for lang, w in (words or {}).items() if w["question"] == getattr(message, "text", None)), "en")
        found, token = await asyncio.to_thread(self.load, match.group(1))
        if found == "missing":
            # A button whose token was never kept here, or is past its 30 days, answers nothing.
            if words:
                await self.edit(context, message, words[shown]["noOpenQuestion"])
            return
        if found != "ok":
            await self.failed(context, message, words, shown)
            return
        if (token.get("ownerId") != owner or token.get("chatId") != chat_id or token.get("botId") != str(context.bot.id)
                or token.get("messageId") != str(message.message_id)):
            return
        language = token["language"] if words and token["language"] in words else shown
        try:
            claimed = await asyncio.to_thread(self.claim, token)
        except Exception:
            await self.failed(context, message, words, language)
            return
        if not claimed:
            # This message was answered already: the command is not run again, so nothing is written.
            if words:
                await self.edit(context, message, words[language]["noOpenQuestion"])
            return
        try:
            reply = await asyncio.to_thread(self.answer, token)
        except Exception:
            # Nothing is known to have changed: give the tap back, so a second one can try.
            try:
                await asyncio.to_thread(self.release, token)
            except Exception:
                pass
            await self.failed(context, message, words, language)
            return
        await self.edit(context, message, reply)

    def close(self):
        self.active = False
        self.clients.clear()
