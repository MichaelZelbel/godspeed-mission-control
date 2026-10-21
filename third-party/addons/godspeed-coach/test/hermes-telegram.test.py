# From Godspeed Mission Control (notebook/test/habit-progress-telegram.test.py), which runs it against its bundled copy
# of this plugin; here it runs against this repository's. Run: npm run test:hermes
"""Native Telegram SDK contract, entirely fictional data and in-memory SDK doubles."""
import asyncio
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import types
import unittest
import subprocess
import shutil
from unittest.mock import AsyncMock, Mock, patch

SOURCE = Path(__file__).resolve().parents[1] / "hermes/plugin/godspeed-coach/telegram_progress.py"
# The one case that drives the real habit button service needs Godspeed Mission Control's notebook
# scripts (notebook/scripts/habit-button-action.mjs). It runs where GODSPEED_KIT names a checkout
# of the product, and is skipped otherwise; the product runs it on every push.
KIT = Path(os.environ["GODSPEED_KIT"]) if os.environ.get("GODSPEED_KIT") else None
spec = importlib.util.spec_from_file_location("telegram_progress_test", SOURCE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class Keyboard:
    def __init__(self, rows):
        self.inline_keyboard = rows


class Button:
    def __init__(self, text, callback_data):
        self.text, self.callback_data = text, callback_data


class Photo:
    def __init__(self, media, caption):
        self.bytes, self.caption = media.read(), caption


class Handler:
    def __init__(self, callback, pattern):
        self.callback, self.pattern = callback, pattern


class NativeProgress(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="fictional-habit-button-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.image = self.root / "example.png"
        self.image.write_bytes(b"fictional PNG")
        self.bridge = module.ProgressTelegram(lambda: str(self.root), lambda: str(self.root / "renderer.mjs"))
        self.route = {"ownerId": "31415", "userId": "31415", "chatId": "31415", "chatType": "private", "replyTo": "8"}
        self.buttons = [{"text": "I did it", "callbackData": "gsh1:" + "a" * 32}]
        self.habit = {"id": "habit-fictional", "progress": {"version": 1}}
        self.bot = types.SimpleNamespace(id=1112, send_photo=AsyncMock(return_value=types.SimpleNamespace(message_id=9)),
                                         edit_message_media=AsyncMock(), edit_message_caption=AsyncMock(),
                                         edit_message_reply_markup=AsyncMock())
        self.app = types.SimpleNamespace(bot=self.bot, add_handler=Mock())
        self.message = types.SimpleNamespace(message_id=9, chat=types.SimpleNamespace(id=31415, type="private"),
                                             from_user=types.SimpleNamespace(id=1112), forward_origin=None,
                                             reply_markup=Keyboard([[Button("I did it", self.buttons[0]["callbackData"])]]))
        self.query = types.SimpleNamespace(id="callback-example", message=self.message, data=self.buttons[0]["callbackData"],
                                           from_user=types.SimpleNamespace(id=31415), answer=AsyncMock())
        self.update = types.SimpleNamespace(callback_query=self.query)
        self.context = types.SimpleNamespace(bot=self.bot)
        self.env = patch.dict(os.environ, TELEGRAM_ALLOWED_USERS="31415")
        self.env.start()
        self.addCleanup(self.env.stop)
        modules = {"telegram": types.SimpleNamespace(InlineKeyboardButton=Button, InlineKeyboardMarkup=Keyboard, InputMediaPhoto=Photo),
                   "telegram.ext": types.SimpleNamespace(CallbackQueryHandler=Handler)}
        self.sdk = patch.dict("sys.modules", modules)
        self.sdk.start()
        self.addCleanup(self.sdk.stop)

    def service(self, command, **payload):
        if command == "issue":
            return {"ok": True, "habit": self.habit, "buttons": self.buttons}
        return {"ok": True}

    async def send(self, call=None, key="session:turn"):
        with patch.object(self.bridge, "call", side_effect=call or self.service), \
             patch.object(self.bridge, "render", return_value=(str(self.image), "Reading. One saved day.")):
            return await self.bridge.send(self.app, "habit-fictional", self.route, key, "en")

    async def test_public_factory_scopes_handler_on_existing_application(self):
        self.bridge.factory(self.app, object())
        handler = self.app.add_handler.call_args.args[0]
        self.assertEqual(handler.pattern, r"^gsh1:")
        self.assertEqual(len(self.bridge.clients), 1)

    async def test_single_photo_contains_actual_button_then_binds_exact_receipt(self):
        calls = []
        def service(command, **payload):
            calls.append((command, payload))
            return self.service(command, **payload)
        self.assertTrue(await self.send(service))
        self.bot.send_photo.assert_awaited_once()
        kwargs = self.bot.send_photo.call_args.kwargs
        self.assertEqual(kwargs["chat_id"], 31415)
        self.assertEqual(kwargs["reply_to_message_id"], 8)
        self.assertEqual(kwargs["reply_markup"].inline_keyboard[0][0].callback_data, self.buttons[0]["callbackData"])
        self.assertEqual(calls[1][0], "bind")
        self.assertEqual(calls[1][1]["messageId"], "9")
        self.assertEqual(calls[1][1]["botId"], "1112")
        receipt = json.loads(next((self.root / ".godspeed/habit-button-delivery").glob("*.json")).read_text())
        self.assertEqual(receipt["state"], "acknowledged")

    async def test_restart_or_repeated_finalizer_never_sends_second_photo(self):
        self.assertTrue(await self.send())
        self.bridge = module.ProgressTelegram(lambda: str(self.root), lambda: "renderer.mjs")
        self.assertFalse(await self.send())
        self.bot.send_photo.assert_awaited_once()

    async def test_uncertain_send_persists_attempt_and_is_never_retried(self):
        self.bot.send_photo.side_effect = TimeoutError("unknown delivery")
        self.assertFalse(await self.send())
        self.assertFalse(await self.send())
        self.bot.send_photo.assert_awaited_once()
        receipt = json.loads(next((self.root / ".godspeed/habit-button-delivery").glob("*.json")).read_text())
        self.assertEqual(receipt["state"], "attempted")

    async def test_unbound_keyboard_is_removed_without_resending_photo(self):
        def service(command, **payload):
            return {"ok": False} if command == "bind" else self.service(command, **payload)
        self.assertTrue(await self.send(service))
        self.bot.send_photo.assert_awaited_once()
        self.bot.edit_message_reply_markup.assert_awaited_once_with(chat_id=31415, message_id=9, reply_markup=None)

    async def test_callback_acknowledges_then_edits_same_photo(self):
        calls = []
        def service(command, **payload):
            self.assertEqual(self.query.answer.await_count, 1)
            calls.append((command, payload))
            return {"ok": True, "habit": self.habit, "buttons": [], "notice": "Saved for today."}
        with patch.object(self.bridge, "call", side_effect=service), \
             patch.object(self.bridge, "render", return_value=(str(self.image), "Reading. Two saved days.")):
            await self.bridge.callback(self.update, self.context)
        self.bot.send_photo.assert_not_awaited()
        self.bot.edit_message_media.assert_awaited_once()
        kwargs = self.bot.edit_message_media.call_args.kwargs
        self.assertEqual((kwargs["chat_id"], kwargs["message_id"]), (31415, 9))
        self.assertEqual(kwargs["media"].bytes, b"fictional PNG")
        self.assertEqual(calls[0][1]["messageId"], "9")
        self.assertEqual(calls[0][1]["callbackId"], "callback-example")

    async def test_unauthorized_group_forward_or_other_bot_never_calls_service(self):
        cases = [("user", 99), ("group", "group"), ("forward", object()), ("bot", 99)]
        for kind, value in cases:
            with self.subTest(kind=kind), patch.object(self.bridge, "call") as call:
                original = (self.query.from_user.id, self.message.chat.type, self.message.forward_origin, self.message.from_user.id)
                if kind == "user": self.query.from_user.id = value
                if kind == "group": self.message.chat.type = value
                if kind == "forward": self.message.forward_origin = value
                if kind == "bot": self.message.from_user.id = value
                await self.bridge.callback(self.update, self.context)
                call.assert_not_called()
                self.query.from_user.id, self.message.chat.type, self.message.forward_origin, self.message.from_user.id = original

    async def test_saved_but_picture_fails_keeps_truthful_receipt_caption(self):
        with patch.object(self.bridge, "call", return_value={"ok": True, "habit": self.habit, "buttons": [], "notice": "Saved for today."}), \
             patch.object(self.bridge, "render", side_effect=RuntimeError("render failed")):
            await self.bridge.callback(self.update, self.context)
        self.assertEqual(self.bot.edit_message_caption.call_args.kwargs["caption"], "Saved for today.")
        self.bot.send_photo.assert_not_awaited()

    async def test_failed_save_never_claims_success_and_preserves_retry_token(self):
        with patch.object(self.bridge, "call", side_effect=TimeoutError("service outage")):
            await self.bridge.callback(self.update, self.context)
        kwargs = self.bot.edit_message_caption.call_args.kwargs
        self.assertIn("couldn't confirm", kwargs["caption"])
        self.assertIs(kwargs["reply_markup"], self.message.reply_markup)
        self.bot.edit_message_media.assert_not_awaited()

    async def test_stale_card_refreshes_same_photo_without_success_wording(self):
        with patch.object(self.bridge, "call", return_value={"ok": False, "status": "stale", "habit": self.habit,
                                                           "buttons": [], "notice": "This card was for yesterday. Here is today."}), \
             patch.object(self.bridge, "render", return_value=(str(self.image), "Reading. One saved day.")):
            await self.bridge.callback(self.update, self.context)
        self.assertIn("yesterday", self.bot.edit_message_media.call_args.kwargs["media"].caption)

    async def test_paused_and_completed_cards_have_truthful_action_caption(self):
        paused = dict(self.habit, name="Reading", habit_status="paused")
        completed = dict(self.habit, name="Reading", doneMeans="Read one page", progress={
            "today": "2026-10-13", "lifetimeCompletedDays": 3,
            "calendar": [{"date": "2026-10-13", "status": "completed"}]})
        self.assertIn("paused", self.bridge.caption(paused, [{"text": "Resume this habit"}], "en"))
        self.assertIn("already recorded", self.bridge.caption(completed, [], "en"))
        self.assertIn("correct", self.bridge.caption(completed, [], "en"))
        self.assertNotIn("button", self.bridge.caption(completed, [], "en"))

    async def test_undo_result_updates_photo_and_binds_replacement_button(self):
        replacement = [{"text": "I did it", "callbackData": "gsh1:" + "b" * 32}]
        calls = []
        def service(command, **payload):
            calls.append((command, payload))
            if command == "bind": return {"ok": True}
            return {"ok": True, "habit": self.habit, "buttons": replacement, "notice": "Today's entry was undone."}
        with patch.object(self.bridge, "call", side_effect=service), \
             patch.object(self.bridge, "render", return_value=(str(self.image), "Reading")):
            await self.bridge.callback(self.update, self.context)
        self.assertEqual([name for name, _ in calls], ["tap", "bind"])
        self.assertIn("undone", self.bot.edit_message_media.call_args.kwargs["media"].caption)
        self.bot.send_photo.assert_not_awaited()

    async def test_real_typed_bridge_happy_double_tap_undo_and_paused_resume(self):
        node = shutil.which("node")
        if not node:
            self.skipTest("Node runtime required for typed bridge integration")
        if not KIT or not (KIT / "notebook/scripts/habit-button-action.mjs").is_file():
            self.skipTest("Set GODSPEED_KIT to a Godspeed Mission Control checkout to run the habit button service")
        kit = KIT
        # The actual typed service and canonical habit writer operate on this temporary fixture only.
        fixture = """
import {addArea} from './third-party/addons/godspeed-coach/lib/areas.mjs';
import {addHabit,setStatus} from './third-party/addons/godspeed-coach/lib/habits.mjs';
const root=process.argv[1];addArea(root,{slug:'learning',title:'Learning',rhythm:'weekly sunday',starts:'2026-10-01'});
const habit=addHabit(root,{area:'learning',slug:'fictional',title:'Reading',doneMeans:'Read one page',days:'daily',timezone:'Europe/Berlin'},'2026-10-01');
if(process.argv[2]==='paused')setStatus(habit,'paused','2026-10-12');
"""
        for paused in (False, True):
            with self.subTest(paused=paused), tempfile.TemporaryDirectory(prefix="fictional-bridge-") as directory:
                created = subprocess.run([node, "--input-type=module", "-e", fixture, directory, "paused" if paused else "active"],
                                         cwd=kit, capture_output=True, text=True)
                self.assertEqual(created.returncode, 0, created.stderr)
                bridge = module.ProgressTelegram(lambda: directory, lambda: str(kit / "notebook/scripts/habit-progress-image.mjs"))
                habit_id = "habit-learning-fictional"
                auth = bridge.identity(self.route, 1112)
                self.bot.send_photo.reset_mock()
                with patch.dict(os.environ, GODSPEED_NOW="2026-10-13T10:00:00Z"), \
                     patch.object(bridge, "render", return_value=(str(self.image), "Reading")):
                    self.assertTrue(await bridge.send(self.app, habit_id, self.route, "fictional-session:turn", "en"))
                    self.query.data = self.bot.send_photo.call_args.kwargs["reply_markup"].inline_keyboard[0][0].callback_data
                    if paused:
                        await bridge.callback(self.update, self.context)
                        self.assertIn("Resumed", self.bot.edit_message_media.call_args.kwargs["media"].caption)
                        state = bridge.call("issue", habitId=habit_id, **auth)
                        self.assertEqual(state["habit"]["progress"]["lifetimeCompletedDays"], 0)
                        self.query.data = self.bot.edit_message_media.call_args.kwargs["reply_markup"].inline_keyboard[0][0].callback_data
                    original_done = self.query.data
                    await bridge.callback(self.update, self.context)
                    self.assertIn("Saved", self.bot.edit_message_media.call_args.kwargs["media"].caption)
                    undo = self.bot.edit_message_media.call_args.kwargs["reply_markup"].inline_keyboard[0][0].callback_data
                    state = bridge.call("issue", habitId=habit_id, **auth)
                    self.assertEqual(state["habit"]["progress"]["lifetimeCompletedDays"], 1)
                    before = next(Path(directory, "coach").rglob("fictional.md")).read_bytes()
                    await bridge.callback(self.update, self.context)
                    self.assertEqual(next(Path(directory, "coach").rglob("fictional.md")).read_bytes(), before)
                    self.query.data = undo
                    await bridge.callback(self.update, self.context)
                    self.assertIn("Undone", self.bot.edit_message_media.call_args.kwargs["media"].caption)
                    self.assertEqual(bridge.call("issue", habitId=habit_id, **auth)["habit"]["progress"]["lifetimeCompletedDays"], 0)
                    self.query.data = original_done
                    await bridge.callback(self.update, self.context)
                    self.assertEqual(bridge.call("issue", habitId=habit_id, **auth)["habit"]["progress"]["lifetimeCompletedDays"], 0)
                    self.bot.send_photo.assert_awaited_once()

    def test_owner_is_explicit_single_numeric_allowlist_and_route_is_task_local(self):
        for bad in ("", "*", "31415,22", "@owner"):
            with patch.dict(os.environ, TELEGRAM_ALLOWED_USERS=bad):
                self.assertIsNone(self.bridge.owner())
        values = {"PLATFORM": "telegram", "CHAT_ID": "31415", "USER_ID": "31415", "CHAT_TYPE": "private", "ID": "s1"}
        context = types.SimpleNamespace(get_session_env=lambda name, default="": values.get(name.removeprefix("HERMES_SESSION_"), default))
        with patch.dict("sys.modules", {"gateway": types.ModuleType("gateway"), "gateway.session_context": context}):
            self.assertEqual(self.bridge.route("s1")["ownerId"], "31415")
            values["CHAT_TYPE"] = "dm"
            self.assertEqual(self.bridge.route("s1")["chatType"], "private")
            self.assertIsNone(self.bridge.route("different-session"))
            values["CHAT_TYPE"] = "group"
            self.assertIsNone(self.bridge.route("s1"))


if __name__ == "__main__":
    unittest.main()
