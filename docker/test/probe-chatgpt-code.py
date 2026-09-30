#!/usr/bin/env python3
# For docker/test.sh only: does the chat setup read the code the REAL `hermes auth add
# openai-codex` prints, in this image? Starts the sign-in the way the chat setup does (on a
# pseudo-terminal, in a throwaway HERMES_HOME), waits for a code, and stops it before
# anybody could use it. Prints one line:
#   FOUND <address>        the code was read (the code itself is not printed)
#   UNREADABLE <output>    Hermes printed a code and the chat setup could not read it
#   UNREACHED <output>     no code came (no network, or ChatGPT's sign-in is down)
import importlib.machinery
import importlib.util
import re
import sys
import time

PROGRAM = "/usr/local/bin/godspeed-telegram-setup"
spec = importlib.util.spec_from_loader("s", importlib.machinery.SourceFileLoader("s", PROGRAM))
s = importlib.util.module_from_spec(spec)
spec.loader.exec_module(s)

p = s.Proc(s.HERMES + ["auth", "add", "openai-codex", "--type", "oauth", "--no-browser"], True)
found, t0 = None, time.time()
while time.time() - t0 < 60 and not found and p.p.poll() is None:
    found = s.find_device_code(p.text())
    time.sleep(0.5)
found = found or s.find_device_code(p.text())
p.stop()
out = s.ANSI.sub("", p.text())
if found:
    print("FOUND", found[0])
elif re.search(r"enter (this )?code", out, re.I):
    print("UNREADABLE", out[-800:].replace("\n", " | "))
else:
    print("UNREACHED", out[-400:].replace("\n", " | "))
