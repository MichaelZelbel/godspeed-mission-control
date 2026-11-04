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
# THE TELEGRAM IS A FIXTURE (owner-on-telegram.py): only Telegram's servers are stood in for.
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
#   telegram-fixture.json, driver.log, ai.txt, routines.json, config.yaml, plugins.txt
SCENARIO=what-was-that
# shellcheck source=scenarios/scenario-lib.sh
. "$(dirname "$0")/scenario-lib.sh"
scenario_arguments "$@"

NOTICE_TEXT='Your notebook backup to GitHub did not run last night.'
NOTICE_ABOUT='The nightly backup of your notebook to GitHub stopped'
# The extra fields are ticket 03's (#198); where they are not known they are dropped and the notice is still queued.
FACTS='["At 03:00 GitHub refused the sign-in this computer uses for the backup","Your notes are safe on this computer; the copy on GitHub is from the day before"]'
QUEUE_NOTICE='
import {pathToFileURL} from "node:url";
const [notices,records,device,root,text,about,facts]=process.argv.slice(1);
const {queueNotice}=await import(pathToFileURL(notices).href);
const {Store}=await import(pathToFileURL(records).href);
const {machineDevice}=await import(pathToFileURL(device).href);
const store=new Store(root,{device:machineDevice(root).id});
if(!queueNotice(store,{id:"scenario-backup-1",text,about,facts:JSON.parse(facts)}))throw Error("the notice was already queued");
'

act() {
  need_the_ai_key "the owner's question answered in the chat"
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
  phase 'the owner on a fixture Telegram'
  owner_on_telegram_install no
  printf '%s\n' "$FACTS" >"$EVIDENCE/report-facts.json"

  phase 'a notice queued, said by its routine, and asked about in a new conversation'
  printf '%s' "$QUEUE_NOTICE" >"$EVIDENCE/queue-notice.mjs"
  steps_file "$EVIDENCE/steps.json" \
    "$(step_of run queue "\"argv\":[\"$NODE\",$(quoted_json "$EVIDENCE/queue-notice.mjs"),$(quoted_json "$(product_script "$ROOT" notebook/core/notices.mjs)"),$(quoted_json "$(product_script "$ROOT" notebook/core/records/store.mjs)"),$(quoted_json "$(product_script "$ROOT" notebook/core/device-id.mjs)"),$(quoted_json "$ROOT"),$(quoted_json "$NOTICE_TEXT"),$(quoted_json "$NOTICE_ABOUT"),$(quoted_json "$FACTS")]")" \
    "$(step_of cron report '"job":"Journal check-ins"')" "$(snapshot_step report conversation_messages)" \
    "$(step_of say question '"text":"what is this about?","session":"scenario-owner-new"')"
  owner_on_telegram "$EVIDENCE/steps.json" "$EVIDENCE/run.json"
  rm -f "$EVIDENCE"/.[a-z]*
}

# ------------------------------------------------------------------------------ what it judges
check() { # <evidence folder>
  local folder=$1 text answer
  [ -d "$folder" ] || fail "there is nothing at $folder, so this scenario kept no evidence of a report asked about"
  need_node
  kept_all "$folder" 'what was sent, recorded and answered' run.json report-facts.json conversation_messages-report.json telegram-fixture.json
  text=$(step_failure "$folder/run.json")
  [ -z "$text" ] || fail "a step of the run did not work, so the report could not be asked about: $text"

  case $("$NODE" "$HERE/telegram-judge.mjs" recorded "$folder/run.json" report "$folder/conversation_messages-report.json" "$folder/report-facts.json") in
    ok) ;;
    not-sent) fail "the routine that says notices did not send exactly one message to the owner" ;;
    not-recorded) fail "the report was not recorded where the chat reads it (ticket 03, #198): the chat holds no background message with the words that were sent" ;;
    *) fail "the recorded report does not carry the facts it was written from ($(tr -d '\n' <"$folder/report-facts.json" | cut -c1-200))" ;;
  esac

  answer=$(outbox_between "$folder/run.json" question accepted)
  [ -n "$answer" ] || fail "the owner's \"what is this about?\" got no answer"
  if ! grep -qi 'backup' <<<"$answer" || ! grep -qi 'github' <<<"$answer"; then
    fail "the answer did not name what the report was about (the backup to GitHub): $answer"
  fi
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
