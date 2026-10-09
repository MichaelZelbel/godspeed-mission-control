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
  work        mc-work-run, the daily round's work (the work-item recipe). Prints one sentence for
              each finished piece the person will open, one for each piece whose check failed,
              or nothing.
  due         mc-due check and mc-due today. Prints the reminders that need saying today, or
              nothing, and nothing at all on a day a morning brief carries them.
  coach-gate  godspeed-coach gate: the talk brief when a talk is due, else {"wakeAgent": false}.
  coach-tick  godspeed-coach tick: the one follow-up and the evening habit check, or nothing.

Printing nothing is Hermes' silence: nothing is sent and no note is saved. A failure exits non-zero
with one plain sentence, which the notebook's Routines list shows as the last run.

A daily round that went wrong is not such a failure (9 October 2026, a live run: the morning choice
ran out of time, a work item failed its check, and both reached nobody, because a failed script
reaches only the Routines list). Its one plain sentence is printed like any other line, so it
reaches the person the way their lines do (a note in "From your routines" on a computer, Telegram
on a server), and it is kept in godspeed-routines-status.json beside Hermes' own record, from which
the Routines list still says that the run failed (starting-routines.mjs, routineStatus).
"""
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
NO_WAKE = '{"wakeAgent": false}'
# Hermes gives a script one hour; the runs below stop five minutes before that.
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


def decide(c):
    day = today(c)
    env = environment(c, day)
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


def register_what(c, env, item):
    """The WHAT of a work item, from the register (mc-work show), or ""."""
    try:
        r = run([c["node"], os.path.join(c["tools"], "work.js"), "show", item, "--godspeed", c["root"]], c, env, timeout=120)
    except Exception:
        return ""
    m = re.search(r"^WHAT:\s*(.+)$", r.stdout or "", re.M)
    return short(m.group(1)) if m else ""


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
    if r.returncode != 0:
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
        if not lines:
            continue
        url = re.search(re.escape(item) + r" published: (https://\S+)", r.stdout)
        said.append(lines[-1][4:].strip() + (" " + url.group(1) if url else ""))
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


def coach(c, command):
    day = today(c)
    env = environment(c, day)
    try:
        r = run([c["node"], c["coach"], command, "--godspeed", c["root"]], c, env, timeout=600)
    except subprocess.TimeoutExpired:
        r = None
    if command == "gate":
        return r.stdout.strip() if r is not None and r.returncode == 0 and r.stdout.strip() else NO_WAKE
    if r is None or r.returncode != 0:
        fail("The coach's reminders could not run.", r)
    return r.stdout.strip()


def main(kind):
    c = config()
    out = {"decide": decide, "work": work, "due": due,
           "coach-gate": lambda c: coach(c, "gate"), "coach-tick": lambda c: coach(c, "tick")}[kind](c)
    if out:
        # UTF-8 whatever the console's code page: a curly quote must not end the run on Windows.
        sys.stdout.buffer.write((out + "\n").encode("utf-8"))
        sys.stdout.flush()
