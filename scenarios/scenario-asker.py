"""The fixture asker: a Hermes script routine ("Scenario asker") that asks the owner for a yes the one
way the product gives a job to ask, `godspeed-step open`, for the scenarios that prove what the owner
is asked and how he answers (no-question-he-cannot-judge.sh, plain-yes.sh).

It reads ./.scenario-asks.json (the routine runs in the workspace; the scenario writes the file before
each run), a list of {about, question, yes, no, quiet?, subject?, optional_after?}, opens a waiting
step for each ask the operation answers with a question (not a quiet, decided, done or dropped one), and prints what the operation says to send, which Hermes delivers to the owner's
Telegram. The command prints a JSON outcome for every ask; this fixture prints only its "message",
so an outcome without one (quiet, decided, do, dropped) prints nothing.

THE COUPLING TO TICKETS 01 AND 04 IS THIS ONE TABLE. Ticket 01 (#196) is rebuilt after #203 and its
flags may move; ticket 04 has no code yet, so its three flags are provisional. Re-check both against
`godspeed-step open --help` when they merge: nothing else in the scenarios names a flag.
"""
import json
import os
import shutil
import subprocess
import sys

BY = "job:scenario-asker"
FLAGS = (  # ask field -> command line flag
    ("about", "--about"),      # ticket 01, as in #204
    ("question", "--question"),  # ticket 01
    ("yes", "--yes"),          # ticket 01
    ("no", "--no"),            # ticket 01
    ("quiet", "--quietly"),    # ticket 04: safe to do quietly (restart, reload, retry)
    ("subject", "--subject"),  # ticket 04: the stable key an earlier decision is matched on
    ("optional_after", "--extra"),  # ticket 04: an extra after an instruction (never within it here, so dropped)
)


def the_command():
    home = os.environ.get("HERMES_HOME", "")
    return shutil.which("godspeed-step", path=os.pathsep.join([os.path.join(home, "bin"), os.environ.get("PATH", "")]))


def record(message):
    """Records the words as the notebook's own routine runner records a script routine's own words
    (godspeed_routines.py, record): through background-report.mjs. Without that record the delivery
    that follows has nothing to make answerable, and the question goes out with no buttons."""
    home = os.environ.get("HERMES_HOME", "")
    with open(os.path.join(home, "plugins", "godspeed_notebook", "report.json"), encoding="utf-8") as f:
        wiring = json.load(f)
    done = subprocess.run([wiring["node"], wiring["script"], "record", "--godspeed", wiring["root"], "--home", home,
                           "--routine", "Scenario asker", "--delivery", "telegram"],
                          input=message, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120)
    if done.returncode != 0:
        raise RuntimeError((done.stderr or done.stdout).strip()[:300] or "the notebook refused the record")


def main():
    command = the_command()
    if command is None:
        print("this install has no godspeed-step, the one way to ask for a yes (ticket 01, #196)", file=sys.stderr)
        return 1
    asks = json.load(open(".scenario-asks.json", encoding="utf-8"))
    for ask in asks:
        argv = [command, "open", "--by", BY, "--chat", "telegram"]
        for field, flag in FLAGS:
            if ask.get(field):
                argv += [flag, str(ask[field])]
        done = subprocess.run(argv, capture_output=True, text=True)
        if done.returncode != 0:
            print("godspeed-step open refused %r: %s" % (ask.get("question"), (done.stderr or done.stdout).strip()), file=sys.stderr)
            return 1
        try:
            message = json.loads(done.stdout).get("message", "")
        except ValueError:
            message = done.stdout.strip()
        if message:
            try:
                record(message)
            except Exception as error:
                print("the question could not be recorded in the notebook: %s" % error, file=sys.stderr)
                return 1
            print(message)
    return 0


sys.exit(main())
