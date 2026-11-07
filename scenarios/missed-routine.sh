#!/usr/bin/env bash
# PROVING SCENARIO OF 2.0.0-beta.19: the daily connection check tells the owner about a routine that did
# not run or kept failing, once, and closes that when the routine runs well again.
#
# What it proves (godspeed-dev, releases/godspeed-2.0.0-beta.19-looks-after-itself/tickets/05-scenarios.md,
# scenario 3), once it is moved onto the installed server's Telegram path:
#   one routine whose time passed without a run, and one that failed twice, and a third that failed once
#   check 1   the "Daily connection check" sends one message, which names the first two and not the third
#   check 2   the second run sends nothing
#   good      a good run of each of the two closes what the check opened
#
# THE ROUTINES are three made on the install through the assistant's own command (the way
# scenario-asker.py's routine is made), named Scenario missed, Scenario failing twice and Scenario failing
# once, each daily at 06:00. The failing ones run a script that ends 1, run by the driver the way the
# install's tick runs a routine. THE CLOCK IS MOVED BY WRITING: the first routine's next run is written
# two days into the past in the assistant's own list of routines, which is what the check sees on a
# machine whose clock has gone two days on without that routine being run. (A real clock cannot be moved
# for one process of the install here; the pull request says so.)
#
# THE CHECK IS FOUND BY NAME, and the deadline it opens by being new, so this does not depend on the
# titles ticket 03 chose; the message is judged on the routines' names, and the deadlines on opening and
# closing. THE TELEGRAM PATH is the installed server's (server-lib.sh, server-telegram.mjs); until this scenario is moved onto it, acting ends at once in a FAIL line that says so.
#
# No AI is connected: nothing in this scenario talks to a model.
#
#   bash scenarios/missed-routine.sh candidate/2.0.0-beta.19
#   bash scenarios/missed-routine.sh --check <folder>
#
# What it keeps for its checking part:
#   run.json                              every message sent (with its step's label) and each step's outcome
#   routines.json                         the routines the install made
#   due-before.json, due-<label>.json     the deadlines before and after check-1, check-2 and check-3
#   telegram-fixture-calls.log, telegram-fixture.json, driver.log, config.yaml, plugins.txt
SCENARIO=missed-routine
# shellcheck source=scenarios/scenario-lib.sh
. "$(dirname "$0")/scenario-lib.sh"
scenario_arguments "$@"

CHECK_ROUTINE='Daily connection check'
MISSED='Scenario missed'
TWICE='Scenario failing twice'
ONCE='Scenario failing once'

# A routine made through the assistant's own command, a script of the scripts folder, daily at 06:00.
make_routine() { # <name> <script>
  local executable
  executable=$(json_value "$STATE/assistant.json" executable) ||
    fail "the install recorded no command for its assistant, so the routine $1 could not be made"
  (cd "$ROOT" && HERMES_HOME="$HERMES" "$executable" cron create '0 6 * * *' --no-agent --name "$1" \
    --script "$2" --deliver local --failure-deliver local --workdir "$ROOT") >&2 ||
    fail "the assistant would not make the routine $1"
}

# Writes the next run of one routine into the past, as a clock two days on would find it.
MOVE_THE_CLOCK='
const fs=require("fs");
const [file,name]=process.argv.slice(1);
const data=JSON.parse(fs.readFileSync(file,"utf8"));
const jobs=Array.isArray(data)?data:data.jobs;
const job=(jobs||[]).find(j=>j&&j.name===name);
if(!job){console.error("no routine named "+name+" in "+file);process.exit(1);}
job.next_run_at=new Date(Date.now()-2*86400000).toISOString();
job.last_run_at=null;
fs.writeFileSync(file,JSON.stringify(data,null,2)+"\n");
'

look() { # <label>: the deadlines as they are after a step
  step_of run "$1" "\"argv\":[\"$NODE\",$(quoted_json "$(product_script "$ROOT" notebook/bin/personal-command.mjs)"),\"due\",\"state\",\"--json\"],\"env\":{\"GODSPEED_WORKSPACE\":$(quoted_json "$ROOT")},\"stdout_file\":$(quoted_json "$EVIDENCE/due-$1.json")"
}
check_and_look() { # <label>
  step_of cron "$1" "\"job\":\"$CHECK_ROUTINE\""
  printf ','
  look "$1"
}

