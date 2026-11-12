"""godspeed-reply (notebook/assistant-files/godspeed-reply): the reply goes out in the language of the
message it answers. The plugin's own code runs for real, against a real SQLite store shaped like
Hermes' (sessions, messages) and a stand-in for the `godspeed-model` command the notebook installs,
which answers from a table and records every request. A text it has no answer for, or every request
while a file "fail-next" is there (which it then counts down), fails as godspeed-model does: exit 1
and its error words (the file "error.txt") on stderr. A second, stricter try (the system words "Never
repeat the original text") is answered from the table's "strict:<text>" when there is one. Run: python reply-language.test.py [-v]"""
import importlib.util
import json
import os
import shutil
import sqlite3
import sys
import tempfile
import types
import unittest

SOURCE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assistant-files", "godspeed-reply")

STAND_IN = """#!%s
import json, os, sys
here = os.path.dirname(os.path.abspath(__file__))
request = json.load(sys.stdin)
with open(os.path.join(here, "requests.jsonl"), "a", encoding="utf-8") as f:
    f.write(json.dumps(request) + "\\n")
table = json.load(open(os.path.join(here, "table.json"), encoding="utf-8"))
text = request["prompt"].split("\\n\\n", 1)[1]
if "Never repeat the original text" in request["system"] and "strict:" + text in table:
    text = "strict:" + text
fail_next = os.path.join(here, "fail-next")
failing = os.path.exists(fail_next)
if failing:
    left = int(open(fail_next).read()) - 1
    if left > 0:
        open(fail_next, "w").write(str(left))
    else:
        os.remove(fail_next)
if failing or text not in table:
    if os.path.exists(os.path.join(here, "error.txt")):
        sys.stderr.write(open(os.path.join(here, "error.txt"), encoding="utf-8").read())
    sys.exit(1)
print(json.dumps({"text": table[text]}))
"""

JOURNAL = [
    "Track Journal: finished the login page and starting on the API docs",
    "Done with the API docs, now working on the tests for the login page",
    "I finished the tests and started on the release notes for this week",
]
DRAFT = "Alles klar, das ist gespeichert. Woran merkst du, dass es fertig ist?"
SENT = "Got it, that is saved. What does done look like?"
STATUS_REPLIES = [  # the review of PR #465, D1
    ("Gespeichert: Login-Seite fertig, API-Doku in Arbeit, Tests offen.",
     "Saved: login page done, API docs in progress, tests open."),
    ("Diese Woche ist noch offen:\n- Login-Seite: fertig\n- API-Doku: in Arbeit\n- Tests: offen",
     "Still open this week:\n- Login page: done\n- API docs: in progress\n- Tests: open"),
]
GERMAN_MESSAGE = "Ich bin heute mit dem Bericht fertig und fange jetzt mit den Tests an"


