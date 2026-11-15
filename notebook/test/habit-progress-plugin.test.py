"""Hermes attachment hooks, with synthetic tool results and no Telegram connection."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "third-party/addons/godspeed-coach/hermes/plugin/godspeed-coach/__init__.py"
spec = importlib.util.spec_from_file_location("coach_progress_test", SOURCE)
plugin = importlib.util.module_from_spec(spec)
spec.loader.exec_module(plugin)


class ProgressHooks(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="godspeed-progress-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / ".godspeed/habit-progress").mkdir(parents=True)
        self.png = self.root / ".godspeed/habit-progress/fictional.png"
        self.png.write_bytes(b"fictional png")
        (self.root / "progress-renderer.txt").write_text("renderer.mjs", encoding="utf-8")
        self.habit = {"id": "habit-example", "name": "Reading", "progress": {"version": 1}}
        self.identity = {"session_id": "example-session", "turn_id": "example-turn"}
        self.route_patch = patch.object(plugin._progress_telegram, "route", return_value={
            "ownerId": "31415", "userId": "31415", "chatId": "31415", "chatType": "private"})
        self.route_patch.start()
        self.addCleanup(self.route_patch.stop)
        plugin._progress_pending.clear()
        plugin._progress_telegram.clients.clear()
        plugin._output_bus.append = plugin.on_progress_reply
        if hasattr(plugin._output_bus, "voice_transform"):
            del plugin._output_bus.voice_transform

    def observe(self, **change):
        values = dict(self.identity, tool_name="mcp_notebook_personal_operation", args={"type": "track"},
                      status="success", result={"content": [{"type": "text", "text": json.dumps({"habit": self.habit})}]})
        values.update(change)
        rendered = types.SimpleNamespace(returncode=0, stdout=json.dumps({"path": str(self.png)}))
        with patch.object(plugin, "HERE", str(self.root)), patch.object(plugin, "_mission_control", return_value=str(self.root)), \
             patch.object(plugin.subprocess, "run", return_value=rendered) as run:
            plugin.on_progress_tool(**values)
            return run.call_count

    def reply(self, **change):
        values = dict(self.identity, response_text="Recorded. 120 days altogether.", platform="telegram")
        values.update(change)
        return plugin.on_progress_transform(**values)

    def test_correct_turn_only_and_once(self):
        self.assertEqual(self.observe(), 1)
        self.assertIsNone(self.reply(turn_id="another-turn"))
        text = self.reply()
        self.assertEqual(text.count("MEDIA:"), 1)
        self.assertIn(str(self.png.resolve()), text)
        self.assertIsNone(self.reply())

    def test_failed_unrelated_or_search_results_never_produce_media(self):
        self.assertEqual(self.observe(status="error"), 0)
        self.assertEqual(self.observe(tool_name="mcp_notebook_search_notes"), 0)
        self.assertEqual(self.observe(args={"type": "goal-change"}), 0)
        self.assertEqual(self.observe(result={"isError": True, "habit": self.habit}), 0)
        self.assertIsNone(self.reply())

    def test_cli_json_and_multiple_habits(self):
        result = {"exit_code": 0, "output": json.dumps({"ok": True, "habit": "reading", "progressCard": self.habit})}
        self.assertEqual(self.observe(tool_name="terminal", args={"command": 'godspeed-coach habit track "Read" --json'}, result=result), 1)
        self.assertIn("MEDIA:", self.reply())
        self.assertEqual(self.observe(tool_name="terminal", args={"command": 'godspeed-coach habit track "Read"'}, result=result), 0)
        self.assertEqual(len(plugin._progress_values({"habits": [self.habit, dict(self.habit, id="another-habit")]})), 2)

    def test_web_and_cron_do_not_send_and_cannot_leak_to_next_turn(self):
        self.observe()
        self.assertIsNone(self.reply(platform="cron"))
        self.assertIsNone(self.reply())
        self.observe()
        self.assertIsNone(self.reply(platform="cli"))

    def test_optional_voice_composes_before_media_and_respects_silence(self):
        def voice(**kwargs):
            kwargs["response_text"] = "Repaired text."
            return plugin.on_progress_reply(**kwargs)
        plugin._output_bus.voice_transform = voice
        self.observe()
        self.assertTrue(self.reply().startswith("Repaired text.\n\nMEDIA:"))
        self.assertIsNone(self.reply())
        self.observe()
        self.assertIsNone(plugin.on_progress_reply(**dict(self.identity, platform="telegram", response_text="[SILENT]")))
        self.assertIsNone(self.reply())

    def test_render_failure_preserves_text_fallback(self):
        (self.root / "progress-renderer.txt").unlink()
        self.assertEqual(self.observe(), 0)
        self.assertIsNone(self.reply())
        (self.root / "progress-renderer.txt").write_text("renderer.mjs", encoding="utf-8")
        # A verified API result alone never authorizes an arbitrary file outside the private cache.
        self.png = self.root / "some-other-file.png"
        self.png.write_bytes(b"private")
        self.observe()
        self.assertIsNone(self.reply())

    def test_unload_clears_pending_and_detaches_callback(self):
        cleanup = []
        ctx = types.SimpleNamespace(register_hook=lambda *_: None, on_unload=cleanup.append)
        plugin.register(ctx)
        self.observe()
        cleanup.pop()()
        self.assertFalse(hasattr(plugin._output_bus, "append"))
        self.assertIsNone(self.reply())

    def test_native_delivery_composes_voice_once_without_media_reupload(self):
        route = {"chatId": "31415", "userId": "31415", "ownerId": "31415", "chatType": "private"}
        plugin._progress_telegram.clients["synthetic"] = object()
        plugin._output_bus.voice_transform = lambda **kwargs: plugin.on_progress_reply(**dict(kwargs, response_text="Repaired text."))
        with patch.object(plugin._progress_telegram, "route", return_value=route), \
             patch.object(plugin._progress_telegram, "deliver", return_value=True) as deliver:
            self.observe()
            self.assertEqual(self.reply(), "Repaired text.")
            self.assertIsNone(self.reply())
            deliver.assert_called_once_with("habit-example", route, "example-session:example-turn", "en")

    def test_native_invalid_route_suppresses_private_photo(self):
        plugin._progress_telegram.clients["synthetic"] = object()
        with patch.object(plugin._progress_telegram, "route", return_value=None), \
             patch.object(plugin._progress_telegram, "deliver") as deliver:
            self.observe()
            self.assertEqual(self.reply(), "Recorded. 120 days altogether.")
            deliver.assert_not_called()

    def test_no_native_client_invalid_route_never_falls_back_to_private_media(self):
        with patch.object(plugin._progress_telegram, "route", return_value=None):
            self.observe()
            self.assertEqual(self.reply(), "Recorded. 120 days altogether.")


if __name__ == "__main__":
    unittest.main()
