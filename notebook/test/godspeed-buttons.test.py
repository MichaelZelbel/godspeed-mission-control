"""The shared Yes/No buttons (notebook/assistant-files/godspeed-buttons/buttons.py), driven the way
Hermes would: stand-ins for the telegram SDK and the bot, real token files on a throwaway folder."""
import asyncio
import importlib.util
import os
import re
import sys
import tempfile
import types
import unittest

try:  # Hermes' own Python has the real SDK: then a press is read the way the gateway reads it.
    from telegram import Bot as SdkBot, Update as SdkUpdate
except ImportError:
    SdkBot = SdkUpdate = None

OWNER, BOT = 31415, 1112
HERE = os.path.dirname(os.path.abspath(__file__))


def load(name, *parts):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, *parts))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


buttons = load("buttons", "..", "assistant-files", "godspeed-buttons", "buttons.py")
# The stand-in Telegram whose press scenarios/server-telegram.mjs queues.
fake_telegram = load("fake_telegram", "..", "..", "docker", "test", "fake-telegram.py")

WORDS = {"en": {"question": "Go ahead?", "buttonYes": "Yes", "buttonNo": "No",
                "noOpenQuestion": "Nothing is open.", "buttonFailed": "That did not go through."}}


class Button:
    def __init__(self, text, callback_data=None):
        self.text, self.callback_data = text, callback_data


class Markup:
    def __init__(self, rows):
        self.inline_keyboard = rows


telegram = types.ModuleType("telegram")
telegram.InlineKeyboardButton, telegram.InlineKeyboardMarkup = Button, Markup
sys.modules["telegram"] = telegram


class Bot:
    id = BOT

    def __init__(self):
        self.sent, self.edits = [], []

    async def send_message(self, **kw):
        self.sent.append(kw)
        return types.SimpleNamespace(message_id=100 + len(self.sent))

    async def edit_message_text(self, **kw):
        self.edits.append(kw)


def tap(buttons_, bot, data, message_id, user=OWNER, handler=None):
    message = types.SimpleNamespace(chat=types.SimpleNamespace(id=OWNER, type="private"), message_id=message_id,
                                    text=WORDS["en"]["question"], from_user=types.SimpleNamespace(id=BOT),
                                    reply_markup=None)

    async def answer():
        pass
    query = types.SimpleNamespace(from_user=types.SimpleNamespace(id=user), message=message, data=data, answer=answer)
    asyncio.run((handler or buttons_.callback)(types.SimpleNamespace(callback_query=query), types.SimpleNamespace(bot=bot)))


