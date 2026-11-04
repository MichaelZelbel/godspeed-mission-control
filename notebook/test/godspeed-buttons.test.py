"""The shared Yes/No buttons (notebook/assistant-files/godspeed-buttons/buttons.py), driven the way
Hermes would: stand-ins for the telegram SDK and the bot, real token files on a throwaway folder."""
import asyncio
import importlib.util
import os
import sys
import tempfile
import types
import unittest

OWNER, BOT = 31415, 1112
HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location(
    "buttons", os.path.join(HERE, "..", "assistant-files", "godspeed-buttons", "buttons.py"))
buttons = importlib.util.module_from_spec(spec)
spec.loader.exec_module(buttons)

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


def tap(buttons_, bot, data, message_id, user=OWNER):
    message = types.SimpleNamespace(chat=types.SimpleNamespace(id=OWNER, type="private"), message_id=message_id,
                                    text=WORDS["en"]["question"], from_user=types.SimpleNamespace(id=BOT),
                                    reply_markup=None)

    async def answer():
        pass
    query = types.SimpleNamespace(from_user=types.SimpleNamespace(id=user), message=message, data=data, answer=answer)
    asyncio.run(buttons_.callback(types.SimpleNamespace(callback_query=query), types.SimpleNamespace(bot=bot)))


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
        tap(other, self.bot, other.prefix + theirs["yes"], 300)
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


if __name__ == "__main__":
    unittest.main()
