#!/usr/bin/env bash
# PROVING SCENARIO 5 of 2.0.0-beta.12: one reminder closed on two computers while they were apart
# is closed on both, with two closing moments and nothing for the owner to settle.
#
# What it proves (godspeed-dev, releases/godspeed-2.0.0-beta.12-reminders-in-the-notebook/plan.md,
# scenario 5): two people, or one person on two computers, can both close the same thing before
# either machine syncs. A closing is something that happened, so both happenings are kept: two
# moments on the timeline, not one of them standing for the other and not a conflict waiting in the
# owner's review queue. The identity of a closing made here and now is the store's own, which is
# exactly why the two do not collapse into one (core/deadline-records.mjs closingUid: `from` is
# what makes a derived identity safe, and a closing of this moment passes none).
#
# The two computers are two installations on this one machine, each with its own mission control
# folder, its own port and its own device identity, joined through one bare repository standing in
# for the private GitHub repository, the way Settings connects one.
#
#   bash scenarios/closed-offline-on-both.sh candidate/2.0.0-beta.12
#   bash scenarios/closed-offline-on-both.sh --check <folder>
#
# What it keeps for its checking part:
#   what.txt                  the reminder and the two evidences it was closed with
#   a-state.json / b-state.json      what each computer's reminders say afterwards
#   a-closings.txt / b-closings.txt  each computer's closing moments, with their evidence
#   a-reviews.txt / b-reviews.txt    each computer's review queue
#   rounds.txt                what every sync round answered
SCENARIO='closed-offline-on-both'
# shellcheck source=scenarios/scenario-lib.sh
. "$(dirname "$0")/scenario-lib.sh"
scenario_arguments "$@"

COMPUTERS='a b'
SLUG='quarterly-report'
TITLE='Send the quarterly report'
EVIDENCE_A='I sent it from my desk, mail of 09:12'
EVIDENCE_B='I sent it from the laptop on the train'

said() { # <file> <key>
  awk -F'\t' -v key="$2" '$1==key{print $2;exit}' "$1"
}
# shellcheck disable=SC2016  # a JavaScript program, which this shell must not expand
STATE_ROW='
const fs=require("fs");
let rows;try{rows=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));}catch{process.exit(3);}
if(!Array.isArray(rows))process.exit(3);
const row=rows.find(r=>r&&r.slug===process.argv[2]);
if(!row)process.exit(1);
process.stdout.write([row.state||"",row.closedBy||"",row.title||""].join("\t"));
'
state_row() { # <file> <slug>
  "$NODE" -e "$STATE_ROW" "$1" "$2"
}
closings_for() { # <file> <title>: how many closing moments are about that reminder
  awk -F'\t' -v title="Done: $2" '$2==title' "$1" | grep -c . || true
}

# ------------------------------------------------------------------------------------ the acting
act() {
  fresh_evidence
  install_paths
  local work=${GODSPEED_SCENARIO_WORK:-${RUNNER_TEMP:-/tmp}} b address
  b=$work/computer-b
  rm -rf "$b"
  {
    printf 'slug\t%s\n' "$SLUG"
    printf 'title\t%s\n' "$TITLE"
    printf 'evidence-a\t%s\n' "$EVIDENCE_A"
    printf 'evidence-b\t%s\n' "$EVIDENCE_B"
  } >"$EVIDENCE/what.txt"

  say "== the first computer, and the reminder both will close"
  install_the_stage_line_into "$ROOT" "$NOTEBOOK_PORT" "$EVIDENCE/a-install.log"
  RUNTIME=$(runtime_of "$ROOT")
  need_node
  read_version "$ROOT"
  due_on "$ROOT" add "$SLUG" --title "$TITLE" --to "$(day_in +14)" \
    --cost 'The board meets without the numbers.' --done-when 'The report is with the board.' >&2 ||
    fail "the reminder could not be added on the first computer"

  say "== the second computer, set up from the copy on GitHub the way Settings makes one"
  address=$(stand_in_github "$work/github")
  sync_on "$ROOT" configure "$address" >"$EVIDENCE/configure.json" ||
    fail "Settings' own way of connecting a repository was refused on the first computer"
  sync_on "$ROOT" >"$EVIDENCE/rounds.txt" || fail "the first sync round failed, so the second computer had nothing to be set up from"
  git clone -q "$address" "$b" || fail "the second computer could not be set up from the copy on GitHub"
  install_the_stage_line_into "$b" 47841 "$EVIDENCE/b-install.log"
  read_version "$b"
  notebook_on "$b" sync folder >&2 || fail "godspeed sync folder was refused on the second computer, so it never joined"
  sync_on "$b" >>"$EVIDENCE/rounds.txt" || fail "the sync round that brings the reminder to the second computer failed"

  say "== closed on both, before either syncs"
  due_on "$ROOT" 'done' "$SLUG" --evidence "$EVIDENCE_A" >&2 || fail "the reminder could not be closed on the first computer"
  due_on "$b" 'done' "$SLUG" --evidence "$EVIDENCE_B" >&2 ||
    fail "the reminder could not be closed on the second computer, which is what this scenario is about"

  say "== and now they sync, twice each, so both have seen the other"
  sync_on "$ROOT" >>"$EVIDENCE/rounds.txt" || fail "the first computer's sync round after the closing failed"
  sync_on "$b" >>"$EVIDENCE/rounds.txt" || fail "the second computer's sync round after the closing failed"
  sync_on "$ROOT" >>"$EVIDENCE/rounds.txt" || fail "the first computer's second sync round failed"
  sync_on "$b" >>"$EVIDENCE/rounds.txt" || fail "the second computer's second sync round failed"

  due_on "$ROOT" state --json >"$EVIDENCE/a-state.json" || fail "the first computer could not say what it holds"
  due_on "$b" state --json >"$EVIDENCE/b-state.json" || fail "the second computer could not say what it holds"
  closings_of "$ROOT" "$EVIDENCE/a-closings.txt"
  closings_of "$b" "$EVIDENCE/b-closings.txt"
  reviews_of "$ROOT" "$EVIDENCE/a-reviews.txt"
  reviews_of "$b" "$EVIDENCE/b-reviews.txt"
}

