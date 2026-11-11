"""godspeed-chat-guard: the code watch and the plain reply, with fake Hermes and Telegram objects."""
import asyncio
import importlib.util
import json
import os
import shutil
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


def update(user=OWNER, chat_type="private", message_id=7, text="What is on today?"):
    return types.SimpleNamespace(effective_message=types.SimpleNamespace(message_id=message_id, text=text, caption=None),
                                 effective_chat=types.SimpleNamespace(id=int(user), type=chat_type),
                                 effective_user=types.SimpleNamespace(id=int(user)))


def event(user=OWNER, chat_type="dm", message_id="9", text="Plan my week"):
    return types.SimpleNamespace(source=types.SimpleNamespace(chat_id=user, user_id=user, chat_type=chat_type),
                                 message_id=message_id, text=text)


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

    def test_a_stranger_or_a_group_gets_nothing(self):
        self.handle(update(user="999"))
        self.handle(update(chat_type="group"))
        self.handle(types.SimpleNamespace())
        self.assertEqual(self.app.bot.sent, [])
        self.assertEqual(self.saved(), [])

    def test_a_failed_turn_gets_the_plain_sentence_instead_of_hermes_notice(self):
        asyncio.run(self.adapter._notify_turn_error(event(), STALE))
        self.assertEqual(self.app.bot.sent, [(int(OWNER), self.plugin.PLAIN)])
        self.assertEqual(self.adapter.originals, [])
        [line] = self.saved()
        self.assertEqual((line["text"], line["why"]), ("Plan my week", "turn"))
        asyncio.run(self.adapter._notify_turn_error(event(), STALE))
        self.assertEqual(len(self.app.bot.sent), 1)

    def test_a_group_turn_keeps_hermes_notice(self):
        group = event(chat_type="group")
        asyncio.run(self.adapter._notify_turn_error(group, STALE))
        self.assertEqual(self.adapter.originals, [(group, STALE)])
        self.assertEqual(self.app.bot.sent, [])

    def test_a_second_telegram_client_is_wrapped_once_and_answers_through_the_new_one(self):
        second = Application()
        self.plugin.factory(second, self.adapter)
        asyncio.run(self.adapter._notify_turn_error(event(), STALE))
        self.assertEqual((self.app.bot.sent, second.bot.sent), ([], [(int(OWNER), self.plugin.PLAIN)]))

    def test_the_unanswered_list_keeps_the_newest(self):
        root = os.path.join(self.folder, "mc")
        for n in range(self.plugin.KEEP + 3):
            self.plugin.save_unanswered(root, {"n": n})
        kept = self.saved()
        self.assertEqual((len(kept), kept[0]["n"], kept[-1]["n"]), (self.plugin.KEEP, 3, self.plugin.KEEP + 2))


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
