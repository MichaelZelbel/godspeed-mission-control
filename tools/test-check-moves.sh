#!/usr/bin/env bash
# The gate for mc-check-moves: a decision with too few moves, an empty field, or the mission
# control's own work passed off as "who did this" fails; a full one, or one that says why a goal
# has fewer, passes. Runs in a throwaway godspeed root.
# Usage: bash tools/test-check-moves.sh
set -uo pipefail
. "$(dirname "$0")/test-guard.bash"
HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP" "$TEST_GUARD_HOME"' EXIT
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
# Found by a test reader on Hermes (2026-09-30): a brand-new goal got no moves "because the
# playbook is a draft". The recipe answers that too: read two or three real cases today.
{ move 1 money-goal "Simon Willison" "x"; move 2 money-goal "a" "y"; move 3 money-goal "b" "z"; echo "FEWER health-goal: playbook is draft (STATUS: draft); the recipe forbids working a goal without knowing how it is won"; } > "$RUN/moves.md"
OUT="$(run)"; case "$OUT" in *"not a reason for fewer"*) ok "a draft playbook is refused as the reason for fewer";; *) bad "draft playbook refused: $OUT";; esac
{ move 1 money-goal "Simon Willison" "x"; move 2 money-goal "a" "y"; move 3 money-goal "b" "z"; echo "FEWER health-goal: there is no playbook yet"; } > "$RUN/moves.md"
OUT="$(run)"; case "$OUT" in *"not a reason for fewer"*) ok "  and so is no playbook";; *) bad "no playbook refused: $OUT";; esac
{ move 1 money-goal "Simon Willison" "x"; move 2 money-goal "a" "y"; move 3 money-goal "b" "z"; echo "FEWER health-goal: the playbook's next rung is an invitation that waits on his answer of 2026-09-22"; } > "$RUN/moves.md"
OUT="$(run)"; [ $? -eq 0 ] && ok "  but a reason that only mentions the playbook stands" || bad "  playbook mention: $OUT"

# Found by a test reader on Hermes (2026-09-30): moves headed "### Move 1: ..." were invisible to
# the check, so FEWER lines covered them and not one field was checked (a bet with no APPLY got
# through, and no bet reached the goal card).
{ printf '## money-goal\n\n'; move 1 money-goal "Simon Willison" "x" | sed 's/^### 1\. /### Move 1: /'; move 2 money-goal "a" "y"; move 3 money-goal "b" "z"; echo "FEWER health-goal: the week's scale reading lands on Sunday"; } > "$RUN/moves.md"
OUT="$(run)"; case "$OUT" in *'heading "### <n>.'*) ok "a move without the numbered heading is found, not skipped";; *) bad "unnumbered heading: $OUT";; esac
{ move 1 money-goal "Simon Willison" "x"; move 2 money-goal "a" "y"; move 3 money-goal "b" "z" | sed 's/^### 3\. /#### Also: /'; echo "FEWER health-goal: the week's scale reading lands on Sunday"; } > "$RUN/moves.md"
OUT="$(run)"; case "$OUT" in *'heading "### <n>.'*) ok "  and two moves under one numbered heading are found too";; *) bad "two under one: $OUT";; esac