class Reply(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.mkdtemp(prefix="godspeed-reply-")
        self.home = os.path.join(self.temp, "home")
        self.plugin = os.path.join(self.home, "plugins", "godspeed-reply")
        shutil.copytree(SOURCE, self.plugin, ignore=shutil.ignore_patterns("__pycache__"))
        self.model = os.path.join(self.temp, "model")
        os.makedirs(self.model)
        command = os.path.join(self.model, "godspeed-model")
        with open(command, "w", encoding="utf-8") as f:
            f.write(STAND_IN % sys.executable)
        os.chmod(command, 0o755)
        with open(os.path.join(self.plugin, "model-command.txt"), "w", encoding="utf-8") as f:
            f.write(command + "\n")
        self.table = {}
        self.save_table()
        db = sqlite3.connect(os.path.join(self.home, "state.db"))
        db.executescript("CREATE TABLE sessions(id TEXT PRIMARY KEY, source TEXT NOT NULL);"
                         "CREATE TABLE messages(id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,"
                         " role TEXT NOT NULL, content TEXT);")
        db.commit()
        self.db = db
        self.env = dict(os.environ)
        os.environ["HERMES_HOME"] = self.home
        os.environ.pop("GODSPEED_SCHEDULED_RUN", None)
        for name in ("godspeed_reply_steps_v1", "godspeed_progress_output_v1"):
            sys.modules.pop(name, None)
        spec = importlib.util.spec_from_file_location("godspeed_reply_under_test", os.path.join(self.plugin, "__init__.py"))
        self.mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.mod)
        self.hooks = {}
        self.mod.register(types.SimpleNamespace(register_hook=lambda n, cb: self.hooks.setdefault(n, []).append(cb)))

    def tearDown(self):
        self.db.close()
        os.environ.clear()
        os.environ.update(self.env)
        shutil.rmtree(self.temp, ignore_errors=True)

    # -- helpers
    def save_table(self):
        with open(os.path.join(self.model, "table.json"), "w", encoding="utf-8") as f:
            json.dump(self.table, f)

    def teach(self, draft, translation):
        """The stand-in translates `draft` (as the plugin holds it back) into `translation`."""
        self.table[self.mod._protect(draft)[0]] = translation
        self.save_table()

    def fail_next(self, times, error=""):
        with open(os.path.join(self.model, "fail-next"), "w") as f:
            f.write(str(times))
        with open(os.path.join(self.model, "error.txt"), "w", encoding="utf-8") as f:
            f.write(error)

    def requests(self):
        try:
            with open(os.path.join(self.model, "requests.jsonl"), encoding="utf-8") as f:
                return [json.loads(line) for line in f if line.strip()]
        except OSError:
            return []

    def say(self, session, text, source="telegram"):
        self.db.execute("INSERT OR IGNORE INTO sessions(id, source) VALUES (?, ?)", (session, source))
        self.db.execute("INSERT INTO messages(session_id, role, content) VALUES (?, 'user', ?)", (session, text))
        self.db.commit()

    def send(self, session, draft, platform="telegram"):
        """What Hermes sends: the first replacement text of the hook, else the draft itself."""
        outs = [cb(response_text=draft, session_id=session, platform=platform, model="m", turn_id="t")
                for cb in self.hooks["transform_llm_output"]]
        return next((o for o in outs if isinstance(o, str) and o), draft)

    def log(self):
        with open(os.path.join(self.home, "logs", "godspeed-reply.log"), encoding="utf-8") as f:
            return [json.loads(line) for line in f if line.strip()]

    # -- the cases of the ticket
    def test_three_english_journal_turns_with_a_german_draft_go_out_in_english(self):
        self.teach(DRAFT, SENT)
        for n, message in enumerate(JOURNAL):
            session = "journal-%d" % n
            self.say(session, message)
            self.assertEqual(self.send(session, DRAFT), SENT, message)
        self.assertEqual(len(self.requests()), 3)
        self.assertIn("English", self.requests()[0]["prompt"])
        self.assertEqual([e["result"] for e in self.log()], ["corrected"] * 3)

    def test_english_german_english_in_one_session_each_follow_their_message(self):
        english_draft = "I saved that. What does done look like for you?"
        german_sent = "Ich habe das gespeichert. Woran merkst du, dass es fertig ist?"
        self.teach(DRAFT, SENT)
        self.teach(english_draft, german_sent)
        self.say("chat", JOURNAL[0])
        self.assertEqual(self.send("chat", DRAFT), SENT)
        self.say("chat", GERMAN_MESSAGE)
        self.assertEqual(self.send("chat", english_draft), german_sent)
        self.say("chat", JOURNAL[1])
        self.teach(DRAFT + "!", SENT)
        self.assertEqual(self.send("chat", DRAFT + "!"), SENT)
        # A reply already in the message's language is left alone, with no request.
        before = len(self.requests())
        self.assertEqual(self.send("chat", SENT), SENT)
        self.assertEqual(len(self.requests()), before)

    def test_an_explicit_language_request_wins(self):
        listing = "Here is your list for today and the tasks that are open for this week"
        german = "Hier ist deine Liste für heute und die Aufgaben, die diese Woche offen sind"
        self.teach(listing, german)
        self.say("a", "Please answer in German from now on, what is on my list for today")
        self.assertEqual(self.send("a", listing), german)
        self.say("b", "Bitte antworte auf Englisch, was steht heute auf meiner Liste")
        self.teach(german, listing)
        self.assertEqual(self.send("b", german), listing)
        # The same English message without the request keeps its English reply, and a request
        # whose language the reply already has changes nothing.
        self.say("c", "What is on my list for today and for the rest of this week")
        self.assertEqual(self.send("c", listing), listing)
        self.say("d", "Translate this into English: the list for today and for this week")
        self.assertEqual(self.send("d", listing), listing)
        self.assertEqual(len(self.requests()), 2)

    def test_mixed_text_is_unchanged(self):
        mixed = "Ok, das ist erledigt and I will save the notes for you now"
        self.assertIsNone(self.mod.language_of(mixed))
        self.say("m", JOURNAL[0])
        self.assertEqual(self.send("m", mixed), mixed)
        self.assertIsNone(self.mod.language_of("Das ist gut und I think the tests are done"))
        self.say("n", "Das ist gut und I think the tests are done")
        self.assertEqual(self.send("n", DRAFT), DRAFT)
        self.assertEqual(self.requests(), [])

    def test_a_two_word_acknowledgement_is_unchanged(self):
        self.say("s", "Thanks, done")
        self.assertEqual(self.send("s", "Alles klar"), "Alles klar")
        self.say("t", JOURNAL[0])
        self.assertEqual(self.send("t", "Alles klar!"), "Alles klar!")
        self.say("u", "Ok")
        self.assertEqual(self.send("u", DRAFT), DRAFT)
        self.assertEqual(self.requests(), [])

    def test_names_numbers_urls_and_quotes_survive_a_correction(self):
        draft = ('Ich habe "Projekt Nordlicht" mit Anna Schmidt auf 14 Aufgaben gesetzt, siehe '
                 'https://example.com/a?b=1 und `make test`. Das ist für den 3. Mai fertig.')
        held, kept = self.mod._protect(draft)
        self.assertEqual(len(kept), 3)
        marks = {k: "{{%d}}" % (i + 1) for i, k in enumerate(kept)}
        english = ("I put %s with Anna Schmidt on 14 tasks, see %s and %s. That is done for May 3."
                   % (marks['"Projekt Nordlicht"'], marks["https://example.com/a?b=1"], marks["`make test`"]))
        self.table[held] = english
        self.save_table()
        self.say("k", JOURNAL[0])
        sent = self.send("k", draft)
        for must in ('"Projekt Nordlicht"', "Anna Schmidt", "14", "https://example.com/a?b=1", "`make test`", "May 3"):
            self.assertIn(must, sent)
        self.assertNotIn("{{", sent)
        self.assertNotIn("Ich habe", sent)
        # What the model was shown held the protected parts back.
        self.assertNotIn("example.com", self.requests()[0]["prompt"])
        # A translation that drops a link, or changes a number, never goes out: the draft does, as written.
        for n, bad in enumerate((english.replace(marks["https://example.com/a?b=1"], "the link"),
                                 english.replace("14 tasks", "15 tasks"))):
            self.table[held] = bad
            self.save_table()
            self.say("bad%d" % n, JOURNAL[0])
            self.assertEqual(self.send("bad%d" % n, draft), self.mod.NOTICE["en"] + "\n\n" + draft)

    def test_a_cron_delivery_is_unchanged(self):
        self.say("job", JOURNAL[0], source="cron")
        self.assertEqual(self.send("job", DRAFT, platform="cron"), DRAFT)
        self.say("job2", JOURNAL[0], source="cron")
        self.assertEqual(self.send("job2", DRAFT, platform=""), DRAFT)
        self.say("hook", JOURNAL[0], source="webhook")
        self.assertEqual(self.send("hook", DRAFT, platform="webhook"), DRAFT)
        os.environ["GODSPEED_SCHEDULED_RUN"] = "1"
        self.say("env", JOURNAL[0])
        self.assertEqual(self.send("env", DRAFT), DRAFT)
        self.assertEqual(self.requests(), [])
        self.assertEqual({e["result"] for e in self.log()}, {"scheduled"})

    def test_a_correction_that_fails_once_is_tried_again(self):
        self.teach(DRAFT, SENT)
        self.fail_next(1, "Error: The connection was reset\n")
        self.say("r", JOURNAL[0])
        self.assertEqual(self.send("r", DRAFT), SENT)
        self.assertEqual(len(self.requests()), 2)
        line = self.log()[-1]
        self.assertEqual(line["result"], "corrected")
        self.assertEqual(line["failed_tries"], ["request-failed: Error: The connection was reset"])

    def test_the_request_names_both_languages_and_forbids_the_unchanged_text(self):
        self.teach(DRAFT, SENT)
        self.say("q", JOURNAL[0])
        self.send("q", DRAFT)
        request = self.requests()[-1]
        self.assertTrue(request["prompt"].startswith("Translate this German text into English:\n\n"))
        self.assertIn("written entirely in English, never the original text unchanged", request["system"])
        self.assertIn("translate it, do not answer it", request["system"])

    def test_a_correction_that_fails_twice_says_so_in_the_message_language_above_the_draft(self):
        self.teach(DRAFT, SENT)
        self.fail_next(2, "The AI usage limit of this connection is reached.\n")
        self.say("f", JOURNAL[0])
        sent = self.send("f", DRAFT)
        self.assertEqual(sent, self.mod.NOTICE["en"] + "\n\n" + DRAFT)
        self.assertEqual(self.mod.language_of(self.mod.NOTICE["en"]), "en")
        self.assertEqual(len(self.requests()), 2)
        line = self.log()[-1]
        self.assertEqual(line["result"], "correction-failed:request-failed: The AI usage limit of this connection is reached.")
        self.assertEqual(len(line["failed_tries"]), 2)
        self.assertEqual(line["sent"], sent)
        # The same for a German message whose draft is English, in German.
        english_draft = "I saved that. What does done look like for you?"
        self.say("f2", GERMAN_MESSAGE)
        self.fail_next(2)
        sent = self.send("f2", english_draft)
        self.assertEqual(sent, self.mod.NOTICE["de"] + "\n\n" + english_draft)
        self.assertEqual(self.mod.language_of(self.mod.NOTICE["de"]), "de")
        self.assertEqual(self.log()[-1]["result"], "correction-failed:request-failed")

    def test_every_kind_of_failed_correction_gets_the_notice(self):
        self.teach(DRAFT + " ", DRAFT + " ")  # an answer that is still German
        self.say("g", JOURNAL[1])
        self.assertEqual(self.send("g", DRAFT + " "), self.mod.NOTICE["en"] + "\n\n" + DRAFT + " ")
        self.assertEqual(self.log()[-1]["result"], "correction-failed:repeats-the-draft: unchanged")
        self.assertEqual(len(self.requests()), 2)
        # An answer in the draft's language, not the same text: the log names why, not the words.
        german_answer = "Gut, ich habe es gespeichert. Woran merkst du, dass es fertig ist?"
        self.teach(DRAFT + "   ", german_answer)
        self.say("g2", JOURNAL[1])
        self.assertEqual(self.send("g2", DRAFT + "   "), self.mod.NOTICE["en"] + "\n\n" + DRAFT + "   ")
        line = self.log()[-1]
        self.assertEqual(line["result"], "correction-failed:repeats-the-draft: part of it")
        self.assertNotIn("Gut, ich", json.dumps(line["failed_tries"], ensure_ascii=False))
        os.remove(os.path.join(self.plugin, "model-command.txt"))  # no door at all
        self.say("h", JOURNAL[2])
        self.assertEqual(self.send("h", DRAFT + "  "), self.mod.NOTICE["en"] + "\n\n" + DRAFT + "  ")
        self.assertEqual(self.log()[-1]["result"], "correction-failed:no-model-command")

    def test_the_log_keeps_the_error_words_without_keys_or_tokens(self):
        os.environ["GODSPEED_SCENARIO_AI_KEY"] = "plain-words-key-value"
        error = ("Error: 401 from https://ai.example/v1?key=abc123 with Authorization: \"Bearer qwertyuiop\" "
                 "(api_key=sk-live-0123456789abcdef, bot 123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw, "
                 "id 9f8e7d6c5b4a39281706f5e4d3c2b1a0) for plain-words-key-value; the key: is invalid\n")
        self.fail_next(2, error)
        self.say("e", JOURNAL[0])
        self.send("e", DRAFT)
        logged = self.log()[-1]["result"]
        for secret in ("abc123", "qwertyuiop", "sk-live", "AAHdqTcv", "9f8e7d6c5b4a", "plain-words-key-value"):
            self.assertNotIn(secret, logged)
        for kept in ("Error: 401 from https://ai.example/v1", "the key: is invalid", "[redacted]"):
            self.assertIn(kept, logged)
        # Only the end of a long error is kept.
        self.fail_next(2, "x " * 1000 + "the last words\n")
        self.say("e2", JOURNAL[1])
        self.send("e2", DRAFT)
        logged = self.log()[-1]["result"]
        self.assertTrue(logged.endswith("the last words"))
        self.assertLessEqual(len(logged), len("correction-failed:request-failed: ") + self.mod.ERROR_CHARS)

    # -- the owner decision on #453 of 12 November: reject, retry once stricter, then the notice
    ECHO = (DRAFT + "\n\nWait, I need to correct that: the translation is below.\n\n"
            "Got it, that's saved. How do you notice that it's finished?")  # run 43115758752, chat-en-1
    MIXED = "Alles klar, I've saved the entry. How can you tell it's finished?"  # the same run, j1

    def test_the_draft_repeated_with_a_translation_is_rejected_and_the_stricter_try_goes_out(self):
        self.assertEqual(self.mod.rejection(self.ECHO, DRAFT, "en"), "repeats-the-draft: part of it")
        self.teach(DRAFT, self.ECHO)
        self.table["strict:" + DRAFT] = SENT
        self.save_table()
        self.say("echo", JOURNAL[0])
        self.assertEqual(self.send("echo", DRAFT), SENT)
        first, second = self.requests()
        self.assertNotIn("Never repeat the original text", first["system"])
        self.assertIn("Return only the message in English. Never repeat the original text or any part of it",
                      second["system"])
        line = self.log()[-1]
        self.assertEqual((line["result"], line["failed_tries"]), ("corrected", ["repeats-the-draft: part of it"]))
        self.assertNotIn("Wait, I need", json.dumps(line, ensure_ascii=False).replace(line["sent"], ""))

    def test_an_answer_that_mixes_the_languages_is_rejected(self):
        self.assertEqual(self.mod.rejection(self.MIXED, DRAFT, "en"), "mixed-languages: too many German words")
        self.assertEqual(self.mod.rejection("Got it, ich habe das saved. Und wie merkst du that it is done?", DRAFT, "en"),
                         "mixed-languages: too many German words")
        english_draft = "I saved that. What does done look like for you?"
        self.assertEqual(self.mod.rejection("Ich habe das gespeichert. What does fertig look like?", english_draft, "de"),
                         "mixed-languages: too many English words")
        self.teach(DRAFT, self.MIXED)
        self.say("mix", JOURNAL[0])
        self.assertEqual(self.send("mix", DRAFT), self.mod.NOTICE["en"] + "\n\n" + DRAFT)
        line = self.log()[-1]
        self.assertEqual(line["failed_tries"], ["mixed-languages: too many German words"] * 2)
        self.assertNotIn("I've saved", line["result"] + " ".join(line["failed_tries"]))

    def test_a_clean_answer_in_the_target_language_is_accepted(self):
        self.assertEqual(self.mod.rejection(SENT, DRAFT, "en"), "")
        self.assertEqual(self.mod.rejection("Got it, that's saved. How do you notice that it's finished?", DRAFT, "en"), "")
        # Names stay names, and an English word German writes as a noun is German.
        self.assertEqual(self.mod.rejection("I told Jürgen Müller in München that it is done.",
                                            "Ich habe Jürgen Müller in München gesagt, dass es fertig ist.", "en"), "")
        self.assertEqual(self.mod.rejection("Dein Meeting mit Anna ist verschoben, ich sage dir dann Bescheid.",
                                            "Your meeting with Anna is moved, I will let you know.", "de"), "")
        # A German status list answered in English keeps words like Login, API and Tests: they are not
        # judged one by one, so the faithful translation goes out (the review of PR #465, D1).
        for draft, answer in STATUS_REPLIES:
            self.assertEqual(self.mod.rejection(answer, draft, "en"), "", answer)
        self.assertEqual(self.mod.rejection("Got it, I saved the entry. How can you tell it's finished?",
                                            "Alles klar, ich habe den Eintrag gespeichert. Woran merkst du, dass es fertig ist?",
                                            "en"), "")
        # An answer with no word of either language is not clearly English.
        self.assertEqual(self.mod.rejection("👍", DRAFT, "en"), "not-clearly-English")
        self.teach(DRAFT, SENT)
        self.say("clean", JOURNAL[0])
        self.assertEqual(self.send("clean", DRAFT), SENT)
        self.assertEqual(len(self.requests()), 1)
        self.assertNotIn("failed_tries", self.log()[-1])

    def test_a_second_rejected_answer_sends_the_notice(self):
        self.teach(DRAFT, self.ECHO)
        self.table["strict:" + DRAFT] = self.MIXED
        self.save_table()
        self.say("twice", JOURNAL[0])
        self.assertEqual(self.send("twice", DRAFT), self.mod.NOTICE["en"] + "\n\n" + DRAFT)
        self.assertEqual(len(self.requests()), 2)
        line = self.log()[-1]
        self.assertEqual(line["result"], "correction-failed:mixed-languages: too many German words")
        self.assertEqual(line["failed_tries"], ["repeats-the-draft: part of it",
                                                "mixed-languages: too many German words"])

    def test_a_message_after_context_in_the_other_language_gets_a_reply_in_its_own(self):
        english_draft = "I saved that. What does done look like for you?"
        german_sent = "Ich habe das gespeichert. Woran merkst du, dass es fertig ist?"
        self.teach(DRAFT, SENT)
        self.teach(english_draft, german_sent)
        # English after German context: the model kept writing German.
        for message in (GERMAN_MESSAGE, "Ich habe die Tests fertig und schreibe jetzt die Notizen"):
            self.say("de-then-en", message)
            self.assertEqual(self.send("de-then-en", DRAFT), DRAFT)
        self.say("de-then-en", JOURNAL[0])
        self.assertEqual(self.send("de-then-en", DRAFT), SENT)
        # German after English context: the model kept writing English.
        for message in JOURNAL[:2]:
            self.say("en-then-de", message)
            self.assertEqual(self.send("en-then-de", english_draft), english_draft)
        self.say("en-then-de", GERMAN_MESSAGE)
        self.assertEqual(self.send("en-then-de", english_draft), german_sent)
        self.assertEqual(len(self.requests()), 2)

    def test_a_second_step_added_by_the_documented_call_runs_after_the_language_step(self):
        self.teach(DRAFT, SENT)
        seen = []

        def later(text, **hook):
            seen.append((text, hook.get("session_id")))
            return text + " (checked)"
        bus = sys.modules["godspeed_reply_steps_v1"]
        bus.__dict__.setdefault("STEPS", []).append(("later", later))  # the documented call, by hand
        self.say("x", JOURNAL[0])
        self.assertEqual(self.send("x", DRAFT), SENT + " (checked)")
        self.assertEqual(seen, [(SENT, "x")])
        # A step that raises is skipped, and the one after it still runs.
        bus.add_step("broken", lambda text, **hook: 1 / 0)
        bus.add_step("last", lambda text, **hook: text + "!")
        self.say("y", JOURNAL[1])
        self.assertEqual(self.send("y", DRAFT), SENT + " (checked)!")
        # Only one transformer is registered, whatever the steps are.
        self.assertEqual(len(self.hooks["transform_llm_output"]), 1)

    def test_the_bus_slot_the_addons_call_runs_the_same_steps_with_one_request(self):
        self.teach(DRAFT, SENT)
        bus = sys.modules["godspeed_progress_output_v1"]
        bus.append = lambda **kw: kw["response_text"] + "\n\nMEDIA:/tmp/p.png"
        self.say("z", JOURNAL[0])
        out = bus.voice_transform(response_text=DRAFT, session_id="z", platform="telegram")
        self.assertEqual(out, SENT + "\n\nMEDIA:/tmp/p.png")
        self.assertEqual(len(self.requests()), 1)

    def test_the_same_draft_gets_its_own_decision_for_each_message(self):
        self.teach(DRAFT, SENT)
        self.say("same", JOURNAL[0])
        self.assertEqual(self.send("same", DRAFT), SENT)
        self.say("same", GERMAN_MESSAGE)  # the same reply text, now to a German message
        self.assertEqual(self.send("same", DRAFT), DRAFT)

    def test_one_log_line_per_reply_says_what_was_sent(self):
        self.teach(DRAFT, SENT)
        self.say("l", JOURNAL[0])
        self.send("l", DRAFT)
        self.send("l", SENT)
        lines = self.log()
        self.assertEqual([e["result"] for e in lines], ["corrected", "unchanged"])
        self.assertEqual(lines[0]["sent"], SENT)
        self.assertEqual(lines[0]["session"], "l")


if __name__ == "__main__":
    unittest.main()
