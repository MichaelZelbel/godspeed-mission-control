"""The starting routines' scripts, as Hermes runs them (one small file per routine imports this).

Written into HERMES_HOME/scripts by the Godspeed Mission Control notebook when a reader's first goal
starts the routines (notebook/core/starting-routines.mjs), with godspeed-routines.json beside it,
and rewritten whenever the notebook's paths change. Hermes runs a script with its own Python on
every system, so this works the same on Windows, Linux and a Mac.

Each routine runs the original programs of the mission control, never a copy of them:

  decide      mc-decide, the daily round's morning choice (the next-action recipe). Prints the
              decision's one line for the person, or nothing when there is nothing for them or
              when a morning brief still to come today will open with that line. A round that
              did not finish says so in one line, the way any other line reaches the person.
              When no morning brief runs today it also lists the steps going out unless the
              person says stop, and marks exactly those as shown (mc-work announce).
  research    mc-research, the nightly research on every adopted goal (the goal-research recipe),
              at 00:15 with a two-hour budget, before the morning choice. It prints nothing: a
              night that fell short leaves its own gap file in the goal's research folder.
  work        mc-work-run, the daily round's work (the work-item recipe). Prints one sentence for
              each finished piece the person will open, one for each step that went out on a
              kind of step they allowed once, one for each piece whose check failed, or nothing.
  due         mc-due check and mc-due today. Prints the reminders that need saying today, or
              nothing, and nothing at all on a day a morning brief carries them.
  coach-gate  godspeed-coach gate: the talk brief when a talk is due, else {"wakeAgent": false}.
  coach-prep  mc-coach-prep, every night at 03:00: each coaching talk of the next day is prepared
              with the coach-prep recipe, within two hours. It prints nothing: a talk it could not
              prepare opens from its brief as before, and the run is shown as failed.
  coach-tick  godspeed-coach tick: the one follow-up and the evening habit check, or nothing.
  journal-tick  godspeed-journal tick: the journal's check-ins, evening list and weekly summary that
              the person switched on, when one is due, or nothing (notebook-routines.mjs).
  chat-tidy   the night chat tidy-up, at 01:30: the long chat with the assistant is summarised
              while nobody waits for an answer, through the assistant's own control channel. It is
              the one routine that runs no program of the mission control's; its rules and reasons
              are in its own block below (chat_tidy). It prints nothing for the person: its log is
              its output and goes to the error stream, and it sends nothing to the chat. No
              install is given this routine since 27 October 2026 (notebook-routines.mjs).

The two that run every 15 minutes, coach-tick and journal-tick, also say once what the notebook
needs the person to hear and could not send itself, such as a nightly backup that failed: the
notebook queues it in notices.json in its own state, and each one is said once (notices).

Printing nothing is Hermes' silence: nothing is sent and no note is saved. A failure exits non-zero
with one plain sentence, which the notebook's Routines list shows as the last run.

A daily round that went wrong is not such a failure (9 October 2026, a live run: the morning choice
ran out of time, a work item failed its check, and both reached nobody, because a failed script
reaches only the Routines list). Its one plain sentence is printed like any other line, so it
reaches the person the way their lines do (a note in "From your routines" on a computer, Telegram
on a server), and it is kept in godspeed-routines-status.json beside Hermes' own record, from which
the Routines list still says that the run failed (starting-routines.mjs, routineStatus).
"""
import argparse
import json
import os
import queue
import re
import shutil
import sqlite3
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

HERE = os.path.dirname(os.path.abspath(__file__))
NO_WAKE = '{"wakeAgent": false}'
# Hermes gives a script 9000 seconds (cron.script_timeout_seconds, hermes-config.mjs); the daily
# round's runs stop five minutes before one hour, and the nightly research (8100 seconds) is longer.
LIMIT = 3300


def config():
    with open(os.path.join(HERE, "godspeed-routines.json"), encoding="utf-8") as f:
        return json.load(f)


def today(c):
    """The reader's date, in the installation's time zone."""
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo(c["timezone"])).date().isoformat()
    except Exception:
        pass
    try:
        r = subprocess.run(
            [c["node"], "-e", "process.stdout.write(new Intl.DateTimeFormat('en-CA',{timeZone:process.argv[1]}).format(new Date()))", c["timezone"]],
            capture_output=True, text=True, timeout=60)
        if r.returncode == 0 and re.match(r"^\d{4}-\d{2}-\d{2}$", r.stdout.strip()):
            return r.stdout.strip()
    except Exception:
        pass
    return datetime.now(timezone.utc).date().isoformat()


def environment(c, day):
    env = dict(os.environ)
    key = next((k for k in env if k.upper() == "PATH"), "PATH")
    first = [c["bin"], c["tools"], os.path.dirname(c["node"])]
    if c.get("hermes") and os.path.isabs(c["hermes"]):
        first.append(os.path.dirname(c["hermes"]))
    env[key] = os.pathsep.join(first + [env.get(key, "")])
    env.update({
        "GODSPEED_ROOT": c["root"], "GODSPEED_DIR": c["root"], "GODSPEED_WORKSPACE": c["root"],
        "HERMES_HOME": c["home"], "HERMES_TIMEZONE": c["timezone"], "GODSPEED_TODAY": day,
        "GODSPEED_RUNNER": "hermes", "GODSPEED_SCHEDULED_RUN": "1", "GODSPEED_NODE": c["node"],
        "GODSPEED_COACH_DIR": c["root"], "GODSPEED_COACH_SCRIPT": c["coach"], "GODSPEED_COACH_APP": c["coach_app"],
        "GODSPEED_COACH_GIT_SYNC": "off", "GODSPEED_JOURNAL_GIT_SYNC": "off",
        # Hermes appends a "File-mutation verifier" block to an answer whose write failed; in a
        # routine nobody reads the answer but these programs, and on 9 October 2026 that block was
        # all the person got from the daily round. The run's files are checked by the programs.
        "HERMES_FILE_MUTATION_VERIFIER": "0",
    })
    return env


