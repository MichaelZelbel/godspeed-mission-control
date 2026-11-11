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
# holds (#282): a naive run that proposes an interview the person postponed (its APPLY is
# FAKE_APPLY, its TOUCHES FAKE_TOUCHES) beside a note to Jane Doe, and lists both on its card
# (FAKE_CARD, when it words the card itself) and its Moves list (FAKE_MOVES). FAKE_PROMPTS keeps each prompt.
# FAKE_FULL=1 gives both moves every field the moves check asks for, so only the held one is short;
# with FAKE_ACTIVE=1 the goal book is active too, and two moves are fewer than it needs (#405).
cat > "$BIN/claude" <<'STAND'
#!/usr/bin/env bash
prompt="$(cat)"
mode="${FAKE_MODE:-writes}"
case "$prompt" in *"the moves check"*) mode="${FAKE_FIX_MODE:-answers}" ;; esac
echo "$mode" >> "$FAKE_CALLS"
[ -z "${FAKE_PROMPTS:-}" ] || printf '%s\n' "$prompt" >> "$FAKE_PROMPTS"
case "$mode" in
  writes)  printf '# Decision\n\n## For you today\nNothing needs you today.\n' > "$FAKE_RUN/decision.md"
           [ "${FAKE_ACTIVE:-0}" = 1 ] && printf 'Attention for the test\nactive:\n  money-goal    outcome    deadline in 3 day(s)\n' > "$FAKE_RUN/attention.txt"
           echo "Nothing needs you today. nothing" ;;
  holds)   card='ship-list card: 1. Answer Podcast X'"'"'s interview invitation about the book; 2. Send the launch note to Jane Doe'
           printf '# Decision\n\n## For you today\n%s\n\n## Moves\n%s\n' "${FAKE_CARD:-$card}" "${FAKE_MOVES:-Two.}" > "$FAKE_RUN/decision.md"
           full=''; [ "${FAKE_FULL:-0}" = 1 ] && full='WHERE: x\nNOW: x\nAFTER: x\nWHO DID THIS: Ann Lee did this\nUNDO: x\n'
           [ "${FAKE_ACTIVE:-0}" = 1 ] && printf 'Attention for the test\nactive:\n  book    outcome    deadline in 3 day(s)\n' > "$FAKE_RUN/attention.txt"
           printf '### 1. Answer Podcast X'"'"'s interview invitation about the book\nAPPLY: %s\nTOUCHES: %s\nGOAL: book\nPERMISSION: ship list\nHOW IT LANDS: only the person\n'"$full"'\n### 2. Send the launch note to Jane Doe\nAPPLY: W-NOTE-01\nTOUCHES: jane-doe\nGOAL: book\nPERMISSION: ship list\nHOW IT LANDS: the mission control sends it\n'"$full" "$FAKE_APPLY" "${FAKE_TOUCHES:-the-book}" > "$FAKE_RUN/moves.md"
           echo "Two changes are ready. ship-list card" ;;
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

