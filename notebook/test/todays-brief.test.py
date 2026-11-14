"""godspeed-reply/todays_brief.py: "today's brief" in Telegram is the briefing the notebook saved,
word for word, answered before the model. The plugin's own code runs against a stand-in
`godspeed-brief` and a stand-in gateway. Run: python todays-brief.test.py [-v]"""
import asyncio
import importlib.util
import os
import sqlite3
import stat
import sys
import tempfile
import types
import unittest

SOURCE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assistant-files", "godspeed-reply", "todays_brief.py")
spec = importlib.util.spec_from_file_location("todays_brief", SOURCE)
brief = importlib.util.module_from_spec(spec)
spec.loader.exec_module(brief)

OWNER = "31415"
SAVED = "One of your saved goals is Plant the fictional garden.\n\nNext: review the work Godspeed verified."


def home_with(output, code=0):
    home = tempfile.mkdtemp(prefix="godspeed-todays-brief-")
    os.makedirs(os.path.join(home, "bin"))
    command = os.path.join(home, "bin", "godspeed-brief")
    with open(command, "w", encoding="utf-8") as f:
        f.write("#!%s\nimport sys\nassert sys.argv[1:] == ['--saved'], sys.argv\nsys.stdout.write(%r)\nsys.exit(%d)\n"
                % (sys.executable, output, code))
    os.chmod(command, os.stat(command).st_mode | stat.S_IEXEC)
    return home


def event(text, user=OWNER, chat=OWNER, platform="telegram", chat_type="dm"):
    source = types.SimpleNamespace(platform=types.SimpleNamespace(value=platform), chat_id=chat, user_id=user, chat_type=chat_type)
    return types.SimpleNamespace(text=text, source=source)


class Adapter:
    def __init__(self):
        self.sent = []

    async def send(self, chat_id, content, reply_to=None, metadata=None):
        self.sent.append((chat_id, content))
        return types.SimpleNamespace(success=True)


class TodaysBrief(unittest.TestCase):
    def setUp(self):
        os.environ["TELEGRAM_ALLOWED_USERS"] = OWNER

    def test_the_asks_in_english_and_german(self):
        for text in ("today's brief", "Today's brief?", "today’s brief", "my brief", "the brief again",
                     "Show me today's brief", "morning brief please", "brief", "😀" * 59 + "brief"):
            self.assertTrue(brief.asks_for_brief(text), text)
        for text in ("Heutiges Briefing", "zeig mir das Briefing von heute", "mein Morgenbriefing", "Morgenbriefing bitte"):
            self.assertTrue(brief.asks_for_brief(text), text)
        for text in ("what was in yesterday's brief?", "make the brief shorter from tomorrow", "brief me on the garden",
                     "yes", "", None, "today's brief " * 10):
            self.assertFalse(brief.asks_for_brief(text), text)

    def test_the_saved_briefing_word_for_word_and_nothing_written(self):
        self.assertEqual(brief.answer(event("today's brief"), home_with(SAVED + "\n")), SAVED)

    def test_no_briefing_saved_today_is_one_sentence_in_the_language_asked(self):
        self.assertEqual(brief.answer(event("today's brief"), home_with("")), "No morning briefing is saved for today.")
        self.assertEqual(brief.answer(event("heutiges Briefing"), home_with("")), "Für heute ist kein Morgenbriefing gespeichert.")

    def test_a_bare_briefing_follows_the_persons_earlier_messages(self):
        home = home_with("")
        self.assertEqual(brief.answer(event("Briefing"), home), "No morning briefing is saved for today.")
        db = sqlite3.connect(os.path.join(home, "state.db"))
        db.executescript("CREATE TABLE sessions(id TEXT PRIMARY KEY, source TEXT NOT NULL, user_id TEXT);"
                         "CREATE TABLE messages(id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,"
                         " role TEXT NOT NULL, content TEXT);")
        db.execute("INSERT INTO sessions VALUES ('s', 'telegram', ?), ('t', 'telegram', '999')", (OWNER,))
        db.execute("INSERT INTO messages(session_id, role, content) VALUES ('s', 'user', ?)",
                   ("Ich bin heute mit dem Bericht fertig und fange jetzt mit den Tests an",))
        db.execute("INSERT INTO messages(session_id, role, content) VALUES ('t', 'user', 'What is on my list today?')")
        db.commit()
        db.close()
        self.assertEqual(brief.answer(event("Briefing"), home), "Für heute ist kein Morgenbriefing gespeichert.")
        self.assertEqual(brief.answer(event("today's brief"), home), "No morning briefing is saved for today.")

    def test_everything_else_goes_to_the_model(self):
        home = home_with(SAVED)
        self.assertIsNone(brief.answer(event("how is my garden doing?"), home))
        self.assertIsNone(brief.answer(event("today's brief", user="999", chat="999"), home), "not the owner")
        self.assertIsNone(brief.answer(event("today's brief", platform="discord"), home))
        self.assertIsNone(brief.answer(event("today's brief", chat_type="group"), home))
        self.assertIsNone(brief.answer(event("today's brief"), home_with("", code=1)), "a read that fails")
        self.assertIsNone(brief.answer(event("today's brief"), None))
        os.environ["TELEGRAM_ALLOWED_USERS"] = "111,222"
        self.assertIsNone(brief.answer(event("today's brief"), home), "no single owner")

    def test_the_hook_sends_it_and_keeps_the_message_from_the_model(self):
        adapter, home = Adapter(), home_with(SAVED)
        platform = type("Platform", (), {"value": "telegram"})()  # hashable, as Hermes' Platform enum is
        gateway = types.SimpleNamespace(adapters={platform: adapter})
        hook = brief.make_hook(lambda: home)
        result = asyncio.run(hook(event=event("today's brief"), gateway=gateway, session_store=None))
        self.assertEqual(result["action"], "skip")
        self.assertEqual(adapter.sent, [(OWNER, SAVED)])
        self.assertIsNone(asyncio.run(hook(event=event("hello"), gateway=gateway, session_store=None)))
        self.assertEqual(len(adapter.sent), 1)


if __name__ == "__main__":
    unittest.main()