def bash():
    """The bash the original programs are written for: Git Bash on Windows, as Hermes itself uses."""
    if os.name != "nt":
        return shutil.which("bash") or ("/bin/bash" if os.path.isfile("/bin/bash") else None)
    try:
        from tools.environments.local import _find_bash  # Hermes' own search, when it can be imported
        return _find_bash()
    except Exception:
        pass
    local = os.environ.get("LOCALAPPDATA", "")
    for candidate in (
        os.environ.get("HERMES_GIT_BASH_PATH", ""),
        os.path.join(local, "hermes", "git", "bin", "bash.exe"),
        os.path.join(local, "hermes", "git", "usr", "bin", "bash.exe"),
        os.path.join(os.environ.get("ProgramFiles", r"C:\Program Files"), "Git", "bin", "bash.exe"),
        os.path.join(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"), "Git", "bin", "bash.exe"),
        os.path.join(local, "Programs", "Git", "bin", "bash.exe"),
    ):
        if candidate and os.path.isfile(candidate):
            return candidate
    found = shutil.which("bash")
    # Never Windows' own bash.exe, which is WSL and fails on Windows paths.
    return found if found and "git" in found.lower() else None


def posix(p):
    return p.replace("\\", "/") if os.name == "nt" else p


def run(args, c, env, timeout=LIMIT):
    return subprocess.run(args, cwd=c["root"], env=env, capture_output=True, text=True,
                          encoding="utf-8", errors="replace", timeout=timeout)


def read(p):
    try:
        with open(p, encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        return ""


def fail(sentence, result=None):
    detail = ""
    if result is not None:
        lines = [l for l in ((result.stderr or "") + "\n" + (result.stdout or "")).splitlines() if l.strip()]
        if lines:
            detail = "\n" + lines[-1].strip()[:300]
    # The sentence first, on a line of its own: it is what Settings > Routines shows.
    sys.stderr.write(sentence + detail + "\n")
    sys.exit(1)


STATUS = "godspeed-routines-status.json"


def remember(c, kind, failed=None):
    """What this run of a daily-round routine came to, beside Hermes' own record: the Routines list
    shows a run that printed its failure as failed (starting-routines.mjs, routineStatus)."""
    path = os.path.join(c["home"], STATUS)
    try:
        with open(path, encoding="utf-8") as f:
            status = json.load(f)
        if not isinstance(status, dict):
            status = {}
    except Exception:
        status = {}
    status[kind] = {"at": datetime.now(timezone.utc).isoformat(), "failed": failed}
    try:
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(status, f, indent=1)
        os.replace(tmp, path)
    except OSError:
        pass


def tell(c, kind, sentence, result=None):
    """A daily round that went wrong: one plain sentence for the person, printed like any line of
    theirs, and kept as this run's failure. The detail stays in the run's own files."""
    if result is not None:
        lines = [l for l in ((result.stderr or "") + "\n" + (result.stdout or "")).splitlines() if l.strip()]
        if lines:
            sys.stderr.write(lines[-1].strip()[:300] + "\n")
    remember(c, kind, sentence)
    return sentence


SILENT = re.compile(r"^\[?\s*silent\s*\]?$|^no[_ ]reply$", re.I)


def silent(text):
    lines = [l.strip() for l in text.strip().splitlines() if l.strip()]
    return not lines or bool(SILENT.match(text.strip())) or bool(SILENT.match(lines[0])) or bool(SILENT.match(lines[-1]))


# What Hermes itself adds to an answer, which is never the person's line (9 October 2026: the daily
# round's whole message was Hermes' "File-mutation verifier" block). Each pattern removes a whole
# block: the verifier's header and its bullet lines, a repaired tool name Hermes printed, a notice
# that replaced a reply the model never finished, and a network notice.
TRAILERS = [
    re.compile(r"^[ \t]*(?:⚠️?[ \t]*)?File-mutation verifier:.*(?:\n[ \t]+(?:•|-|\*).*)*", re.M),
    re.compile(r"^[ \t]*\U0001f527[ \t]*Auto-repaired tool name:.*$", re.M),
    # These replace an unfinished reply and run to its end.
    re.compile(r"^[ \t]*⚠️?[ \t]*(?:No reply:|\*\*Response Stopped|\*\*No visible answer)[\s\S]*", re.M),
    re.compile(r"^[ \t]*\U0001f501[ \t]*Response dominated by repeated text.*$", re.M),
    re.compile(r"^[ \t]*\[System: [^\]]*\][ \t]*$", re.M),
]


def strip_trailers(text):
    text = str(text or "").replace("\r\n", "\n")
    for pattern in TRAILERS:
        text = pattern.sub("", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def section(markdown, title):
    m = re.search(r"^## " + re.escape(title) + r"[^\n]*\n(.*?)(?=^## |\Z)", markdown, re.M | re.S)
    return m.group(1).strip() if m else ""


NOTHING = re.compile(r"^\W*(?:for you today\W*)?nothing\b", re.I)
# The recipe ends its answer with the card's id ("ship-list-2026-10-09") or the word nothing, which
# are for the programs; the person gets the sentence.
CARD_ID = re.compile(r"\s+(?:\(?(?=[A-Za-z][\w-]*\d)[A-Za-z]\w*(?:-\w+){2,}\)?|nothing)\W*$", re.I)


MARKER = re.compile(r"^\W*for you today\W*", re.I)
# The recipe's own ending: the card's id, or the word nothing after the sentence ("... April? nothing").
# "I changed nothing." is a sentence, not that ending.
ENDING = re.compile(r"(?:\s\(?(?=[A-Za-z][\w-]*\d)[A-Za-z]\w*(?:-\w+){2,}\)?|[.?!:;)]\s+nothing)\W*$", re.I)


def one_line(text):
    return " ".join(str(text or "").split())


def for_you(answer, decision):
    """The decision's one line for the person, or "" when there is nothing for them today.

    It comes from what the round decided, never from what Hermes or the model added after it: the
    answer's own "For you today" paragraph, else its last paragraph when that ends the way the
    recipe asks (the card's id or the word nothing), else the decision's "For you today" section.
    Until 9 October 2026 it was simply the answer's last paragraph, and that was Hermes' verifier
    block in one live run and the model's own "Verified: ..." note in another."""
    record = section(decision, "For you today")
    first = next((l.strip() for l in record.splitlines() if l.strip()), "")
    if first and NOTHING.search(first):
        return ""
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", strip_trailers(answer)) if p.strip()]
    marked = [p for p in paragraphs if MARKER.match(p)]
    if marked:
        line = MARKER.sub("", one_line(marked[-1]), count=1)
    elif paragraphs and ENDING.search(" " + one_line(paragraphs[-1])):
        line = one_line(paragraphs[-1])
    else:
        line = one_line(strip_trailers(record))
    if not line or silent(line) or NOTHING.search(line):
        return ""
    return CARD_ID.sub("", line).strip()


def local_day(stamp, c):
    """The reader's date of a time Hermes wrote (ISO, with its offset), or ""."""
    if not stamp:
        return ""
    try:
        when = datetime.fromisoformat(str(stamp).replace("Z", "+00:00"))
        if when.tzinfo is not None:
            try:
                from zoneinfo import ZoneInfo
                when = when.astimezone(ZoneInfo(c["timezone"]))
            except Exception:
                pass
        return when.date().isoformat()
    except Exception:
        return str(stamp)[:10]


BRIEF = re.compile(r"morning[\s_-]*brief", re.I)


def brief_today(c, day):
    """Whether a morning brief that is switched on runs today: (already ran today, still to run
    today). The brief carries the dates and the daily round's line itself (Teach It Once,
    Chapter 25), so the routines here never say the same thing twice in one morning."""
    try:
        with open(os.path.join(c["home"], "cron", "jobs.json"), encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return False, False
    jobs = data if isinstance(data, list) else data.get("jobs", []) if isinstance(data, dict) else []
    ran = later = False
    for j in jobs:
        if not isinstance(j, dict) or j.get("enabled") is False or str(j.get("state") or "") in ("paused", "completed"):
            continue
        names = [j.get("skill") or ""] + list(j.get("skills") or []) + [j.get("name") or "", j.get("prompt") or ""]
        if not any(BRIEF.search(str(n)) for n in names):
            continue
        if local_day(j.get("last_run_at"), c) == day:
            ran = True
        elif local_day(j.get("next_run_at"), c) == day:
            later = True
    return ran, later


def told_today(c, kind, day, sentence):
    """Whether this very sentence already reached the person today (a second run by hand, a
    catch-up after the computer slept): a failure is said once a day, like any line."""
    try:
        with open(os.path.join(c["home"], STATUS), encoding="utf-8") as f:
            last = (json.load(f) or {}).get(kind) or {}
    except Exception:
        return False
    return last.get("failed") == sentence and local_day(last.get("at"), c) == day


def went_wrong(c, kind, day, sentence, result=None):
    already = told_today(c, kind, day, sentence)
    tell(c, kind, sentence, result)
    return "" if already else sentence


def goal_title(c, goal):
    """A goal's own title, from its card, or its id when the card says none."""
    if not re.match(r"^[A-Za-z0-9][A-Za-z0-9._-]*$", str(goal or "")):
        return ""
    m = re.search(r"^TITLE:[ \t]*(.+)$", read(os.path.join(c["root"], "goals", goal + ".md")), re.M)
    return m.group(1).strip() if m else goal


def when_words(at, c, day):
    """A GOES OUT time (UTC, YYYY-MM-DDTHH:MM) on the reader's clock, in plain words."""
    try:
        when = datetime.strptime(at, "%Y-%m-%dT%H:%M").replace(tzinfo=timezone.utc)
    except Exception:
        return at + " UTC"
    try:
        from zoneinfo import ZoneInfo
        when = when.astimezone(ZoneInfo(c["timezone"]))
        zone = ""
    except Exception:
        zone = " UTC"
    date = when.date().isoformat()
    try:
        tomorrow = (datetime.strptime(day, "%Y-%m-%d").date().toordinal() + 1)
    except Exception:
        tomorrow = None
    hm = when.strftime("%H:%M") + zone
    if date == day:
        return "today at " + hm
    if tomorrow is not None and when.date().toordinal() == tomorrow:
        return "tomorrow at " + hm
    return when.strftime("%d %B").lstrip("0") + " at " + hm


def going_out(c, env, day):
    """THE STEPS THAT GO OUT UNLESS THE PERSON SAYS STOP, SHOWN WITHOUT A MORNING BRIEF (18 October
    2026). A step of a kind the person allowed once ("notice") goes out at its time only after a
    morning message showed it, so they could stop it (mc-work announce). Until this change only the
    morning brief showed them, and a mission control without a brief, which is how every first goal
    starts, never sent one: they waited, moved to the next evening, and waited again, silently. When
    no brief runs today, this morning's daily round shows the ones not shown yet and marks exactly
    those as shown. A step it cannot mark is left out of the message."""
    script = os.path.join(c["tools"], "work.js")
    try:
        r = run([c["node"], script, "going-out", "--json", "--godspeed", c["root"]], c, env, timeout=120)
        rows = json.loads((r.stdout or "").strip().splitlines()[-1]) if r.returncode == 0 and (r.stdout or "").strip() else []
    except Exception:
        return ""
    rows = [x for x in rows if isinstance(x, dict) and x.get("status") == "planned" and not x.get("announced") and x.get("id")]
    if not rows:
        return ""
    try:
        marked = run([c["node"], script, "announce"] + [x["id"] for x in rows] + ["--godspeed", c["root"]], c, env, timeout=120)
    except Exception:
        return ""
    missed = set(re.findall(r"^(\S+): .*, not marked$", marked.stdout or "", re.M))
    shown = [x for x in rows if x["id"] not in missed]
    if not shown:
        return ""
    lines = ["Going out unless you say stop:"]
    for x in shown:
        goal = goal_title(c, x.get("goal"))
        lines.append("%s. %s (%s%s)" % (x.get("n"), one_line(x.get("what")), (goal + ", ") if goal else "", when_words(x.get("at", ""), c, day)))
    lines.append('Reply "stop" to keep all of them back, or "stop" and a number for one.')
    return "\n".join(lines)


def decide(c):
    day = today(c)
    env = environment(c, day)
    said = choose(c, day, env)
    # A brief switched on for today shows the steps itself (its "Going out tonight").
    ran, later = brief_today(c, day)
    going = "" if (ran or later) else going_out(c, env, day)
    return "\n\n".join(x for x in (said, going) if x)


def choose(c, day, env):
    shell = bash()
    if not shell:
        return went_wrong(c, "decide", day, "The daily round needs Git Bash on this computer, and it was not found, so nothing was decided today.")
    rundir = os.path.join(c["root"], "routines", "next-action", day)
    names = [os.path.join(rundir, "answer.txt"), os.path.join(rundir, "answer-moves.txt")]
    stamp = lambda p: os.stat(p).st_mtime_ns if os.path.isfile(p) else None
    before = {p: stamp(p) for p in names}
    try:
        r = run([shell, posix(os.path.join(c["tools"], "mc-decide")), "--godspeed", posix(c["root"]), "--date", day], c, env)
    except subprocess.TimeoutExpired:
        return went_wrong(c, "decide", day, "This morning's daily round took longer than its hour and was stopped, so nothing was decided today.")
    decision = read(os.path.join(rundir, "decision.md"))
    if not decision.strip() or "did not finish and wrote no record of its own" in decision:
        return went_wrong(c, "decide", day, "This morning's daily round did not finish, so nothing was decided today.", r)
    remember(c, "decide")
    # Only an answer this run wrote: a day already decided (a catch-up after the computer slept,
    # a second run by hand) was said already, and is never said twice.
    answers = [p for p in names if stamp(p) is not None and stamp(p) != before[p]]
    if not answers:
        return ""
    answers.sort(key=os.path.getmtime)
    line = for_you(read(answers[-1]), decision)
    ran, later = brief_today(c, day)
    # A brief still to come today opens with this line; one that already ran could not have it.
    return "" if later and not ran else line


RESEARCH_MINUTES = 120


def research(c):
    """The nightly goal research: mc-research for every adopted goal that is due, within two hours.
    It only reads pages and writes files, so it never says anything; a night that fell short (a
    goal that did not fit, a check that failed) is a gap file in the goal's own research folder
    and is read by the morning choice. Only a run that could not start is said."""
    day = today(c)
    env = environment(c, day)
    shell = bash()
    if not shell:
        return went_wrong(c, "research", day, "The nightly goal research needs Git Bash on this computer, and it was not found, so no goal was researched tonight.")
    try:
        r = run([shell, posix(os.path.join(c["tools"], "mc-research")), "--godspeed", posix(c["root"]), "--date", day,
                 "--budget-minutes", str(RESEARCH_MINUTES)], c, env, timeout=RESEARCH_MINUTES * 60 + 900)
    except subprocess.TimeoutExpired:
        return went_wrong(c, "research", day, "Tonight's goal research took longer than its time and was stopped.")
    # 2 and 3 mean it never started.
    if r.returncode in (2, 3):
        return went_wrong(c, "research", day, "The nightly goal research could not start tonight.", r)
    # 1 is a night that fell short on some goals (each says so in its own research folder): shown
    # as failed in the Routines list, with one plain sentence, but nothing is printed to the reader.
    if r.returncode != 0:
        remember(c, "research", "Tonight's goal research did not finish every goal; each one that fell short says so in its research folder.")
        return ""
    remember(c, "research")
    return ""


def register_fields(c, env, item):
    """A work item's fields, from the register (mc-work show), or {}."""
    try:
        r = run([c["node"], os.path.join(c["tools"], "work.js"), "show", item, "--godspeed", c["root"]], c, env, timeout=120)
    except Exception:
        return {}
    fields = {}
    for line in (r.stdout or "").splitlines():
        if line.startswith("## "):
            break
        m = re.match(r"^([A-Z][A-Z ]*[A-Z]):[ \t]*(.*)$", line)
        if m and m.group(1) not in fields:
            fields[m.group(1)] = m.group(2).strip()
    return fields


PREP_MINUTES = 120


def coach_prep(c):
    """The coaching talk preparation: mc-coach-prep prepares each talk of today or tomorrow that has
    no ready preparation, with the coach-prep recipe, within two hours. It only reads and writes
    the talks' own preparation files, so it never says anything; a talk it could not prepare is in
    its summary (routines/coach-prep/<date>/summary.txt) and opens from its brief as before. Only a
    run that could not start is said."""
    day = today(c)
    env = environment(c, day)
    shell = bash()
    if not shell:
        return went_wrong(c, "coach-prep", day, "The coaching talk preparation needs Git Bash on this computer, and it was not found, so no talk was prepared tonight.")
    try:
        r = run([shell, posix(os.path.join(c["tools"], "mc-coach-prep")), "--godspeed", posix(c["root"]), "--date", day,
                 "--budget-minutes", str(PREP_MINUTES)], c, env, timeout=PREP_MINUTES * 60 + 900)
    except subprocess.TimeoutExpired:
        return went_wrong(c, "coach-prep", day, "Tonight's coaching talk preparation took longer than its time and was stopped.")
    # 2 and 3 mean it never started.
    if r.returncode in (2, 3):
        return went_wrong(c, "coach-prep", day, "The coaching talk preparation could not start tonight.", r)
    # 1 is a talk that could not be prepared or did not fit the time: shown as failed in the
    # Routines list, with one plain sentence, and nothing is printed to the person.
    if r.returncode != 0:
        remember(c, "coach-prep", "A coaching talk could not be prepared ahead, so it opens from its brief; routines/coach-prep/" + day + "/summary.txt says which.")
        return ""
    remember(c, "coach-prep")
    return ""


def register_what(c, env, item):
    """The WHAT of a work item, from the register (mc-work show), or ""."""
    return short(register_fields(c, env, item).get("WHAT", ""))


def short(what):
    what = " ".join(str(what or "").split())
    return what[:140].rsplit(" ", 1)[0].rstrip(",;:") + "..." if len(what) > 140 else what


def work(c):
    day = today(c)
    env = environment(c, day)
    shell = bash()
    if not shell:
        return went_wrong(c, "work", day, "The daily round's work needs Git Bash on this computer, and it was not found, so nothing was worked on today.")
    try:
        r = run([shell, posix(os.path.join(c["tools"], "mc-work-run")), "--godspeed", posix(c["root"]), "--date", day, "--budget", "1200"], c, env)
    except subprocess.TimeoutExpired:
        return went_wrong(c, "work", day, "The daily round's work took longer than its hour and was stopped.")
    # Exit 4 (since 11 October 2026) is a run that went through in which an assistant did not
    # finish an item; that item is said below like any other that could not be finished. Only
    # 1 to 3 mean the work never started.
    if r.returncode not in (0, 4):
        return went_wrong(c, "work", day, "The daily round's work could not start today.", r)
    # A piece whose check failed, or that could not be finished, is said too, in one line each
    # (9 October 2026: a failed check reached nobody). The detail is on the item in the register.
    unfinished = []
    taken = dict(re.findall(r"^\S+ (\S+) taken \([^)\n]*\): (.+)$", r.stdout, re.M))
    for item in dict.fromkeys(re.findall(r"^\S+ (\S+) (?:attempted, not verified|failed:)", r.stdout, re.M)):
        what = short(taken.get(item, "")) or register_what(c, env, item)
        checked = re.search(r"^\S+ " + re.escape(item) + r" attempted, not verified", r.stdout, re.M)
        sentence = "Today's work " + ("did not pass its check" if checked else "could not be finished") + ", so it is not done yet"
        unfinished.append(sentence + (': "' + what + '".' if what else "."))
    remember(c, "work", " ".join(unfinished) if unfinished else None)
    said = []
    for item in re.findall(r"^\S+ (\S+) verified$", r.stdout, re.M):
        lines = [l for l in read(os.path.join(c["root"], "routines", "work", day, item, "answer.txt")).splitlines() if l.startswith("SAY:")]
        url = re.search(re.escape(item) + r" published: (https://\S+)", r.stdout)
        link = (" " + url.group(1)) if url else ""
        # A STEP THAT WENT OUT WITHOUT A YES FOR ITSELF IS ALWAYS SAID (18 October 2026). It went out
        # on a kind of step the person allowed once (a MAY line on the goal card); until this change
        # only a morning brief, the next day, ever said so, and most mission controls have none.
        fields = register_fields(c, env, item)
        if fields.get("MAY") and fields.get("OUTWARD") == "yes":
            what = lines[-1][4:].strip() if lines else short(fields.get("WHAT", ""))
            said.append("Done, as you allowed: " + what + link)
            continue
        if not lines:
            continue
        said.append(lines[-1][4:].strip() + link)
    return "\n".join(said + unfinished)


DUE_TAGS = ("RUNNING OUT", "SOON", "ON THE WAY", "PLENTY OF TIME", "NOT YET", "AIMING FOR",
            "TARGET TODAY", "WHEN YOU CAN", "DONE", "CALLED OFF", "NEEDS A LOOK")


def due(c):
    day = today(c)
    env = environment(c, day)
    script = os.path.join(c["tools"], "due.js")
    try:
        check = run([c["node"], script, "check", "--godspeed", c["root"]], c, env, timeout=300)
        # A brief switched on for today carries the dates in its own section, from the same
        # `mc-due today`; the reminders then say nothing, so no date comes twice in a morning.
        ran, later = brief_today(c, day)
        if ran or later:
            return ""
        closed = [l.strip()[len("closed itself: "):] for l in check.stdout.splitlines() if l.strip().startswith("closed itself: ")]
        r = run([c["node"], script, "today", "--godspeed", c["root"]], c, env, timeout=300)
    except subprocess.TimeoutExpired:
        fail("The deadline reminders took too long and were stopped.")
    if r.returncode != 0:
        fail("The deadline reminders could not read your dates.", r)
    lines = [l.rstrip() for l in r.stdout.splitlines() if l.strip()]
    if not lines or lines[0].startswith(("Nothing needs saying today", "Nothing with a last day yet")):
        lines = []
    said = []
    for line in lines:
        tag = next((t for t in DUE_TAGS if line.startswith(t + " ")), None)
        said.append(tag.capitalize() + ". " + line[len(tag):].strip() if tag else line.strip())
    said += ["Closed by its own check: " + x for x in closed]
    return ("From your deadline reminders:\n" + "\n".join(said)) if said else ""


NOTICES_SAID = "godspeed-notices-said.json"


def notices(c):
    """What the notebook queued for the person (core/notices.mjs), each said once on this machine."""
    queued = c.get("notices")
    if not queued:
        return []
    try:
        with open(queued, encoding="utf-8") as f:
            waiting = [n for n in (json.load(f) or {}).get("notices", []) if isinstance(n, dict) and n.get("id") and n.get("text")]
    except Exception:
        return []
    said_file = os.path.join(c["home"], NOTICES_SAID)
    try:
        with open(said_file, encoding="utf-8") as f:
            said = list((json.load(f) or {}).get("ids", []))
    except Exception:
        said = []
    fresh = [n for n in waiting if n["id"] not in said]
    if not fresh:
        return []
    keep = (said + [n["id"] for n in fresh])[-200:]
    tmp = said_file + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"ids": keep}, f)
    os.replace(tmp, said_file)
    return [n["text"] for n in fresh]


def journal_tick(c):
    day = today(c)
    env = environment(c, day)
    env["GODSPEED_JOURNAL_APP"] = c.get("journal_app") or ""
    try:
        r = run([c["node"], c["journal"], "tick", "--godspeed", c["root"]], c, env, timeout=600)
    except subprocess.TimeoutExpired:
        r = None
    said = notices(c)
    if r is None or r.returncode != 0:
        if said:
            return "\n\n".join(said)
        fail("The journal's check-ins could not run.", r)
    return "\n\n".join(said + ([r.stdout.strip()] if r.stdout.strip() else []))


# ===================================================================== THE NIGHT CHAT TIDY-UP
#
# WHY THIS EXISTS (26 October 2026). The assistant keeps a chat app's chat as one long conversation
# and summarises its older part once it passes its threshold (compression.threshold_tokens). It does
# that BEFORE answering the message that crossed the line, and a summary takes minutes: a real
# message waited 4 min 9 s while 348 messages became 43, and all the person saw was "typing". The
# assistant has no idle-time summarising of its own (idle_compact_after_seconds also runs before the
# next reply) and no compress command.
#
# What it does have is its own control channel, the stdio JSON-RPC its terminal and desktop apps use
# (python -m tui_gateway.entry): session.resume opens a stored conversation and session.compress
# summarises it under the assistant's own compression lock. The gateway reloads the chat from the
# database on every message, so a summary written here at night is what the next morning's message
# starts from.
#
# RULES IT HOLDS ITSELF TO
#   - It only ever summarises the conversation the gateway's routing table names for the owner's
#     chat, and only after session.resume confirms that exact conversation. Any other answer stops
#     it. (On 26 October 2026 a hand test whose copy step failed went on to summarise the live chat
#     instead of the copy; every step here is checked before the next one runs.)
#   - It does nothing while the chat is in use: last message less than --idle-minutes ago, an open
#     turn lease on any conversation of its chain, or the conversation reported running.
#   - It does nothing below --min-tokens (the last real prompt size the gateway recorded), because
#     summarising an already short chat only rewrites the summary.
#   - It talks to the assistant only through that control channel, checks every answer before the
#     next step, always closes what it opened, and opens the database read-only.
#   - It sends nothing to the chat. Its output is its log, which goes to the error stream so that
#     what the routine prints for the person stays empty: the assistant's silence, so nothing is
#     sent and no note is saved. A run that went wrong says one sentence and exits non-zero.
#
# The assistant's home, the assistant's own Python and the working folder come from this install
# (godspeed-routines.json, written by starting-routines.mjs), never from a path written by hand.
#
# By hand, from the assistant's scripts folder:
#   godspeed-chat-tidy.py --dry-run             find the chat, open and close it, say what it would do
#   godspeed-chat-tidy.py --session ID --force  summarise one named stored conversation whatever its
#                                               size (for a test on a copy; a chat in use is refused)
#
# The routing key of the owner's own chat in a chat app. The app's name is the routing table's, so a
# chat app the gateway routes the same way needs no new code here (today: telegram, a private chat).
# "local" is no chat app: it is the assistant's own terminal and desktop app, which the assistant
# routes the same way, one key per conversation (agent:main:local:dm:local-<id>). Until 27 October
# 2026 it counted, so on a machine where the owner had once talked to the assistant in its terminal
# the routine found two chats beside a Telegram one and refused every night ("found 2"), and with no
# chat app at all it would have summarised a terminal conversation.
CHAT_KEY_LIKE = "agent:main:%:dm:%"
CHAT_KEY = re.compile(r"^agent:main:(?!local:)[^:]+:dm:.+$")


def chat_log(line):
    sys.stderr.write(time.strftime("%Y-%m-%d %H:%M:%S UTC ", time.gmtime()) + line + "\n")
    sys.stderr.flush()


def chat_db(c):
    """The assistant's own database, read-only. A path becomes a URI through as_uri(), because a
    Windows path is none as it stands and a space or a hash in it would end the file name."""
    file = os.path.join(c["home"], "state.db")
    if not os.path.isfile(file):
        fail("The assistant keeps no chat on this machine yet.")
    try:
        return sqlite3.connect(Path(file).as_uri() + "?mode=ro", uri=True, timeout=30)
    except sqlite3.Error as error:
        fail("The assistant's chat could not be opened: %s" % error)


def chat_session(c, con):
    """The stored conversation the gateway currently routes the owner's chat to, or None while it
    routes none: the routine is made from the moment a chat app is connected, and a chat app
    connected today has nothing routed until the first message (made for no install since 27
    October 2026, notebook-routines.mjs says why). Nothing to tidy up is not a failure. More than
    one chat is: acting then could summarise the wrong conversation, which is the one thing this
    must never do."""
    scope = os.path.join(c["home"], "sessions")
    try:
        rows = [row for row in con.execute(
            "select session_key, entry_json from gateway_routing where scope = ? and session_key like ?",
            (scope, CHAT_KEY_LIKE)).fetchall() if CHAT_KEY.match(row[0] or "")]
    except sqlite3.Error as error:
        fail("The assistant's routing table could not be read: %s" % error)
    if not rows:
        return None
    if len(rows) > 1:
        fail("Expected one chat of the owner's in the assistant's routing table, found %d." % len(rows))
    try:
        entry = json.loads(rows[0][1] or "{}")
    except ValueError:
        entry = {}
    if not entry.get("session_id"):
        fail("The assistant's routing table names no stored conversation for %s." % rows[0][0])
    return entry["session_id"]


def chat_state(con, session_id):
    """The last prompt size the gateway recorded, when the last message was, and open turn leases."""
    row = con.execute("select model_config from sessions where id = ?", (session_id,)).fetchone()
    if row is None:
        fail("The stored conversation %s was not found." % session_id)
    try:
        anchor = (json.loads(row[0] or "{}").get("_usage_anchor") or {})
    except ValueError:
        anchor = {}
    last = con.execute("select max(timestamp) from messages where session_id = ?", (session_id,)).fetchone()[0]
    # A turn lease is keyed by the lineage root (the first conversation this one continues), so look
    # for one on every conversation in the chain.
    chain, sid = [], session_id
    while sid and sid not in chain and len(chain) < 50:
        chain.append(sid)
        parent = con.execute("select parent_session_id from sessions where id = ?", (sid,)).fetchone()
        sid = parent[0] if parent else None
    marks = ",".join("?" * len(chain))
    leases = con.execute(
        "select count(*) from session_turn_leases where expires_at > ? and conversation_id in (%s)" % marks,
        (time.time(), *chain)).fetchone()[0]
    return anchor.get("prompt_tokens"), last, leases


class Channel:
    """The assistant's control channel over stdio, one request at a time."""

    def __init__(self, c):
        python, source = c.get("hermes_python"), c.get("hermes_source")
        if not python or not os.path.isfile(python):
            fail("The assistant's own Python was not found on this machine, so its chat is left as it is.")
        env = dict(os.environ, HERMES_HOME=c["home"], GODSPEED_ROOT=c["root"], GODSPEED_DIR=c["root"],
                   GODSPEED_WORKSPACE=c["root"], PYTHONIOENCODING="utf-8")
        # The assistant's own folder first on Python's path, the way the add-ons reach its modules
        # (core/addon-model.mjs); an install that runs it from a package needs nothing here.
        if source:
            env["PYTHONPATH"] = os.pathsep.join([source] + [p for p in [env.get("PYTHONPATH")] if p])
        try:
            self.p = subprocess.Popen([python, "-m", "tui_gateway.entry"], cwd=c["root"], env=env,
                                      stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                      stderr=subprocess.PIPE, text=True, encoding="utf-8",
                                      errors="replace", bufsize=1)
        except OSError as error:
            fail("The assistant's control channel could not be started: %s" % error)
        self.q, self.n, self.said = queue.Queue(), 0, []
        threading.Thread(target=self._lines, daemon=True).start()
        threading.Thread(target=self._errors, daemon=True).start()

    def _lines(self):
        for line in self.p.stdout:
            self.q.put(line)

    def _errors(self):
        # Its last words, so a channel that ends says why and not only its exit code (27 October
        # 2026: "exited (1)" was all a real install said, and the reason was in a log of its own).
        for line in self.p.stderr:
            if line.strip():
                self.said = (self.said + [line.strip()[:300]])[-3:]

    def why(self):
        time.sleep(0.2)  # the reader thread takes the last line just after the exit
        return (": " + self.said[-1]) if self.said else ""

    def call(self, method, params, timeout):
        self.n += 1
        try:
            self.p.stdin.write(json.dumps({"jsonrpc": "2.0", "id": self.n, "method": method, "params": params}) + "\n")
            self.p.stdin.flush()
        except OSError:
            fail("%s: the assistant's control channel closed." % method)
        end = time.time() + timeout
        while time.time() < end:
            try:
                line = self.q.get(timeout=1)
            except queue.Empty:
                if self.p.poll() is not None:
                    fail("%s: the assistant's control channel exited (%s)%s." % (method, self.p.returncode, self.why()))
                continue
            try:
                msg = json.loads(line)
            except ValueError:
                continue
            if msg.get("id") == self.n:
                if msg.get("error"):
                    fail("%s refused: %s" % (method, msg["error"]))
                return msg.get("result") or {}
        fail("%s: no answer within %d s." % (method, timeout))

    def close(self):
        try:
            self.p.stdin.close()
            self.p.wait(timeout=20)
        except Exception:
            self.p.kill()


def chat_tidy(c):
    ap = argparse.ArgumentParser(prog="godspeed-chat-tidy",
                                 description="Summarise the long chat with the assistant at night.")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true", help="ignore --min-tokens")
    ap.add_argument("--session", help="a stored conversation id instead of the owner's chat")
    ap.add_argument("--min-tokens", type=int, default=60000)
    ap.add_argument("--idle-minutes", type=int, default=30)
    ap.add_argument("--resume-timeout", type=int, default=180)
    ap.add_argument("--compress-timeout", type=int, default=900)
    a = ap.parse_args()

    con = chat_db(c)
    try:
        target = a.session or chat_session(c, con)
        state = chat_state(con, target) if target else None
    finally:
        try:
            con.close()
        except sqlite3.Error:
            pass
    if not target:
        chat_log("skip: the assistant routes no chat of the owner's yet")
        return ""
    tokens, last, leases = state
    idle_min = (time.time() - last) / 60 if last else None
    if idle_min is None:
        chat_log("chat %s: no messages" % target)
    else:
        chat_log("chat %s: last prompt %s tokens, last message %.0f min ago, open leases %d"
                 % (target, tokens if tokens is not None else "unknown", idle_min, leases))
    if leases:
        chat_log("skip: a turn is open")
        return ""
    if idle_min is not None and idle_min < a.idle_minutes:
        chat_log("skip: in use (quiet for less than %d min)" % a.idle_minutes)
        return ""
    if not a.force and tokens is None:
        # The assistant clears the recorded size when it summarises; it comes back with the next reply.
        chat_log("skip: no reply since the last summary")
        return ""
    if not a.force and tokens < a.min_tokens:
        chat_log("skip: below %d tokens" % a.min_tokens)
        return ""

    ch, sid = Channel(c), None
    try:
        res = ch.call("session.resume", {"session_id": target}, a.resume_timeout)
        sid = res.get("session_id")
        if res.get("resumed") != target or not sid:
            fail("Resume opened %r, not %r; stopping." % (res.get("resumed"), target))
        if res.get("running") or res.get("inflight") or res.get("status") != "idle":
            chat_log("skip: conversation busy (status %s)" % res.get("status"))
            return ""
        if a.dry_run:
            chat_log("dry run: would summarise %s (%s messages loaded)" % (target, res.get("message_count")))
            return ""
        started = time.time()
        out = ch.call("session.compress", {"session_id": sid}, a.compress_timeout)
        chat_log("summarised in %.0f s: status %s, messages %s -> %s, about %s -> %s tokens"
                 % (time.time() - started, out.get("status"), out.get("before_messages"),
                    out.get("after_messages"), out.get("before_tokens"), out.get("after_tokens")))
        if out.get("status") != "compressed":
            fail("The summary ended with status %r." % out.get("status"))
        return ""
    finally:
        if sid:
            try:
                ch.call("session.close", {"session_id": sid}, 30)
            except SystemExit as error:
                chat_log("close: %s" % error)
        ch.close()


def coach(c, command):
    day = today(c)
    env = environment(c, day)
    try:
        r = run([c["node"], c["coach"], command, "--godspeed", c["root"]], c, env, timeout=600)
    except subprocess.TimeoutExpired:
        r = None
    if command == "gate":
        return r.stdout.strip() if r is not None and r.returncode == 0 and r.stdout.strip() else NO_WAKE
    said = notices(c)
    if r is None or r.returncode != 0:
        if said:
            return "\n\n".join(said)
        fail("The coach's reminders could not run.", r)
    return "\n\n".join(said + ([r.stdout.strip()] if r.stdout.strip() else []))


def main(kind):
    c = config()
    out = {"research": research, "decide": decide, "work": work, "due": due, "coach-prep": coach_prep,
           "coach-gate": lambda c: coach(c, "gate"), "coach-tick": lambda c: coach(c, "tick"),
           "journal-tick": journal_tick, "chat-tidy": chat_tidy}[kind](c)
    if out:
        # UTF-8 whatever the console's code page: a curly quote must not end the run on Windows.
        sys.stdout.buffer.write((out + "\n").encode("utf-8"))
        sys.stdout.flush()
