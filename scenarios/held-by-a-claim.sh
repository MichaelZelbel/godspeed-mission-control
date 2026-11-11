#!/usr/bin/env bash
# PROVING SCENARIO OF 2.0.0-beta.21 (#282): a step the person postponed is not proposed again, and
# comes back by itself when the condition they named ends.
#
# What it proves: the person said "not yet, only once the book is out of beta" about an interview
# invitation, and it is a world claim (written with the installed mc-holds). The real daily
# decision (the installed mc-decide, its moves check and its hold step) then runs on a workspace
# this scenario seeds itself, with a carried interview step and a carried note to Jane Doe:
#   day 1   the interview is absent from the day's moves and from its card, the decision's output
#           names the claim that held the move and the carried step, and the register lists that
#           step as held by it; the Jane Doe move, its line on the card and its step are there and
#           not held
#   day 2   the book's beta claim was ended (mc-holds end): the interview move is back, nothing is
#           held, and the card is not held back
#
# THE ASSISTANT IS A STAND-IN. The decision's own run is a model's; here a stand-in `claude` writes
# what a naive run writes (it proposes the interview and the Jane Doe note and lists both on the
# card), so what is proved is what the programs around it do. It sits in a throwaway home's
# .local/bin, which mc-decide puts first on the path, and the scenario refuses to start if any other
# claude would answer. No model and no key are used.
#
#   bash scenarios/held-by-a-claim.sh candidate/2.0.0-beta.21
#   GODSPEED_SCENARIO_PRODUCT=<a checkout> bash scenarios/held-by-a-claim.sh local
#   bash scenarios/held-by-a-claim.sh --check <folder>
#
# What it keeps for its checking part:
#   hold.txt                what mc-holds hold answered (the claim's file is its first word)
#   day1-holds.txt, day1-moves.md, day1-held.md, day1-decision.md, day1-decide.txt, day1-work.json
#   day2-holds.txt, day2-moves.md, day2-decision.md, day2-decide.txt, day2-work.json
#                           the run folder's files, what mc-decide printed, and `mc-work list --json`
SCENARIO=held-by-a-claim
# shellcheck source=scenarios/scenario-lib.sh
. "$(dirname "$0")/scenario-lib.sh"
scenario_arguments "$@"

DAY0=2026-11-19
DAY1=2026-11-20
DAY2=2026-11-21
INTERVIEW="Answer Podcast X's interview invitation about the book"
NOTE="Send the launch note to Jane Doe"

# The stand-in assistant: the moves of a run that never read holds.txt.
STAND_IN='#!/usr/bin/env bash
prompt="$(cat)"
case "$prompt" in *"says it is not finished"*) echo "The moves are as far as they go today."; exit 0 ;; esac
printf "# Decision\n\n## For you today\nship-list card: 1. %s; 2. %s\n\n## Moves\nTwo.\n" "$FAKE_INTERVIEW" "$FAKE_NOTE" > "$FAKE_RUN/decision.md"
printf "### 1. %s\nAPPLY: %s\nTOUCHES: the-book\nGOAL: book\nPERMISSION: ship list\n\n### 2. %s\nAPPLY: %s\nTOUCHES: jane-doe\nGOAL: book\nPERMISSION: ship list\n" \
  "$FAKE_INTERVIEW" "$FAKE_INTERVIEW_ID" "$FAKE_NOTE" "$FAKE_NOTE_ID" > "$FAKE_RUN/moves.md"
echo "Two changes are ready. ship-list card"
'

on_root() { # <day> <product script> <arguments...>
  local day=$1 script=$2
  shift 2
  GODSPEED_ROOT="$ROOT" GODSPEED_TODAY="$day" "$NODE" "$(product_script "$ROOT" "$script")" "$@"
}
id_of_key() { # <work.json> <key>
  "$NODE" -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).find(x=>x.KEY===process.argv[2]);process.stdout.write(r?r.id:"")' "$1" "$2"
}

decide_day() { # <day> <label>
  local day=$1 label=$2 run=$ROOT/routines/next-action/$1
  phase "the daily decision of $day"
  HOME="$STAND_HOME" GODSPEED_RUNNER=claude GODSPEED_TODAY="$day" FAKE_RUN="$run" \
    FAKE_INTERVIEW="$INTERVIEW" FAKE_NOTE="$NOTE" FAKE_INTERVIEW_ID="$INTERVIEW_ID" FAKE_NOTE_ID="$NOTE_ID" \
    bash "$(product_script "$ROOT" tools/mc-decide)" --godspeed "$ROOT" --date "$day" --timeout 120 >"$EVIDENCE/$label-decide.txt" 2>&1
  sed 's/^/  | /' "$EVIDENCE/$label-decide.txt" >&2
  for f in holds.txt moves.md held.md decision.md; do [ -f "$run/$f" ] && cp "$run/$f" "$EVIDENCE/$label-$f"; done
  on_root "$day" tools/work.js list --all --json >"$EVIDENCE/$label-work.json" ||
    fail "the work register could not be listed after the decision of $day"
}

