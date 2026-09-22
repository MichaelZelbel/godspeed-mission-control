#!/usr/bin/env bash
# The two sync arrows and their runner: what must stay quiet, and what must never happen.
#
# WHY THIS FILE IS HERE. tools/notebook-sync.py, tools/world-pull.py and mc-notebook-sync
# are what Chapter 28 means by the notebook keeping itself current. They run unattended,
# on a schedule, on machines whose owner never asked to see them, and that shape carries
# two promises the rest of the kit does not:
#
#   1. A reader WITHOUT a notebook must never see an error from them. Most readers never
#      connect one, and a scheduled job that complains daily about a thing you never asked
#      for is how a kit gets uninstalled. Checks 8 and 9 are that.
#   2. The runner must never push. Pulling keeps an idle machine fresh; pushing is a
#      decision, and a schedule must not make decisions. Check 7 is that.
#
# Usage: bash tools/test-notebook-sync.sh
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
PY="${PYTHON:-python3}"
command -v "$PY" >/dev/null 2>&1 && "$PY" -c "pass" >/dev/null 2>&1 || PY=python
"$PY" -c "pass" >/dev/null 2>&1 || { echo "no working python, cannot test"; exit 0; }
PASS=0; FAIL=0
ok()  { echo "  ok   $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL $1"; FAIL=$((FAIL+1)); [ -n "${2:-}" ] && echo "       $2"; }

W="$HERE/.tmp-notebook-test.$$"; rm -rf "$W"; mkdir -p "$W"
trap 'rm -rf "$W"' EXIT

echo "== the notebook sync: quiet for most readers, honest for the rest =="

# 1 + 2. Both programs are valid Python. A syntax error here ships to every reader.
for f in notebook-sync.py world-pull.py; do
  if "$PY" -c "import ast,sys; ast.parse(open(sys.argv[1], encoding='utf-8').read())" "$HERE/$f" 2>"$W/err"; then
    ok "$f is valid Python"
  else
    bad "$f does not parse" "$(cat "$W/err")"
  fi
done

# 3 + 4. --help answers and exits 0, which is the smallest proof each program starts.
for f in notebook-sync.py world-pull.py; do
  if "$PY" "$HERE/$f" --help >/dev/null 2>"$W/err"; then
    ok "$f --help answers"
  else
    bad "$f --help failed" "$(cat "$W/err")"
  fi
done

# 5 + 6. The runner and the credential helper parse as shell.
for f in mc-notebook-sync mc-notebook-env; do
  if bash -n "$HERE/$f" 2>"$W/err"; then
    ok "$f parses as shell"
  else
    bad "$f does not parse" "$(cat "$W/err")"
  fi
done

# 7. The runner never pushes. It pulls to stay fresh; pushing stays a decision a person
# makes, never something a schedule does.
if [ "$(grep -Ec 'git +push' "$HERE/mc-notebook-sync")" = "0" ]; then
  ok "the runner never contains git push"
else
  bad "THE RUNNER PUSHES, which turns a schedule into a decision-maker"
fi

# 8. No godspeed recorded on this computer: silent, exit 0. This is most readers' machines
# before the installer runs, and any output here becomes a daily complaint.
mkdir -p "$W/home-empty/.godspeed"
rc=0; out="$(HOME="$W/home-empty" MENERIO_API_KEY="" sh "$HERE/mc-notebook-sync" 2>&1)" || rc=$?
if [ "$rc" = "0" ] && [ -z "$out" ]; then
  ok "no mission control recorded: exit 0 and not a word"
else
  bad "a reader with no mission control saw something (exit $rc)" "$out"
fi

# 9. A mission control but no notebook: silent, exit 0. This is most readers' machines forever.
mkdir -p "$W/home-nokey/.godspeed" "$W/mc-nokey"
printf 'GODSPEED_DIR=%s\n' "$W/mc-nokey" > "$W/home-nokey/.godspeed/device.env"
rc=0; out="$(HOME="$W/home-nokey" MENERIO_API_KEY="" sh "$HERE/mc-notebook-sync" 2>&1)" || rc=$?
if [ "$rc" = "0" ] && [ -z "$out" ]; then
  ok "no notebook connected: exit 0 and not a word"
