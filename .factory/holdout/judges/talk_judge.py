#!/usr/bin/env python3
"""Judge for the coaching-talk start holdouts (H-14..H-17).

Usage: python3 -I talk_judge.py run.json

run.json, recorded by the verifier for one attempt to start a talk:
{
  "case": "miss-twice" | "miss-then-match" | "match" | "partial" | "empty" | "ai-error" | "unprepared",
  "prepared_opening": "...",          # the opening the preparation recorded (null for "unprepared")
  "ai_replies": ["...", "..."],       # what the stand-in AI answered, in order, to each request to open this talk
  "opening_requests": 2,              # how many times the AI was asked to open this talk
  "person_saw": "...",                # the first message the person saw for the talk
  "error_shown": false,               # an error, a stack, a code or "try again later" in place of a talk
  "open_talk_records": 1,             # open records of this talk after the start (and after any second ask)
  "record_complete": true             # the open record names its area and holds the opening the person saw
}
Prints PASS, FAIL or INCONCLUSIVE on the first line, then one reason per line.
"""
import json
import re
import sys


def norm(t):
    return re.sub(r"\s+", " ", (t or "").replace("’", "'")).strip().lower()


def main():
    run = json.load(open(sys.argv[1], encoding="utf-8"))
    case = run.get("case")
    fails = []
    n = run.get("opening_requests")
    saw = norm(run.get("person_saw"))
    prep = norm(run.get("prepared_opening"))
    if n is None:
        print("INCONCLUSIVE\nthe requests to the AI were not recorded")
        return
    if run.get("error_shown"):
        fails.append("the person got an error instead of a talk")
    if not saw:
        fails.append("the person saw no opening")
    if run.get("open_talk_records") != 1:
        fails.append(f"{run.get('open_talk_records')} open records of this talk, expected exactly 1")
    if not run.get("record_complete"):
        fails.append("the talk's record is not open and complete")
    if case == "match":
        if n != 1:
            fails.append(f"a matching opening was asked for {n} times, expected once")
        if prep and prep not in saw:
            fails.append("the prepared opening is not in what the person saw")
    elif case in ("miss-twice", "partial", "empty", "ai-error"):
        if n > 2:
            fails.append(f"the AI was asked {n} times, more than once more")
        if case != "ai-error" and n != 2:
            fails.append(f"the AI was asked {n} times, expected the first ask and exactly one more")
        if prep and prep not in saw:
            fails.append("the talk did not open from the prepared opening on record")
        for r in run.get("ai_replies") or []:
            r = norm(r)
            if r and prep not in r and len(r) > 20 and r in saw:
                fails.append("the reply that missed the opening was shown to the person")
    elif case == "miss-then-match":
        if n != 2:
            fails.append(f"the AI was asked {n} times, expected 2")
        replies = run.get("ai_replies") or []
        if prep and prep not in saw:
            fails.append("the prepared opening is not in what the person saw")
        if replies and norm(replies[0]) and norm(replies[0]) in saw and prep not in norm(replies[0]):
            fails.append("the first reply, which missed the opening, was shown")
    elif case == "unprepared":
        if n > 2:
            fails.append(f"an unprepared talk asked the AI {n} times")
        if not re.search(r"prepar", saw):
            fails.append("an unprepared talk does not say it is not prepared")
    else:
        print(f"INCONCLUSIVE\nunknown case {case!r}")
        return
    print("FAIL\n" + "\n".join(fails) if fails else "PASS")


if __name__ == "__main__":
    main()
