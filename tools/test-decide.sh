#!/usr/bin/env bash
# test-decide.sh - the gate for how mc-decide ends a day (2026-10-11).
#
# WHY. On 8, 9, 10 and 11 October 2026 the server's daily decision died after about 35 seconds:
# Hermes could not start (a module missing after a half-finished update). mc-decide wrote its
# honest stand-in record, as it should, and then printed "decided" and exited 0. The job list
# read four good runs and nobody heard for four days. A run whose assistant did not finish is a
# failed run: the stand-in is still written, the line says NOT decided, and the exit code is 1,
# so the morning job check names it the same day.
#
# A stand-in plays the assistant (as claude); no model runs here. It sits in the throwaway home's
# .local/bin, which mc-decide and mc-run put first on the path, and this refuses to start if any
# other claude would answer: written after a first try of this test, given a home of the form
# C:/..., split the path at the colon and started the real assistant. Runs in a throwaway
# mission control.
# Usage: bash tools/test-decide.sh
set -uo pipefail
. "$(dirname "$0")/test-guard.bash"
HERE="$(cd "$(dirname "$0")" && pwd)"
NODE=""
for c in node nodejs /usr/local/bin/node /usr/bin/node; do
  "$c" -e '' >/dev/null 2>&1 && { NODE="$c"; break; }
done
[ -n "$NODE" ] || { echo "FAIL: no node on this box"; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP" "$TEST_GUARD_HOME"' EXIT
G="$TMP/godspeed"; D=2026-10-10; RUN="$G/routines/next-action/$D"; CALLS="$TMP/calls.txt"
BIN="$HOME/.local/bin"
mkdir -p "$G/rules" "$G/skills/next-action" "$BIN"
printf -- '---\nname: next-action\ndescription: the recipe, cut down for a test\n---\nDecide the day.\n' > "$G/skills/next-action/SKILL.md"

# THE STAND-IN ASSISTANT. FAKE_MODE picks what it does: writes (a record and an answer), crash
# (8 October: nothing written, a traceback, exit 1), silent (exit 0 and an answer, but no record),
# late (26 September: the record written, then the time limit, so no answer). The run sent back
# for its moves names the moves check, and plays FAKE_FIX_MODE instead (default: it answers).
# FAKE_ACTIVE=1 makes the first run leave a goal active and no moves, so the moves check fails.
cat > "$BIN/claude" <<'STAND'
#!/usr/bin/env bash
prompt="$(cat)"
mode="${FAKE_MODE:-writes}"
case "$prompt" in *"the moves check"*) mode="${FAKE_FIX_MODE:-answers}" ;; esac
echo "$mode" >> "$FAKE_CALLS"
case "$mode" in
  writes)  printf '# Decision\n\n## For you today\nNothing needs you today.\n' > "$FAKE_RUN/decision.md"
           [ "${FAKE_ACTIVE:-0}" = 1 ] && printf 'Attention for the test\nactive:\n  money-goal    outcome    deadline in 3 day(s)\n' > "$FAKE_RUN/attention.txt"
           echo "Nothing needs you today. nothing" ;;
  answers) echo "The moves are as far as they go today." ;;
  crash)   printf 'Traceback (most recent call last):\nModuleNotFoundError: No module named %s\n' "'ruamel'" >&2; exit 1 ;;
  silent)  echo "All done, the day is decided." ;;
  late)    printf '# Decision\n\n## For you today\nHalf a page.\n' > "$FAKE_RUN/decision.md"; echo "Terminated" >&2; exit 124 ;;
esac
exit 0
STAND
# On a server with the agent cage, mc-run hands the assistant to it; here the cage only runs it.
printf '#!/usr/bin/env bash\nwhile [ $# -gt 0 ] && [ "$1" != -- ]; do shift; done; shift; exec "$@"\n' > "$BIN/agent-cage"
chmod +x "$BIN/claude" "$BIN/agent-cage"

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
check()    { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (wanted [$3], got [$2])"; fi; }
contains() { case "$2" in *"$3"*) ok "$1";; *) bad "$1 (missing [$3] in: $(printf '%s' "$2" | tail -4 | cut -c1-200))";; esac; }
missing()  { case "$2" in *"$3"*) bad "$1 (should not contain [$3])";; *) ok "$1";; esac; }

case "$HOME" in *:*) echo "FAIL: the throwaway home $HOME has a colon in it, so it cannot go on the path; refusing to start an assistant"; exit 1;; esac
found="$(PATH="$BIN:/usr/local/bin:/usr/bin:/bin:$PATH" command -v claude)"
[ "$found" = "$BIN/claude" ] || { echo "FAIL: claude would be $found, not the stand-in; refusing to start a real assistant"; exit 1; }

