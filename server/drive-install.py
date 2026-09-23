#!/usr/bin/env python3
"""The test rig's driver: runs the Teach It Once server installer under a pseudo-terminal, answering its
prompts the way a reader would.

Three deliberate differences from a reader's run:
  * the ChatGPT sign-in is cancelled (SIGINT to the hermes auth process only), because
    it is not what is under test and the installer is designed to carry on with a warning;
  * the GitHub one-time code is written to a file so the operator can type it into
    github.com/login/device from a browser that is signed in;
  * the Telegram stop is answered from the environment: TELEGRAM_ANSWER is what is
    pasted at "Paste the bot token" (default: Enter, which skips), and the
    "Press Enter once you have sent it" prompt is answered with Enter after
    TELEGRAM_HELLO_WAIT seconds (default 0), so a real bot can be messaged by hand.
"""
import os
import re
import subprocess
import time

import pexpect

URL = os.environ.get(
    "INSTALL_URL",
    "https://raw.githubusercontent.com/MichaelZelbel/godspeed-mission-control/main/server/install.sh",
)
REPO_NAME = os.environ.get("TEST_REPO_NAME", "mc-installer-test-2026-09-05")
LOG = os.environ.get("INSTALL_LOG", "/root/install-run.log")
STATE = os.environ.get("INSTALL_STATE", "/root/install-state")
os.makedirs(STATE, exist_ok=True)


def note(msg):
    line = f"{time.strftime('%H:%M:%S')} {msg}"
    with open(os.path.join(STATE, "events.log"), "a", encoding="utf-8") as f:
        f.write(line + "\n")
    print(line, flush=True)


cmd = f"curl -fsSL {URL} | bash"
env = dict(os.environ)
env["TERM"] = "xterm"
child = pexpect.spawn(
    "/bin/bash", ["-c", cmd], encoding="utf-8", codec_errors="replace",
    timeout=1800, dimensions=(50, 200), env=env,
)
child.logfile_read = open(LOG, "a", encoding="utf-8")
note(f"started: {cmd}")

patterns = [
    re.compile(r"Enter this code:\s*([A-Z0-9][A-Z0-9-]{5,})"),        # 0 hermes device code
    re.compile(r"Waiting for sign-in"),                                # 1 hermes waiting
    re.compile(r"one-time code: ([A-Z0-9]{4}-[A-Z0-9]{4})"),           # 2 gh device code
    re.compile(r"Press Enter to open"),                                # 3 gh prompt
    re.compile(r"Authenticate Git with your GitHub credentials"),      # 4 gh question
    re.compile(r"Which repository holds your folder|Paste the address, or press Enter for a fresh folder"),  # 5 installer ask
    re.compile(r"Name for the new private GitHub repository"),         # 6 helper prompt
    pexpect.EOF,                                                       # 7
    pexpect.TIMEOUT,                                                   # 8
    re.compile(r"Connect (a notebook|Menerio) now\? \(y/n\) \[n\]:"),  # 9 setup-godspeed's Menerio question
    re.compile(r"\(y/n\) \[[yn]\]:"),                                  # 10 any other yes/no: take the default
    re.compile(r"Put the morning brief on this server's clock \(y/n\) \[n\]:"),  # 11 the opt-in brief
    re.compile(r"Paste the bot token, or press Enter to skip"),        # 12 the Telegram stop
    re.compile(r"Press Enter once you have sent it"),                  # 13 the hello step
]
hermes_cancelled = False
telegram_answers = os.environ.get("TELEGRAM_ANSWER", "").split("|") if os.environ.get("TELEGRAM_ANSWER") else []
while True:
    i = child.expect(patterns)
    if i == 0:
        code = child.match.group(1)
        with open(os.path.join(STATE, "hermes-code.txt"), "w") as f:
            f.write(code + "\n")
        note(f"hermes device code seen: {code}")
    elif i == 1:
        if not hermes_cancelled:
            note("hermes is waiting for the ChatGPT sign-in; cancelling that step only")
            time.sleep(2)
            # [a]dd: the bracket keeps this pkill's own command line from matching.
            subprocess.run(["pkill", "-INT", "-f", "auth [a]dd openai-codex"], check=False)
            hermes_cancelled = True
    elif i == 2:
        code = child.match.group(1)
        with open(os.path.join(STATE, "gh-code.txt"), "w") as f:
            f.write(code + "\n")
        note(f"github device code seen: {code}")
    elif i == 3:
        time.sleep(0.5)
        child.sendline("")
        note("pressed Enter for the GitHub sign-in")
    elif i == 4:
        time.sleep(0.5)
        child.sendline("Y")
        note("answered Y to authenticating git")
    elif i == 5:
        time.sleep(0.5)
        answer = os.environ.get("GODSPEED_REPO_ANSWER", "")
        child.sendline(answer)
        note("answered the repository question with " + (repr(answer) if answer else "Enter (fresh godspeed)"))
    elif i == 6:
        time.sleep(0.5)
        child.sendline(REPO_NAME)
        note(f"named the new repository {REPO_NAME}")
    elif i == 7:
        break
    elif i == 9:
        time.sleep(0.5)
        child.sendline("n")
        note("answered the notebook question with n (a reader without a Menerio account)")
    elif i == 11:
        time.sleep(0.5)
        answer = os.environ.get("BRIEF_ANSWER", "")
        child.sendline(answer)
        note("answered the morning-brief question with " + (repr(answer) if answer else "Enter (no)"))
    elif i == 12:
        time.sleep(0.5)
        answer = telegram_answers.pop(0) if telegram_answers else ""
        child.sendline(answer)
        # never log the token itself
        note("answered the Telegram token prompt with " + ("a token (%d chars)" % len(answer) if answer else "Enter (skip)"))
    elif i == 13:
        wait = float(os.environ.get("TELEGRAM_HELLO_WAIT", "0"))
        if wait:
            note(f"hello step: waiting {wait:.0f}s for a message to the bot to be sent by hand")
            time.sleep(wait)
        else:
            time.sleep(0.5)
        child.sendline("")
        note("pressed Enter at the hello step")
    elif i == 10:
        time.sleep(0.5)
        child.sendline("")
        note(f"took the default on a yes/no question: {child.after.strip()}")
    else:
        note("timed out waiting for output")
        break

child.close()
note(f"installer finished: exit={child.exitstatus} signal={child.signalstatus}")
with open(os.path.join(STATE, "done"), "w") as f:
    f.write(f"{child.exitstatus}\n")
