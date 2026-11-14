"""The language of a message the person sent in Telegram: the one decision every reply path uses.

WHY (13 November 2026, issue #505): a short message ("Danke", "Did my tests pass?") had no language,
because only text with enough words of one language counted, so its reply went out in whatever
language the model wrote. Three earlier fixes each added a rule of their own. Now one place decides,
and every message gets "en" or "de" (message_language):

1. the language the message asks for ("answer in German"),
2. else the language its own words tell, when at least one word tells one and the other language's
   words are a small part (a known word, not an umlaut, which may be a name),
3. else the language of the person's recent messages, newest first,
4. else the language set for the person (person_language),
5. else English, every add-on's default.

A reply is judged against that decision with reply_language: by the default threshold when it is long
enough, else by its few words as a message is, so a short wrong-language reply ("Gern geschehen!" to
"Thanks") is translated too (the review of PR #516).

Loaded by file path (godspeed-reply/__init__.py, todays_brief.py, and godspeed-charm for the line it adds
to a reply), never as a package, so each copy of the plugin finds the mission-control.txt next to it.
"""
import json
import os
import re
import sqlite3

HERE = os.path.dirname(os.path.abspath(__file__))
MIN_SIGNALS = 3        # words that tell the language, in the text, before it counts as clearly one
MIN_SHARE = 0.8        # of those words, the share that must belong to the one language
RECENT = 10            # the person's earlier messages that are looked at, newest first
LANGUAGES = ("en", "de")
# The add-on settings where a person sets a language, the replies' own one first.
SETTINGS = (("routines", "charm"), ("routines", "journal"), ("coach",), ("routines", "headache"))

ENGLISH = set("""the a and or but is are be to of on at for with from by i you we it this that my your what how
when where why do does did done have has had not would can could should just then if about me us they he she
his our their there here these those been get got make let now new look like which more some any much next
today today's todays morning thanks please yes no tell finished starting working welcome you're sure""".split())
GERMAN = set("""der die das den dem des ein eine einen einem einer und oder aber ist sind nicht ich du wir ihr
es mit von für auf zu zum zur im dass wie wo woran wann warum hat habe haben bin auch noch schon mir mich
dich dir kein keine mein meine dein deine fertig heute bitte danke ja nein merkst jetzt nur wenn dann bei
aus nach über kann können soll muss werden wird gerade heißt woher wieso welche alles klar heutiges heutige
heutigen morgenbriefing tagesbriefing sie gern gerne geschehen""".split())
GERMAN_LETTERS = re.compile(r"[äöüßÄÖÜ]")
WORD = re.compile(r"[A-Za-zÄÖÜäöüß']+")
URL = re.compile(r"https?://[^\s<>()\[\]]+|www\.[^\s<>()\[\]]+")
CODE = re.compile(r"```.*?```|`[^`\n]+`", re.S)
QUOTE = re.compile(r'"[^"\n]{2,}"|“[^”\n]{2,}”|„[^“”\n]{2,}[“”]|«[^»\n]{2,}»')
MEDIA = re.compile(r"^[ \t]*MEDIA:[^\n]*$", re.M)


def _plain(text):
    for pattern in (CODE, URL, MEDIA, QUOTE):
        text = pattern.sub(" ", text)
    return text


def language_of(text, least=MIN_SIGNALS):
    """"en", "de" or None: at least `least` words tell a language, and the other's are a small part.
    Mixed text, too few telling words, and everything in a quote or link: None. A reply is judged with
    the default; an incoming message with least=1 (message_language). Below the default, an umlaut
    tells nothing: in a short message it is usually a name ("Call Jörg")."""
    if not isinstance(text, str):
        return None
    plain = _plain(text)
    words = [w.lower().strip("'") for w in WORD.findall(plain)]
    en = sum(w in ENGLISH for w in words)
    de = sum(w in GERMAN for w in words)
    if least >= MIN_SIGNALS:
        de += len(GERMAN_LETTERS.findall(plain))
    total = en + de
    if total < least:
        return None
    if en / total >= MIN_SHARE:
        return "en"
    if de / total >= MIN_SHARE:
        return "de"
    return None


REQUEST_VERB = re.compile(r"\b(?:answer|reply|respond|write|speak|say|tell|translate|talk|antworte\w*|schreib\w*|"
                          r"sag\w*|sprich\w*|übersetz\w*|rede\w*|bitte|please)\b", re.I)
ASKED = {"de": re.compile(r"\b(?:in|into|to|auf)\s+(?:german|deutsch)\b|\bins\s+deutsche\b|\bdeutsch\s+bitte\b", re.I),
         "en": re.compile(r"\b(?:in|into|to|auf)\s+(?:english|englisch)\b|\bins\s+englische\b|\benglish\s+please\b", re.I)}