else
  bad "a reader without a notebook saw something (exit $rc)" "$out"
fi

# 9b. A notebook, but the reader never said yes to the mission control copy: the runner says so and sends
# nothing up. The UP program is replaced by one that would leave a mark if it were started.
mkdir -p "$W/home-nomirror/.godspeed" "$W/mc-nomirror" "$W/bin-nomirror"
printf 'GODSPEED_DIR=%s
' "$W/mc-nomirror" > "$W/home-nomirror/.godspeed/device.env"
cp "$HERE/mc-notebook-sync" "$W/bin-nomirror/mc-notebook-sync"
printf 'print("UP RAN")
' > "$W/bin-nomirror/notebook-sync.py"
printf 'print("DOWN RAN")
' > "$W/bin-nomirror/world-pull.py"
rc=0; out="$(HOME="$W/home-nomirror" USERPROFILE="$W/home-nomirror" GODSPEED_NOTEBOOK_MIRROR="" MENERIO_API_KEY="test-key" sh "$W/bin-nomirror/mc-notebook-sync" --verbose 2>&1)" || rc=$?
if [ "$rc" = "0" ] && ! echo "$out" | grep -q "UP RAN" && ! echo "$out" | grep -q "DOWN RAN" && echo "$out" | grep -q "switched off on this computer, so nothing was sent or fetched"; then
  ok "the mission control copy is off unless the reader said yes: nothing was sent up, and the log says why"
else
  bad "a mission control whose owner never said yes was sent up anyway (exit $rc)" "$out"
fi
printf 'GODSPEED_DIR=%s
GODSPEED_NOTEBOOK_MIRROR=1
' "$W/mc-nomirror" > "$W/home-nomirror/.godspeed/device.env"
rc=0; out="$(HOME="$W/home-nomirror" USERPROFILE="$W/home-nomirror" GODSPEED_NOTEBOOK_MIRROR="" MENERIO_API_KEY="test-key" sh "$W/bin-nomirror/mc-notebook-sync" --verbose 2>&1)" || rc=$?
echo "$out" | grep -q "UP RAN" && echo "$out" | grep -q "DOWN RAN" && ok "  and with GODSPEED_NOTEBOOK_MIRROR=1 in device.env both directions run" || bad "  the yes in device.env was not honoured" "$out"

# 9c. The copy program itself honours the answer, so typing it by hand cannot undo a "no".
mkdir -p "$W/home-hand/.godspeed" "$W/mc-hand"
printf '# A
' > "$W/mc-hand/AGENTS.md"
rc=0; out="$(HOME="$W/home-hand" USERPROFILE="$W/home-hand" GODSPEED_NOTEBOOK_MIRROR="" MENERIO_API_KEY="test-key" MENERIO_BASE_URL="http://127.0.0.1:1" "$PY" "$HERE/notebook-sync.py" --apply --repo-root "$W/mc-hand" 2>&1)" || rc=$?
if [ "$rc" = "0" ] && echo "$out" | grep -q "switched off on this computer, so nothing was sent"; then
  ok "typed by hand with the copy switched off: nothing is sent, and it says why"
else
  bad "notebook-sync.py --apply ignored the reader's no (exit $rc)" "$out"
fi

# 10 to 14. The dry run keeps the book's promise, offline: the WHOLE godspeed is mirrored,
# and each decision in decisions.md is its own entry. No key and no --apply, so nothing
# leaves the machine. Until 2026-09-20 the promise was the opposite for profile/ and
# AGENTS.md ("already loaded, so a copy is noise"); that reasoning is retired and the
# header of notebook-sync.py says why.
# The visible skills/ is the room since the Hermes switch (2026-09-02); .claude/skills
# is a link the installer makes, and on an older godspeed it may still be the only room.
mkdir -p "$W/godspeed/observations" "$W/godspeed/skills/plan-my-day" "$W/godspeed/profile" "$W/godspeed/rules" \
         "$W/godspeed/goals" "$W/godspeed/dev/some-project"
