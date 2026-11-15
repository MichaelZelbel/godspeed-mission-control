"""A stand-in for the assistant's control channel, for one case of scenarios/night-tidy.sh.

The night tidy-up acts only on the conversation the gateway's routing table names, and only after
the assistant's `session.resume` confirms that exact conversation; a resume that answers with
another one has to stop it, because rewriting the wrong conversation is the one thing the routine
must never do. A real assistant always resumes what it was asked for, so that guard cannot be shown
with one: this module answers the routine's own command (`python -m tui_gateway.entry`) from a plan
the scenario writes, and records every request it was sent, so "it compressed nothing" is a fact
about that record and not a reading of the code.

The scenario copies this file into a folder of its own as `tui_gateway/entry.py` and names that
folder to the routine as the assistant's source folder. Everything else in that run is real: the
routine's own script file, the assistant's own chat store, the install's own Python.

  CHANNEL_PLAN    a JSON file: {"session.resume": {...}}, the answer to each method
  CHANNEL_RECORD  written after every request: [{"method": ..., "params": ...}, ...]
"""
import json
import os
import sys

plan = json.load(open(os.environ["CHANNEL_PLAN"], encoding="utf-8"))
seen = []
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    message = json.loads(line)
    seen.append({"method": message.get("method"), "params": message.get("params")})
    with open(os.environ["CHANNEL_RECORD"], "w", encoding="utf-8") as record:
        json.dump(seen, record)
    answer = plan.get(message.get("method"))
    if answer is None:  # a step this channel never answers
        continue
    out = {"jsonrpc": "2.0", "id": message.get("id")}
    out["error" if "error" in answer else "result"] = answer.get("error", answer)
    sys.stdout.write(json.dumps(out) + "\n")
    sys.stdout.flush()
