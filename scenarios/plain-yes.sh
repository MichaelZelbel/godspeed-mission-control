#!/usr/bin/env bash
# PROVING SCENARIO OF 2.0.0-beta.17: a plain yes, or a button, answers the right waiting step.
#
# What it proves (godspeed-dev, releases/godspeed-2.0.0-beta.17-a-plain-yes/plan.md, "Proving
# scenarios" 3, and issue #191), on an install whose owner is on a fixture Telegram, with steps opened
# by a fixture asker (scenario-asker.py) that uses the one way the product gives a job to ask:
#   a  one step waits: "yes" approves it, with one reply
#   b  two steps wait: "yes" gets exactly one question, in words, that names both, and approves
#      neither; the answer that names one approves only that one
#   c  the owner presses Yes under the question of a waiting step: that step is approved, and only it
#   d  nothing waits: a "yes" approves nothing (a button's No rejected the last one before)
# and no message tells the owner to type a code.
#
# THE TELEGRAM IS A FIXTURE (owner-on-telegram.py): only Telegram's servers are stood in for. THE BUTTONS
# are ticket 02's (#197); until they are wired to the waiting steps, a question without them is a FAIL.
#
#   GODSPEED_SCENARIO_AI_KEY    the model that reads the owner's "yes" (without it: FAIL), with
#                               GODSPEED_SCENARIO_AI_URL and GODSPEED_SCENARIO_AI_MODEL.
#
#   bash scenarios/plain-yes.sh candidate/2.0.0-beta.17
#   bash scenarios/plain-yes.sh --check <folder>
#
# What it keeps for its checking part:
#   run.json                 every message sent (with its step's label and buttons) and each step's outcome
#   approvals-<label>.json   the waiting steps after each step: a-ask a b-ask b b-choice c-ask c-press d-no d
#   telegram-fixture.json, driver.log, ai.txt, routines.json, config.yaml, plugins.txt
SCENARIO=plain-yes
# shellcheck source=scenarios/scenario-lib.sh
. "$(dirname "$0")/scenario-lib.sh"
scenario_arguments "$@"


ask_file() { # <label> <about> <question> <yes> <no>
  printf '[{"about":%s,"question":%s,"yes":%s,"no":%s}]\n' "$(quoted_json "$2")" "$(quoted_json "$3")" \
    "$(quoted_json "$4")" "$(quoted_json "$5")" >"$EVIDENCE/asks-$1.json"
}
two_asks_file() { # <label> <about 1> <question 1> <yes 1> <no 1> <about 2> <question 2> <yes 2> <no 2>
  printf '[{"about":%s,"question":%s,"yes":%s,"no":%s},{"about":%s,"question":%s,"yes":%s,"no":%s}]\n' \
    "$(quoted_json "$2")" "$(quoted_json "$3")" "$(quoted_json "$4")" "$(quoted_json "$5")" \
    "$(quoted_json "$6")" "$(quoted_json "$7")" "$(quoted_json "$8")" "$(quoted_json "$9")" >"$EVIDENCE/asks-$1.json"
}

act() {
  need_the_ai_key "the owner's plain \"yes\" read in the chat"
  fresh_evidence
  install_paths
  install_the_stage_line "$EVIDENCE/.install.log"
  need_node
  wait_for 180 "the notebook to answer after the install" notebook_is_up ||
    fail "the notebook does not answer after the install"
  read_version "$ROOT"
  assistant_home
  connect_the_ai
  echo "the connected AI ($AI_MODEL)" >"$EVIDENCE/ai.txt"
  phase 'the owner on a fixture Telegram, and the fixture asker'
  owner_on_telegram_install yes

  phase 'a plain yes, two waiting, a button, and nothing waiting'
  ask_file a-ask "Share this week's food log with your nutritionist" \
    "Share this week's food log with your nutritionist?" 'The log is shared' 'It stays private'
  two_asks_file b-ask "Send this week's food log to your nutritionist" \
    "Send this week's food log to your nutritionist?" 'The log is sent' 'Nothing is sent' \
    'Cancel the renewal of your gym membership' 'Cancel the renewal of your gym membership?' 'The renewal is cancelled' 'The membership renews'
  ask_file c-ask "Book the car's yearly inspection" "Book the car's yearly inspection?" 'The inspection is booked' 'Nothing is booked'
  steps_file "$EVIDENCE/steps.json" \
    "$(asker_steps a-ask "$EVIDENCE/asks-a-ask.json")" "$(snapshot_step a-ask approvals)" \
    "$(step_of say a '"text":"yes","session":"scenario-owner-a"')" "$(snapshot_step a approvals)" \
    "$(asker_steps b-ask "$EVIDENCE/asks-b-ask.json")" "$(snapshot_step b-ask approvals)" \
    "$(step_of say b '"text":"yes","session":"scenario-owner-b"')" "$(snapshot_step b approvals)" \
    "$(step_of say b-choice '"text":"the food log one","session":"scenario-owner-b"')" "$(snapshot_step b-choice approvals)" \
    "$(asker_steps c-ask "$EVIDENCE/asks-c-ask.json")" "$(snapshot_step c-ask approvals)" \
    "$(step_of press c-press '"message":"last-with-buttons","contains":"gym","button":"Yes"')" "$(snapshot_step c-press approvals)" \
    "$(step_of press d-no '"message":"last-with-buttons","contains":"inspection","button":"No"')" "$(snapshot_step d-no approvals)" \
    "$(step_of say d '"text":"yes","session":"scenario-owner-d"')" "$(snapshot_step d approvals)"
  owner_on_telegram "$EVIDENCE/steps.json" "$EVIDENCE/run.json"
  rm -f "$EVIDENCE"/.[a-z]*
}