printf 'You proofread before sending.\n' > "$W/godspeed/observations/quirk.md"
printf '# Plan my day\n'                 > "$W/godspeed/skills/plan-my-day/SKILL.md"
printf '# About me\n'                    > "$W/godspeed/profile/about-me.md"
printf '# Ask first\n'                   > "$W/godspeed/rules/when-in-doubt-ask.md"
printf '# Health\n'                      > "$W/godspeed/goals/health.md"
printf '# Manual\n'                      > "$W/godspeed/AGENTS.md"
printf '# My projects\n'                 > "$W/godspeed/dev/README.md"
printf '# A project\n'                   > "$W/godspeed/dev/some-project/README.md"
cat > "$W/godspeed/decisions.md" <<'DECEOF'
# Decisions

- (2026-01-05) Chose one AI subscription instead of two, because the best
  tool is the one I open daily.
- 2026-02-11 Named the folder godspeed, so every tool calls it the same thing.

## 2026-03-01 Moved the notebook key
Why: one key, one off-switch.
DECEOF

plan="$(MENERIO_API_KEY="" "$PY" "$HERE/notebook-sync.py" --repo-root "$W/godspeed" 2>&1)"

echo "$plan" | grep -q "would create observations/quirk.md" \
  && ok "observations/ is sent" || bad "observations/ was not in the plan" "$plan"
echo "$plan" | grep -q "would create skills/plan-my-day/SKILL.md" \
  && ok "the visible skills/ is sent" || bad "skills/ was not in the plan" "$plan"

# An older godspeed that has not been topped up keeps its recipes in .claude/skills only.
# It must still be sent, or a reader who skipped the re-run loses their recipes from
# the notebook without a word.
mkdir -p "$W/oldgodspeed/.claude/skills/plan-my-day"
printf '# Plan my day\n' > "$W/oldgodspeed/.claude/skills/plan-my-day/SKILL.md"
oldplan="$(MENERIO_API_KEY="" "$PY" "$HERE/notebook-sync.py" --repo-root "$W/oldgodspeed" 2>&1)"
echo "$oldplan" | grep -q "would create .claude/skills/plan-my-day/SKILL.md" \
  && ok "an older mission control's .claude/skills/ is still sent" || bad "the older mission control's recipes were not in the plan" "$oldplan"

# A mission control where .claude/skills is a real second copy (Windows without links, or a mission control
# somebody copied by hand) must not send every skill twice. The visible name wins.
mkdir -p "$W/twogodspeed/skills/plan-my-day" "$W/twogodspeed/.claude/skills/plan-my-day"
printf '# Plan my day\n' > "$W/twogodspeed/skills/plan-my-day/SKILL.md"
printf '# Plan my day\n' > "$W/twogodspeed/.claude/skills/plan-my-day/SKILL.md"
twoplan="$(MENERIO_API_KEY="" "$PY" "$HERE/notebook-sync.py" --repo-root "$W/twogodspeed" 2>&1)"
if [ "$(echo "$twoplan" | grep -c "plan-my-day/SKILL.md")" = "1" ] \
   && echo "$twoplan" | grep -q "would create skills/plan-my-day/SKILL.md"; then
  ok "a skill that lives under both names is sent once, under the visible one"
else
  bad "the same skill was planned twice, or under the hidden name" "$twoplan"
fi

n="$(echo "$plan" | grep -c "would create decisions.md#")"
if [ "$n" = "3" ]; then
  ok "each decision is its own entry: two bullets and a heading make three"
else
  bad "expected 3 decision entries, the plan holds $n" "$plan"
fi
echo "$plan" | grep -q "would create decisions.md$" \
  && bad "decisions.md was also sent whole, beside its own decisions" "$plan" \
  || ok "decisions.md is never sent whole"

