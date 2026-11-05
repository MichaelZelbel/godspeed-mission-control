"""godspeed-chat-tidy: the plugin command against a fake gateway runner."""
import asyncio
import importlib.util
import os
import re
import sys
import tempfile
import threading
import types
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
FILE = os.path.join(HERE, "..", "assistant-files", "godspeed-chat-tidy", "__init__.py")
KEY = "agent:main:telegram:dm:4242"
os.environ["HERMES_HOME"] = tempfile.mkdtemp(prefix="chat-tidy-plugin-")


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


class Ctx:
    def __init__(self):
        self.registered = []

    def register_command(self, name, handler, **kwargs):
        self.registered.append((name, handler))


ROUTINES = os.path.join(HERE, "..", "core", "routine-scripts", "godspeed_routines.py")


class ChatTidy(unittest.TestCase):
    def test_a_group_route_is_refused(self):
        group = "agent:main:telegram:group:8"
        runner = Runner({group: Entry("group-1")})
        self.assertTrue(load(runner).tidy(group + " group-1").startswith("refused:"))
        self.assertEqual(runner.events, [])

    def test_the_routine_and_the_plugin_agree_on_the_command_the_route_and_the_answers(self):
        source = open(ROUTINES, encoding="utf-8").read()
        plugin = load(Runner({KEY: Entry("chat-1")}))
        ctx = Ctx()
        plugin.register(ctx)
        self.assertEqual([name for name, _ in ctx.registered], [plugin.COMMAND])
        self.assertIn('CHAT_TIDY_COMMAND = "%s"' % plugin.COMMAND, source)
        self.assertIn('CHAT_KEY = re.compile(r"%s")' % plugin.CHAT_KEY, source)
        # the routine reads the first line: "ok:" tidied, "refused:" logged, anything else fails
        self.assertIn('line.startswith("refused:")', source)
        self.assertIn('line.startswith("ok:")', source)
        handler = ctx.registered[0][1]
        self.assertTrue(handler(KEY + " chat-1").startswith("ok:"))
        self.assertTrue(handler(KEY + " other").startswith("refused:"))


    def test_the_origin_exclusions_and_the_key_pattern_name_the_same_platforms(self):
        plugin = load(Runner({}))
        encoded = re.search(r"\(\?!\(\?:([^)]+)\):\)", plugin.CHAT_KEY).group(1).split("|")
        self.assertEqual(sorted(plugin.NOT_A_CHAT_APP), sorted(encoded))
        self.assertEqual(len(plugin.NOT_A_CHAT_APP), 6)
        for name in plugin.NOT_A_CHAT_APP:
            self.assertFalse(re.match(plugin.CHAT_KEY, "agent:main:%s:dm:1" % name), name)

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
        plugin = load(None)
        plugin.CLAIM_WAIT, plugin.POLL = 0.2, 0.05
        self.assertEqual(plugin.tidy(KEY + " chat-1"), "refused: the gateway runner is not running")
        self.assertEqual(os.listdir(plugin._requests()), [])

    def test_a_process_without_a_runner_gets_its_answer_from_the_gateways_copy(self):
        # the routine's control process (no runner) and the gateway process (the runner) are two
        # loads of the plugin that share only the assistant's home
        runner = Runner({KEY: Entry("chat-1")})
        control = load(None)
        gateway = load(runner)
        gateway._runner, control._runner = (lambda: runner), (lambda: None)
        gateway.POLL = control.POLL = 0.05
        gateway.register(Ctx())  # registration alone starts the worker that serves the control copy
        answers = []
        asking = threading.Thread(target=lambda: answers.append(control.tidy(KEY + " chat-1")))
        asking.start()
        asking.join(5)
        self.assertEqual(answers, ["ok: chat-1"])
        self.assertEqual(len(runner.events), 1)
        self.assertEqual(runner.events[0].text, "/compress")
        self.assertEqual(os.listdir(control._requests()), [])

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
