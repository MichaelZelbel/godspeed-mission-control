"""godspeed-chat-guard: the code watch and the plain reply, with fake Hermes and Telegram objects."""
import asyncio
import importlib.util
import json
import os
import shutil
import sys
import tempfile
import types
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
FILE = os.path.join(HERE, "..", "assistant-files", "godspeed-chat-guard", "__init__.py")
OWNER = "4242"
A, B = "a" * 40, "b" * 40


def load(folder):
    """The plugin as installed in folder, with its mission control in folder/mc."""
    target = os.path.join(folder, "plugin")
    os.makedirs(target)
    shutil.copy(FILE, os.path.join(target, "__init__.py"))
    with open(os.path.join(target, "mission-control.txt"), "w", encoding="utf-8") as f:
        f.write(os.path.join(folder, "mc") + "\n")
    spec = importlib.util.spec_from_file_location("godspeed_chat_guard_under_test", os.path.join(target, "__init__.py"))
    plugin = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(plugin)
    return plugin


class Bot:
    def __init__(self):
        self.sent = []

    async def send_message(self, chat_id, text):
        self.sent.append((chat_id, text))


class Application:
    def __init__(self):
        self.bot, self.error_handlers = Bot(), []

    def add_error_handler(self, handler):
        self.error_handlers.append(handler)


class Adapter:
    def __init__(self):
        self.originals = []

    async def _notify_turn_error(self, event, error):
        self.originals.append((event, error))


GROUP = "-1001234567890"


def update(user=OWNER, chat_type="private", message_id=7, text="What is on today?", chat=None):
    return types.SimpleNamespace(effective_message=types.SimpleNamespace(message_id=message_id, text=text, caption=None),
                                 effective_chat=types.SimpleNamespace(id=int(chat or user), type=chat_type),
                                 effective_user=types.SimpleNamespace(id=int(user)))


def event(user=OWNER, chat_type="dm", message_id="9", text="Plan my week", internal=False, chat=None):
    return types.SimpleNamespace(source=types.SimpleNamespace(chat_id=chat or user, user_id=user, chat_type=chat_type),
                                 message_id=message_id, text=text, internal=internal)


HERMES_REPLY = ("Something went wrong and I couldn't finish this reply. Use /retry to try again, or /new to start "
                "a fresh conversation. Technical details are in the gateway log (`hermes logs`).")


class Runner:
    """Hermes' turn handler as it is shaped in gateway/run_turn.py: an exception inside the model turn is
    answered by _hmwa_agent_error_reply, whose text becomes the turn's reply; it never raises."""
    def __init__(self, error):
        self.error, self.handled = error, []

    async def _handle_message_with_agent(self, event, source, _quick_key, run_generation):
        try:
            raise self.error
        except Exception as e:
            return await self._hmwa_agent_error_reply(e, event, source, None, "session", None)

    async def _hmwa_agent_error_reply(self, e, event, source, session_entry, session_key, prepared):
        self.handled.append(e)
        return HERMES_REPLY


class FlakyBot(Bot):
    def __init__(self, failures):
        super().__init__()
        self.failures = failures

    async def send_message(self, chat_id, text):
        if self.failures:
            self.failures -= 1
            raise ConnectionError("Telegram did not answer")
        await super().send_message(chat_id, text)


STALE = ImportError("cannot import name 'resolve_turn_route' from 'agent.routing' (/opt/hermes-src/agent/routing.py)")


class Case(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.folder, True)
        self.env = os.environ.get("TELEGRAM_ALLOWED_USERS")
        os.environ["TELEGRAM_ALLOWED_USERS"] = OWNER
        self.plugin = load(self.folder)

    def tearDown(self):
        if self.env is None:
            os.environ.pop("TELEGRAM_ALLOWED_USERS", None)
        else:
            os.environ["TELEGRAM_ALLOWED_USERS"] = self.env

    def saved(self):
        try:
            with open(os.path.join(self.folder, "mc", ".godspeed", "chat-guard", "unanswered.jsonl"), encoding="utf-8") as f:
                return [json.loads(line) for line in f if line.strip()]
        except FileNotFoundError:
            return []