missing=""
for want in AGENTS.md profile/about-me.md rules/when-in-doubt-ask.md goals/health.md; do
  echo "$plan" | grep -q "would create $want$" || missing="$missing $want"
done
[ -z "$missing" ] && ok "the whole godspeed is mirrored: AGENTS.md, profile/, rules/ and goals/ are in the plan" \
  || bad "the mirror left out:$missing" "$plan"

if echo "$plan" | grep -q "would create dev/"; then
  bad "dev/ reached the plan, and dev/ never leaves the computer" "$plan"
else
  ok "dev/ is never sent, not even its README"
fi

# ---- git decides, when there is a git to ask -------------------------------------------
# The real godspeed is a git folder, and what git tracks is what is mirrored: .gitignore is
# the reader's own list of what stays home. A file git ignores, and a scratch file nobody
# committed, must both stay out. dev/README.md IS tracked in the starter godspeed, and stays
# out anyway.
if command -v git >/dev/null 2>&1; then
  G="$W/github"; mkdir -p "$G/profile" "$G/private" "$G/dev" "$G/scratch"
  printf 'private/\n'        > "$G/.gitignore"
  printf '# About me\n'      > "$G/profile/about-me.md"
  printf '# Manual\n'        > "$G/AGENTS.md"
  printf '# Projects\n'      > "$G/dev/README.md"
  printf '# Secret plan\n'   > "$G/private/plan.md"
  git -C "$G" init -q 2>/dev/null
  git -C "$G" add -A >/dev/null 2>&1
  git -C "$G" -c user.email=t@example.com -c user.name=t commit -qm one >/dev/null 2>&1
  printf '# Half a thought\n' > "$G/scratch/untracked.md"
  gplan="$(MENERIO_API_KEY="" "$PY" "$HERE/notebook-sync.py" --repo-root "$G" 2>&1)"
  if echo "$gplan" | grep -q "would create profile/about-me.md" \
     && echo "$gplan" | grep -q "would create AGENTS.md"; then
    ok "in a git godspeed, what git tracks is sent"
  else
    bad "a tracked file was not in the plan" "$gplan"
  fi
  if echo "$gplan" | grep -q "private/plan.md\|scratch/untracked.md\|dev/README.md"; then
    bad "an ignored file, an uncommitted file or dev/ reached the plan" "$gplan"
  else
    ok "in a git godspeed, ignored files, uncommitted files and dev/ stay home"
  fi
else
  ok "git is not on this box, so the git half of the mirror was not tested (skipped)"
  ok "skipped"
fi

# ---- what came down is never sent back up ----------------------------------------------
# world-pull.py writes `origin: menerio` files. Sending one up hands Menerio its own
# record as a new note, which the next pull brings down again. world/removed/ holds the
# pull's notices about what Menerio dropped, and must not put it back.
mkdir -p "$W/wh/world/claims" "$W/wh/world/removed"
printf -- '---\nsubject: me\norigin: menerio\nattribute: city\n---\nFrom the notebook.\n' > "$W/wh/world/claims/me--city--down.md"
printf -- '---\nsubject: me\norigin: godspeed\nattribute: shoe-size\n---\nSaid at my desk.\n'  > "$W/wh/world/claims/me--shoe-size--local.md"
printf -- 'A note that talks about it:\n\norigin: menerio\n'                               > "$W/wh/world/claims/no-header.md"
printf '# Removed today\n'                                                                 > "$W/wh/world/removed/2026-09-01-removed.md"
printf '# world\n'                                                                         > "$W/wh/world/README.md"
wplan="$(MENERIO_API_KEY="" "$PY" "$HERE/notebook-sync.py" --repo-root "$W/wh" 2>&1)"
if echo "$wplan" | grep -q "me--city--down.md\|world/removed/"; then
  bad "a record that came from Menerio, or a removal notice, was planned for sending back" "$wplan"
else
  ok "world/ files marked origin: menerio, and world/removed/, are never sent back"
fi
if echo "$wplan" | grep -q "would create world/claims/me--shoe-size--local.md" \
   && echo "$wplan" | grep -q "would create world/claims/no-header.md" \
   && echo "$wplan" | grep -q "would create world/README.md"; then
  ok "world/ files you wrote yourself are sent, and only the header block decides"