class SharedButtons(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        os.environ["TELEGRAM_ALLOWED_USERS"] = str(OWNER)
        os.environ["GODSPEED_CHARM_BUTTON_DELAY"] = "0"
        self.heard = []
        self.buttons = buttons.YesNoButtons(
            lambda: self.dir.name,
            {"one": lambda t: self.heard.append(("one", t["answer"], t["step"])) or "one done",
             "two": lambda t: self.heard.append(("two", t["answer"], t["step"])) or "two done"},
            texts=lambda: WORDS, prefix="gsb1:", folder="buttons")
        self.bot = Bot()

    def tearDown(self):
        self.dir.cleanup()

    def ask(self, callback_id, step):
        route = {"ownerId": str(OWNER), "chatId": str(OWNER)}
        tokens = self.buttons.issue(callback_id, {"step": step}, route, BOT, "en")
        self.assertIsNotNone(tokens)
        message_id = 100 + len(self.bot.sent) + 1
        self.bot.sent.append({})
        self.buttons.bind(tokens, message_id)
        return tokens, message_id

    def data(self, tokens, answer):
        return self.buttons.prefix + tokens[answer]

    def test_one_press_answers_once_and_a_second_press_is_refused(self):
        tokens, message = self.ask("one", "s1")
        tap(self.buttons, self.bot, self.data(tokens, "yes"), message)
        tap(self.buttons, self.bot, self.data(tokens, "yes"), message)
        tap(self.buttons, self.bot, self.data(tokens, "no"), message)
        self.assertEqual(self.heard, [("one", "yes", "s1")])
        self.assertEqual([e["text"] for e in self.bot.edits],
                         ["one done", WORDS["en"]["noOpenQuestion"], WORDS["en"]["noOpenQuestion"]])

    def test_a_stale_or_unknown_token_is_refused(self):
        tap(self.buttons, self.bot, self.buttons.prefix + "a" * 32, 101)
        self.assertEqual(self.heard, [])
        self.assertEqual([e["text"] for e in self.bot.edits], [WORDS["en"]["noOpenQuestion"]])

    def test_a_token_pressed_on_another_message_changes_nothing(self):
        tokens, message = self.ask("one", "s1")
        tap(self.buttons, self.bot, self.data(tokens, "yes"), message + 7)
        self.assertEqual((self.heard, self.bot.edits), ([], []))

    def test_the_answer_reaches_the_callback_for_its_id_only(self):
        first, first_message = self.ask("one", "s1")
        second, second_message = self.ask("two", "s2")
        tap(self.buttons, self.bot, self.data(second, "no"), second_message)
        self.assertEqual(self.heard, [("two", "no", "s2")])
        tap(self.buttons, self.bot, self.data(first, "yes"), first_message)
        self.assertEqual(self.heard, [("two", "no", "s2"), ("one", "yes", "s1")])

    def test_two_callers_keep_their_own_prefix_and_tokens(self):
        other_heard = []
        other = buttons.YesNoButtons(lambda: self.dir.name, {"one": lambda t: other_heard.append(t["answer"]) or "other"},
                                     texts=lambda: WORDS, prefix="gsx1:", folder="other-buttons")
        mine, mine_message = self.ask("one", "s1")
        route = {"ownerId": str(OWNER), "chatId": str(OWNER)}
        theirs = other.issue("one", {"step": "t1"}, route, BOT, "en")
        other.bind(theirs, 300)
        self.assertNotEqual(self.buttons.data.pattern, other.data.pattern)
        self.assertIsNone(self.buttons.data.match(other.prefix + theirs["yes"]))
        handlers = []

        class Native:
            def add_handler(self, handler):
                handlers.append(handler)

        class Handler:
            def __init__(self, callback, pattern):
                self.callback, self.pattern = callback, pattern
        ext = types.ModuleType("telegram.ext")
        ext.CallbackQueryHandler = Handler
        sys.modules["telegram.ext"] = ext
        self.addCleanup(sys.modules.pop, "telegram.ext", None)

        async def register():
            self.buttons.factory(Native(), None)
            other.factory(Native(), None)
        asyncio.run(register())
        data = other.prefix + theirs["yes"]
        selected = next(h for h in handlers if re.match(h.pattern, data))
        self.assertEqual(selected.callback.__self__, other)
        tap(other, self.bot, data, 300, handler=selected.callback)
        self.assertEqual((self.heard, other_heard), ([], ["yes"]))
        tap(self.buttons, self.bot, self.data(mine, "no"), mine_message)
        self.assertEqual(self.heard, [("one", "no", "s1")])

    def test_a_token_for_an_id_nobody_registered_runs_nothing(self):
        tokens, message = self.ask("one", "s1")
        del self.buttons.callbacks["one"]
        tap(self.buttons, self.bot, self.data(tokens, "yes"), message)
        self.assertEqual(self.heard, [])

    def test_nobody_but_the_owner_can_press(self):
        tokens, message = self.ask("one", "s1")
        tap(self.buttons, self.bot, self.data(tokens, "yes"), message, user=OWNER + 1)
        self.assertEqual((self.heard, self.bot.edits), ([], []))
        tap(self.buttons, self.bot, self.data(tokens, "yes"), message)
        self.assertEqual(self.heard, [("one", "yes", "s1")])

    def test_a_callback_that_fails_gives_the_press_back(self):
        tokens, message = self.ask("one", "s1")
        calls = []

        def broken(token):
            calls.append(token["answer"])
            if len(calls) == 1:
                raise RuntimeError("nothing happened")
            return "worked"
        self.buttons.callbacks["one"] = broken
        tap(self.buttons, self.bot, self.data(tokens, "yes"), message)
        tap(self.buttons, self.bot, self.data(tokens, "yes"), message)
        self.assertEqual(calls, ["yes", "yes"])
        self.assertIn(WORDS["en"]["buttonFailed"], self.bot.edits[0]["text"])
        self.assertEqual(self.bot.edits[1]["text"], "worked")


def driver_press(data, text):
    """The update the scenarios' stand-in Telegram queues when server-telegram.mjs presses `data`."""
    fake = fake_telegram.Fake("1:a", {"users": {str(OWNER): {"first_name": "Scenario owner"}}})
    fake.handle("sendMessage", {"chat_id": OWNER, "text": text,
                                "reply_markup": {"inline_keyboard": [[{"text": "Yes", "callback_data": data}]]}})
    fake.later({"from": OWNER, "press": data})
    return fake.updates[-1], fake.sent[-1]["message_id"], fake_telegram.BOT["id"]


def telegram_press(data, text):
    """The update Telegram itself sends for a press in the owner's private chat (Bot API, CallbackQuery)."""
    message_id = 120
    return {"update_id": 900, "callback_query": {
        "id": "4382bfdwdsb323b2d9", "chat_instance": "-7843297923742", "data": data,
        "from": {"id": OWNER, "is_bot": False, "first_name": "Ann", "language_code": "en"},
        "message": {"message_id": message_id, "date": 1794400000, "text": text,
                    "from": {"id": BOT, "is_bot": True, "first_name": "Godspeed", "username": "godspeed_bot"},
                    "chat": {"id": OWNER, "type": "private", "first_name": "Ann"},
                    "reply_markup": {"inline_keyboard": [[{"text": "Yes", "callback_data": data}]]}}}}, message_id, BOT


def as_objects(value):
    """A Bot API dict read with python-telegram-bot's attribute names, for a Python without the SDK."""
    if isinstance(value, dict):
        return types.SimpleNamespace(**{("from_user" if key == "from" else key): as_objects(item)
                                        for key, item in value.items()})
    return value


class PressShapes(unittest.TestCase):
    """The press the scenarios send and the press Telegram sends, through every gate of callback()."""

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        os.environ["TELEGRAM_ALLOWED_USERS"] = str(OWNER)
        self.heard = []
        self.buttons = buttons.YesNoButtons(lambda: self.dir.name,
                                            {"step": lambda t: self.heard.append(t["answer"]) or "Approved."},
                                            texts=lambda: WORDS, prefix="gss1:", folder="step-buttons")

    def press(self, shape, change=lambda update: None):
        """Makes a step's tokens, presses Yes in `shape` after `change`, and gives the gate it stopped at."""
        route = {"ownerId": str(OWNER), "chatId": str(OWNER)}
        update, message_id, bot_id = shape("gss1:" + "0" * 32, WORDS["en"]["question"])
        tokens = self.buttons.issue("step", {"step": "gym"}, route, bot_id, "en")
        self.buttons.bind(tokens, message_id)
        update["callback_query"]["data"] = self.buttons.prefix + tokens["yes"]
        change(update)
        parsed = SdkUpdate.de_json(update, SdkBot("1:a")) if SdkUpdate else as_objects(update)
        bot = Bot()
        bot.id = bot_id
        with self.assertLogs("godspeed-buttons", "DEBUG") as logged:
            buttons.log.debug("pressed")
            asyncio.run(self.buttons.callback(parsed, types.SimpleNamespace(bot=bot)))
        return [line.split(" stopped at ", 1)[1] for line in logged.output if " stopped at " in line]

    def test_both_shapes_carry_what_the_sdk_needs_to_read_a_press(self):
        for shape in (driver_press, telegram_press):
            with self.subTest(shape=shape.__name__):
                query = shape("gss1:" + "0" * 32, "Q?")[0]["callback_query"]
                self.assertTrue({"id", "from", "chat_instance", "data", "message"} <= set(query))
                self.assertTrue({"message_id", "date", "chat"} <= set(query["message"]))
                self.assertEqual(query["message"]["chat"]["type"], "private")

    def test_the_owners_press_answers_its_step_in_both_shapes(self):
        for shape in (driver_press, telegram_press):
            with self.subTest(shape=shape.__name__):
                self.heard.clear()
                self.assertEqual(self.press(shape), [])
                self.assertEqual(self.heard, ["yes"])

    def test_each_gate_stops_a_press_and_names_itself(self):
        def message(update):
            return update["callback_query"]["message"]

        def allowed_users(update):
            os.environ["TELEGRAM_ALLOWED_USERS"] = "%d,%d" % (OWNER, OWNER + 1)
        gates = {
            "allowed users": allowed_users,
            "owner": lambda u: u["callback_query"]["from"].update(id=OWNER + 1),
            "private chat": lambda u: message(u)["chat"].update(type="group", title="Family"),
            "forward_origin": lambda u: message(u).update(forward_origin={
                "type": "user", "date": 1794400000, "sender_user": {"id": 7, "is_bot": False, "first_name": "Bo"}}),
            "bot message": lambda u: message(u)["from"].update(id=7, is_bot=False),
            "prefix": lambda u: u["callback_query"].update(data="gsx1:" + "0" * 32),
            "token binding (messageId)": lambda u: message(u).update(message_id=message(u)["message_id"] + 1),
        }
        for shape in (driver_press, telegram_press):
            for gate, change in gates.items():
                with self.subTest(shape=shape.__name__, gate=gate):
                    os.environ["TELEGRAM_ALLOWED_USERS"] = str(OWNER)
                    stopped = self.press(shape, change)
                    self.assertEqual(len(stopped), 1, stopped)
                    self.assertTrue(stopped[0].startswith(gate), stopped)
                    self.assertEqual(self.heard, [])

    def test_the_handler_says_which_handler_group_it_joined(self):
        class Native:
            def add_handler(self, handler):
                pass
        ext = types.ModuleType("telegram.ext")
        ext.CallbackQueryHandler = lambda callback, pattern: None
        sys.modules["telegram.ext"] = ext
        self.addCleanup(sys.modules.pop, "telegram.ext", None)

        async def register():
            self.buttons.factory(Native(), None)
        with self.assertLogs("godspeed-buttons", "INFO") as logged:
            asyncio.run(register())
        self.assertIn("(gss1:): press handler registered in handler group 0", logged.output[0])


if __name__ == "__main__":
    unittest.main()