# --- the weekly number (2026-09-30) ----------------------------------------------------------
full() { move 1 money-goal "Simon Willison" "x"; move 2 money-goal "Justin Welsh" "y"; move 3 money-goal "swyx" "z"; echo "FEWER health-goal: the week's scale reading lands on Sunday"; }
full > "$RUN/moves.md"
OUT="$(run)"; [ $? -eq 0 ] && ok "a goal without a weekly number is checked as before (an older recipe keeps working)" || bad "no LEAD, old rules: $OUT"
printf 'ID: money-goal\nKIND: outcome\nSTATUS: adopted\nLEAD: people who join the newsletter | total | subscriber mails\n\n## Log\n- 2026-09-10 READ 2 (subscriber mails)\n' > "$TMP/goals/money-goal.md"
OUT="$(run)"; case "$OUT" in *'needs a line "BET:'*) ok "a move for a goal with a weekly number needs a BET";; *) bad "BET required: $OUT";; esac
case "$OUT" in *"not read in the last seven days"*) ok "  and a reading older than seven days fails";; *) bad "  stale reading: $OUT";; esac
printf -- '- 2026-09-23 READ 2 (subscriber mails)\n' >> "$TMP/goals/money-goal.md"
for i in 1 2 3; do printf 'ID: W-20260924-0%s\nSTATUS: blocked\n\n## Log\n' "$i" > "$TMP/work/W-20260924-0$i.md"; done
# Found by the final review (2026-09-30): a placeholder APPLY passed, and its bet never reached the card.
full | awk '{print} /^GOAL:/{print "BET: 2 -> 4"}' | sed 's/^APPLY: W-20260924-01$/APPLY: (filed below)/' > "$RUN/moves.md"
OUT="$(run)"; case "$OUT" in *"names no work item on the register"*) ok "a bet whose APPLY names no filed work item fails";; *) bad "placeholder APPLY: $OUT";; esac
full | awk '{print} /^GOAL:/{print "BET: 2 -> 4"}' | sed 's/^APPLY: W-20260924-01$/APPLY:/' > "$RUN/moves.md"
OUT="$(run)"; case "$OUT" in *'needs "APPLY'*) ok "  and an empty APPLY line is no APPLY line";; *) bad "empty APPLY: $OUT";; esac
full | awk '{print} /^GOAL:/{print "BET: 2 -> 4 within seven days of going live"}' > "$RUN/moves.md"
OUT="$(run)"; [ $? -eq 0 ] && ok "every move with a BET, and a reading this week, passes" || bad "BET passes: $OUT"
full | awk '{print} /^GOAL:/{print "BET: 2 → 4"}' > "$RUN/moves.md"
OUT="$(run)"; [ $? -eq 0 ] && ok "  the arrow may be →" || bad "  unicode arrow: $OUT"
# Found by the replay of 2026-09-30: moves that bet on no change ("2 -> 2, this one bets on a reply").
full | awk '{print} /^GOAL:/{n++; print (n==2 ? "BET: 2 -> 2 (held, not a one-off)" : "BET: 2 -> 4")}' > "$RUN/moves.md"
OUT="$(run)"; case "$OUT" in *"bets on no change"*) ok "a bet of no change is refused: it is not a move for this goal";; *) bad "no-change bet: $OUT";; esac
full | awk '{print} /^GOAL:/{print "BET: 2.0 -> 2"}' > "$RUN/moves.md"
OUT="$(run)"; case "$OUT" in *"bets on no change"*) ok "  also when written 2.0 -> 2";; *) bad "  2.0 -> 2: $OUT";; esac
full | awk '{print} /^GOAL:/{print "BET: 2 -> 4"}' | grep -v '^APPLY' > "$RUN/moves.md"
OUT="$(run)"; case "$OUT" in *'a move with a bet needs "APPLY'*) ok "a bet without its APPLY item fails, even off the ship list";; *) bad "APPLY for bets: $OUT";; esac
full | awk '{print} /^GOAL:/{print "BET: 2 -> 4"}' > "$RUN/moves.md"
printf 'Weekly numbers on %s.\nread today: money-goal\n' "$D" > "$RUN/settle.txt"
OUT="$(run)"; case "$OUT" in *"a verdict is due today"*) ok "a goal named under read today needs a reading dated today";; *) bad "read today: $OUT";; esac
printf -- '- %s READ 3 (subscriber mails)\n' "$D" >> "$TMP/goals/money-goal.md"
OUT="$(run)"; [ $? -eq 0 ] && ok "  and passes once it has one" || bad "  read today passes: $OUT"
rm -f "$RUN/settle.txt"
printf 'ID: money-goal\nKIND: outcome\nSTATUS: adopted\nLEAD: runs this week | per week | the person tells it\n\n## Log\n- 2026-09-20 CHANGED LEAD "" -> "runs this week | per week | the person tells it" because test\n' > "$TMP/goals/money-goal.md"
OUT="$(run)"; [ $? -eq 0 ] && ok "a weekly number set in the last seven days may wait for its first reading" || bad "grace for a new LEAD: $OUT"
printf 'ID: money-goal\nKIND: outcome\nSTATUS: adopted\nLEAD: runs this week | per week | the person tells it\n\n## Log\n- 2026-09-10 CHANGED LEAD "" -> "runs this week | per week | the person tells it" because test\n' > "$TMP/goals/money-goal.md"
OUT="$(run)"; case "$OUT" in *"not read in the last seven days"*) ok "  but not for longer than a week";; *) bad "  grace ends: $OUT";; esac
# Found by the final review (2026-09-30): a number only the person can tell, not told this week,
# had no honest way through; the pressure was to re-record an old value as today's reading.
{ full | awk '{print} /^GOAL:/{print "BET: 2 -> 4"}'; echo "UNREAD money-goal: asked on the card of 2026-09-22 and again today, no answer yet"; } > "$RUN/moves.md"
for i in 1 2 3; do [ -f "$TMP/work/W-20260924-0$i.md" ] || printf 'ID: W-20260924-0%s\nSTATUS: blocked\n\n## Log\n' "$i" > "$TMP/work/W-20260924-0$i.md"; done
OUT="$(run)"; [ $? -eq 0 ] && ok "a number the person has not told passes with an UNREAD line that says where it was asked" || bad "UNREAD line: $OUT"
printf 'Weekly numbers on %s.\nread today: money-goal\n' "$D" > "$RUN/settle.txt"
OUT="$(run)"; [ $? -eq 0 ] && ok "  also when a verdict is due today" || bad "  UNREAD with read today: $OUT"
rm -f "$RUN/settle.txt"
{ full | awk '{print} /^GOAL:/{print "BET: 2 -> 4"}'; echo "UNREAD money-goal:"; } > "$RUN/moves.md"
OUT="$(run)"; case "$OUT" in *"not read in the last seven days"*) ok "  but an UNREAD line with no reason does not count";; *) bad "  empty UNREAD: $OUT";; esac

echo; echo "$PASS passed, $FAIL failed"; [ "$FAIL" -eq 0 ]