else
  bad "a locally written world/ file was left out" "$wplan"
fi

# ---- one huge file does not eat the allowance ------------------------------------------
mkdir -p "$W/big/prompts/archive" "$W/big/profile"
printf '# About me\n' > "$W/big/profile/about-me.md"
"$PY" -c "import sys; open(sys.argv[1], 'w', encoding='utf-8').write('# Log\n' + 'x' * 320000)" "$W/big/prompts/archive/2025.md"
bplan="$(MENERIO_API_KEY="" "$PY" "$HERE/notebook-sync.py" --repo-root "$W/big" 2>&1)"
if [ "$(echo "$bplan" | grep -c "^skipped prompts/archive/2025.md")" = "1" ] \
   && ! echo "$bplan" | grep -q "would create prompts/archive/2025.md" \
   && echo "$bplan" | grep -q "would create profile/about-me.md"; then
  ok "a file over 300 KB is skipped, named in one line, and the rest still goes"
else
  bad "the size limit did not hold, or did not say so" "$bplan"
fi

# ---- who wrote it, said inside the note -------------------------------------------------
# Only observations/ is called a guess. profile/ and rules/ are the reader's own words.
# Everything else is called a copy, which claims neither.
lines="$("$PY" - "$HERE/notebook-sync.py" <<'LINEEOF'
import importlib.util, sys
spec = importlib.util.spec_from_file_location("ns", sys.argv[1])
ns = importlib.util.module_from_spec(spec); spec.loader.exec_module(ns)
for path in ("observations/quirk.md", "profile/about-me.md", "rules/ask.md", "AGENTS.md",
             "goals/health.md", "world/claims/x.md", "skills/a/SKILL.md", "decisions.md"):
    d = ns.Document(doc_id=path, title=path, body="b", source_path=path)
    print(path, "=>", ns.build_note_body(d).split("\n")[0])
LINEEOF
)"
guess="$(echo "$lines" | grep -c "which makes it a guess")"
echo "$lines" | grep "^observations/quirk.md" | grep -q "which makes it a guess" && [ "$guess" = "1" ] \
  && ok "only observations/ is called a machine's guess" || bad "the guess line is on the wrong notes" "$lines"
[ "$(echo "$lines" | grep "^profile/\|^rules/" | grep -c "You wrote or decided this")" = "2" ] \
  && ok "profile/ and rules/ say you wrote or decided them" || bad "profile/ or rules/ carries the wrong line" "$lines"
[ "$(echo "$lines" | grep "^AGENTS.md\|^goals/\|^world/" | grep -c "This is a copy of the mission control file at .*Change the file in the mission control, never this note")" = "3" ] \
  && ok "everything else says it is a copy, and to change the file and never the note" || bad "the neutral line is missing" "$lines"

# ---- a mission control that already synced sends nothing again --------------------------------------
# The ids and the first line of a note are what the cache is keyed and hashed on. The
# strings below are the ones the program shipped with BEFORE the whole godspeed was mirrored,
# copied here on purpose and not imported, so a change to either is caught as what it
# is: every reader's notebook paying for every note a second time.
resend="$("$PY" - "$HERE/notebook-sync.py" "$W/godspeed" <<'OLDEOF'
import hashlib, importlib.util, pathlib, sys
spec = importlib.util.spec_from_file_location("ns", sys.argv[1])
ns = importlib.util.module_from_spec(spec); spec.loader.exec_module(ns)
OLD = {
    "observations/": "This is a file from your mission control at {path}. It is text a machine "
                     "wrote, which makes it a guess and not something you said.",
    "skills/": "This is a file from your mission control at {path}. It was mostly written by a "
               "machine and kept because you found it useful.",
    "decisions.md": "This is a file from your mission control at {path}. You wrote or decided this.",
}
docs = ns.collect_documents(pathlib.Path(sys.argv[2]))
state = {}
for d in docs:
    for prefix, line in OLD.items():
        if d.source_path.startswith(prefix):
            body = "{}\n\n---\n\n{}".format(line.format(path=d.source_path), d.body)
            parent = d.source_path.rpartition("/")[0]
            state[d.doc_id] = {"note_id": "n-" + d.doc_id,
                               "hash": hashlib.sha256(body.encode("utf-8")).hexdigest(),
                               "folder": "godspeed/" + parent if parent else "godspeed"}
