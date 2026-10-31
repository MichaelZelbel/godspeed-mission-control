#!/usr/bin/env bash
# PROVING SCENARIO 4 of 2.0.0-beta.12: a file written the old way after the move is still taken in,
# once, and a file changed under a page that also changed waits for the owner.
#
# What it proves (godspeed-dev, releases/godspeed-2.0.0-beta.12-reminders-in-the-notebook/plan.md,
# scenario 4): the machines of one mission control update at different times, so after this machine
# has moved its reminders into the notebook, another machine still on the old version can commit a
# new file in due/ or a new closing in world/events/, and a person can write one by hand. Each is
# taken in on the next run: the reminder is listed once and never twice, the closing closes its
# reminder. And when the same reminder changed on both sides - the old file the old way, the page in
# the notebook - the notebook's version is kept and the difference waits as one review item, never
# a silent drop and never a second reminder.
#
#   bash scenarios/late-reminder-file.sh candidate/2.0.0-beta.12
#   bash scenarios/late-reminder-file.sh --check <folder>
#
# What it keeps for its checking part:
#   what.txt            the three it wrote: the late reminder, the one closed late, the changed one
#   late-list.txt       `due list` on the run after the late file appeared
#   late-state.json     and `due state --json` of that run
#   closed-state.json   `due state --json` after the closing written the old way appeared
#   pages.txt           the reminder pages afterwards: <title><TAB>file
#   closings.txt        the closing moments afterwards
#   reviews.txt         the notebook's review queue, one line per item still waiting:
#                       <suggestion type><TAB><status><TAB><title><TAB><what it says>
#   changed-list.txt    `due list` after the one that changed on both sides
#   second-list.txt     and `due list` once more, so a second run is seen to change nothing
SCENARIO='late-reminder-file'
# shellcheck source=scenarios/scenario-lib.sh
. "$(dirname "$0")/scenario-lib.sh"
scenario_arguments "$@"

LATE_SLUG='late-by-another-machine'
LATE_TITLE='Renew the car insurance'
CLOSED_SLUG=deadline-only
CLOSED_TITLE='File the VAT return'
CHANGED_SLUG=both-dates
CHANGED_TITLE='Send the tax papers'
CHANGED_WORDS='A line another machine wrote into the old file'
PAGE_WORDS='A line the owner wrote into the page'

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
counted() { # <file> <column> <value>
  awk -F'\t' -v column="$2" -v value="$3" '$column==value' "$1" | grep -c . || true
}

# ------------------------------------------------------------------------------------ the acting
# A file in due/ exactly as the old version writes one (tools/due.js: the head lines in order, the
# windows, the log), because that is what another machine still on the old version commits.
old_reminder_file() { # <root> <slug> <title> <last day>
  mkdir -p "$1/due" || fail "due/ could not be written in $1"
  {
    printf 'TITLE:          %s\n' "$3"
    printf 'DONE-WHEN:      The new policy is in the folder.\n'
    printf 'COST-IF-MISSED: The car is uninsured.\n'
    printf 'SELF-CHECK:     none\n'
    printf 'SELF-CHECK-ARG:\n'
    printf 'REPEATS:        no\n'
    printf 'LINK:\n'
    printf 'SOURCE:         another machine, %s\n' "$(day_in +0)"
    printf '\n## Windows\n'
    printf 'STRIP: %s %s\n' "$(day_in +0)" "$4"
    printf '\n## Log\n'
    printf -- '- %s created, window %s to %s\n' "$(day_in +0)" "$(day_in +0)" "$4"
  } >"$1/due/$2.md" || fail "the late file due/$2.md could not be written"
}
# And a closing exactly as the old version writes one (tools/due.js writeEvent).
old_closing_event() { # <root> <slug> <evidence>
  mkdir -p "$1/world/events" || fail "world/events/ could not be written in $1"
  {
    printf -- '---\n'
    printf 'date: %s\n' "$(day_in +0)"
    printf 'closes: [due/%s]\n' "$2"
    printf 'evidence: %s\n' "$3"
    printf 'source: mc-due done\n'
    printf 'written_by: mc-due\n'
    printf 'origin: mission control\n'
    printf -- '---\n\n'
    printf 'Closed on another machine, the old way.\n'
  } >"$1/world/events/$(day_in +0)-$2-closed-elsewhere.md" || fail "the late closing event for $2 could not be written"
}