decide() { GODSPEED_RUNNER=claude FAKE_RUN="$RUN" FAKE_CALLS="$CALLS" bash "$HERE/mc-decide" --godspeed "$G" --date "$D" --timeout 60 "$@" 2>&1; }
fresh() { rm -rf "$G/routines" "$CALLS"; }
said_decided() { printf '%s\n' "$1" | grep -c "^decided $D"; }
STANDIN="did not finish and wrote no record of its own"

echo "mc-decide gate"

echo "-- the assistant crashes before writing anything (8 to 11 October)"
fresh; OUT="$(FAKE_MODE=crash decide)"; RC=$?
check "  the run fails" "$RC" "1"
contains "  and says NOT decided" "$OUT" "NOT decided $D: the assistant did not finish"
contains "  and where the reason is" "$OUT" "answer.txt.stderr"
check "  it never says decided" "$(said_decided "$OUT")" "0"
contains "  the honest stand-in record is still written" "$(cat "$RUN/decision.md" 2>/dev/null)" "$STANDIN"
contains "  and the assistant's own words are kept beside it" "$(cat "$RUN/answer.txt.stderr" 2>/dev/null)" "No module named 'ruamel'"

echo "-- a retry that crashes the same way"
OUT="$(FAKE_MODE=crash decide)"; RC=$?
check "  fails again" "$RC" "1"
missing "  the stand-in is not taken for a decision" "$OUT" "already decided"
contains "  and says NOT decided again" "$OUT" "NOT decided $D"

echo "-- a retry that works"
OUT="$(decide)"; RC=$?
check "  decides, exit 0" "$RC" "0"
contains "  and says so" "$OUT" "decided $D: "
contains "  naming the record" "$OUT" "routines/next-action/$D/decision.md"
missing "  without a NOT" "$OUT" "NOT decided"
missing "  the stand-in is replaced by the real record" "$(cat "$RUN/decision.md")" "$STANDIN"
OUT="$(decide)"; RC=$?
check "  a third run the same day is a quiet exit 0" "$RC" "0"
contains "  that decides nothing twice" "$OUT" "already decided"

echo "-- the assistant ends well but writes no record"
fresh; OUT="$(FAKE_MODE=silent decide)"; RC=$?
check "  the run fails" "$RC" "1"
contains "  and says NOT decided" "$OUT" "NOT decided $D"
contains "  the stand-in is written" "$(cat "$RUN/decision.md")" "$STANDIN"

echo "-- the assistant writes the record, then runs out of time before its answer (26 September)"
fresh; OUT="$(FAKE_MODE=late decide)"; RC=$?
check "  the run fails" "$RC" "1"
contains "  and says the day is decided but the assistant did not finish" "$OUT" "decided $D, but the assistant did not finish"
missing "  it is not called NOT decided, because it was" "$OUT" "NOT decided"
contains "  the assistant's record is kept as it wrote it" "$(cat "$RUN/decision.md")" "Half a page."
missing "  with no stand-in over it" "$(cat "$RUN/decision.md")" "$STANDIN"

echo "-- the run sent back for its moves"
fresh; OUT="$(FAKE_ACTIVE=1 FAKE_FIX_MODE=answers decide)"; RC=$?
check "  it was sent back once" "$(grep -c . "$CALLS")" "2"
check "  an assistant that answered but stayed short is a decided day, exit 0" "$RC" "0"
contains "  with the shortfall in the record" "$(cat "$RUN/decision.md")" "Still short after one return run"
fresh; OUT="$(FAKE_ACTIVE=1 FAKE_FIX_MODE=crash decide)"; RC=$?
check "  an assistant that crashed on the way back fails the run" "$RC" "1"
contains "  and the line names that answer" "$OUT" "answer-moves.txt.stderr"
contains "  and says the day is decided but not finished" "$OUT" "decided $D, but the assistant did not finish"

echo "-- goals the person pinned for a trial reach the day's attention plan (final review I3)"
for g in a1 a2 a3 a4; do GODSPEED_ROOT="$G" GODSPEED_TODAY="$D" "$NODE" "$HERE/goals.js" file --kind outcome --title "Goal $g" --id "$g" --status adopted --source "test" >/dev/null 2>&1; done
fresh; decide >/dev/null
ACTIVE="$(sed -n '/^active:/,/^[^ ]/p' "$RUN/attention.txt")"
missing "  without a pin, a4 waits behind three seats" "$ACTIVE" "  a4 "
fresh; GODSPEED_ATTENTION_PIN=a4 decide >/dev/null
ACTIVE="$(sed -n '/^active:/,/^[^ ]/p' "$RUN/attention.txt")"
contains "  mc-decide hands GODSPEED_ATTENTION_PIN on: the pinned goal is active" "$ACTIVE" "  a4 "
check "  and first" "$(printf '%s\n' "$ACTIVE" | sed -n '2p' | awk '{print $1}')" "a4"
rm -f "$G/goals/a1.md" "$G/goals/a2.md" "$G/goals/a3.md" "$G/goals/a4.md"; rm -rf "$G/goals/research"

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
