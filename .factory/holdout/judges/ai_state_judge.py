#!/usr/bin/env python3
"""Judge for "one AI state, every surface" (H-19..H-29).

Usage: python3 -I ai_state_judge.py run.json

run.json: one or more snapshots. A snapshot is everything a person can see at one moment, read after
the page has settled (no request in flight for 3 seconds), for one true state of the install.
{
  "snapshots": [
    {
      "label": "fresh install",                  # free text, echoed in reasons
      "state": "none" | "refused" | "connected", # the true state the verifier set up
      "expect_model": "standin-model-1",         # optional, connected only: the model name the person chose
      "required": ["card", "global_chat", ...],  # surfaces this scenario needs; a missing one is INCONCLUSIVE
      "surfaces": {
        "<name>": {
          "kind": "status" | "picker" | "reply", # status: a line saying the AI's state (card, chat header or
                                                 #   empty-chat text, banner); picker: the model or effort
                                                 #   control's visible label and every option it lists;
                                                 #   reply: the chat's answer to a message sent in this state
          "text": "...",                         # all visible text of the surface (innerText), options included
          "clipped": false,                      # optional: true when a label is cut off (scrollWidth > clientWidth
                                                 #   or ellipsis shown) at this viewport
          "ai_requests": 0                       # optional, reply only: requests the stand-in AI recorded for it
        }
      }
    }
  ]
}

Rules:
- every snapshot, every surface: no "Connecting" (the word shows only while the status loads, and
  snapshots are read after loading), no clipped label, no bare error ("undefined", "null", "NaN",
  "[object Object]", "Error:", a stack line, "500", "Internal Server Error").
- state "none": no surface claims a connection ("Connected", "Connected model", "Connected to", "is connected"
  without a negation); every status and reply surface says "No AI is connected yet" and names Settings and
  Your AI; every reply is exactly the refusal sentence (whitespace collapsed); no reply reached an AI;
  no surface says the key was refused.
- state "refused": no surface says "No AI is connected yet"; no surface claims the AI works ("Connected",
  "Connected model", "Ready") without also saying the key is refused; every status and reply surface says
  the key (or sign-in) was refused or rejected and names Settings; no reply is the "No AI is connected yet"
  sentence.
- state "connected": no surface says "No AI is connected", "Connect your AI", "Connect AI" or that the key
  was refused; every picker of kind model (its name contains "model") shows expect_model when given, and no
  picker shows a placeholder claim ("Connected model") instead of a model name; every reply reached the AI
  (ai_requests >= 1) and is not a refusal.
- all status surfaces of one snapshot are classified into one state; they must all agree with the true state.
Prints PASS, FAIL or INCONCLUSIVE on the first line, then one reason per line.
"""
import json
import re
import sys

REFUSAL = ("No AI is connected yet. Connect your AI service in Settings, Your AI, "
           "then ask Godspeed again.")
NO_AI = re.compile(r"no ai is connected", re.I)
CLAIM = re.compile(r"(?<![Nn]ot )(?<![Nn]ot yet )\b(Connected( model| to)?|is connected)\b")
CONNECTING = re.compile(r"\bConnecting\b", re.I)
KEY_REFUSED = re.compile(r"\b(key|sign-?in|login)\b[^.]{0,60}\b(refus|reject|invalid|not accepted|expired)"
                         r"|\b(refus|reject)\w*\b[^.]{0,60}\b(key|sign-?in)\b", re.I)
SETTINGS = re.compile(r"settings", re.I)
YOUR_AI = re.compile(r"your ai", re.I)
CONNECT_PROMPT = re.compile(r"\bconnect (your )?ai\b", re.I)
BARE_ERROR = re.compile(r"\bundefined\b|\bnull\b|\bNaN\b|\[object Object\]|\bError:|^\s*at \S+ \(|"
                        r"Internal Server Error|\b500\b|\bTraceback\b", re.M)


def norm(s):
    return re.sub(r"\s+", " ", s or "").strip()


def classify(text):
    if KEY_REFUSED.search(text):
        return "refused"
    if NO_AI.search(text):
        return "none"
    return "connected"