echo "-- a step the person postponed is held off the day, and comes back when its condition ends (#282)"
mkdir -p "$G/world/claims"
printf -- '---\nsubject: the-book\nattribute: status\nvalue: beta\nvalid_from: 2026-09-01\n---\n' > "$G/world/claims/the-book--status--2026-09-01.md"
printf -- '---\nsubject: the-book\nattribute: interview-stance\nvalue: not yet, only once the book is out of beta\nstance: postponed\nsteps: [interview]\nuntil: the-book--status--2026-09-01\nvalid_from: 2026-09-10\n---\n' > "$G/world/claims/the-book--interview-stance--2026-09-10.md"
HOLD=world/claims/the-book--interview-stance--2026-09-10.md
GODSPEED_ROOT="$G" GODSPEED_TODAY="$D" "$NODE" "$HERE/work.js" file --id W-HELD-01 --what "Answer Podcast X's interview invitation about the book" --done-when "sent" --outward yes --key apply-answer-interview --source next-action >/dev/null
fresh; PROMPTS="$TMP/prompts.txt"; rm -f "$PROMPTS"
OUT="$(FAKE_MODE=holds FAKE_APPLY=W-HELD-01 FAKE_PROMPTS="$PROMPTS" decide)"; RC=$?
check "  the day is decided" "$RC" "0"
contains "  holds.txt names the claim" "$(cat "$RUN/holds.txt" 2>/dev/null)" "$HOLD: postponed"
contains "  and the run is told to read it" "$(head -c 2000 "$PROMPTS" 2>/dev/null)" "holds.txt (what the person declined or postponed"
missing "  the interview move is out of moves.md" "$(cat "$RUN/moves.md")" "### 1. Answer Podcast X"
contains "  with a HELD line in its place" "$(cat "$RUN/moves.md")" "HELD 1: Answer Podcast X's interview invitation about the book (held by $HOLD)"
contains "  the Jane Doe move stays" "$(cat "$RUN/moves.md")" "### 2. Send the launch note to Jane Doe"
contains "  held.md keeps the block and the claim" "$(cat "$RUN/held.md" 2>/dev/null)" "held by $HOLD: postponed"
contains "  held.md keeps the block itself" "$(cat "$RUN/held.md" 2>/dev/null)" "### 1. Answer Podcast X"
check "  the card keeps every other line as the run wrote it" "$(sed -n '/^## For you today/{n;p;}' "$RUN/decision.md")" "ship-list card: 1. (held back: you postponed this, $HOLD); 2. Send the launch note to Jane Doe"
contains "  the output names the held move and the claim" "$OUT" "held: move 1 \"Answer Podcast X's interview invitation about the book\" by $HOLD"
contains "  and the held card" "$OUT" "held: W-HELD-01 "
contains "  the APPLY card now names what it touches" "$(cat "$G/work/W-HELD-01.md")" "TOUCHES: the-book"
fresh; OUT="$(FAKE_MODE=holds FAKE_APPLY=W-HELD-01 FAKE_TOUCHES="$(printf 'jane-doe,\n         the-book')" decide)"
missing "  a TOUCHES line the run wrapped onto a second line is read whole: the move is out" "$(cat "$RUN/moves.md")" "### 1. Answer Podcast X"
contains "  and named on the output" "$OUT" "held: move 1 "
for_you() { sed -n '/^## For you today/,/^## Moves/{/^## /d;p;}' "$RUN/decision.md"; }
QUESTION='How many copies sold this week? (the book has no number read today)'
fresh; FAKE_MODE=holds FAKE_APPLY=W-HELD-01 FAKE_CARD="$(printf 'ship-list card: 1. Say yes to the podcast; 2. Send the launch note to Jane Doe; 3. Fix the shop link (carried)\n%s' "$QUESTION")" decide >/dev/null
check "  a card that names the held move in other words keeps every line as the run wrote it" "$(for_you | sed -n 1,2p)" "$(printf 'ship-list card: 1. Say yes to the podcast; 2. Send the launch note to Jane Doe; 3. Fix the shop link (carried)\n%s' "$QUESTION")"
contains "  and says the held step is not applied" "$(for_you)" "Held back: move 1 of moves.md is a step you postponed ($HOLD); if this card names it in other words, it is not applied."
fresh; FAKE_MODE=holds FAKE_APPLY=W-HELD-01 FAKE_CARD="$(printf "ship-list card: 1. Answer Podcast X's interview invitation about the bookshop; 2. Answer Podcast X's interview invitation about the book; 3. Fix the shop link (carried)\n%s" "$QUESTION")" decide >/dev/null
check "  only the held title as whole words is taken off; a line it begins, a carried line and the weekly question stay" "$(for_you | sed -n 1,2p)" "$(printf "ship-list card: 1. Answer Podcast X's interview invitation about the bookshop; 2. (held back: you postponed this, %s); 3. Fix the shop link (carried)\n%s" "$HOLD" "$QUESTION")"
missing "  with no Held back line when the title was found" "$(for_you)" "Held back:"
fresh; FAKE_MODE=holds FAKE_APPLY=W-HELD-01 FAKE_CARD="$(printf "ship-list card: 1. Answer Podcast X's interview invitation about the book with a short thank-you; 2. Answer Podcast X's interview invitation about the book (carried)\n%s" "$QUESTION")" decide >/dev/null
check "  a longer line that begins with the held title stays; the held item itself is taken off" "$(for_you | sed -n 1,2p)" "$(printf "ship-list card: 1. Answer Podcast X's interview invitation about the book with a short thank-you; 2. (held back: you postponed this, %s) (carried)\n%s" "$HOLD" "$QUESTION")"
missing "  and no Held back line is added" "$(for_you)" "Held back:"
fresh; FAKE_MODE=holds FAKE_APPLY=W-HELD-01 FAKE_CARD="$(printf "ship-list card: 1. Draft and answer Podcast X's interview invitation about the book; 2. Re-answer Podcast X's interview invitation about the book; 3. Answer Podcast X's interview invitation about the book\n%s" "$QUESTION")" decide >/dev/null
check "  a longer line that ends with the held title stays; the held item itself is taken off" "$(for_you | sed -n 1,2p)" "$(printf "ship-list card: 1. Draft and answer Podcast X's interview invitation about the book; 2. Re-answer Podcast X's interview invitation about the book; 3. (held back: you postponed this, %s)\n%s" "$HOLD" "$QUESTION")"
missing "  and no Held back line is added" "$(for_you)" "Held back:"
fresh; FAKE_MODE=holds FAKE_APPLY=W-HELD-01 FAKE_CARD="$(printf "ship-list card: 1. Answer Podcast X's interview invitation about the book (a short thank-you); 2. Answer Podcast X's interview invitation about the book\n%s" "$QUESTION")" decide >/dev/null
check "  an item with the held title and a remark of its own stays when the held item stands plain" "$(for_you | sed -n 1,2p)" "$(printf "ship-list card: 1. Answer Podcast X's interview invitation about the book (a short thank-you); 2. (held back: you postponed this, %s)\n%s" "$HOLD" "$QUESTION")"
fresh; FAKE_MODE=holds FAKE_APPLY=W-HELD-01 FAKE_CARD="ship-list card: 1. Draft and answer Podcast X's interview invitation about the book" decide >/dev/null
check "  a card where the held title only ends a longer item keeps it" "$(for_you | sed -n 1p)" "ship-list card: 1. Draft and answer Podcast X's interview invitation about the book"
contains "  and says the held step is not applied" "$(for_you)" "Held back: move 1 of moves.md is a step you postponed ($HOLD)"
fresh; FAKE_MODE=holds FAKE_APPLY=W-HELD-01 FAKE_MOVES="$(printf "1. book: Answer Podcast X's interview invitation about the book (ship list)\n2. book: Send the launch note to Jane Doe (ship list)")" decide >/dev/null
check "  the decision's Moves list no longer has the held move, only the held-back mark" "$(sed -n '/^## Moves$/,/^## /{/^## /d;p;}' "$RUN/decision.md" | sed -n 1,2p)" "$(printf "1. book: (held back: you postponed this, %s)\n2. book: Send the launch note to Jane Doe (ship list)" "$HOLD")"
fresh; FAKE_MODE=holds FAKE_APPLY=W-HELD-01 decide >/dev/null
check "  a Moves list that words the held move otherwise keeps its lines and says it is held" "$(sed -n '/^## Moves$/,/^## /{/^## /d;p;}' "$RUN/decision.md")" "$(printf "Two.\nHeld back: move 1 of moves.md is a step you postponed (%s); if a line here names it in other words, it is not on the ship list." "$HOLD")"
echo "-- once a held move is taken out, the record and the card stop counting it (#405)"
movescheck() { sed -n '/^## Moves check$/,/^## /{/^## Moves check$/d;p;}' "$RUN/decision.md"; }
fresh; FAKE_MODE=holds FAKE_APPLY=W-HELD-01 FAKE_FULL=1 decide >/dev/null
check "  it was sent back once" "$(grep -c . "$CALLS")" "2"
check "  the held move was the only gap: the record has no Moves check" "$(movescheck)" ""
missing "  and never tells the run to take it out" "$(cat "$RUN/decision.md")" "take it out of moves.md"
fresh; FAKE_MODE=holds FAKE_APPLY=W-HELD-01 FAKE_FULL=1 FAKE_ACTIVE=1 decide >/dev/null
contains "  another gap still stands, counted on the moves that are left" "$(movescheck)" "book: 1 move(s), fewer than 3"
contains "  the person's count leaves the held move out" "$(movescheck)" "PERSON 0: none"
missing "  and the held move is not named" "$(movescheck)" "Answer Podcast X"
fresh; FAKE_MODE=holds FAKE_APPLY=W-HELD-01 decide >/dev/null
contains "  a move short of its fields is still listed as before" "$(movescheck)" "move \"2. Send the launch note to Jane Doe\": WHERE is missing or empty"
missing "  beside no word of the held one" "$(movescheck)" "Answer Podcast X"
fresh; FAKE_MODE=holds FAKE_APPLY=W-HELD-01 FAKE_CARD="WHAT: 3 changes are ready: 1. Answer Podcast X's interview invitation about the book; 2. Send the launch note to Jane Doe; 3. Fix the shop link (carried)" decide >/dev/null
check "  the card counts only the ready changes, and says how many are held back" "$(for_you | sed -n 1p)" "WHAT: 2 changes are ready, 1 held back: 1. (held back: you postponed this, $HOLD); 2. Send the launch note to Jane Doe; 3. Fix the shop link (carried)"
fresh; FAKE_MODE=holds FAKE_APPLY=W-HELD-01 FAKE_CARD="Two changes are ready: 1. Answer Podcast X's interview invitation about the book; 2. Send the launch note to Jane Doe" decide >/dev/null
check "  a count in words stays in words" "$(for_you | sed -n 1p)" "One change is ready, 1 held back: 1. (held back: you postponed this, $HOLD); 2. Send the launch note to Jane Doe"
fresh; FAKE_MODE=holds FAKE_APPLY=W-HELD-01 FAKE_CARD="WHAT: 2 changes are ready: 1. Say yes to the podcast; 2. Send the launch note to Jane Doe" decide >/dev/null
check "  a card that names the held move in other words keeps its count" "$(for_you | sed -n 1p)" "WHAT: 2 changes are ready: 1. Say yes to the podcast; 2. Send the launch note to Jane Doe"
NOCARD="$TMP/no-card"; mkdir -p "$NOCARD"
printf '# Decision\n\n## Moves\nOne.\n' > "$NOCARD/decision.md"
printf "### 1. Answer Podcast X's interview invitation about the book\nTOUCHES: the-book\n" > "$NOCARD/moves.md"
GODSPEED_ROOT="$G" "$NODE" "$HERE/holds.js" strip --run "$NOCARD" --date "$D" --godspeed "$G" >/dev/null
check "  a decision with no card gets one that says the step is held back" "$(sed -n '/^## For you today/,$p' "$NOCARD/decision.md")" "$(printf '## For you today\nHeld back: move 1 of moves.md is a step you postponed (%s); if this card names it in other words, it is not applied.' "$HOLD")"
contains "  and the rest of it stays" "$(cat "$NOCARD/decision.md")" "$(printf '## Moves\nOne.')"
mv "$G/world/claims" "$G/world/claims.away"; printf 'not a folder\n' > "$G/world/claims"
fresh; OUT="$(FAKE_MODE=holds FAKE_APPLY=W-HELD-01 decide)"; RC=$?
check "  holds that cannot be read: the day ends NOT clean" "$RC" "1"
contains "  and says why" "$OUT" "decided $D, but what the person declined or postponed could not be read"
contains "  the run is told it cannot tell" "$(cat "$RUN/holds.txt")" "holds NOT read:"
contains "  and the moves check says so" "$(GODSPEED_ROOT="$G" "$NODE" "$HERE/check-moves.js" --godspeed "$G" --date "$D" 2>&1)" "NOTE holds NOT read ("
rm -f "$G/world/claims"; mv "$G/world/claims.away" "$G/world/claims"
D2=2026-10-11
GODSPEED_ROOT="$G" "$NODE" "$HERE/holds.js" end the-book--status--2026-09-01 --words "the book is out of beta" --date "$D2" --godspeed "$G" >/dev/null
OUT="$(D="$D2" RUN="$G/routines/next-action/$D2"; GODSPEED_RUNNER=claude FAKE_MODE=holds FAKE_APPLY=W-HELD-01 FAKE_RUN="$RUN" FAKE_CALLS="$CALLS" bash "$HERE/mc-decide" --godspeed "$G" --date "$D2" --timeout 60 2>&1)"
contains "  the next day, with the book out of beta, the interview move is back" "$(cat "$G/routines/next-action/$D2/moves.md")" "### 1. Answer Podcast X"
missing "  and nothing is held" "$OUT" "held:"
contains "  holds.txt says so" "$(cat "$G/routines/next-action/$D2/holds.txt")" "nothing is held"