class CodeWatch(Case):
    def watch(self, reads, off=False):
        reads, signals = list(reads), []
        watch = self.plugin.Watch("/hermes", read=lambda root: reads.pop(0), signal_self=lambda: signals.append(1),
                                  hard_exit=lambda code: None, sleep=lambda s: None, off=lambda: off)
        return watch, signals

    def test_two_reads_of_new_code_restart_once(self):
        watch, signals = self.watch([A, B, B])
        self.assertEqual([watch.step(), watch.step()], [None, "restart"])
        self.assertEqual(signals, [1])

    def test_a_revision_that_flips_back_waits_for_two_in_a_row(self):
        watch, signals = self.watch([A, B, A, B, B])
        self.assertEqual([watch.step() for _ in range(4)], [None, None, None, "restart"])
        self.assertEqual(signals, [1])

    def test_unreadable_code_never_restarts(self):
        watch, signals = self.watch([A, None, None, None])
        self.assertEqual([watch.step() for _ in range(3)], [None, None, None])
        self.assertEqual(signals, [])

    def test_the_off_marker_keeps_the_process(self):
        watch, signals = self.watch([A, B, B, B], off=True)
        self.assertEqual([watch.step() for _ in range(3)], [None, None, None])
        self.assertEqual(signals, [])

    def test_run_exits_75_when_the_restart_does_not_end_the_process(self):
        reads, exits, slept = [A, B, B], [], []
        watch = self.plugin.Watch("/hermes", read=lambda root: reads.pop(0), signal_self=lambda: None,
                                  hard_exit=exits.append, sleep=slept.append, off=lambda: False)
        watch.run()
        self.assertEqual(exits, [75])
        self.assertEqual(slept, [60, 60, 300])

    def test_revision_from_the_git_files(self):
        root = os.path.join(self.folder, "hermes")
        git = os.path.join(root, ".git")
        os.makedirs(os.path.join(git, "refs", "heads"))
        write = lambda name, text: open(os.path.join(git, name), "w", encoding="utf-8").write(text)
        write("HEAD", "ref: refs/heads/main\n")
        write(os.path.join("refs", "heads", "main"), A + "\n")
        self.assertEqual(self.plugin.checkout_revision(root), A)
        os.remove(os.path.join(git, "refs", "heads", "main"))
        write("packed-refs", "# pack-refs with: peeled fully-peeled sorted\n%s refs/heads/main\n" % B)
        self.assertEqual(self.plugin.checkout_revision(root), B)
        write("HEAD", A + "\n")
        self.assertEqual(self.plugin.checkout_revision(root), A)
        write("HEAD", "ref: refs/heads/gone\n")
        self.assertIsNone(self.plugin.checkout_revision(root))
        self.assertIsNone(self.plugin.checkout_revision(os.path.join(self.folder, "nowhere")))

    def test_revision_of_a_worktree(self):
        main = os.path.join(self.folder, "main.git")
        own = os.path.join(main, "worktrees", "hermes")
        os.makedirs(own)
        os.makedirs(os.path.join(main, "refs", "heads"))
        open(os.path.join(own, "HEAD"), "w").write("ref: refs/heads/stable\n")
        open(os.path.join(own, "commondir"), "w").write("../..\n")
        open(os.path.join(main, "refs", "heads", "stable"), "w").write(B + "\n")
        root = os.path.join(self.folder, "hermes")
        os.makedirs(root)
        open(os.path.join(root, ".git"), "w").write("gitdir: %s\n" % own)
        self.assertEqual(self.plugin.checkout_revision(root), B)


