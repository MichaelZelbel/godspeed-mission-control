"""Exercise the real installed Hermes/PTB registration and dispatch without network traffic.

Run with Hermes' Python environment. All SDK HTTP is a BaseRequest test double.
"""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import AsyncMock, patch

try:
    from telegram import Update
    from telegram.ext import Application
    from telegram.request import BaseRequest
    from hermes_cli.plugins import PluginContext, PluginManager, PluginManifest
    from gateway.config import PlatformConfig
    from plugins.platforms.telegram.adapter import TelegramAdapter
    from gateway.session_context import set_session_vars, set_current_session_id, clear_session_vars
    HAS_HERMES = True
except ImportError:
    HAS_HERMES = False
    BaseRequest = object

SOURCE = Path(__file__).resolve().parents[2] / "third-party/addons/godspeed-coach/hermes/plugin/godspeed-coach/telegram_progress.py"
spec = importlib.util.spec_from_file_location("native_telegram_progress_test", SOURCE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class FakeRequest(BaseRequest):
    def __init__(self):
        super().__init__()
        self.methods = []
        self.markup_present = False

    @property
    def read_timeout(self):
        return 5

    async def initialize(self):
        pass

    async def shutdown(self):
        pass

    async def do_request(self, url, method, request_data=None, **kwargs):
        name = url.rsplit("/", 1)[-1]
        self.methods.append(name)
        if name == "getMe":
            result = {"id": 1112, "is_bot": True, "first_name": "Fictional", "username": "fictional_test_bot"}
        elif name in ("sendPhoto", "editMessageMedia", "editMessageCaption"):
            parameters = request_data.json_parameters
            if name == "sendPhoto":
                self.markup_present = bool(json.loads(parameters["reply_markup"])["inline_keyboard"])
            result = {"message_id": 9, "date": 0, "chat": {"id": 31415, "type": "private"},
                      "from": {"id": 1112, "is_bot": True, "first_name": "Fictional"}}
        else:
            result = True
        return 200, json.dumps({"ok": True, "result": result}).encode()


@unittest.skipUnless(HAS_HERMES, "Requires installed Hermes with its Telegram dependency")
class RegisteredNativeHandler(unittest.IsolatedAsyncioTestCase):
    async def test_public_registration_actual_adapter_dispatch_send_and_same_message_edit(self):
        with tempfile.TemporaryDirectory(prefix="fictional-native-habit-") as directory, \
             patch.dict(os.environ, TELEGRAM_ALLOWED_USERS="31415"):
            image = Path(directory, "fictional.png")
            image.write_bytes(b"fictional PNG payload")
            bridge = module.ProgressTelegram(lambda: directory, lambda: "renderer.mjs")
            request = FakeRequest()
            app = Application.builder().token("0:synthetic-never-networked").request(request).get_updates_request(FakeRequest()).build()
            manager = PluginManager()
            ctx = PluginContext(manifest=PluginManifest(name="fictional-habit-buttons", version="1.0.0"), manager=manager)
            ctx.register_telegram_handler(bridge.factory)
            adapter = TelegramAdapter(PlatformConfig(enabled=True, token="synthetic", extra={}))
            core_callback = AsyncMock()
            with patch("hermes_cli.plugins.get_plugin_manager", return_value=manager), \
                 patch.object(adapter, "_handle_callback_query", core_callback):
                adapter._wire_plugin_handlers(app)  # Actual Hermes connect path, tested without connecting.
                adapter._register_handlers(app)
            buttons = [{"text": "I did it", "callbackData": "gsh1:" + "a" * 32}]
            habit = {"id": "habit-fictional", "name": "Reading", "progress": {"lifetimeCompletedDays": 1}}
            calls = []
            def service(command, **payload):
                calls.append((command, payload))
                if command == "bind": return {"ok": True}
                return {"ok": True, "habit": habit, "buttons": buttons if command == "issue" else [], "notice": "Saved for today."}
            await app.initialize()
            try:
                with patch.object(bridge, "call", side_effect=service), \
                     patch.object(bridge, "render", return_value=(str(image), "Reading")):
                    tokens = set_session_vars(platform="telegram", chat_id="31415", chat_type="dm", user_id="31415", message_id="8")
                    try:
                        set_current_session_id("fictional-session")
                        route = bridge.route("fictional-session")
                        self.assertEqual(route["chatType"], "private")
                        self.assertEqual(route["replyTo"], "8")
                        self.assertIsNone(bridge.route("foreign-session"))
                    finally:
                        clear_session_vars(tokens)
                    self.assertTrue(await bridge.send(app, habit["id"], route, "fictional-session:turn", "en"))
                    self.assertTrue(request.markup_present)
                    callback = {"id": "fictional-callback", "chat_instance": "fictional", "data": buttons[0]["callbackData"],
                                "from": {"id": 31415, "is_bot": False, "first_name": "Example"},
                                "message": {"message_id": 9, "date": 0, "chat": {"id": 31415, "type": "private"},
                                            "from": {"id": 1112, "is_bot": True, "first_name": "Fictional"}}}
                    await app.process_update(Update.de_json({"update_id": 1, "callback_query": callback}, app.bot))
                    core_callback.assert_not_awaited()
                    self.assertEqual([name for name, _ in calls], ["issue", "bind", "tap"])
                    self.assertEqual(calls[-1][1]["messageId"], "9")
                    self.assertEqual(request.methods.count("sendPhoto"), 1)
                    self.assertEqual(request.methods.count("answerCallbackQuery"), 1)
                    self.assertEqual(request.methods.count("editMessageMedia"), 1)
                    # Scoped matching keeps all pre-existing Hermes button flows available.
                    callback["data"] = "cp:fictional-core-button"
                    await app.process_update(Update.de_json({"update_id": 2, "callback_query": callback}, app.bot))
                    core_callback.assert_awaited_once()
            finally:
                await app.shutdown()


if __name__ == "__main__":
    unittest.main()
