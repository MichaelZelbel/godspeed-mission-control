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

Which text is judged as a statement of the AI's state:
- a status surface is judged only on what in it states the AI's state: a chat's header, title and
  empty-chat text ("What would you like to work on?") say nothing about the AI and are not counted as a
  status line. A status surface's text is read without the labels of the pickers recorded in the same
  snapshot (those are judged as pickers). What is left states the AI's state when it says no AI is
  connected ("No AI is connected yet", "No AI connected", "not connected", "Connect AI"), that a key or
  sign-in was refused, or claims a connection ("Connected", "Connected model", "Connected to …", "is
  connected", "Ready"). A status surface that states none of these is not classified and need not say
  anything, except the card (a surface whose name is or ends in "card"): the card must always state the
  true state.
- pickers that state the AI's state ("No AI connected", "Connected model", ...) are classified with the
  status surfaces, so a picker that reads as another state than the card fails.
- every snapshot must have at least one surface (status, picker or reply) that states the AI's state, or
  a model picker showing expect_model; a screen that says nothing about the AI anywhere fails.

Rules:
- every snapshot, every surface: no "Connecting" (the word shows only while the status loads, and
  snapshots are read after loading), no clipped label, no bare error ("undefined", "null", "NaN",
  "[object Object]", "Error:", a stack line, "500", "Internal Server Error").
- every reply: no typing indicator still shown ("typing": true), and the composer usable again right
  after ("composer_usable_after": false fails), when the run records them.
- state "none": no surface claims a connection ("Connected", "Connected model", "Connected to", "is connected"
  without a negation, "Ready"); every status surface that states the AI's state, and the card always, says
  "No AI is connected yet"; every reply says it, names Settings and Your AI, and is exactly the refusal
  sentence (whitespace collapsed); no reply reached an AI; no surface says the key was refused.
- state "refused": no surface says no AI is connected ("No AI is connected yet", "No AI connected"); no
  surface claims the AI works ("Connected", "Connected model", "Ready") without also saying the key is
  refused; every status surface that states the AI's state, the card always, and every reply says the key
  (or sign-in) was refused or rejected and names Settings; no reply is the "No AI is connected yet" sentence.
- state "connected": no surface says no AI is connected ("No AI is connected", "No AI connected", "not
  connected"), "Connect your AI", "Connect AI" or that the key was refused; the card states a connection;
  every picker of kind model (its name contains "model") shows expect_model when given, and no picker shows
  a placeholder claim ("Connected model") instead of a model name; every reply reached the AI
  (ai_requests >= 1) and is not a refusal.
- all stating status and picker surfaces of one snapshot are classified into one state; they must all agree
  with the true state.
Prints PASS, FAIL or INCONCLUSIVE on the first line, then one reason per line.
"""
import json
import re
import sys

REFUSAL = ("No AI is connected yet. Connect your AI service in Settings, Your AI, "
           "then ask Godspeed again.")
NO_AI = re.compile(r"no ai is connected", re.I)
# any wording that says no AI is connected, used to read a surface's state (not to meet the phrase rules)
NO_AI_ANY = re.compile(r"\bno ai\b(?: is)?(?: yet)? connected\b|\bnot (?:yet )?connected\b", re.I)
CLAIM = re.compile(r"(?<![Nn]ot )(?<![Nn]ot yet )\b(Connected( model| to)?|is connected)\b")
READY = re.compile(r"\bReady\b|\bready to (chat|answer|help)\b")
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


def claims(text):
    """True when the text claims a working connection, outside any no-AI wording."""
    rest = NO_AI_ANY.sub("", NO_AI.sub("", text))
    return bool(CLAIM.search(rest) or READY.search(rest))


def says_no_ai(text):
    return bool(NO_AI_ANY.search(text) or CONNECT_PROMPT.search(text))


def classify(text):
    """The state the text states, or None when it says nothing about the AI."""
    if KEY_REFUSED.search(text):
        return "refused"
    if says_no_ai(text):
        return "none"
    if claims(text):
        return "connected"
    return None


def is_card(name):
    return name.endswith("card")


def picker_labels(surf):
    out = []
    for s in surf.values():
        if s.get("kind") == "picker":
            lab = norm((s.get("text") or "").split(" | options:")[0])
            if lab:
                out.append(lab)
    return sorted(set(out), key=len, reverse=True)


def own_text(text, labels):
    """A status surface's text without the picker labels the run appended to it."""
    for lab in labels:
        text = text.replace(lab, " ")
    return norm(text)


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
        labels = picker_labels(surf)
        em = snap.get("expect_model")
        states, stated = {}, False
        for name, s in surf.items():
            full = norm(s.get("text"))
            kind = s.get("kind", "status")
            where = f"[{lab}] {name}"
            if not full:
                continue
            # what this surface says about the AI: for a status line, its own words only
            text = own_text(full, labels) if kind == "status" else full
            st = classify(text)
            states_this = kind in ("status", "picker") and st is not None
            card = kind == "status" and is_card(name)
            if st is not None or kind == "reply" or (kind == "picker" and em and em in full
                                                       and "model" in name.lower()):
                stated = True
            if CONNECTING.search(full):
                fails.append(f"{where}: still says Connecting after loading: {full[:120]!r}")
            if s.get("clipped"):
                fails.append(f"{where}: label is cut off: {full[:120]!r}")
            if BARE_ERROR.search(full):
                fails.append(f"{where}: bare error text: {full[:160]!r}")
            if kind == "reply":
                if s.get("typing"):
                    fails.append(f"{where}: a typing indicator is still shown after the reply")
                if s.get("composer_usable_after") is False:
                    fails.append(f"{where}: the composer cannot send again right after the reply")
            judged_status = kind == "reply" or card or (kind == "status" and st is not None)
            if state == "none":
                if claims(full):
                    fails.append(f"{where}: claims a connection with no AI connected: {full[:160]!r}")
                if KEY_REFUSED.search(full):
                    fails.append(f"{where}: says a key was refused, but no AI is connected: {full[:160]!r}")
                if judged_status and not NO_AI.search(text):
                    fails.append(f"{where}: does not say no AI is connected: {text[:160]!r}")
                if kind == "reply":
                    if not (SETTINGS.search(text) and YOUR_AI.search(text)):
                        fails.append(f"{where}: does not point to Settings, Your AI: {text[:160]!r}")
                    if text != REFUSAL:
                        fails.append(f"{where}: reply is not the refusal sentence word for word: {text[:200]!r}")
                    if (s.get("ai_requests") or 0) > 0:
                        fails.append(f"{where}: a message reached an AI with none connected")
            elif state == "refused":
                if NO_AI.search(full) or NO_AI_ANY.search(full):
                    fails.append(f"{where}: says no AI is connected, but one is connected and refusing its key")
                if claims(full) and not KEY_REFUSED.search(full):
                    fails.append(f"{where}: claims a working connection while the key is refused: {full[:160]!r}")
                if judged_status:
                    if not KEY_REFUSED.search(text):
                        fails.append(f"{where}: does not say the key or sign-in was refused: {text[:160]!r}")
                    if not SETTINGS.search(text):
                        fails.append(f"{where}: does not point to Settings: {text[:160]!r}")
                if kind == "reply" and text == REFUSAL:
                    fails.append(f"{where}: answers that no AI is connected, but one is connected")
            else:
                if NO_AI.search(full) or says_no_ai(full):
                    fails.append(f"{where}: stale no-AI text after connecting: {full[:160]!r}")
                if KEY_REFUSED.search(full):
                    fails.append(f"{where}: stale key-refused text with a working key: {full[:160]!r}")
                if card and st != "connected":
                    fails.append(f"{where}: the card does not say the AI is connected: {text[:160]!r}")
                if kind == "picker" and "model" in name.lower():
                    if re.search(r"\bConnected model\b", full):
                        fails.append(f"{where}: shows a placeholder instead of a model name: {full[:120]!r}")
                    if em and em not in full:
                        fails.append(f"{where}: does not show the chosen model {em!r}: {full[:120]!r}")
                if kind == "reply":
                    if (s.get("ai_requests") or 0) < 1:
                        fails.append(f"{where}: the message never reached the connected AI")
                    if text == norm(REFUSAL) or KEY_REFUSED.search(text):
                        fails.append(f"{where}: refused although an AI is connected and working")
            if states_this:
                states[name] = st
        if surf and not stated:
            fails.append(f"[{lab}] nothing on this screen states the AI's state")
        wrong = {n: st for n, st in states.items() if st != state}
        if wrong:
            fails.append(f"[{lab}] surfaces that state the AI's state disagree with the true state {state}: {wrong}")
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
