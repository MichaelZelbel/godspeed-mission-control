#!/usr/bin/env bash
# The two sync arrows and their runner: what must stay quiet, and what must never happen.
#
# WHY THIS FILE IS HERE. tools/notebook-sync.py, tools/world-pull.py and mc-notebook-sync
# are what Chapter 26 means by the notebook keeping itself current. They run unattended,
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

# 8. No mission control recorded on this computer: silent, exit 0. This is most readers' machines
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

# 10 to 13. The dry run keeps the book's promise, offline: "It sends observations/,
# skills/, and each decision in decisions.md as its own entry. It does not send
# profile/ or AGENTS.md." No key and no --apply, so nothing leaves the machine.
# The visible skills/ is the room since the Hermes switch (2026-09-02); .claude/skills
# is a link the installer makes, and on an older mission control it may still be the only room.
mkdir -p "$W/godspeed/observations" "$W/godspeed/skills/plan-my-day" "$W/godspeed/profile"
printf 'You proofread before sending.\n' > "$W/godspeed/observations/quirk.md"
printf '# Plan my day\n'                 > "$W/godspeed/skills/plan-my-day/SKILL.md"
printf '# About me\n'                    > "$W/godspeed/profile/about-me.md"
printf '# Manual\n'                      > "$W/godspeed/AGENTS.md"
cat > "$W/godspeed/decisions.md" <<'DECEOF'
# Decisions

- (2026-01-05) Chose one AI subscription instead of two, because the best
  tool is the one I open daily.
- 2026-02-11 Named the folder mission control, so every tool calls it the same thing.

## 2026-03-01 Moved the notebook key
Why: one key, one off-switch.
DECEOF

plan="$(MENERIO_API_KEY="" "$PY" "$HERE/notebook-sync.py" --repo-root "$W/godspeed" 2>&1)"

echo "$plan" | grep -q "would create observations/quirk.md" \
  && ok "observations/ is sent" || bad "observations/ was not in the plan" "$plan"
echo "$plan" | grep -q "would create skills/plan-my-day/SKILL.md" \
  && ok "the visible skills/ is sent" || bad "skills/ was not in the plan" "$plan"

# An older mission control that has not been topped up keeps its recipes in .claude/skills only.
# It must still be sent, or a reader who skipped the re-run loses their recipes from
# the notebook without a word.
mkdir -p "$W/oldgodspeed/.claude/skills/plan-my-day"
printf '# Plan my day\n' > "$W/oldgodspeed/.claude/skills/plan-my-day/SKILL.md"
oldplan="$(MENERIO_API_KEY="" "$PY" "$HERE/notebook-sync.py" --repo-root "$W/oldgodspeed" 2>&1)"
echo "$oldplan" | grep -q "would create .claude/skills/plan-my-day/SKILL.md" \
  && ok "an older mission control's .claude/skills/ is still sent" || bad "the older mission control's recipes were not in the plan" "$oldplan"

n="$(echo "$plan" | grep -c "would create decisions.md#")"
if [ "$n" = "3" ]; then
  ok "each decision is its own entry: two bullets and a heading make three"
else
  bad "expected 3 decision entries, the plan holds $n" "$plan"
fi

if echo "$plan" | grep -q "profile/\|AGENTS.md"; then
  bad "profile/ or AGENTS.md reached the plan, and the book promises they never do" "$plan"
else
  ok "profile/ and AGENTS.md are not sent"
fi

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
