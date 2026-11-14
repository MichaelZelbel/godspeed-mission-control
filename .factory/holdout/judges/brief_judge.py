#!/usr/bin/env python3
"""Judge for the morning-brief holdouts (H-01..H-08, H-18).

Usage: python3 -I brief_judge.py run.json

run.json, recorded by the verifier:
{
  "brief_requests": 1,            # how many times the stand-in AI was asked to write the brief
  "good": ["sentence", ...],      # sentences of the prepared draft built only from facts in the folder
  "refused": [                    # sentences built to be refused by the source check
    {"sentence": "...", "tokens": ["Zorvath", "4,382"]}   # tokens found nowhere in the person's folder
  ],
  "carried": ["line", ...],       # optional: lines the brief must carry word for word (Charm Challenge line)
  "voice_cut": ["sentence", ...], # optional: sentences that break a rule in profile/voice.md
  "order_matters": true,          # optional: good sentences must keep their draft order
  "all_refused": false,           # true when every sentence of the draft is built to be refused
  "expect_single_brief": true,    # optional: the person asked for the brief again after it was made;
                                  # more than 2 requests (one brief may take two drafts) is a FAIL
  "surfaces": {"saved_brief": "...", "chat_today": "...", "notebook": "..."}   # null = not reachable
}

Prints PASS, FAIL or INCONCLUSIVE on the first line, then one reason per line.
"""
import json
import re
import sys


def norm(text):
    text = text.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    text = re.sub(r"[*_`#>]", " ", text)                    # markdown emphasis, headings, quotes
    text = re.sub(r"(?m)^\s*(?:[-+•]|\d+[.)])\s+", " ", text)  # list markers
    return re.sub(r"\s+", " ", text).strip().lower()


def main():
    run = json.load(open(sys.argv[1], encoding="utf-8"))
    fails, inconclusive = [], []
    if not run.get("brief_requests"):
        inconclusive.append("the stand-in AI was never asked to write the brief")
    surfaces = {k: v for k, v in (run.get("surfaces") or {}).items() if v is not None}
    if not surfaces:
        inconclusive.append("no surface showed a brief")
    good = run.get("good") or []
    refused = run.get("refused") or []
    carried = run.get("carried") or []
    for name, raw in surfaces.items():
        text = norm(raw)
        if not text:
            fails.append(f"{name}: empty, the person got nothing")
            continue
        if re.search(r"(?i)\b(traceback|exception|error:|undefined|null|nan)\b", raw):
            fails.append(f"{name}: shows an error or a programming word")
        for s in good:
            if norm(s) not in text:
                fails.append(f"{name}: a sentence that passed is missing: {s!r}")
        for s in carried:
            if norm(s) not in text:
                fails.append(f"{name}: a line carried word for word is missing: {s!r}")
        for s in run.get("voice_cut") or []:
            if norm(s) in text:
                fails.append(f"{name}: a sentence that breaks a voice rule arrived: {s!r}")
        for r in refused:
            if norm(r["sentence"]) in text:
                fails.append(f"{name}: a refused sentence arrived: {r['sentence']!r}")
            for tok in r.get("tokens") or []:
                if norm(tok) in text:
                    fails.append(f"{name}: part of a refused sentence arrived ({tok!r})")
        if run.get("order_matters") and good:
            pos = [text.find(norm(s)) for s in good]
            if -1 not in pos and pos != sorted(pos):
                fails.append(f"{name}: sentences that passed are out of their order")
        for line in raw.splitlines():
            if re.fullmatch(r"\s*(?:[-*+•]|\d+[.)])\s*", line):
                fails.append(f"{name}: an empty list item is left where a sentence was")
                break
        if re.search(r"(?<![.])\.\s*\.(?![.])|,\s*\.|\.\s*,", raw):
            fails.append(f"{name}: stray punctuation is left where a sentence was")
        if run.get("all_refused") and len(text.split()) < 4:
            fails.append(f"{name}: all text was refused but no readable note was given")
    if len({norm(v) for v in surfaces.values()}) > 1:
        fails.append("the surfaces show different briefs for the same morning")
    if (run.get("brief_requests") or 0) > 2 and run.get("expect_single_brief"):
        fails.append("the brief was made again when the person asked for it")
    if fails:
        print("FAIL")
        print("\n".join(fails))
    elif inconclusive:
        print("INCONCLUSIVE")
        print("\n".join(inconclusive))
    else:
        print("PASS")


if __name__ == "__main__":
    main()