act() {
  fail "missed-routine needs a Telegram path on the installed server (server-lib.sh and server-telegram.mjs), which it has not been moved onto yet; the retired in-process Telegram driver is not brought back"
  fresh_evidence
  install_paths
  install_the_stage_line "$EVIDENCE/.install.log"
  need_node
  wait_for 180 "the notebook to answer after the install" notebook_is_up ||
    fail "the notebook does not answer after the install"
  read_version "$ROOT"
  assistant_home
  phase 'the owner on a fixture Telegram'
  owner_on_telegram_install no
  mkdir -p "$HERMES/scripts"
  printf 'import sys\nsys.exit(0)\n' >"$HERMES/scripts/scenario-ok.py"
  printf 'import sys\nsys.exit(1)\n' >"$HERMES/scripts/scenario-fail.py"
  phase 'three routines'
  make_routine "$MISSED" scenario-ok.py
  make_routine "$TWICE" scenario-fail.py
  make_routine "$ONCE" scenario-fail.py
  routines_exist
  cp "$EVIDENCE/.jobs.json" "$EVIDENCE/routines.json"
  rm -f "$EVIDENCE/.jobs.json"
  due_on "$ROOT" state --json >"$EVIDENCE/due-before.json" ||
    fail "the install's deadlines could not be read before the connection check ran"

  phase 'a routine missed, one failed twice, one failed once; the check twice; good runs; the check again'
  steps_file "$EVIDENCE/steps.json" \
    "$(step_of cron fail-twice-1 "\"job\":\"$TWICE\"")" "$(step_of cron fail-twice-2 "\"job\":\"$TWICE\"")" \
    "$(step_of cron fail-once-1 "\"job\":\"$ONCE\"")" \
    "$(step_of run move-the-clock "\"argv\":[\"$NODE\",\"-e\",$(quoted_json "$MOVE_THE_CLOCK"),$(quoted_json "$HERMES/cron/jobs.json"),$(quoted_json "$MISSED")]")" \
    "$(check_and_look check-1)" "$(check_and_look check-2)" \
    "$(step_of run good-script "\"argv\":[\"cp\",$(quoted_json "$HERMES/scripts/scenario-ok.py"),$(quoted_json "$HERMES/scripts/scenario-fail.py")]")" \
    "$(step_of cron good-missed "\"job\":\"$MISSED\"")" "$(step_of cron good-failing "\"job\":\"$TWICE\"")" \
    "$(check_and_look check-3)"
  owner_on_telegram "$EVIDENCE/steps.json" "$EVIDENCE/run.json"
  rm -f "$EVIDENCE"/.[a-z]*
}

# ------------------------------------------------------------------------------ what it judges
# The labels of the steps of a run.json that did (ok) or did not (bad) succeed, one a line.
steps_labelled() { # <run.json> <ok|bad>
  "$NODE" -e '
const run=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
for(const s of run.steps||[])if((s.success===true)===(process.argv[2]==="ok"))console.log(s.label);
' "$1" "$2"
}
new_deadlines() { # <due after> <due before>: "<state><TAB><title><TAB><slug>"
  "$NODE" "$HERE/telegram-judge.mjs" deadlines "$1" "$2"
}

check() { # <evidence folder>
  local folder=$1 label text count opened slug
  [ -d "$folder" ] || fail "there is nothing at $folder, so this scenario kept no evidence of a connection check"
  need_node
  kept_all "$folder" 'what was sent and opened' run.json routines.json due-before.json telegram-fixture-calls.log
  for label in check-1 check-2 check-3; do kept "$folder" "due-$label.json" "the deadlines after $label"; done
  for text in "$CHECK_ROUTINE" "$MISSED" "$TWICE" "$ONCE"; do
    grep -qF "\"$text\"" "$folder/routines.json" || fail "the install has no routine named $text, so the scenario's routines were not made"
  done

  # Only the two routines made to fail may fail, and they did.
  for label in $(steps_labelled "$folder/run.json" bad); do
    case $label in
      fail-twice-1 | fail-twice-2 | fail-once-1) ;;
      *) fail "the step $label of the run did not work, so the connection check could not be tried (its error is in run.json)" ;;
    esac
  done
  for label in fail-twice-1 fail-twice-2 fail-once-1; do
    steps_labelled "$folder/run.json" bad | grep -qx "$label" ||
      fail "the routine meant to fail ($label) did not fail, so the scenario made no failing routine"
  done

  # check 1: one message, naming the missed routine and the one that failed twice, not the one that failed once.
  text=$(outbox_between "$folder/run.json" check-1 accepted)
  count=$(grep -c . <<<"$text" || true)
  [ "$count" = 1 ] || fail "the connection check told the owner in $count messages, not one: $(tr '\n' '|' <<<"$text" | cut -c1-300)"
  grep -qF "$MISSED" <<<"$text" || fail "the one message does not name the routine whose time passed without a run ($MISSED): $text"
  grep -qF "$TWICE" <<<"$text" || fail "the one message does not name the routine that failed twice ($TWICE): $text"
  grep -qF "$ONCE" <<<"$text" && fail "the message names the routine that failed only once ($ONCE): $text"

  # check 2: nothing more.
  text=$(outbox_between "$folder/run.json" check-2 | head -n 1)
  [ -z "$text" ] || fail "the second run of the connection check sent a message again: $text"

  # The deadlines it opened are closed by the good runs, and none is about the routine that failed once.
  opened=$(new_deadlines "$folder/due-check-1.json" "$folder/due-before.json" | awk -F'\t' '$1=="open"')
  [ -n "$opened" ] || fail "the connection check opened no deadline for a routine that did not run and one that failed twice"
  grep -qF "$ONCE" <<<"$opened" && fail "a deadline is open about the routine that failed only once: $(tr '\t\n' ' ' <<<"$opened")"
  count=$(new_deadlines "$folder/due-check-2.json" "$folder/due-check-1.json" | grep -c . || true)
  [ "$count" = 0 ] || fail "the second run of the connection check opened $count more deadlines"
  while IFS=$'\t' read -r _ text slug; do
    [ "$("$NODE" "$HERE/telegram-judge.mjs" state "$folder/due-check-3.json" "$slug")" = closed ] ||
      fail "the deadline \"$text\" is $("$NODE" "$HERE/telegram-judge.mjs" state "$folder/due-check-3.json" "$slug"), not closed, after each routine had a good run"
  done <<<"$opened"
  no_code_in "$folder/run.json"
  pass "with a routine missed, one failed twice and one failed once, the connection check sent one message naming the first two and not the third; the second run sent nothing; after a good run of each the $(grep -c . <<<"$opened") deadline(s) it opened were closed"
}

if [ "$CHECK_ONLY" = yes ]; then
  install_paths
  need_node
  check "$EVIDENCE"
else
  act
  check "$EVIDENCE"
fi
