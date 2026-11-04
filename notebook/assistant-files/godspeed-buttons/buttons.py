"""Godspeed's shared Yes/No buttons on Hermes' own Telegram client. No polling, no second bot.

One owner (TELEGRAM_ALLOWED_USERS holds exactly one id), a private chat, the bot's own message, and
an opaque token behind each button, kept under the workspace in .godspeed/<folder>/<token>.json.
A token binds the callback it belongs to (`id`), the fields its caller gave (the conversation, when
the question was asked, the language ...), when it was made and the answer its button gives. A tap
runs the callback registered for the token's id, and for that id only; the message then says what
the callback returned, and the buttons go. Both buttons of one message share one claim, so a message
is answered at most once. A tap by anyone but the owner, on a message that is not the bot's own, or
on an answered message changes nothing.

A caller builds `YesNoButtons(root, callbacks, texts, prefix=..., folder=...)`, hands `factory` to
`register_telegram_handler`, and calls `offer(id, fields, route, language)` once its message is
known to go out. Every caller names its own `prefix` (ending in ":", unique among callers, as
Hermes gives a press to the first handler that matches) and its own `folder`; there is no default. `texts()` gives {language: {question, buttonYes, buttonNo, noOpenQuestion,
buttonFailed}}; `callbacks` maps an id to `fn(token) -> reply text`, token["answer"] being yes or no.
"""
import asyncio
import json
import os
import re
import secrets
import time

HEX = re.compile(r"^[a-f0-9]{32}$")
RETENTION = 30 * 86400  # seconds; habit-button tokens are kept as long
MAX_TOKENS = 4096


class YesNoButtons:
    def __init__(self, root, callbacks, texts=None, *, prefix, folder, default_id=None):
        # root(): the mission control folder. default_id: the callback of a token kept without an id.
        self.root, self.callbacks = root, callbacks
        if texts:  # a subclass may define texts() itself
            self.texts = texts
        self.prefix, self.folder_name, self.default_id = prefix, folder, default_id
        self.data = re.compile("^" + re.escape(prefix) + "([a-f0-9]{32})$")
        self.clients = {}
        self.active = True

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
        # Scoped to this caller's own buttons, so Hermes' and the other plugins' buttons keep working.
        native.add_handler(CallbackQueryHandler(self.callback, pattern="^" + re.escape(self.prefix)))

    def client(self):
        live = [(app, loop) for app, loop in list(self.clients.values()) if not loop.is_closed()]
        if len(live) != 1:
            return None  # Several bots need an explicit choice, never a guess.
        app, loop = live[0]
        return (app, loop) if loop.is_running() else None

    # ---- the tokens --------------------------------------------------------------------------
    def folder(self):
        root = self.root()
        if not root:
            raise RuntimeError("No mission control folder for the button tokens")
        folder = os.path.join(root, ".godspeed", self.folder_name)
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
            raise RuntimeError("Too many buttons waiting")

    def issue(self, callback_id, fields, route, bot_id, language):
        """Two tokens, Yes and No, sharing one claim. None when they cannot be kept."""
        try:
            folder, now = self.folder(), time.time()
            self.gc(folder, now)
            group = secrets.token_hex(16)
            tokens = {"group": group, "yes": secrets.token_hex(16), "no": secrets.token_hex(16)}
            for answer in ("yes", "no"):
                self.save(os.path.join(folder, tokens[answer] + ".json"), {
                    **fields, "version": 1, "key": tokens[answer], "group": group, "answer": answer,
                    "id": callback_id, "created": int(now * 1000), "language": language,
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
        if isinstance(token, dict):
            token.setdefault("id", self.default_id)
        ok = (isinstance(token, dict) and token.get("version") == 1 and token.get("key") == key
              and HEX.match(str(token.get("group") or "")) and token.get("answer") in ("yes", "no")
              and token.get("id") in self.callbacks and isinstance(token.get("language"), str))
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
        # so the question waits a moment; the variable exists for the tests (and keeps its
        # name from the first caller, Charm).
        try:
            return max(0.0, float(os.environ.get("GODSPEED_CHARM_BUTTON_DELAY") or 2))
        except ValueError:
            return 2.0

    def markup(self, tokens, words):
        from telegram import InlineKeyboardButton, InlineKeyboardMarkup
        return InlineKeyboardMarkup([[InlineKeyboardButton(words["buttonYes"], callback_data=self.prefix + tokens["yes"]),
                                      InlineKeyboardButton(words["buttonNo"], callback_data=self.prefix + tokens["no"])]])

    def offer(self, callback_id, fields, route, language):
        """Last of all, once the message the question belongs to is known to go out: the two tokens
        and the question's message, scheduled on the bot's own loop. False when it cannot be arranged."""
        client, words = self.client(), self.texts()
        if not client or not words or language not in words or callback_id not in self.callbacks:
            return False
        app, loop = client
        try:
            bot_id = app.bot.id
        except Exception:
            return False
        tokens = self.issue(callback_id, fields, route, bot_id, language)
        if not tokens:
            return False
        if self.deliver(app, loop, route, tokens, words[language]) is None:
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
        match = self.data.match(str(query.data or ""))
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
            reply = await asyncio.to_thread(self.callbacks[token["id"]], token)
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