echo "-- a day decided ahead with --date: work.txt marks held by that day, not by today (#406)"
# The hold ended on $D2 (it held through 2026-10-10); today is 2026-10-09, before it ended.
T=2026-10-09
dated() { local day="$1"; shift; GODSPEED_TODAY="$T" GODSPEED_RUNNER=claude FAKE_MODE=holds FAKE_APPLY=W-HELD-01 FAKE_RUN="$G/routines/next-action/$day" FAKE_CALLS="$CALLS" bash "$HERE/mc-decide" --godspeed "$G" "$@" --timeout 60 2>&1; }
fresh; dated 2026-10-12 --date 2026-10-12 >/dev/null
missing "  a day after the hold ended: work.txt shows the step free" "$(grep W-HELD-01 "$G/routines/next-action/2026-10-12/work.txt" 2>/dev/null)" "held by"
contains "  (the step is in work.txt)" "$(cat "$G/routines/next-action/2026-10-12/work.txt" 2>/dev/null)" "W-HELD-01"
contains "  as holds.txt for that day says" "$(cat "$G/routines/next-action/2026-10-12/holds.txt")" "nothing is held"
fresh; dated 2026-10-10 --date 2026-10-10 >/dev/null
contains "  a day still inside the hold: work.txt keeps the marker" "$(grep W-HELD-01 "$G/routines/next-action/2026-10-10/work.txt" 2>/dev/null)" "held by $HOLD"
contains "  as holds.txt for that day says" "$(cat "$G/routines/next-action/2026-10-10/holds.txt")" "$HOLD: postponed"
fresh; dated "$T" >/dev/null
contains "  a scheduled run (no --date) marks by today, as before" "$(grep W-HELD-01 "$G/routines/next-action/$T/work.txt" 2>/dev/null)" "held by $HOLD"

