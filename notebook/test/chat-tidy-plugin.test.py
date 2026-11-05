"""godspeed-chat-tidy: the plugin command against a fake gateway runner."""
import asyncio
import importlib.util
import os
import sys
import types
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
FILE = os.path.join(HERE, "..", "assistant-files", "godspeed-chat-tidy", "__init__.py")
KEY = "agent:main:telegram:dm:4242"


class Platform:
    def __init__(self, value):
        self.value = value


class Entry:
    def __init__(self, session_id, platform="telegram"):
        self.session_id, self.origin = session_id, types.SimpleNamespace(platform=Platform(platform))


class Store:
    def __init__(self, entries):
        self.entries = entries

    def lookup_by_session_key(self, key):
        return self.entries.get(key)


class Runner:
    def __init__(self, entries, running=(), moves_to=None):
        self.session_store, self._running_agents, self.events = Store(entries), {k: object() for k in running}, []
        self.moves_to = moves_to

    async def _handle_compress_command(self, event):
        self.events.append(event)
        if self.moves_to:
            self.session_store.entries[KEY] = Entry(self.moves_to)
        return "compressed"


def load(runner):
    run_api = types.ModuleType("gateway.run_api")
    run_api._ACTIVE_RUNNER = runner
    event = types.ModuleType("gateway.platforms.event")
    event.MessageEvent = lambda text, source: types.SimpleNamespace(text=text, source=source)
    for name, module in (("gateway", types.ModuleType("gateway")), ("gateway.run_api", run_api),
                         ("gateway.platforms", types.ModuleType("gateway.platforms")),
                         ("gateway.platforms.event", event)):
        sys.modules[name] = module
    spec = importlib.util.spec_from_file_location("godspeed_chat_tidy_under_test", FILE)
    plugin = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(plugin)
    return plugin


class ChatTidy(unittest.TestCase):
    def test_a_route_to_another_session_is_refused(self):
        runner = Runner({KEY: Entry("someone-else")})
        self.assertTrue(load(runner).tidy(KEY + " chat-1").startswith("refused:"))
        self.assertEqual(runner.events, [])

    def test_a_non_chat_app_origin_is_refused(self):
        runner = Runner({KEY: Entry("chat-1", "local")})
        self.assertTrue(load(runner).tidy(KEY + " chat-1").startswith("refused:"))
        self.assertEqual(runner.events, [])

    def test_a_running_turn_is_refused(self):
        runner = Runner({KEY: Entry("chat-1")}, running=[KEY])
        self.assertTrue(load(runner).tidy(KEY + " chat-1").startswith("refused:"))
        self.assertEqual(runner.events, [])

    def test_a_missing_runner_is_refused(self):
        self.assertTrue(load(None).tidy(KEY + " chat-1").startswith("refused:"))

    def test_an_unknown_key_and_bad_arguments_are_refused(self):
        plugin = load(Runner({}))
        self.assertTrue(plugin.tidy(KEY + " chat-1").startswith("refused:"))
        self.assertTrue(plugin.tidy("only-one").startswith("refused:"))

    def test_a_route_that_moved_during_the_summary_is_refused(self):
        runner = Runner({KEY: Entry("chat-1")}, moves_to="chat-2")
        self.assertEqual(load(runner).tidy(KEY + " chat-1"), "refused: route moved")
        self.assertEqual(len(runner.events), 1)

    def test_the_match_compresses_once_and_names_the_session(self):
        runner = Runner({KEY: Entry("chat-1")})
        self.assertEqual(load(runner).tidy(KEY + " chat-1"), "ok: chat-1")
        self.assertEqual(len(runner.events), 1)
        self.assertEqual(runner.events[0].text, "/compress")


if __name__ == "__main__":
    unittest.main()
