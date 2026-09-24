#!/usr/bin/env bash
# The gate for mc-check-moves: a decision with too few moves, an empty field, or the mission
# control's own work passed off as "who did this" fails; a full one, or one that says why a goal
# has fewer, passes. Runs in a throwaway godspeed root.
# Usage: bash tools/test-check-moves.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
D=2026-09-24; RUN="$TMP/routines/next-action/$D"
mkdir -p "$RUN" "$TMP/goals" "$TMP/work/plans"
cat > "$RUN/attention.txt" <<'EOF'
Attention for 2026-09-24
active:
  money-goal                         outcome     deadline in 3 day(s)
    under it: kits (strategy): deadline in 3 day(s)
  health-goal                        outcome     nothing pressing
quiet today:
  friends                            outcome     quiet today
EOF
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
run() { node "$HERE/check-moves.js" --godspeed "$TMP" --date "$D" 2>&1; }
move() { # n goal who after
  cat <<EOF
### $1. Change something for $2
APPLY: W-20260924-0$1
GOAL: $2
WHERE: https://example.org/profile
NOW: "old line"
AFTER: $4
WHO DID THIS: $3
HOW IT LANDS: API, CHECK curl the page
UNDO: put the old line back
PERMISSION: ship list
EOF
}
echo "mc-check-moves gate"

OUT="$(run)"; [ $? -eq 1 ] && ok "no moves file fails" || bad "no moves file fails"

{ move 1 money-goal "Simon Willison, his profile README, read today" "the new line"; } > "$RUN/moves.md"
OUT="$(run)"; [ $? -eq 1 ] && ok "one move for a goal that needs three fails" || bad "one move fails"
case "$OUT" in *"health-goal: 0 move(s)"*) ok "  and names the goal with none";; *) bad "  names the goal with none: $OUT";; esac
case "$OUT" in *friends*) bad "  a quiet goal is not counted";; *) ok "  a quiet goal is not counted";; esac

{ move 1 money-goal "his own best video" "x"; move 2 money-goal "a" "y"; move 3 money-goal "b" "z"; echo "FEWER health-goal: waiting on the scale reading"; } > "$RUN/moves.md"
OUT="$(run)"; case "$OUT" in *"WHO DID THIS must name somebody outside"*) ok "the person's own work as the example fails";; *) bad "own work as example: $OUT";; esac

{ move 1 money-goal "Simon Willison" "work/plans/missing.md"; move 2 money-goal "a" "y"; move 3 money-goal "b" "z"; echo "FEWER health-goal: waiting"; } > "$RUN/moves.md"
OUT="$(run)"; case "$OUT" in *"not there or empty"*) ok "an AFTER pointing at a missing file fails";; *) bad "missing AFTER file: $OUT";; esac

{ move 1 money-goal "Simon Willison" "x" | grep -v '^UNDO'; move 2 money-goal "a" "y"; move 3 money-goal "b" "z"; echo "FEWER health-goal: waiting"; } > "$RUN/moves.md"
OUT="$(run)"; case "$OUT" in *"UNDO is missing"*) ok "a missing field fails and is named";; *) bad "missing field: $OUT";; esac

echo "the full plan, written out" > "$TMP/work/plans/readme.md"; echo "with enough words in it to count as a file" >> "$TMP/work/plans/readme.md"
{ move 1 money-goal "Simon Willison" "work/plans/readme.md"; move 2 money-goal "Justin Welsh" "y"; move 3 money-goal "swyx" "z"; echo "FEWER health-goal: the week's scale reading lands on Sunday"; } > "$RUN/moves.md"
OUT="$(run)"; [ $? -eq 0 ] && ok "three full moves, and a reason for fewer, pass" || bad "full set passes: $OUT"
case "$OUT" in *"money-goal 3"*"health-goal 0 (fewer: said why)"*) ok "  and the count is printed";; *) bad "  count printed: $OUT";; esac

{ move 1 money-goal "Simon Willison" "x"; move 2 money-goal "a" "y"; move 3 money-goal "b" "z"; echo "FEWER health-goal: the idea register is empty today"; } > "$RUN/moves.md"
OUT="$(run)"; case "$OUT" in *"not a reason for fewer"*) ok "a thin register is refused as the reason for fewer";; *) bad "thin register refused: $OUT";; esac
{ move 1 money-goal "Simon Willison" "x"; move 2 money-goal "a" "y"; move 3 money-goal "b" "z"; echo "FEWER health-goal: LinkedIn has no signed-in session"; } > "$RUN/moves.md"
OUT="$(run)"; case "$OUT" in *"not a reason for fewer"*) ok "a missing sign-in is refused as the reason for fewer";; *) bad "sign-in refused: $OUT";; esac

{ move 1 money-goal "Simon Willison" "x" | grep -v '^APPLY'; move 2 money-goal "a" "y"; move 3 money-goal "b" "z"; echo "FEWER health-goal: waiting"; } > "$RUN/moves.md"
OUT="$(run)"; case "$OUT" in *"no \"APPLY"*) ok "a ship-list move with no APPLY line fails";; *) bad "no APPLY: $OUT";; esac

{ move 1 money-goal "Simon Willison" "x"; move 2 money-goal "a" "y"; move 3 money-goal "b" "z"; printf 'FEWER health-goal: two moves prepared; a third was not ready.\nThe register holds fifty ideas to draw from tomorrow.\n'; } > "$RUN/moves.md"
OUT="$(run)"; case "$OUT" in *"not a reason for fewer"*) ok "a refused reason on the second line of FEWER is still read";; *) bad "second line read: $OUT";; esac
{ move 1 money-goal "Simon Willison" "x"; move 2 money-goal "a" "y"; move 3 money-goal "b" "z"; echo "FEWER health-goal: a third was not prepared in the time this run had"; } > "$RUN/moves.md"
OUT="$(run)"; case "$OUT" in *"not a reason for fewer"*) ok "running out of time is refused";; *) bad "time refused: $OUT";; esac

echo; echo "$PASS passed, $FAIL failed"; [ "$FAIL" -eq 0 ]