act() {
  fresh_evidence
  install_paths
  say "== a mission control on the public version, with the set of the plan, updated to the stage"
  install_the_public_line_into "$ROOT" "$NOTEBOOK_PORT"
  RUNTIME=$(runtime_of "$ROOT")
  need_node
  read_version "$ROOT"
  seed_the_old_set "$ROOT"
  due_on "$ROOT" state >/dev/null || fail "the public version could not say what it holds before the update"
  install_the_stage_line_into "$ROOT" "$NOTEBOOK_PORT" "$EVIDENCE/update.log"
  read_version "$ROOT"
  due_on "$ROOT" state >/dev/null || fail "the stage could not say what it holds after the move, so nothing was moved"
  {
    printf 'late\t%s\n' "$LATE_SLUG"
    printf 'late-title\t%s\n' "$LATE_TITLE"
    printf 'closed\t%s\n' "$CLOSED_SLUG"
    printf 'closed-title\t%s\n' "$CLOSED_TITLE"
    printf 'changed\t%s\n' "$CHANGED_SLUG"
    printf 'changed-title\t%s\n' "$CHANGED_TITLE"
    printf 'changed-words\t%s\n' "$CHANGED_WORDS"
    printf 'page-words\t%s\n' "$PAGE_WORDS"
  } >"$EVIDENCE/what.txt"

  say "== a reminder another machine wrote the old way, after the move"
  old_reminder_file "$ROOT" "$LATE_SLUG" "$LATE_TITLE" "$(day_in +25)"
  due_on "$ROOT" list >"$EVIDENCE/late-list.txt" || fail "due list could not be read after the late file appeared"
  due_on "$ROOT" state --json >"$EVIDENCE/late-state.json" || fail "due state could not be read after the late file appeared"

  say "== a closing another machine wrote the old way, after the move"
  old_closing_event "$ROOT" "$CLOSED_SLUG" 'the portal says it was filed, another machine saw it'
  due_on "$ROOT" state --json >"$EVIDENCE/closed-state.json" || fail "due state could not be read after the late closing appeared"

  say "== one reminder changed on both sides: the old file the old way, the page in the notebook"
  local page=$ROOT/notebook/Deadlines/$CHANGED_TITLE.md
  [ -f "$page" ] || fail "the move made no page for \"$CHANGED_TITLE\" ($page), so nothing can change on both sides"
  printf '%s\n' "- $(day_in +0) $PAGE_WORDS" >>"$page" || fail "the page of \"$CHANGED_TITLE\" could not be changed"
  mkdir -p "$ROOT/due" || fail "due/ could not be written in $ROOT"
  # The old file as another machine on the old version commits it back, with a line of its own.
  old_reminder_file "$ROOT" "$CHANGED_SLUG" "$CHANGED_TITLE" "$(day_in +40)"
  printf -- '- %s %s\n' "$(day_in +0)" "$CHANGED_WORDS" >>"$ROOT/due/$CHANGED_SLUG.md" ||
    fail "the old file of \"$CHANGED_TITLE\" could not be changed the old way"
  due_on "$ROOT" state --json >"$EVIDENCE/changed-state.json" || fail "due state could not be read after both sides changed"
  due_on "$ROOT" list >"$EVIDENCE/changed-list.txt" || fail "due list could not be read after both sides changed"

  pages_of "$ROOT" "$EVIDENCE/pages.txt"
  closings_of "$ROOT" "$EVIDENCE/closings.txt"
  # Where the product keeps it: a reminder changed in two places at once waits as a review_queue
  # record of the notebook's (core/due-copy.mjs), which is notebook/_system/review_queue/<id>.json
  # on disk - not in conflicts/, which is where a difference the SYNC could not settle waits.
  queued_reviews_of "$ROOT" "$EVIDENCE/reviews.txt"
  say "== once more, so a second run is seen to change nothing"
  due_on "$ROOT" list >"$EVIDENCE/second-list.txt" || fail "due list could not be read a second time"
}