act() {
  fresh_evidence
  install_paths
  install_the_stage_line_into "$ROOT" "$NOTEBOOK_PORT" "$EVIDENCE/.install.log"
  need_node
  read_version "$ROOT"

  STAND_HOME=$EVIDENCE/.home
  mkdir -p "$STAND_HOME/.local/bin" || fail "the stand-in assistant's home could not be made"
  printf '%s' "$STAND_IN" >"$STAND_HOME/.local/bin/claude"
  printf '#!/usr/bin/env bash\nwhile [ $# -gt 0 ] && [ "$1" != -- ]; do shift; done; shift; exec "$@"\n' >"$STAND_HOME/.local/bin/agent-cage"
  chmod +x "$STAND_HOME/.local/bin/claude" "$STAND_HOME/.local/bin/agent-cage"
  case $STAND_HOME in *:*) fail "the stand-in's home $STAND_HOME has a colon in it, so it cannot go on the path" ;; esac
  [ "$(PATH="$STAND_HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH" command -v claude)" = "$STAND_HOME/.local/bin/claude" ] ||
    fail "claude on the decision's path would not be the stand-in, so no decision was run (a real assistant must not answer here)"

  phase 'the person postpones the interview until the book is out of beta'
  mkdir -p "$ROOT/world/entities" "$ROOT/world/claims" || fail "the world folder could not be made in $ROOT"
  printf -- '---\nslug: the-book\norigin: mission control\nname: The book\ntype: project\n---\n' >"$ROOT/world/entities/the-book.md"
  printf -- '---\nslug: jane-doe\norigin: mission control\nname: Jane Doe\ntype: person\n---\n' >"$ROOT/world/entities/jane-doe.md"
  printf -- '---\nsubject: the-book\norigin: mission control\nattribute: status\nvalue: beta\nvalid_from: 2026-09-01\nconfidence: certain\nsource: you said it\n---\n' >"$ROOT/world/claims/the-book--status--2026-09-01.md"
  on_root "$DAY0" tools/holds.js hold --godspeed "$ROOT" --date "$DAY0" --subject the-book --stance postponed --steps interview \
    --until the-book--status--2026-09-01 --words "not yet, only once the book is out of beta" >"$EVIDENCE/hold.txt" 2>&1 ||
    fail "mc-holds would not write the hold: $(tr '\n' ' ' <"$EVIDENCE/hold.txt")"

  phase 'two steps carried from the day before'
  on_root "$DAY0" tools/work.js file --date "$DAY0" --key apply-answer-interview --touches the-book --outward yes \
    --what "$INTERVIEW" --done-when "the answer is sent" --source next-action >&2 || fail "the interview step could not be filed"
  on_root "$DAY0" tools/work.js file --date "$DAY0" --key apply-launch-note --touches jane-doe --outward yes \
    --what "$NOTE" --done-when "the note is sent" --source next-action >&2 || fail "the launch note step could not be filed"
  on_root "$DAY0" tools/work.js list --all --json >"$EVIDENCE/.work.json" || fail "the work register could not be listed"
  INTERVIEW_ID=$(id_of_key "$EVIDENCE/.work.json" apply-answer-interview)
  NOTE_ID=$(id_of_key "$EVIDENCE/.work.json" apply-launch-note)

  decide_day "$DAY1" day1
  phase 'the book is out of beta'
  on_root "$DAY2" tools/holds.js end the-book--status--2026-09-01 --godspeed "$ROOT" --date "$DAY2" --words "the book is out of beta" >&2 ||
    fail "mc-holds would not end the book's beta claim"
  decide_day "$DAY2" day2
  rm -rf "$EVIDENCE"/.[a-z]*
}