def asked_language(message):
    """The language the message asks for ("answer in German", "translate this into English"), the
    later request when it names both, else None."""
    if not isinstance(message, str) or not REQUEST_VERB.search(message):
        return None
    found = [(m.start(), lang) for lang, pattern in ASKED.items() for m in pattern.finditer(message)]
    return max(found)[1] if found else None


def reply_language(text):
    """"en", "de" or None for a draft reply: clearly one language by the default threshold, else, for a
    short reply ("Gern geschehen!", "Nein, zwei Tests sind fehlgeschlagen."), the language its few
    telling words agree on. Mixed words: None, so the reply goes out as it is."""
    return language_of(text) or language_of(text, least=1)


def _told(message):
    return asked_language(message) or language_of(message, least=1)


def message_language(message, earlier=(), person=None):
    """"en" or "de", always: the message's own request or words, else the first of the person's
    earlier messages (newest first) that tells one, else `person`, else English."""
    for text in (message, *earlier):
        found = _told(text)
        if found:
            return found
    return person if person in LANGUAGES else "en"


# ---------------------------------------------------------------- what the person said before
def _text_of(content):
    if isinstance(content, str) and content.lstrip().startswith("["):
        try:
            content = json.loads(content)
        except ValueError:
            return content
    if isinstance(content, list):
        return " ".join(str(p.get("text", "")) for p in content if isinstance(p, dict))
    return content if isinstance(content, str) else ""


def _connect(home):
    db = os.path.join(home or "", "state.db")
    if not home or not os.path.exists(db):
        return None
    return sqlite3.connect("file:%s?mode=ro" % db.replace("\\", "/"), uri=True, timeout=2)


def _user_of(conn, session_id):
    try:
        row = conn.execute("SELECT user_id FROM sessions WHERE id=?", (session_id,)).fetchone()
    except sqlite3.OperationalError:  # a store without the column
        return None
    return str(row[0]) if row and row[0] else None


def _persons(conn, source, user_id, below=None, limit=RECENT):
    sql = ("SELECT m.content FROM messages m JOIN sessions s ON s.id = m.session_id "
           "WHERE m.role='user' AND s.source=? AND s.user_id=?")
    args = [source, user_id]
    if below is not None:
        sql += " AND m.id < ?"
        args.append(below)
    rows = conn.execute(sql + " ORDER BY m.id DESC LIMIT ?", args + [limit]).fetchall()
    return [_text_of(r[0]) for r in rows]


def session_messages(home, session_id, limit=RECENT):
    """(the person's latest message in the session, their earlier messages newest first, the
    session's source) from Hermes' own store, which writes the turn's message before the model runs.
    The earlier ones are the person's across their sessions on the same platform, or this session's
    when the store does not say who the person is."""
    conn = _connect(home) if session_id else None
    if conn is None:
        return "", [], ""
    try:
        rows = conn.execute("SELECT id, content FROM messages WHERE session_id=? AND role='user' "
                            "ORDER BY id DESC LIMIT ?", (session_id, limit + 1)).fetchall()
        src = conn.execute("SELECT source FROM sessions WHERE id=?", (session_id,)).fetchone()
        source = str(src[0] if src and src[0] else "")
        user = _user_of(conn, session_id)
        if rows and user:
            earlier = _persons(conn, source, user, below=rows[0][0], limit=limit)
        else:
            earlier = [_text_of(r[1]) for r in rows[1:]]
    finally:
        conn.close()
    return (_text_of(rows[0][1]) if rows else ""), earlier, source


def person_messages(home, source, user_id, limit=RECENT):
    """The person's newest messages on that platform, newest first; [] when the store cannot say."""
    conn = _connect(home) if user_id else None
    if conn is None:
        return []
    try:
        return _persons(conn, source, str(user_id), limit=limit)
    except sqlite3.OperationalError:
        return []
    finally:
        conn.close()


# ---------------------------------------------------------------- the language set for the person
def _mission_control():
    try:
        with open(os.path.join(HERE, "mission-control.txt"), encoding="utf-8") as f:
            return f.read().strip() or None
    except OSError:
        return None


def person_language(root=None):
    """The first language set in the person's add-on settings (charm, journal, coach, headache), or
    None. There is no setting for the person as a whole."""
    root = root or _mission_control()
    if not root:
        return None
    for parts in SETTINGS:
        try:
            with open(os.path.join(root, *parts, "settings.json"), encoding="utf-8") as f:
                language = json.load(f).get("language")
        except (OSError, ValueError, AttributeError):
            continue
        if language in LANGUAGES:
            return language
    return None