# ----------------------------------------------------------------------------------- the judging
check() { # <evidence folder>
  local folder=$1 slug title evidence_a evidence_b computer row state n waiting
  [ -d "$folder" ] || fail "there is nothing at $folder, so this scenario kept no evidence of a reminder closed on both"
  need_node
  kept_all "$folder" "what the two computers held after both closed it and both synced" \
    what.txt a-state.json b-state.json a-closings.txt b-closings.txt
  slug=$(said "$folder/what.txt" slug)
  title=$(said "$folder/what.txt" title)
  evidence_a=$(said "$folder/what.txt" evidence-a)
  evidence_b=$(said "$folder/what.txt" evidence-b)
  [ -n "$slug" ] && [ -n "$evidence_a" ] && [ -n "$evidence_b" ] ||
    fail "what.txt names no reminder and no two evidences, so there is nothing to look for"
  [ "$evidence_a" != "$evidence_b" ] ||
    fail "the two computers closed it with the same words, so this scenario could not tell one closing from two"

  for computer in $COMPUTERS; do
    # CLOSED ON BOTH.
    row=$(state_row "$folder/$computer-state.json" "$slug")
    case $? in
      3) fail "$computer-state.json is not what due state --json answers" ;;
      1) fail "computer $computer does not name $slug at all, so the reminder never reached it" ;;
    esac
    state=$(printf '%s' "$row" | cut -f1)
    case $state in
      closed | done) ;;
      *) fail "computer $computer says $slug is \"$state\" after both computers closed it and both synced" ;;
    esac
    # TWO CLOSING MOMENTS, one per thing that happened.
    n=$(closings_for "$folder/$computer-closings.txt" "$title")
    [ "$n" = 2 ] ||
      fail "computer $computer holds $n closing moments for \"$title\", and two people closing one thing is two moments"
    grep -qF "$evidence_a" "$folder/$computer-closings.txt" ||
      fail "the closing made on the first computer (\"$evidence_a\") is not on computer $computer"
    grep -qF "$evidence_b" "$folder/$computer-closings.txt" ||
      fail "the closing made on the second computer (\"$evidence_b\") is not on computer $computer"
    # AND NOTHING WAITING FOR THE OWNER. An empty review queue is the point here, so the file is
    # read as a file and not asked to hold anything.
    [ -f "$folder/$computer-reviews.txt" ] ||
      fail "the scenario kept no review queue for computer $computer, so whether anything waits for the owner cannot be said"
    waiting=$(grep -c . "$folder/$computer-reviews.txt" || true)
    [ "$waiting" = 0 ] ||
      fail "computer $computer has $waiting review item(s) waiting for the owner after one reminder was closed on both: $(head -1 "$folder/$computer-reviews.txt" | cut -c1-200)"
  done

  pass "one reminder closed on two computers before either synced is closed on both afterwards, each holding two closing moments - \"$evidence_a\" and \"$evidence_b\" - and neither leaving anything in the owner's review queue"
}

if [ "$CHECK_ONLY" = yes ]; then
  install_paths
  check "$EVIDENCE"
else
  act
  check "$EVIDENCE"
fi