# ------------------------------------------------------------------------------ what it judges
for_you() { # <decision.md>: the body of its "For you today" section
  awk '/^## For you today/{on=1;next} /^## /{on=0} on' "$1"
}
row_field() { # <work.json> <key> <field>
  "$NODE" -e '
let rows;try{rows=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));}catch{process.exit(3);}
const r=rows.find(x=>x.KEY===process.argv[2]);if(!r)process.exit(1);
const v=process.argv[3]==="held_by"?(r.held_by||""):r[process.argv[3]]||"";process.stdout.write(String(v));
' "$1" "$2" "$3"
}

check() { # <evidence folder>
  local folder=$1 claim card held
  [ -d "$folder" ] || fail "there is nothing at $folder, so this scenario kept no evidence of a held step"
  kept_all "$folder" 'what the two decisions did' hold.txt day1-holds.txt day1-moves.md day1-decision.md day1-decide.txt day1-work.json \
    day2-holds.txt day2-moves.md day2-decision.md day2-decide.txt day2-work.json
  claim=$(awk '{sub(/:$/,"",$1); print $1; exit}' "$folder/hold.txt")
  case $claim in world/claims/*.md) ;; *) fail "mc-holds hold wrote no claim: $(tr '\n' ' ' <"$folder/hold.txt")" ;; esac
  grep -qF "$claim: postponed" "$folder/day1-holds.txt" || fail "holds.txt on day 1 does not name the hold $claim: $(tr '\n' ' ' <"$folder/day1-holds.txt")"

  # day 1: held off the moves, the card and the register, and the claim named for each.
  grep -q "^### [0-9]*\. $INTERVIEW" "$folder/day1-moves.md" && fail "day 1 still proposes the interview the person postponed"
  for_you "$folder/day1-decision.md" | grep -qF "Podcast X" &&
    fail "day 1's card still asks about the interview: $(for_you "$folder/day1-decision.md" | tr '\n' ' ' | cut -c1-200)"
  grep -q "^held: move [0-9]* \"$INTERVIEW\" by $claim" "$folder/day1-decide.txt" ||
    fail "the decision's output on day 1 does not name the claim that held the interview move ($claim)"
  card=$(row_field "$folder/day1-work.json" apply-answer-interview id) || fail "day 1's register has no interview step"
  grep -q "^held: $card \".*\" by $claim" "$folder/day1-decide.txt" ||
    fail "the decision's output on day 1 does not name the claim that held the carried step $card ($claim)"
  held=$(row_field "$folder/day1-work.json" apply-answer-interview held_by)
  [ "$held" = "$claim" ] || fail "on day 1 the register lists the interview step as held by [$held], not by $claim"
  grep -q "^### [0-9]*\. $NOTE" "$folder/day1-moves.md" || fail "the Jane Doe move is missing on day 1, so more than the postponed step was held"
  for_you "$folder/day1-decision.md" | grep -qF "$NOTE" ||
    fail "day 1's card lost the Jane Doe line, so more than the postponed step was held: $(for_you "$folder/day1-decision.md" | tr '\n' ' ' | cut -c1-200)"
  held=$(row_field "$folder/day1-work.json" apply-launch-note held_by) || fail "day 1's register has no Jane Doe step"
  [ -z "$held" ] || fail "on day 1 the Jane Doe step is held by $held, though nothing was said about it"
  grep -q "^decided $DAY1" "$folder/day1-decide.txt" || fail "the decision of $DAY1 did not end decided: $(tail -n 1 "$folder/day1-decide.txt")"

  # day 2: the condition ended, so it is back.
  grep -q "^### [0-9]*\. $INTERVIEW" "$folder/day2-moves.md" ||
    fail "day 2, after the book's beta claim ended, still holds the interview move back"
  grep -q '^held:' "$folder/day2-decide.txt" && fail "day 2 still holds a step: $(grep '^held:' "$folder/day2-decide.txt" | head -n 1)"
  held=$(row_field "$folder/day2-work.json" apply-answer-interview held_by)
  [ -z "$held" ] || fail "on day 2 the register still lists the interview step as held by $held"
  for_you "$folder/day2-decision.md" | grep -qi 'held back' && fail "day 2's card is still held back"
  grep -q "^decided $DAY2" "$folder/day2-decide.txt" || fail "the decision of $DAY2 did not end decided: $(tail -n 1 "$folder/day2-decide.txt")"
  pass "the interview the person postponed stayed off the moves, the card and the register on $DAY1, held by $claim and named in the decision's output, while the Jane Doe step stayed; once the book's beta claim ended it came back on $DAY2"
}

if [ "$CHECK_ONLY" = yes ]; then
  install_paths
  need_node
  check "$EVIDENCE"
else
  act
  check "$EVIDENCE"
fi