def judge(run):
    fails, incon = [], []
    snaps = run.get("snapshots") or []
    if not snaps:
        return "INCONCLUSIVE", ["no snapshots recorded"]
    for snap in snaps:
        lab = snap.get("label", "?")
        state = snap.get("state")
        surf = snap.get("surfaces") or {}
        if state not in ("none", "refused", "connected"):
            incon.append(f"[{lab}] unknown state {state!r}")
            continue
        for name in snap.get("required") or []:
            if name not in surf or not norm(surf[name].get("text")):
                incon.append(f"[{lab}] surface {name} not recorded (no route, or empty)")
        for name, s in surf.items():
            text = norm(s.get("text"))
            kind = s.get("kind", "status")
            where = f"[{lab}] {name}"
            if not text:
                continue
            if CONNECTING.search(text):
                fails.append(f"{where}: still says Connecting after loading: {text[:120]!r}")
            if s.get("clipped"):
                fails.append(f"{where}: label is cut off: {text[:120]!r}")
            if BARE_ERROR.search(text):
                fails.append(f"{where}: bare error text: {text[:160]!r}")
            if state == "none":
                if CLAIM.search(NO_AI.sub("", text)):
                    fails.append(f"{where}: claims a connection with no AI connected: {text[:160]!r}")
                if KEY_REFUSED.search(text):
                    fails.append(f"{where}: says a key was refused, but no AI is connected: {text[:160]!r}")
                if kind in ("status", "reply"):
                    if not NO_AI.search(text):
                        fails.append(f"{where}: does not say no AI is connected: {text[:160]!r}")
                    if not (SETTINGS.search(text) and YOUR_AI.search(text)) and kind == "reply":
                        fails.append(f"{where}: does not point to Settings, Your AI: {text[:160]!r}")
                if kind == "reply":
                    if text != REFUSAL:
                        fails.append(f"{where}: reply is not the refusal sentence word for word: {text[:200]!r}")
                    if (s.get("ai_requests") or 0) > 0:
                        fails.append(f"{where}: a message reached an AI with none connected")
            elif state == "refused":
                if NO_AI.search(text):
                    fails.append(f"{where}: says no AI is connected, but one is connected and refusing its key")
                if CLAIM.search(NO_AI.sub("", text)) and not KEY_REFUSED.search(text):
                    fails.append(f"{where}: claims a working connection while the key is refused: {text[:160]!r}")
                if kind in ("status", "reply"):
                    if not KEY_REFUSED.search(text):
                        fails.append(f"{where}: does not say the key or sign-in was refused: {text[:160]!r}")
                    if not SETTINGS.search(text):
                        fails.append(f"{where}: does not point to Settings: {text[:160]!r}")
            else:
                if NO_AI.search(text) or CONNECT_PROMPT.search(text):
                    fails.append(f"{where}: stale no-AI text after connecting: {text[:160]!r}")
                if KEY_REFUSED.search(text):
                    fails.append(f"{where}: stale key-refused text with a working key: {text[:160]!r}")
                if kind == "picker" and "model" in name.lower():
                    if re.search(r"\bConnected model\b", text):
                        fails.append(f"{where}: shows a placeholder instead of a model name: {text[:120]!r}")
                    em = snap.get("expect_model")
                    if em and em not in text:
                        fails.append(f"{where}: does not show the chosen model {em!r}: {text[:120]!r}")
                if kind == "reply":
                    if (s.get("ai_requests") or 0) < 1:
                        fails.append(f"{where}: the message never reached the connected AI")
                    if text == norm(REFUSAL) or KEY_REFUSED.search(text):
                        fails.append(f"{where}: refused although an AI is connected and working")
        states = {n: classify(norm(s.get("text"))) for n, s in surf.items()
                  if s.get("kind", "status") == "status" and norm(s.get("text"))}
        wrong = {n: st for n, st in states.items() if st != state}
        if wrong:
            fails.append(f"[{lab}] status surfaces disagree with the true state {state}: {wrong}")
    if fails:
        return "FAIL", fails + incon
    if incon:
        return "INCONCLUSIVE", incon
    return "PASS", [f"{len(snaps)} snapshot(s) agree on every surface"]


def main():
    with open(sys.argv[1], encoding="utf-8") as f:
        run = json.load(f)
    verdict, reasons = judge(run)
    print(verdict)
    for r in reasons:
        print(r)


if __name__ == "__main__":
    main()