class PlainReply(Case):
    def setUp(self):
        super().setUp()
        self.app, self.adapter = Application(), Adapter()
        self.plugin.start_watch = lambda root=None: None
        self.plugin.factory(self.app, self.adapter)

    def handle(self, upd):
        context = types.SimpleNamespace(error=STALE, bot=self.app.bot)
        asyncio.run(self.app.error_handlers[0](upd, context))

    def assert_plain(self, text):
        for word in ("Error", "error", "import", "/", "routing", "resolve_turn_route", "agent"):
            self.assertNotIn(word, text)

    def test_registers_an_error_handler(self):
        self.assertEqual(len(self.app.error_handlers), 1)

    def test_a_failed_message_from_the_owner_gets_one_plain_sentence_and_is_saved(self):
        self.handle(update())
        self.assertEqual(self.app.bot.sent, [(int(OWNER), self.plugin.PLAIN)])
        self.assert_plain(self.plugin.PLAIN)
        [line] = self.saved()
        self.assertEqual((line["text"], line["chat_id"], line["message_id"], line["why"]), ("What is on today?", OWNER, 7, "handler"))
        self.handle(update())
        self.assertEqual(len(self.app.bot.sent), 1)
        self.assertEqual(len(self.saved()), 1)

    def test_a_stranger_gets_nothing_in_a_private_chat_or_a_group(self):
        self.handle(update(user="999"))
        self.handle(update(user="999", chat_type="supergroup", chat=GROUP))
        self.handle(types.SimpleNamespace())
        self.assertEqual(self.app.bot.sent, [])
        self.assertEqual(self.saved(), [])

    def test_the_owners_failed_message_in_a_group_gets_the_sentence_in_that_group_and_is_saved(self):
        self.handle(update(chat_type="supergroup", chat=GROUP))
        self.handle(update(chat_type="supergroup", chat=GROUP))
        self.assertEqual(self.app.bot.sent, [(int(GROUP), self.plugin.PLAIN)])
        [line] = self.saved()
        self.assertEqual((line["chat_id"], line["text"], line["why"]), (GROUP, "What is on today?", "handler"))

    def test_a_failed_turn_gets_the_plain_sentence_instead_of_hermes_notice(self):
        asyncio.run(self.adapter._notify_turn_error(event(), STALE))
        self.assertEqual(self.app.bot.sent, [(int(OWNER), self.plugin.PLAIN)])
        self.assertEqual(self.adapter.originals, [])
        [line] = self.saved()
        self.assertEqual((line["text"], line["why"]), ("Plan my week", "turn"))
        asyncio.run(self.adapter._notify_turn_error(event(), STALE))
        self.assertEqual(len(self.app.bot.sent), 1)

    def test_the_owners_failed_turn_in_a_group_gets_the_sentence_in_that_group(self):
        asyncio.run(self.adapter._notify_turn_error(event(chat_type="group", chat=GROUP), STALE))
        self.assertEqual((self.app.bot.sent, self.adapter.originals), ([(int(GROUP), self.plugin.PLAIN)], []))
        [line] = self.saved()
        self.assertEqual((line["chat_id"], line["why"]), (GROUP, "turn"))

    def test_a_strangers_turn_in_a_group_keeps_hermes_notice(self):
        group = event(user="999", chat_type="group", chat=GROUP)
        asyncio.run(self.adapter._notify_turn_error(group, STALE))
        self.assertEqual(self.adapter.originals, [(group, STALE)])
        self.assertEqual(self.app.bot.sent, [])

    def test_a_second_telegram_client_is_wrapped_once_and_answers_through_the_new_one(self):
        second = Application()
        self.plugin.factory(second, self.adapter)
        asyncio.run(self.adapter._notify_turn_error(event(), STALE))
        self.assertEqual((self.app.bot.sent, second.bot.sent), ([], [(int(OWNER), self.plugin.PLAIN)]))

    def test_failed_turns_without_a_message_id_are_each_answered(self):
        for _ in range(3):
            asyncio.run(self.adapter._notify_turn_error(event(message_id=None), STALE))
        self.assertEqual(self.app.bot.sent, [(int(OWNER), self.plugin.PLAIN)] * 3)

    def test_an_internal_turn_keeps_hermes_notice(self):
        wake = event(message_id=None, internal=True)
        asyncio.run(self.adapter._notify_turn_error(wake, STALE))
        self.assertEqual((self.adapter.originals, self.app.bot.sent, self.saved()), ([(wake, STALE)], [], []))

    def test_a_message_that_cannot_be_saved_is_logged_and_the_reply_does_not_say_it_was_saved(self):
        os.remove(os.path.join(self.folder, "plugin", "mission-control.txt"))
        with self.assertLogs("godspeed-chat-guard", "ERROR") as logged:
            asyncio.run(self.adapter._notify_turn_error(event(), STALE))
        self.assertEqual(self.app.bot.sent, [(int(OWNER), self.plugin.PLAIN_UNSAVED)])
        self.assertNotIn("saved", self.plugin.PLAIN_UNSAVED)
        self.assert_plain(self.plugin.PLAIN_UNSAVED)
        self.assertTrue(any("Plan my week" in line for line in logged.output))

    def test_a_reply_that_could_not_be_sent_is_tried_again_on_the_next_failure(self):
        self.app.bot = FlakyBot(1)
        self.plugin.factory(self.app, self.adapter)
        asyncio.run(self.adapter._notify_turn_error(event(), STALE))
        self.assertEqual(self.app.bot.sent, [])
        self.handle(update(message_id=9))
        self.assertEqual(self.app.bot.sent, [(int(OWNER), self.plugin.PLAIN)])

    def test_the_unanswered_list_keeps_the_newest(self):
        root = os.path.join(self.folder, "mc")
        for n in range(self.plugin.KEEP + 3):
            self.plugin.save_unanswered(root, {"n": n})
        kept = self.saved()
        self.assertEqual((len(kept), kept[0]["n"], kept[-1]["n"]), (self.plugin.KEEP, 3, self.plugin.KEEP + 2))


