#!/usr/bin/env bash
# PROVING SCENARIO OF 2.0.0-beta.17: the daily connection check speaks only when a connection breaks.
#
# What it proves (godspeed-dev, releases/godspeed-2.0.0-beta.17-a-plain-yes/plan.md, "Proving
# scenarios" 7, and issue #191, ticket 06), on an install whose owner is on a fixture Telegram:
#   fine      the "Daily connection check" runs with Telegram's key valid: nothing is sent, no deadline
#             opens, the bell holds no connection record
#   broken    Telegram refuses the key: exactly one message about it reaches the owner, and exactly one
#             deadline about Telegram opens
#   repaired  the key is valid again: the next run closes that deadline
#
# THE TELEGRAM IS A FIXTURE. The check asks Telegram's servers itself, from Node, so the stand-in for
# them is loaded into every Node program the driver starts (telegram-fixture-fetch.mjs): it answers
# getMe for the valid token and refuses any other with 401, and logs every call it answered. A check
# that never reached it is a FAIL, not a quiet pass.
#
# THE ROUTINE is matched by its name and the deadline by its title and its being new, so this does not
# depend on the slugs ticket 06 (#200) chose.
#
# No AI is connected: nothing in this scenario talks to a model.
#
#   bash scenarios/connection-check.sh candidate/2.0.0-beta.17
#   bash scenarios/connection-check.sh --check <folder>
#
# What it keeps for its checking part:
#   run.json                         every message sent (with its step's label) and each step's outcome
#   routines.json                    the routines the install made
#   due-before.json, due-<label>.json   the deadlines before and after each run: fine, broken, repaired
#   notifications-before.json, notifications-<label>.json   the notebook's bell
#   telegram-fixture-calls.log       one line per call the stand-in answered
#   telegram-fixture.json, driver.log, config.yaml, plugins.txt
SCENARIO=connection-check
# shellcheck source=scenarios/scenario-lib.sh
. "$(dirname "$0")/scenario-lib.sh"
scenario_arguments "$@"

ROUTINE='Daily connection check'

has_the_routine() { grep -qF "\"$ROUTINE\"" "$1/routines.json" 2>/dev/null; }
no_routine() { fail "this install has no $ROUTINE (ticket 06, #200)"; }

run_and_look() { # <label>: the routine, then the deadlines and the bell as they are afterwards
  step_of cron "$1" "\"job\":\"$ROUTINE\""
  printf ','
  step_of run "$1" "\"argv\":[\"$NODE\",$(quoted_json "$(product_script "$ROOT" notebook/bin/personal-command.mjs)"),\"due\",\"state\",\"--json\"],\"env\":{\"GODSPEED_WORKSPACE\":$(quoted_json "$ROOT")},\"stdout_file\":$(quoted_json "$EVIDENCE/due-$1.json")"
  printf ','
  snapshot_step "$1" notifications
}

act() {
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
  has_the_routine "$EVIDENCE" || no_routine
  due_on "$ROOT" state --json >"$EVIDENCE/due-before.json" ||
    fail "the install's deadlines could not be read before the connection check ran"

  phase 'the connection check: fine, broken, repaired'
  steps_file "$EVIDENCE/steps.json" \
    "$(snapshot_step before notifications)" \
    "$(run_and_look fine)" \
    "$(step_of token broken '"valid":false')" "$(run_and_look broken)" \
    "$(step_of token repaired '"valid":true')" "$(run_and_look repaired)"
  owner_on_telegram "$EVIDENCE/steps.json" "$EVIDENCE/run.json"
  rm -f "$EVIDENCE"/.[a-z]*
}

# ------------------------------------------------------------------------------ what it judges
check() { # <evidence folder>
  local folder=$1 label text count title
  [ -d "$folder" ] || fail "there is nothing at $folder, so this scenario kept no evidence of a connection check"
  need_node
  kept_all "$folder" 'what was sent, opened and rung' run.json routines.json due-before.json notifications-before.json telegram-fixture-calls.log
  for label in fine broken repaired; do
    kept "$folder" "due-$label.json" "the deadlines after the run of $label"
    kept "$folder" "notifications-$label.json" "the bell after the run of $label"
  done
  has_the_routine "$folder" || no_routine
  text=$(step_failure "$folder/run.json")
  [ -z "$text" ] || fail "a step of the run did not work, so the connection check could not be tried: $text"

  # The check's own calls reached the stand-in: two answered, one refused.
  [ "$(grep -c '^getMe valid$' "$folder/telegram-fixture-calls.log" || true)" -ge 2 ] &&
    [ "$(grep -c '^getMe invalid$' "$folder/telegram-fixture-calls.log" || true)" -ge 1 ] ||
    fail "the connection check never asked the stand-in for Telegram's servers (getMe: $(sort "$folder/telegram-fixture-calls.log" | uniq -c | tr '\n' ' ')), so its runs prove nothing"

  # fine: it says nothing.
  text=$(outbox_between "$folder/run.json" fine | head -n 1)
  [ -z "$text" ] || fail "the connection check sent a message although everything was fine: $text"
  [ -z "$("$NODE" "$HERE/telegram-judge.mjs" deadlines "$folder/due-fine.json" "$folder/due-before.json")" ] ||
    fail "the connection check opened a deadline although everything was fine: $("$NODE" "$HERE/telegram-judge.mjs" deadlines "$folder/due-fine.json" "$folder/due-before.json" | tr '\t\n' ' ')"
  [ "$("$NODE" "$HERE/telegram-judge.mjs" bell "$folder/notifications-fine.json" "$folder/notifications-before.json" connection)" = 0 ] ||
    fail "the connection check put a connection record in the bell although everything was fine"

  # broken: one message, one deadline.
  text=$({ outbox_between "$folder/run.json" broken | grep -i 'telegram' || true
    "$NODE" "$HERE/telegram-judge.mjs" bell "$folder/notifications-broken.json" "$folder/notifications-fine.json"; } | sort -u)
  count=$(grep -c . <<<"$text" || true)
  [ "$count" = 1 ] || fail "a refused Telegram key told the owner in $count different texts, not one: $(tr '\n' '|' <<<"$text" | cut -c1-300)"
  grep -qi 'telegram' <<<"$text" || fail "the one message about the refused key does not say it is Telegram: $text"
  count=$("$NODE" "$HERE/telegram-judge.mjs" deadlines "$folder/due-broken.json" "$folder/due-before.json" | awk -F'\t' '$1=="open" && tolower($2) ~ /telegram/' | grep -c . || true)
  [ "$count" = 1 ] || fail "a refused Telegram key opened $count deadlines about Telegram, not one"

  # repaired: the deadline is closed.
  deadline=$("$NODE" "$HERE/telegram-judge.mjs" deadlines "$folder/due-broken.json" "$folder/due-before.json" | awk -F'\t' '$1=="open" && tolower($2) ~ /telegram/ {print $2 "\t" $3}')
  title=${deadline%%$'\t'*}
  slug=${deadline##*$'\t'}
  state=$("$NODE" "$HERE/telegram-judge.mjs" state "$folder/due-repaired.json" "$slug")
  [ "$state" = closed ] || fail "the deadline about Telegram (\"$title\") is $state, not closed, after the key was valid again"
  no_code_in "$folder/run.json"
  pass "with Telegram's key valid the connection check sent nothing, opened no deadline and rang no connection bell; with the key refused it told the owner once (one text about Telegram) and opened one deadline (\"$title\"); with the key valid again the next run closed it"
}

if [ "$CHECK_ONLY" = yes ]; then
  install_paths
  need_node
  check "$EVIDENCE"
else
  act
  check "$EVIDENCE"
fi