echo "-- a dry run for a day ahead lists Open work by that day, as its work.txt does (#432)"
openwork() { printf '%s\n' "$1" | sed -n '/^Open work/,/^$/p' | grep W-HELD-01; }
registry() { (cd "$G" && find goals forecasts work world -type f 2>/dev/null | LC_ALL=C sort | xargs -r sha256sum); }
fresh; BEFORE="$(registry)"
OUT="$(dated 2026-10-12 --date 2026-10-12 --dry-run)"
contains "  (the step is listed under Open work)" "$(openwork "$OUT")" "W-HELD-01"
missing "  a day after the hold ended: Open work shows the step free" "$(openwork "$OUT")" "held by"
check "  and says what work.txt for that day says" "$(openwork "$OUT")" "$(grep W-HELD-01 "$G/routines/next-action/2026-10-12/work.txt")"
OUT="$(dated 2026-10-10 --date 2026-10-10 --dry-run)"
contains "  a day still inside the hold: Open work keeps the marker" "$(openwork "$OUT")" "held by $HOLD"
check "  and says what work.txt for that day says" "$(openwork "$OUT")" "$(grep W-HELD-01 "$G/routines/next-action/2026-10-10/work.txt")"
OUT="$(dated "$T" --dry-run)"
contains "  a dry run without --date marks by today, as before" "$(openwork "$OUT")" "held by $HOLD"
check "  the dry runs changed nothing in the registry" "$(registry)" "$BEFORE"
contains "  (the registry was there to compare)" "$BEFORE" "work/W-HELD-01.md"
check "  and decided nothing" "$(ls "$G/routines/next-action/2026-10-12/decision.md" 2>/dev/null)" ""
fresh
rm -rf "$G/world" "$G/work"

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
