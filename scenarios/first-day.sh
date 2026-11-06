#!/usr/bin/env bash
# PROVING SCENARIO: a freshly installed Docker server turns one fictional first goal into useful
# private work, a saved morning brief, and a matching reply on its installed Telegram gateway.
SCENARIO=first-day
# shellcheck source=scenarios/scenario-lib.sh
. "$(dirname "$0")/scenario-lib.sh"
# shellcheck source=scenarios/server-lib.sh
. "$HERE/server-lib.sh"
scenario_arguments "$@"

GOAL='Prepare a practical household emergency-kit checklist by Sunday.'
RESEARCH='Nightly goal research'
CHOOSE="Daily round: choose today's work"
WORK='Daily round: do the work'

rows_with() { # <file> <needle>
  "$NODE" -e 'const fs=require("fs"),d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")),rows=Array.isArray(d)?d:d.data||[];process.stdout.write(String(rows.filter(r=>JSON.stringify(r).includes(process.argv[2])).length))' "$1" "$2"
}

act() {
  fresh_evidence
  install_paths
  need_node
  server_install
  server_connects_the_model
  phase 'the owner connects the fictional bot through the installed Docker Telegram setup'
  server_telegram_setup
  phase 'the fictional emergency-kit goal is filed through the installed notebook'
  printf '{"goal":%s,"timezone":"Etc/UTC","delivery":"telegram"}\n' "$(quoted_json "$GOAL")" >"$EVIDENCE/.setup.json"
  [ "$(server_post /api/setup "$EVIDENCE/.setup.json" "$EVIDENCE/setup.json")" = 200 ] ||
    fail "the installed notebook would not file the emergency-kit goal: $(tr -d '\n' <"$EVIDENCE/setup.json" | cut -c1-200)"
  server_pause_all_jobs
  phase 'the installed research, choice, and work routines'
  server_run_job research "$RESEARCH" 1800
  server_run_job choice "$CHOOSE" 1800
  server_run_job work "$WORK" 1800
  phase 'the installed morning brief and its Telegram delivery'
  server_brief "$EVIDENCE/brief.txt" 1800
  server_telegram_say todays-brief "today's brief"
  server_telegram_snapshot
  server_table work_items "$EVIDENCE/work-items.json"
  server_table notes "$EVIDENCE/notes.json"
  rm -f "$EVIDENCE"/.[a-z]*
}

check() { # <evidence folder>
  local folder=$1 reply
  [ -d "$folder" ] || fail "there is nothing at $folder, so this scenario kept no first-day evidence"
  need_node
  kept_all "$folder" 'the installed first day' setup.json job-research.json job-choice.json job-work.json brief.txt run.json runner.json telegram-requests.json work-items.json notes.json
  grep -Fqx "$GOAL" <(json_value "$folder/setup.json" results.goal.title 2>/dev/null || true) ||
    grep -Fq "$GOAL" "$folder/setup.json" || fail 'the notebook did not retain the fictional emergency-kit goal'
  for label in research choice work; do
    "$NODE" -e 'const fs=require("fs"),d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")),rows=Array.isArray(d)?d:d.data||[];process.exit(rows.some(j=>j?.last_run_at&&j?.last_status==="ok")?0:1)' "$folder/job-$label.json" ||
      fail "the installed $label routine has no successful recorded run"
  done
  [ "$(rows_with "$folder/work-items.json" 'verified')" -ge 1 ] || fail 'the first day produced no verified work item'
  [ -s "$folder/brief.txt" ] || fail 'the installed morning brief saved no readable text'
  [ "$(json_value "$folder/runner.json" state 2>/dev/null)" = gateway ] || fail 'the installed Telegram runner never reached gateway state'
  "$NODE" -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.exit((d.requests||[]).some(r=>r?.method==="getUpdates"&&r.authorized!==false)?0:1)' "$folder/telegram-requests.json" ||
    fail 'the installed Telegram gateway never polled the fake Bot API'
  reply=$(outbox_between "$folder/run.json" todays-brief accepted | tr -d '"' | tr -d '\r')
  [ -n "$reply" ] || fail "the owner received no answer to today's brief through the installed gateway"
  pass "a fresh Docker install connected its fictional Telegram bot, ran research, choice and work, saved a morning brief, and answered today's brief through the gateway"
}

if [ "$CHECK_ONLY" = yes ]; then
  install_paths
  need_node
  check "$EVIDENCE"
else
  act
  check "$EVIDENCE"
fi