# ----------------------------------------------------------------------------------- the judging
check() { # <evidence folder>
  local folder=$1 late late_title closed closed_title changed changed_title row state n reviews
  [ -d "$folder" ] || fail "there is nothing at $folder, so this scenario kept no evidence of a late file"
  need_node
  kept_all "$folder" "what the machine saw after the late files appeared" \
    what.txt late-list.txt late-state.json closed-state.json pages.txt closings.txt     changed-list.txt second-list.txt
  late=$(said "$folder/what.txt" late)
  late_title=$(said "$folder/what.txt" late-title)
  closed=$(said "$folder/what.txt" closed)
  closed_title=$(said "$folder/what.txt" closed-title)
  changed=$(said "$folder/what.txt" changed)
  changed_title=$(said "$folder/what.txt" changed-title)
  [ -n "$late" ] && [ -n "$closed" ] && [ -n "$changed" ] ||
    fail "what.txt names no late reminder, no late closing and no changed one, so there is nothing to look for"

  # THE LATE REMINDER IS THERE, AND ONCE.
  grep -qF "$late_title" "$folder/late-list.txt" ||
    fail "the reminder another machine wrote the old way (\"$late_title\") is not in due list on the next run"
  n=$(grep -oF "$late_title" "$folder/late-list.txt" | grep -c . || true)
  [ "$n" = 1 ] || fail "due list names \"$late_title\" $n times on the run after it appeared, and a late file is one reminder"
  row=$(state_row "$folder/late-state.json" "$late")
  case $? in
    3) fail "late-state.json is not what due state --json answers" ;;
    1) fail "the reminders do not name $late at all, although its file was written the old way" ;;
  esac
  n=$(counted "$folder/pages.txt" 1 "$late_title")
  [ "$n" = 1 ] || fail "the notebook holds $n pages for the late reminder \"$late_title\", and it is one reminder"

  # THE LATE CLOSING CLOSED ITS REMINDER.
  row=$(state_row "$folder/closed-state.json" "$closed")
  state=$(printf '%s' "$row" | cut -f1)
  case $state in
    closed | done) ;;
    *) fail "$closed (\"$closed_title\") is \"$state\" after a closing written the old way named it, and a closing closes it" ;;
  esac

  # THE ONE THAT CHANGED ON BOTH SIDES IS ONE REVIEW ITEM, and no second reminder. The item is the
  # notebook's own, about a reminder changed in two places (core/due-copy.mjs saves it with
  # suggestion_type deadline_both_changed), so that is what is counted: anything else waiting in
  # that queue is something else's business and never stands in for this one.
  kept "$folder" reviews.txt "the notebook's review queue after the old file and its page both changed"
  reviews=$(awk -F'\t' '$1=="deadline_both_changed"' "$folder/reviews.txt" | grep -c . || true)
  [ "$reviews" = 1 ] ||
    fail "the old file and its page both changed and left $reviews review items about a reminder changed in two places, and the plan asks for one"
  awk -F'\t' '$1=="deadline_both_changed"' "$folder/reviews.txt" |
    grep -qF -e "$changed" -e "$changed_title" ||
    fail "the one review item does not name \"$changed_title\", so it is about something else"
  n=$(counted "$folder/pages.txt" 1 "$changed_title")
  [ "$n" = 1 ] || fail "the notebook holds $n pages for \"$changed_title\" after it changed on both sides, and it is one reminder"

  # AND A SECOND RUN CHANGES NOTHING.
  cmp -s "$folder/late-list.txt" "$folder/second-list.txt" ||
    fail "due list does not print the same bytes on a second run: $(diff "$folder/late-list.txt" "$folder/second-list.txt" | tr '\n' ' ' | cut -c1-240)"

  pass "a reminder written the old way after the move is listed once and has one page, a closing written the old way closed $closed, the one changed on both sides left exactly one review item waiting in the notebook and no second page, and a second run changed nothing"
}

if [ "$CHECK_ONLY" = yes ]; then
  install_paths
  check "$EVIDENCE"
else
  act
  check "$EVIDENCE"
fi
