"""The fixture asker: a Hermes script routine ("Scenario asker") that asks the owner for a yes the one
way the product gives a job to ask, `godspeed-step open`, for the scenarios that prove what the owner
is asked and how he answers (no-question-he-cannot-judge.sh, plain-yes.sh).

It reads ./.scenario-asks.json (the routine runs in the workspace; the scenario writes the file before
each run), a list of {about, question, yes, no, quiet?, subject?, optional_after?}, opens a waiting
step for each ask the operation answers with a question (not a quiet, decided, done or dropped one), and prints what the operation says to send, which Hermes delivers to the owner's
Telegram. An ask the operation answers with nothing (it decided quietly, or the question is already
out) prints nothing.

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
            print(message)
    return 0


sys.exit(main())