class ModelTurn(Case):
    """An error inside the model turn, through Hermes' turn handler rather than the wrapped method."""
    def setUp(self):
        super().setUp()
        self.plugin.start_watch = lambda root=None: None
        self.Runner = type("GatewayRunner", (Runner,), {})
        self.addCleanup(sys.modules.pop, "gateway.run", None)
        sys.modules["gateway.run"] = types.SimpleNamespace(GatewayRunner=self.Runner)
        self.plugin.factory(Application(), Adapter())

    def turn(self, ev):
        runner = self.Runner(STALE)
        return runner, asyncio.run(runner._handle_message_with_agent(ev, ev.source, "key", 1))

    def test_the_owner_gets_the_plain_sentence_and_the_message_is_saved(self):
        runner, reply = self.turn(event())
        self.assertEqual(reply, self.plugin.PLAIN)
        self.assertEqual(runner.handled, [STALE], "Hermes still logs the error and keeps the message")
        [line] = self.saved()
        self.assertEqual((line["text"], line["why"]), ("Plan my week", "model turn"))

    def test_the_owners_model_turn_in_a_group_gets_the_plain_sentence(self):
        self.assertEqual(self.turn(event(chat_type="group", chat=GROUP))[1], self.plugin.PLAIN)
        [line] = self.saved()
        self.assertEqual((line["chat_id"], line["why"]), (GROUP, "model turn"))

    def test_a_strangers_or_an_internal_turn_keeps_hermes_reply(self):
        self.assertEqual(self.turn(event(user="999", chat_type="group", chat=GROUP))[1], HERMES_REPLY)
        self.assertEqual(self.turn(event(internal=True))[1], HERMES_REPLY)
        self.assertEqual(self.saved(), [])

    def test_a_second_telegram_client_wraps_it_once(self):
        self.plugin.factory(Application(), Adapter())
        self.assertEqual(self.turn(event())[1], self.plugin.PLAIN)
        self.assertEqual(len(self.saved()), 1)


class StartWatch(Case):
    def setUp(self):
        super().setUp()
        self.started = []
        started = self.started

        class Thread:
            def __init__(self, target, name, daemon):
                self.target, self.daemon = target, daemon

            def start(self):
                started.append(self)

        self.plugin.threading = types.SimpleNamespace(Thread=Thread)
        self.root = os.path.join(self.folder, "hermes")
        os.makedirs(os.path.join(self.root, ".git"))
        with open(os.path.join(self.root, ".git", "HEAD"), "w", encoding="utf-8") as f:
            f.write(A + "\n")
        self.plugin.hermes_root = lambda: self.root

    def test_the_gateway_starts_one_watch_on_the_code_it_loaded(self):
        self.plugin.factory(Application(), Adapter())
        self.plugin.factory(Application(), Adapter())
        [thread] = self.started
        self.assertTrue(thread.daemon)
        self.assertEqual((thread.target.__self__.root, thread.target.__self__.boot), (self.root, A))

    def test_no_watch_on_code_whose_revision_cannot_be_read(self):
        os.remove(os.path.join(self.root, ".git", "HEAD"))
        self.plugin.factory(Application(), Adapter())
        self.assertEqual(self.started, [])


class Registration(unittest.TestCase):
    def test_only_a_telegram_factory_is_registered_and_nothing_starts_at_import(self):
        folder = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, folder, True)
        plugin = load(folder)
        registered = []
        plugin.register(types.SimpleNamespace(register_telegram_handler=registered.append))
        self.assertEqual(registered, [plugin.factory])
        self.assertFalse(plugin._watching)
        plugin.register(types.SimpleNamespace())


if __name__ == "__main__":
    unittest.main()