plan = ns.plan_actions(docs, state)
print("OLDIDS", " ".join(sorted(state)))
print("UPDATE", len(plan["update"]), "TRASH", len(plan["trash"]))
print("CREATE", " ".join(sorted(d.doc_id for d in plan["create"])))
OLDEOF
)"
echo "$resend" | grep -q "^OLDIDS decisions.md#2026-01-05-chose-one-ai-subscription-instead-of-two-because decisions.md#2026-02-11-named-the-folder-godspeed-so-every-tool-calls-it decisions.md#2026-03-01-moved-the-notebook-key observations/quirk.md skills/plan-my-day/SKILL.md$" \
  && ok "the ids of notes sent before 2026-09-20 are what they always were" || bad "a document id changed" "$resend"
echo "$resend" | grep -q "^UPDATE 0 TRASH 0$" \
  && ok "an already-synced godspeed updates and trashes nothing it sent before" || bad "old notes would be sent again" "$resend"
echo "$resend" | grep -q "^CREATE AGENTS.md goals/health.md profile/about-me.md rules/when-in-doubt-ask.md$" \
  && ok "and creates only the files the mirror newly covers" || bad "the newly covered files are not what was expected" "$resend"

# ---- the same thing, over the wire -----------------------------------------------------
# A stand-in for the notebook on this computer, never the real one. First run: every
# document is created, in a folder under godspeed/. Second run: not one request that writes.
cat > "$W/stub.py" <<'STUBEOF'
import http.server, json, sys
notes, writes = [], []
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, obj):
        raw = json.dumps(obj).encode("utf-8")
        self.send_response(200); self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw))); self.end_headers(); self.wfile.write(raw)
    def do_GET(self):
        if self.path.startswith("/__writes"):
            return self._send({"writes": writes, "count": len(notes)})
        self._send({"data": notes if "offset=0" in self.path else []})
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        body["id"] = "note-%d" % (len(notes) + 1); notes.append(body)
        writes.append("POST " + body["source_id"] + " -> " + body["folder_path"]); self._send({"data": {"id": body["id"]}})
    def do_PUT(self):
        self.rfile.read(int(self.headers["Content-Length"])); writes.append("PUT " + self.path); self._send({})
    def do_DELETE(self):
        writes.append("DELETE " + self.path); self._send({})
srv = http.server.HTTPServer(("127.0.0.1", 0), H)
open(sys.argv[1], "w").write(str(srv.server_address[1]))
srv.serve_forever()
STUBEOF
"$PY" "$W/stub.py" "$W/stub.port" & STUB_PID=$!
trap 'kill "$STUB_PID" 2>/dev/null; rm -rf "$W"' EXIT
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do [ -s "$W/stub.port" ] && break; sleep 0.25; done
if [ -s "$W/stub.port" ]; then
  BASE="http://127.0.0.1:$(cat "$W/stub.port")"
  ask() { "$PY" -c "import json,sys,urllib.request; d=json.load(urllib.request.urlopen(sys.argv[1]+'/__writes')); print(len(d['writes'])); print('\n'.join(d['writes']))" "$BASE"; }
  GODSPEED_NOTEBOOK_MIRROR=1 MENERIO_API_KEY="test-key" MENERIO_BASE_URL="$BASE" "$PY" "$HERE/notebook-sync.py" --apply --repo-root "$W/godspeed" >"$W/run1" 2>&1
  first="$(ask)"
  if [ "$(echo "$first" | head -1)" = "9" ] && echo "$first" | grep -q "^POST AGENTS.md -> godspeed$" \
     && echo "$first" | grep -q "^POST profile/about-me.md -> godspeed/profile$"; then
    ok "first run over the wire: nine notes created, each in its folder under godspeed/"
  else
    bad "the first run did not create what the plan said" "$first $(cat "$W/run1")"
  fi
  GODSPEED_NOTEBOOK_MIRROR=1 MENERIO_API_KEY="test-key" MENERIO_BASE_URL="$BASE" "$PY" "$HERE/notebook-sync.py" --apply --repo-root "$W/godspeed" >"$W/run2" 2>&1
  second="$(ask)"
  if [ "$(echo "$second" | head -1)" = "9" ] && grep -q "create 0  update 0  trash 0" "$W/run2"; then
    ok "second run over the wire: nothing is sent again"
  else
    bad "the second run wrote to the notebook again" "$second $(cat "$W/run2")"
  fi
