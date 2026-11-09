#!/usr/bin/env bash
# PROVING SCENARIO OF 2.0.0-beta.17: right after a background report, "what is this about?" is
# answered from what was sent.
#
# What it proves (godspeed-dev, releases/godspeed-2.0.0-beta.17-a-plain-yes/plan.md, "Proving
# scenarios" 4, and issue #191, ticket 03): on an install whose owner is on a fixture Telegram, a notice
# is queued through the product's own function with the subject and the facts it was written from; the
# routine that says notices sends it; and
#   - the report is recorded where the chat reads it (a conversation message from the background,
#     the same words that were sent, with the facts);
#   - the owner asks "what is this about?" in a NEW conversation, where Hermes' own chat history holds
#     nothing of the report, and the answer names what the report was about.
#
# The advertised Docker Telegram route supplies the installed gateway; only its local Bot API is a fixture.
#
#   GODSPEED_SCENARIO_AI_KEY    the model that answers the owner (without it: FAIL), with
#                               GODSPEED_SCENARIO_AI_URL and GODSPEED_SCENARIO_AI_MODEL.
#
#   bash scenarios/what-was-that.sh candidate/2.0.0-beta.17
#   bash scenarios/what-was-that.sh --check <folder>
#
# What it keeps for its checking part:
#   run.json                         the report that was sent, the answer, and each step's outcome
#   report-facts.json                the facts the report was written from
#   conversation_messages-report.json  what the notebook's chat held after the report went out
#   telegram-requests.json, runner.json, routines.json
#   routine-diagnostics-report.json, routine-output-report/  the admitted Hermes child and its run log
SCENARIO=what-was-that
# shellcheck source=scenarios/scenario-lib.sh
. "$(dirname "$0")/scenario-lib.sh"
. "$HERE/server-lib.sh"
scenario_arguments "$@"

NOTICE_TEXT='Your notebook backup to GitHub did not run last night.'
NOTICE_ABOUT='The nightly backup of your notebook to GitHub stopped'
# The extra fields are ticket 03's (#198); where they are not known they are dropped and the notice is still queued.
FACTS='["At 03:00 GitHub refused the sign-in this computer uses for the backup","Your notes are safe on this computer; the copy on GitHub is from the day before"]'
act() {
  need_the_ai_key "the owner's question answered in the chat"
  fresh_evidence
  install_paths
  need_node
  server_install
  server_connects_the_model
  phase 'the owner on the installed Docker Telegram gateway'
  server_telegram_setup
  server_remember_gateway
  printf '{"goal":"Sleep eight hours a night","timezone":"Etc/UTC","delivery":"telegram"}\n' >"$EVIDENCE/.setup.json"
  [ "$(server_post /api/setup "$EVIDENCE/.setup.json" "$EVIDENCE/setup.json")" = 200 ] || fail 'the installed notebook would not make routines for the fixture goal'
  server_settle_gateway
  server_pause_all_jobs
  server_table jobs "$EVIDENCE/routines.json"
  printf '%s\n' "$FACTS" >"$EVIDENCE/report-facts.json"

  phase 'a notice queued, said by its routine, and asked about in a new conversation'
  server_queue_notice "$NOTICE_TEXT" "$NOTICE_ABOUT" "$FACTS"
  server_run_job report 'Coach reminders and habit check' 300
  server_telegram_mark report cron
  server_snapshot_table report conversation_messages
  server_telegram_say question 'what is this about?'
  server_telegram_snapshot
  server_manifest
  rm -f "$EVIDENCE"/.[a-z]*
}

# ------------------------------------------------------------------------------ what it judges
check() { # <evidence folder>
  local folder=$1 text answer
  [ -d "$folder" ] || fail "there is nothing at $folder, so this scenario kept no evidence of a report asked about"
  need_node
  kept_all "$folder" 'what was sent, recorded and answered' run.json report-facts.json conversation_messages-report.json telegram-requests.json runner.json manifest.json
  text=$(step_failure "$folder/run.json")
  [ -z "$text" ] || fail "a step of the run did not work, so the report could not be asked about: $text"

  interaction_begin report
  case $("$NODE" "$HERE/telegram-judge.mjs" recorded "$folder/run.json" report "$folder/conversation_messages-report.json" "$folder/report-facts.json") in
    ok) ;;
    not-sent) fail "the routine that says notices did not send exactly one message to the owner" ;;
    not-recorded) fail "the report was not recorded where the chat reads it (ticket 03, #198): the chat holds no background message with the words that were sent" ;;
    *) fail "the recorded report does not carry the facts it was written from ($(tr -d '\n' <"$folder/report-facts.json" | cut -c1-200))" ;;
  esac
  interaction_passed report

  interaction_begin question
  answer=$(outbox_between "$folder/run.json" question accepted)
  [ -n "$answer" ] || fail "the owner's \"what is this about?\" got no answer"
  if ! grep -qi 'backup' <<<"$answer" || ! grep -qi 'github' <<<"$answer"; then
    fail "the answer did not name what the report was about (the backup to GitHub): $answer"
  fi
  interaction_passed question
  no_code_in "$folder/run.json"
  pass "the report about the backup to GitHub was sent once, is recorded in the chat with the facts it was written from, and \"what is this about?\" asked in a new conversation was answered with the backup and GitHub; no message holds a code"
}

if [ "$CHECK_ONLY" = yes ]; then
  install_paths
  need_node
  check "$EVIDENCE"
else
  act
  check "$EVIDENCE"
fi
