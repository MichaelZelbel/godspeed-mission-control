"""Real habit keyboards on Hermes' existing Telegram client. No polling or shell commands."""
import asyncio
import concurrent.futures
import hashlib
import json
import os
import re
import shutil
import subprocess
import threading
import time


class ProgressTelegram:
    def __init__(self, root, renderer):
        self.root, self.renderer = root, renderer
        self.clients = {}
        self.lock = threading.Lock()
        self.active = True

    @staticmethod
    def owner():
        # An open gateway or several allowed users cannot establish one notebook owner.
        raw = os.environ.get("TELEGRAM_ALLOWED_USERS", "").strip()
        return raw if re.fullmatch(r"[1-9][0-9]*", raw) else None

    def route(self, session_id):
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
            route["chatType"] = "private"  # Hermes normalizes Telegram's private chat type to dm.
            return route
        except (ImportError, AttributeError):
            return None

    def call(self, command, **payload):
        script = os.path.join(os.path.dirname(self.renderer()), "habit-button-action.mjs")
        node = os.environ.get("GODSPEED_NODE") or shutil.which("node")
        if not node or not os.path.isfile(script):
            raise RuntimeError("Habit action service unavailable")
        result = subprocess.run([node, script], input=json.dumps(dict(payload, command=command)),
                                env=dict(os.environ, GODSPEED_WORKSPACE=self.root()),
                                capture_output=True, text=True, timeout=15)
        if result.returncode:
            raise RuntimeError("Habit action service failed")
        value = json.loads(result.stdout)
        if not isinstance(value, dict):
            raise RuntimeError("Invalid habit action result")
        return value

    def render(self, habit, request_id, locale="en"):
        node = os.environ.get("GODSPEED_NODE") or shutil.which("node")
        result = subprocess.run([node, self.renderer()],
                                input=json.dumps({"habit": habit, "requestId": request_id, "locale": locale}),
                                env=dict(os.environ, GODSPEED_WORKSPACE=self.root()),
                                capture_output=True, text=True, timeout=15)
        if result.returncode:
            raise RuntimeError("Habit picture unavailable")
        image = json.loads(result.stdout)
        file = os.path.realpath(image["path"])
        cache = os.path.realpath(os.path.join(self.root(), ".godspeed", "habit-progress"))
        if os.path.commonpath([cache, file]) != cache or not file.endswith(".png") or not os.path.isfile(file):
            raise RuntimeError("Invalid habit picture path")
        return file, str(image.get("alt") or "Habit progress")

    @staticmethod
    def markup(buttons):
        from telegram import InlineKeyboardButton, InlineKeyboardMarkup
        rows = []
        for button in buttons or []:
            data = str(button.get("callbackData") or "")
            if not re.fullmatch(r"gsh1:[a-f0-9]{32}", data):
                raise RuntimeError("Invalid habit button")
            rows.append([InlineKeyboardButton(str(button["text"]), callback_data=data)])
        return InlineKeyboardMarkup(rows) if rows else None

    @staticmethod
    def caption(habit, buttons, locale):
        progress = habit.get("progress", {})
        count = progress.get("lifetimeCompletedDays", 0)
        name = str(habit.get("name") or "Habit")
        minimum = str(habit.get("doneMeans") or name)
        today = next((day for day in progress.get("calendar", []) if day.get("date") == progress.get("today")), {})
        paused = (habit.get("habit_status") or habit.get("status")) == "paused"
        done = today.get("status") == "completed"
        if str(locale).startswith("de"):
            total = f"{count} erledigte Tage bleiben bei dir."
            state = "Diese Gewohnheit ist pausiert." if paused else "Heute ist schon erfasst." if done else f"Dein kleiner Schritt heute: {minimum}"
            action = "Mit der Taste unten geht es weiter." if buttons else "Sag mir, wenn du den Eintrag korrigieren möchtest." if done else ""
        else:
            total = f"{count} completed {'day stays' if count == 1 else 'days stay'} yours."
            state = "This habit is paused." if paused else "Today is already recorded." if done else f"Your tiny win today: {minimum}"
            action = "Use the button below when ready." if buttons else "To correct this entry, tell me what to change." if done else ""
        return "\n\n".join(part for part in (name, state, total, action) if part)[:1024]

    def factory(self, native, adapter):
        from telegram.ext import CallbackQueryHandler
        loop = asyncio.get_running_loop()
        # The SDK client is provided by the public plugin API. The adapter remains untouched.
        self.clients[id(native)] = (native, loop)
        native.add_handler(CallbackQueryHandler(self.callback, pattern=r"^gsh1:"))

    def attempt(self, habit_id, route, request_id, bot_id):
        key = json.dumps([os.path.realpath(self.root()), habit_id, route["chatId"], str(bot_id), request_id])
        folder = os.path.join(self.root(), ".godspeed", "habit-button-delivery")
        os.makedirs(folder, mode=0o700, exist_ok=True)
        file = os.path.join(folder, hashlib.sha256(key.encode()).hexdigest() + ".json")
        try:
            fd = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            return None
        with os.fdopen(fd, "w", encoding="utf-8") as out:
            json.dump({"state": "attempted", "at": time.time()}, out)
            out.flush()
            os.fsync(out.fileno())
        return file

    @staticmethod
    def receipt(file, message_id):
        temporary = file + ".ack"
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as out:
            json.dump({"state": "acknowledged", "messageId": str(message_id), "at": time.time()}, out)
            out.flush()
            os.fsync(out.fileno())
        os.replace(temporary, file)

    def deliver(self, habit_id, route, request_id, locale="en"):
        """None: no native attempt. True/False: attempted; never replay via MEDIA after uncertainty."""
        clients = [(app, loop) for app, loop in self.clients.values() if not loop.is_closed()]
        if len(clients) != 1:
            return None  # Multi-bot routing needs an explicit transport identity, never a guess.
        app, loop = clients[0]
        if not loop.is_running():
            return None
        # Hermes finalizers run in executor threads. Never block the Telegram event loop itself.
        try:
            if asyncio.get_running_loop() is loop:
                return None
        except RuntimeError:
            pass
        future = asyncio.run_coroutine_threadsafe(
            self.send(app, habit_id, route, request_id, locale), loop)
        try:
            return future.result(timeout=55)
        except (concurrent.futures.TimeoutError, Exception):
            # The SDK might have delivered already. Do not cancel and do not upload a duplicate.
            return False

    async def bind(self, buttons, route, bot_id, message_id):
        for button in buttons or []:
            result = await asyncio.to_thread(self.call, "bind", callbackData=button["callbackData"],
                                            **self.identity(route, bot_id), messageId=str(message_id))
            if not result.get("ok"):
                raise RuntimeError("Habit button binding failed")

    @staticmethod
    def identity(route, bot_id):
        return {key: str(route[key]) for key in ("ownerId", "userId", "chatId", "chatType")} | {"botId": str(bot_id)}

    async def send(self, app, habit_id, route, request_id, locale):
        try:
            identity = self.identity(route, app.bot.id)
            prepared = await asyncio.to_thread(self.call, "issue", habitId=habit_id, locale=locale, **identity)
            if not prepared.get("ok") or not prepared.get("habit"):
                return False
            file, alt = await asyncio.to_thread(self.render, prepared["habit"], request_id, locale)
            buttons = prepared.get("buttons", [])
            kwargs = {"chat_id": int(route["chatId"]), "caption": self.caption(prepared["habit"], buttons, locale),
                      "reply_markup": self.markup(buttons)}
            if route.get("replyTo"):
                kwargs["reply_to_message_id"] = int(route["replyTo"])
            if route.get("threadId"):
                kwargs["message_thread_id"] = int(route["threadId"])
            ledger = await asyncio.to_thread(self.attempt, habit_id, route, request_id, app.bot.id)
            if not ledger:
                return False
            with open(file, "rb") as image:
                message = await app.bot.send_photo(photo=image, **kwargs)
            await asyncio.to_thread(self.receipt, ledger, message.message_id)
            try:
                await self.bind(buttons, route, app.bot.id, message.message_id)
            except Exception:
                # A visible but unbound button must fail closed rather than invite a false success.
                try:
                    await app.bot.edit_message_reply_markup(chat_id=int(route["chatId"]),
                                                           message_id=message.message_id, reply_markup=None)
                except Exception:
                    pass
            return True
        except Exception:
            return False  # Main composed text still reaches the user; never retry a possibly sent photo.

    async def callback(self, update, context):
        query = update.callback_query
        message = query.message if query else None
        owner = self.owner()
        if not query or not message:
            return
        if not self.active:
            await query.answer("Please ask for a fresh habit card.")
            return
        user_id, chat_id = str(query.from_user.id), str(message.chat.id)
        if not owner or user_id != owner or chat_id != owner or message.chat.type != "private":
            await query.answer("This button belongs to the habit owner.", show_alert=True)
            return
        if getattr(message, "forward_origin", None) or str(getattr(message.from_user, "id", "")) != str(context.bot.id):
            await query.answer("Please open the original habit card.", show_alert=True)
            return
        # Stop the Telegram spinner promptly, without claiming that anything was saved.
        await query.answer()
        route = {"ownerId": owner, "userId": user_id, "chatId": chat_id, "chatType": "private"}
        try:
            result = await asyncio.to_thread(self.call, "tap", callbackData=query.data,
                                            **self.identity(route, context.bot.id),
                                            messageId=str(message.message_id), callbackId=str(query.id))
            if not result.get("habit"):
                notice = result.get("notice") or "I couldn't save that. Please ask for a fresh habit card."
                await context.bot.edit_message_caption(chat_id=message.chat.id, message_id=message.message_id,
                                                       caption=str(notice)[:1024], reply_markup=None)
                return
            buttons = result.get("buttons", [])
            await self.bind(buttons, route, context.bot.id, message.message_id)
            notice = str(result.get("notice") or "Habit progress refreshed.")
            try:
                locale = result.get("locale") or "en"
                file, alt = await asyncio.to_thread(self.render, result["habit"], "tap:" + str(query.id), locale)
                from telegram import InputMediaPhoto
                with open(file, "rb") as image:
                    await context.bot.edit_message_media(chat_id=message.chat.id, message_id=message.message_id,
                                                        media=InputMediaPhoto(image, caption=(notice + "\n\n" + self.caption(result["habit"], buttons, locale))[:1024]),
                                                        reply_markup=self.markup(buttons))
            except Exception:
                # Saving and displaying are separate. Replaying a consumed action only refreshes.
                await context.bot.edit_message_caption(chat_id=message.chat.id, message_id=message.message_id,
                                                       caption=notice[:1024], reply_markup=self.markup(buttons))
        except Exception:
            # Preserve the original action token. Its durable receipt makes a later tap safe.
            try:
                await context.bot.edit_message_caption(chat_id=message.chat.id, message_id=message.message_id,
                                                       caption="I couldn't confirm the update. Tap again to check safely.",
                                                       reply_markup=message.reply_markup)
            except Exception:
                pass

    def close(self):
        self.active = False
        self.clients.clear()
