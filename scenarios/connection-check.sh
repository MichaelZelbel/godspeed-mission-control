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
# The local Bot API fixture answers the installed server's real HTTP calls: getMe with the valid key
# and 401 with the refused one. A check that never reaches it is a FAIL, not a quiet pass.
#
# THE ROUTINE is matched by its name and the deadline by its title and its being new, so this does not
# depend on the slugs ticket 06 (#200) chose.
#
# This scenario exercises only the connection routine: the installed setup's supported no-sign-in
# branch leaves AI unconfigured, so the current workflow can run it without an AI credential.
#
#   bash scenarios/connection-check.sh candidate/2.0.0-beta.17
#   bash scenarios/connection-check.sh --check <folder>
#
# What it keeps for its checking part:
#   run.json                         every message sent (with its step's label) and each step's outcome
#   routines.json                    the routines the install made
#   due-before.json, due-<label>.json   the deadlines before and after each run: fine, broken, repaired
#   notifications-before.json, notifications-<label>.json   the notebook's bell
#   telegram-requests.json, runner.json  redacted local Bot API traffic and installed gateway state
#   routine-diagnostics-<label>.json, routine-output-<label>/  each admitted Hermes child and its run log
SCENARIO=connection-check
# shellcheck source=scenarios/scenario-lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/scenario-lib.sh"
. "$HERE/server-lib.sh"
scenario_arguments "$@"

ROUTINE='Daily connection check'

has_the_routine() { grep -qF "\"$ROUTINE\"" "$1/routines.json" 2>/dev/null; }
no_routine() { fail "this install has no $ROUTINE (ticket 06, #200)"; }

run_and_look() { # <label>: the installed routine, then its visible records
  local status=ok
  [ "$1" = broken ] && status=delivery_failed
  server_run_job "$1" "$ROUTINE" 300 "$status"
  server_telegram_mark "$1" cron
  server_snapshot_table "$1" deadlines
  server_snapshot_table "$1" notifications
}

act() {
  fresh_evidence
  install_paths
  need_node
  server_install
  phase 'the owner on the installed Docker Telegram gateway'
  server_telegram_setup without-ai
  printf '{"goal":"Sleep eight hours a night","timezone":"Etc/UTC","delivery":"telegram"}\n' >"$EVIDENCE/.setup.json"
  [ "$(server_post /api/setup "$EVIDENCE/.setup.json" "$EVIDENCE/setup.json")" = 200 ] || fail 'the installed notebook would not make routines for the fixture goal'
  server_pause_all_jobs
  server_table jobs "$EVIDENCE/routines.json"
  has_the_routine "$EVIDENCE" || no_routine
  server_table deadlines "$EVIDENCE/due-before.json"
  server_table notifications "$EVIDENCE/notifications-before.json"

  phase 'the connection check: fine, broken, repaired'
  run_and_look fine
  server_set_telegram_token '5550001111:SCENARIO-revoked-bbbbbbbbbbbbbbbbbbbbbbbb'
  run_and_look broken
  server_set_telegram_token "$SERVER_TELEGRAM_TOKEN"
  run_and_look repaired
  server_telegram_snapshot
  server_manifest
  rm -f "$EVIDENCE"/.[a-z]*
}

# ------------------------------------------------------------------------------ what it judges
check() { # <evidence folder>
  local folder=$1 label text count title
  [ -d "$folder" ] || fail "there is nothing at $folder, so this scenario kept no evidence of a connection check"
  need_node
  kept_all "$folder" 'what was sent, opened and rung' run.json routines.json due-before.json notifications-before.json telegram-requests.json runner.json manifest.json
  for label in fine broken repaired; do
    kept "$folder" "due-$label.json" "the deadlines after the run of $label"
    kept "$folder" "notifications-$label.json" "the bell after the run of $label"
  done
  has_the_routine "$folder" || no_routine
  text=$(step_failure "$folder/run.json")
  [ -z "$text" ] || fail "a step of the run did not work, so the connection check could not be tried: $text"

  # The check's own calls reached the stand-in: two answered, one refused.
  "$NODE" -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).requests||[];const good=r.filter(x=>x.method==="getMe"&&x.authorized).length,bad=r.filter(x=>x.method==="getMe"&&!x.authorized).length;process.exit(good>=2&&bad>=1?0:1)' "$folder/telegram-requests.json" ||
    fail 'the connection check never asked the fake Telegram API twice with its valid key and once with the refused key, so its runs prove nothing'

  # fine: it says nothing.
  interaction_begin fine
  text=$(outbox_between "$folder/run.json" fine | head -n 1)
  [ -z "$text" ] || fail "the connection check sent a message although everything was fine: $text"
  [ -z "$("$NODE" "$HERE/telegram-judge.mjs" deadlines "$folder/due-fine.json" "$folder/due-before.json")" ] ||
    fail "the connection check opened a deadline although everything was fine: $("$NODE" "$HERE/telegram-judge.mjs" deadlines "$folder/due-fine.json" "$folder/due-before.json" | tr '\t\n' ' ')"
  [ "$("$NODE" "$HERE/telegram-judge.mjs" bell "$folder/notifications-fine.json" "$folder/notifications-before.json" connection)" = 0 ] ||
    fail "the connection check put a connection record in the bell although everything was fine"
  interaction_passed fine

  # broken: one message, one deadline.
  interaction_begin broken
  text=$({ outbox_between "$folder/run.json" broken | grep -i 'telegram' || true
    "$NODE" "$HERE/telegram-judge.mjs" bell "$folder/notifications-broken.json" "$folder/notifications-fine.json"; } | sort -u)
  count=$(grep -c . <<<"$text" || true)
  [ "$count" = 1 ] || fail "a refused Telegram key told the owner in $count different texts, not one: $(tr '\n' '|' <<<"$text" | cut -c1-300)"
  grep -qi 'telegram' <<<"$text" || fail "the one message about the refused key does not say it is Telegram: $text"
  count=$("$NODE" "$HERE/telegram-judge.mjs" deadlines "$folder/due-broken.json" "$folder/due-before.json" | awk -F'\t' '$1=="open" && tolower($2) ~ /telegram/' | grep -c . || true)
  [ "$count" = 1 ] || fail "a refused Telegram key opened $count deadlines about Telegram, not one"
  interaction_passed broken

  # repaired: the deadline is closed.
  interaction_begin repaired
  deadline=$("$NODE" "$HERE/telegram-judge.mjs" deadlines "$folder/due-broken.json" "$folder/due-before.json" | awk -F'\t' '$1=="open" && tolower($2) ~ /telegram/ {print $2 "\t" $3}')
  title=${deadline%%$'\t'*}
  slug=${deadline##*$'\t'}
  state=$("$NODE" "$HERE/telegram-judge.mjs" state "$folder/due-repaired.json" "$slug")
  [ "$state" = closed ] || fail "the deadline about Telegram (\"$title\") is $state, not closed, after the key was valid again"
  interaction_passed repaired
  no_code_in "$folder/run.json"
  pass "with Telegram's key valid the connection check sent nothing, opened no deadline and rang no connection bell; with the key refused it told the owner once (one text about Telegram) and opened one deadline (\"$title\"); with the key valid again the next run closed it"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  if [ "$CHECK_ONLY" = yes ]; then
    install_paths
    need_node
    check "$EVIDENCE"
  else
    act
    check "$EVIDENCE"
  fi
fi