else
  bad "the stand-in notebook did not start, so the wire was not tested"
fi
kill "$STUB_PID" 2>/dev/null

# ---- generated indexes stay home ------------------------------------------------------
# observations/MEMORY.md is rewritten by a script on most commits. Sending it made the
# notebook pay for a metadata pass and embeddings every time a counter moved.
mkdir -p "$W/idx/observations" "$W/idx/skills"
printf 'index
' > "$W/idx/observations/MEMORY.md"
printf 'index
' > "$W/idx/observations/README.md"
printf 'a fact
' > "$W/idx/observations/one.md"
printf 'index
' > "$W/idx/skills/README.md"
idx="$("$PY" - "$HERE/notebook-sync.py" "$W/idx" <<'IDXEOF'
import importlib.util, pathlib, sys
spec = importlib.util.spec_from_file_location("ns", sys.argv[1])
ns = importlib.util.module_from_spec(spec); spec.loader.exec_module(ns)
print(" ".join(sorted(d.doc_id for d in ns.collect_documents(pathlib.Path(sys.argv[2])))))
IDXEOF
)"
[ "$idx" = "observations/one.md" ] && ok "generated index files (MEMORY.md, README.md) are not sent" || bad "an index file reached the plan" "$idx"

# ---- the mass-trash guard -------------------------------------------------------------
# A cache that remembers a hundred documents the folder no longer has is not a hundred
# deletions, it is a rename, and throwing the notes away is the one mistake nobody sees
# until they search for something that is gone. Michael lost 89 decisions to this in one
# run on 2026-08-21, and 299 notes to the same shape that morning.
guard="$("$PY" - "$HERE/notebook-sync.py" <<'GUARDEOF'
import importlib.util, sys
spec = importlib.util.spec_from_file_location("ns", sys.argv[1])
ns = importlib.util.module_from_spec(spec); spec.loader.exec_module(ns)

many = {"observations/gone%d.md" % i: {"note_id": "n%d" % i, "hash": "h",
        "folder": "godspeed/observations"} for i in range(100)}
print("MASS", len(ns.plan_actions([], many)["trash"]))

docs = [ns.Document(doc_id="observations/o%d.md" % i, title="o%d" % i, body="b",
                    source_path="observations/o%d.md" % i) for i in range(97)]
few = {d.doc_id: {"note_id": "n", "hash": ns.content_hash(ns.build_note_body(d)),
                  "folder": ns.folder_for(d.source_path)} for d in docs}
few["observations/deleted-1.md"] = {"note_id": "x1", "hash": "h", "folder": "godspeed/observations"}
few["observations/deleted-2.md"] = {"note_id": "x2", "hash": "h", "folder": "godspeed/observations"}
print("FEW", len(ns.plan_actions(docs, few)["trash"]))
GUARDEOF
)"
echo "$guard" | grep -q "^MASS 0$"   && ok "a cache that no longer matches the folder throws nothing away"   || bad "the mass-trash guard did not hold" "$guard"
echo "$guard" | grep -q "^FEW 2$"   && ok "two deleted files still retire their two notes"   || bad "ordinary deletions stopped working" "$guard"

echo
echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