# ------------------------------------------------------------------------------ what it judges
messages_of() { outbox_between "$FOLDER/run.json" "$@"; }
status_after() { # <label> <text the waiting step holds>
  "$NODE" "$HERE/telegram-judge.mjs" status "$FOLDER/approvals-$1.json" "$2" | head -n 1
}
check() { # <evidence folder>
  local folder=$1 label text count
  FOLDER=$folder
  [ -d "$folder" ] || fail "there is nothing at $folder, so this scenario kept no evidence of a plain yes"
  need_node
  kept_all "$folder" 'what was sent to the owner and what waited' run.json telegram-fixture.json
  for label in a-ask a b-ask b b-choice c-ask c-press d-no d; do
    kept "$folder" "approvals-$label.json" "the waiting steps after $label"
  done
  text=$(step_failure "$folder/run.json")
  [ -z "$text" ] || fail "a step of the run did not work, so a plain yes could not be tried: $text"

  # a. One step waits and a plain yes approves it.
  [ "$(status_after a 'Share this week')" = approved ] || fail "one step waited and the owner's \"yes\" did not approve it (it is \"$(status_after a 'Share this week')\")"
  count=$(messages_of a accepted | grep -c . || true)
  [ "$count" = 1 ] || fail "the owner's \"yes\" to the one waiting step was answered with $count messages, not one"

  # b. Two wait: one question in words naming both, nothing approved by "yes", and the named one by the answer.
  count=$(messages_of b accepted | grep -c . || true)
  [ "$count" = 1 ] || fail "the owner's \"yes\" with two steps waiting got $count messages, not one question"
  text=$(messages_of b accepted)
  if ! grep -qiE 'food log|nutritionist' <<<"$text" || ! grep -qiE 'gym|membership' <<<"$text"; then
    fail "the question to a \"yes\" with two steps waiting does not name both of them (the food log and the gym membership): $text"
  fi
  [ "$(status_after b 'Send this week')" = pending ] && [ "$(status_after b 'gym')" = pending ] ||
    fail "a \"yes\" with two steps waiting approved one of them (food log: \"$(status_after b 'Send this week')\", gym: \"$(status_after b 'gym')\")"
  [ "$(status_after b-choice 'Send this week')" = approved ] ||
    fail "the answer \"the food log one\" did not approve the food log step (it is \"$(status_after b-choice 'Send this week')\")"
  [ "$(status_after b-choice 'gym')" = pending ] ||
    fail "the answer \"the food log one\" approved the gym step too (it is \"$(status_after b-choice 'gym')\")"

  # c. A button approves its own step and no other.
  for label in b-ask c-ask; do
    count=$("$NODE" "$HERE/telegram-judge.mjs" buttons "$folder/run.json" "$label" "$([ "$label" = b-ask ] && echo gym || echo inspection)")
    [ "$count" -ge 1 ] || fail "the question went out without Yes/No buttons ($label; ticket 02, #197)"
  done
  [ "$(status_after c-press 'gym')" = approved ] ||
    fail "pressing Yes under the gym membership question did not approve it (it is \"$(status_after c-press 'gym')\")"
  [ "$(status_after c-press 'inspection')" = pending ] ||
    fail "pressing Yes under the gym membership question changed the car inspection step (it is \"$(status_after c-press 'inspection')\")"
  [ "$(status_after d-no 'inspection')" = rejected ] ||
    fail "pressing No under the car inspection question did not reject it (it is \"$(status_after d-no 'inspection')\")"

  # d. Nothing waits: a "yes" approves nothing and gets an ordinary answer.
  [ "$("$NODE" "$HERE/telegram-judge.mjs" waiting "$folder/approvals-d.json")" = 0 ] || fail "steps waited when nothing should have"
  cmp -s <("$NODE" "$HERE/telegram-judge.mjs" status "$folder/approvals-d-no.json" '') <("$NODE" "$HERE/telegram-judge.mjs" status "$folder/approvals-d.json" '') ||
    fail "a \"yes\" with nothing waiting changed the status of a step"
  [ "$(messages_of d accepted | grep -c . || true)" -ge 1 ] || fail "a \"yes\" with nothing waiting got no answer at all"

  no_code_in "$folder/run.json" "$folder"/approvals-*.json
  pass "one waiting step took a plain \"yes\" with one reply; two waiting got one question naming both and the answer approved only the one named; Yes under a question approved only its own step and No rejected the other; a \"yes\" with nothing waiting approved nothing; no message holds a code"
}

if [ "$CHECK_ONLY" = yes ]; then
  install_paths
  need_node
  check "$EVIDENCE"
else
  act
  check "$EVIDENCE"
fi
