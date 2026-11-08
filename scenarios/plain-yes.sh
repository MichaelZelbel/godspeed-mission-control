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
# The advertised Docker Telegram route supplies the installed gateway; only its local Bot API is a
# fixture. THE BUTTONS are ticket 02's (#197); until they are wired to the waiting steps, a question
# without them is a FAIL.
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
#   telegram-requests.json, runner.json, routines.json
SCENARIO=plain-yes
# shellcheck source=scenarios/scenario-lib.sh
. "$(dirname "$0")/scenario-lib.sh"
. "$HERE/server-lib.sh"
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
  need_node
  require_candidate_server
  server_connects_the_model
  phase 'the owner on the installed Docker Telegram gateway, and the fixture asker'
  server_telegram_setup
  printf '{"goal":"Sleep eight hours a night","timezone":"Etc/UTC","delivery":"telegram"}\n' >"$EVIDENCE/.setup.json"
  [ "$(server_post /api/setup "$EVIDENCE/.setup.json" "$EVIDENCE/setup.json")" = 200 ] || fail 'the installed notebook would not make routines for the fixture goal'
  server_pause_all_jobs
  server_install_asker
  server_table jobs "$EVIDENCE/routines.json"

  phase 'a plain yes, two waiting, a button, and nothing waiting'
  ask_file a-ask "Share this week's food log with your nutritionist" \
    "Share this week's food log with your nutritionist?" 'The log is shared' 'It stays private'
  two_asks_file b-ask "Send this week's food log to your nutritionist" \
    "Send this week's food log to your nutritionist?" 'The log is sent' 'Nothing is sent' \
    'Cancel the renewal of your gym membership' 'Cancel the renewal of your gym membership?' 'The renewal is cancelled' 'The membership renews'
  ask_file c-ask "Book the car's yearly inspection" "Book the car's yearly inspection?" 'The inspection is booked' 'Nothing is booked'
  server_set_asks "$EVIDENCE/asks-a-ask.json"; server_run_asker a-ask; server_snapshot_table a-ask approvals
  server_telegram_say a yes; server_snapshot_table a approvals
  server_set_asks "$EVIDENCE/asks-b-ask.json"; server_run_asker b-ask; server_snapshot_table b-ask approvals
  server_telegram_say b yes; server_snapshot_table b approvals
  server_telegram_say b-choice 'the food log one'; server_snapshot_table b-choice approvals
  server_set_asks "$EVIDENCE/asks-c-ask.json"; server_run_asker c-ask; server_snapshot_table c-ask approvals
  server_telegram_press c-press gym Yes; server_snapshot_table c-press approvals
  server_telegram_press d-no inspection No; server_snapshot_table d-no approvals
  server_telegram_say d yes; server_snapshot_table d approvals
  server_telegram_snapshot
  server_manifest
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
  kept_all "$folder" 'what was sent to the owner and what waited' run.json telegram-requests.json runner.json manifest.json
  for label in a-ask a b-ask b b-choice c-ask c-press d-no d; do
    kept "$folder" "approvals-$label.json" "the waiting steps after $label"
  done
  text=$(step_failure "$folder/run.json")
  [ -z "$text" ] || fail "a step of the run did not work, so a plain yes could not be tried: $text"

  # a. One step waits and a plain yes approves it.
  interaction_begin a-ask
  [ "$(status_after a-ask 'Share this week')" = pending ] || fail 'the one waiting step was not offered to the owner'
  interaction_passed a-ask
  interaction_begin a
  [ "$(status_after a 'Share this week')" = approved ] || fail "one step waited and the owner's \"yes\" did not approve it (it is \"$(status_after a 'Share this week')\")"
  count=$(messages_of a accepted | grep -c . || true)
  [ "$count" = 1 ] || fail "the owner's \"yes\" to the one waiting step was answered with $count messages, not one"
  interaction_passed a

  # b. Two wait: one question in words naming both, nothing approved by "yes", and the named one by the answer.
  interaction_begin b
  count=$(messages_of b accepted | grep -c . || true)
  [ "$count" = 1 ] || fail "the owner's \"yes\" with two steps waiting got $count messages, not one question"
  text=$(messages_of b accepted)
  if ! grep -qiE 'food log|nutritionist' <<<"$text" || ! grep -qiE 'gym|membership' <<<"$text"; then
    fail "the question to a \"yes\" with two steps waiting does not name both of them (the food log and the gym membership): $text"
  fi
  [ "$(status_after b 'Send this week')" = pending ] && [ "$(status_after b 'gym')" = pending ] ||
    fail "a \"yes\" with two steps waiting approved one of them (food log: \"$(status_after b 'Send this week')\", gym: \"$(status_after b 'gym')\")"
  interaction_passed b
  interaction_begin b-choice
  [ "$(status_after b-choice 'Send this week')" = approved ] ||
    fail "the answer \"the food log one\" did not approve the food log step (it is \"$(status_after b-choice 'Send this week')\")"
  [ "$(status_after b-choice 'gym')" = pending ] ||
    fail "the answer \"the food log one\" approved the gym step too (it is \"$(status_after b-choice 'gym')\")"
  interaction_passed b-choice

  # c. A button approves its own step and no other.
  for label in b-ask c-ask; do
    interaction_begin "$label"
    count=$("$NODE" "$HERE/telegram-judge.mjs" buttons "$folder/run.json" "$label" "$([ "$label" = b-ask ] && echo gym || echo inspection)")
    [ "$count" -ge 1 ] || fail "the question went out without Yes/No buttons ($label; ticket 02, #197)"
    interaction_passed "$label"
  done
  interaction_begin c-press
  [ "$(status_after c-press 'gym')" = approved ] ||
    fail "pressing Yes under the gym membership question did not approve it (it is \"$(status_after c-press 'gym')\")"
  [ "$(status_after c-press 'inspection')" = pending ] ||
    fail "pressing Yes under the gym membership question changed the car inspection step (it is \"$(status_after c-press 'inspection')\")"
  interaction_passed c-press
  interaction_begin d-no
  [ "$(status_after d-no 'inspection')" = rejected ] ||
    fail "pressing No under the car inspection question did not reject it (it is \"$(status_after d-no 'inspection')\")"
  interaction_passed d-no

  # d. Nothing waits: a "yes" approves nothing and gets an ordinary answer.
  interaction_begin d
  [ "$("$NODE" "$HERE/telegram-judge.mjs" waiting "$folder/approvals-d.json")" = 0 ] || fail "steps waited when nothing should have"
  cmp -s <("$NODE" "$HERE/telegram-judge.mjs" status "$folder/approvals-d-no.json" '') <("$NODE" "$HERE/telegram-judge.mjs" status "$folder/approvals-d.json" '') ||
    fail "a \"yes\" with nothing waiting changed the status of a step"
  [ "$(messages_of d accepted | grep -c . || true)" -ge 1 ] || fail "a \"yes\" with nothing waiting got no answer at all"
  interaction_passed d

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
