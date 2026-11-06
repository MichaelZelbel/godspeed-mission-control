#!/usr/bin/env bash
# Shared Docker-server scenario helpers.  scenario-lib.sh must be sourced first.

SERVER_DIR=${GODSPEED_SCENARIO_SERVER_DIR:-/opt/godspeed-mission-control}
INGEST_PORT=${GODSPEED_SCENARIO_INGEST_PORT:-47831}
SERVER_SPARSE_TABLES=(profile_facts goals decisions work_items deadlines health_observations health_episodes medications notes job_receipts watch_topics watch_observations watch_findings lead_entries contacts moments)

# The /server installer owns the Compose project and its generated container names. Resolve the
# current service container through that exact invocation each time because a scenario may recreate
# it to add its local Bot API.
server_compose() {
  sudo docker compose -p godspeed-mission-control --project-directory "$SERVER_DIR" -f "$SERVER_DIR/compose.yaml" --env-file "$SERVER_DIR/.env" "$@"
}
server_container() {
  server_compose ps -q godspeed 2>/dev/null | head -n 1
}
in_server() { local container; container=$(server_container) && [ -n "$container" ] && sudo docker exec -i "$container" "$@"; }
in_server_as_hermes() { local container; container=$(server_container) && [ -n "$container" ] && sudo docker exec -i --user hermes "$container" "$@"; }

server_install() {
  local installer=$EVIDENCE/.server-installer.sh
  say "The /server line, against the stage: $STAGE_REF"
  curl -fsSL https://godspeedmissioncontrol.com/server >"$installer" ||
    fail "the /server download for $STAGE_REF failed before this scenario could do anything (its output is in the step log)"
  sudo GODSPEED_STAGE_REF="$STAGE_REF" GODSPEED_STAGE_RAW="$RAW" GODSPEED_HOST=localhost bash "$installer" >&2 ||
    fail "the /server line for $STAGE_REF failed before this scenario could do anything (its output is in the step log)"
  server_healthy 300 || fail "the Docker server is not healthy after the /server line"
}
# shellcheck disable=SC2317,SC2329  # asked by wait_for
server_is_healthy() { local container; container=$(server_container) && [ -n "$container" ] && [ "$(sudo docker inspect -f '{{.State.Health.Status}}' "$container" 2>/dev/null)" = healthy ]; }
server_healthy() { wait_for "$1" "the server container to be healthy" server_is_healthy; }

server_post() { # <path> <json file> <answer file>
  in_server curl -sS -o /tmp/answer -w '%{http_code}' --max-time 300 -X POST -H 'Content-Type: application/json' \
    --data-binary @- "http://127.0.0.1:$INGEST_PORT$1" <"$2" >"$3.code" 2>"$3.err" || true
  in_server cat /tmp/answer >"$3" 2>/dev/null || : >"$3"
  cat "$3.code"
}
server_post_record() { server_post "$@"; echo; cat "$3"; }
server_table() { # <table> <file>
  printf '{"table":"%s"}' "$1" >"$EVIDENCE/.q.json"
  [ "$(server_post /api/query "$EVIDENCE/.q.json" "$2")" = 200 ] ||
    fail "the server's notebook would not answer a query of $1: $(tr -d '\n' <"$2" | cut -c1-200)"
}
server_clock_at() { # <moment, ISO with Z>
  say "The server notebook's own clock is set to $1"
  printf 'services:\n  godspeed:\n    environment:\n      GODSPEED_NOW: "%s"\n' "$1" |
    sudo tee "$SERVER_DIR/compose.override.yaml" >/dev/null || fail "the server's clock could not be moved"
  server_compose -f "$SERVER_DIR/compose.override.yaml" up -d --force-recreate >&2 ||
    fail "the server could not be started again with its clock moved to $1"
  server_healthy 300 || fail "the server is not healthy after its clock was moved to $1"
}

server_connects_the_model() {
  need_the_ai_key "the briefing"
  printf '{"url":%s,"key":%s,"model":%s,"routines":true}\n' \
    "$(quoted_json "$AI_URL")" "$(quoted_json "$GODSPEED_SCENARIO_AI_KEY")" "$(quoted_json "$AI_MODEL")" >"$EVIDENCE/.provider.json"
  [ "$(server_post /api/provider "$EVIDENCE/.provider.json" "$EVIDENCE/.provider.answer")" = 200 ] ||
    fail "Settings on the server refused the model $AI_MODEL at $AI_URL: $(tr -d '\n' <"$EVIDENCE/.provider.answer" | cut -c1-200)"
  rm -f "$EVIDENCE/.provider.json" "$EVIDENCE/.provider.answer"*
}

server_brief() { # <note file> <seconds>
  local id notes=$EVIDENCE/.notes.json before waited=0
  if [ -z "${SERVER_BRIEF_ID:-}" ]; then
    printf '{"kind":"morning-brief","interval_ms":86400000}' >"$EVIDENCE/.brief-ask.json"
    [ "$(server_post /api/jobs/add "$EVIDENCE/.brief-ask.json" "$EVIDENCE/.brief-added.json")" = 200 ] ||
      fail "the server would not turn its morning brief on: $(tr -d '\n' <"$EVIDENCE/.brief-added.json" | cut -c1-200)"
    SERVER_BRIEF_ID=$(json_value "$EVIDENCE/.brief-added.json" data.id) && [ -n "$SERVER_BRIEF_ID" ] ||
      fail "the server turned its morning brief on but named no routine"
  fi
  id=$SERVER_BRIEF_ID
  server_table notes "$notes"
  before=$("$NODE" -e "$BRIEF_NOTES_COUNTER" "$notes")
  printf '{"id":%s}' "$(quoted_json "$id")" >"$EVIDENCE/.brief-ask.json"
  server_post /api/jobs/run "$EVIDENCE/.brief-ask.json" "$EVIDENCE/.brief-run.json" >/dev/null
  while [ "$waited" -lt "$2" ]; do
    server_table notes "$notes"
    [ "$("$NODE" -e "$BRIEF_NOTES_COUNTER" "$notes")" -gt "$before" ] && break
    sleep 5; waited=$((waited + 5))
  done
  "$NODE" -e "$NEWEST_BRIEFING_NOTE" "$notes" >"$1" 2>/dev/null && [ "$(grep -c . "$1")" -gt 0 ] &&
    [ "$("$NODE" -e "$BRIEF_NOTES_COUNTER" "$notes")" -gt "$before" ] ||
    fail "the morning brief on the server saved no note within $2 s"
  rm -f "$notes" "$EVIDENCE"/.brief-*
}

# This uses the installed scheduler, not Settings' direct "Run now" endpoint. A one-minute
# interval makes the scheduled proof repeatable without changing the machine clock.
server_scheduled_brief() { # <note file> <seconds>
  local id jobs=$EVIDENCE/.scheduled-brief-jobs.json notes=$EVIDENCE/.scheduled-brief-notes.json before_notes before_run waited=0
  printf '{"kind":"morning-brief","interval_ms":60000}' >"$EVIDENCE/.scheduled-brief-ask.json"
  [ "$(server_post /api/jobs/add "$EVIDENCE/.scheduled-brief-ask.json" "$EVIDENCE/.scheduled-brief-added.json")" = 200 ] ||
    fail "the server would not schedule its morning brief: $(tr -d '\n' <"$EVIDENCE/.scheduled-brief-added.json" | cut -c1-200)"
  id=$(json_value "$EVIDENCE/.scheduled-brief-added.json" data.id) && [ -n "$id" ] ||
    fail "the server scheduled its morning brief but named no routine"
  server_table jobs "$jobs"
  before_run=$("$NODE" -e 'const fs=require("fs"),d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")),rows=Array.isArray(d)?d:d.data||[],j=rows.find(v=>v?.id===process.argv[2]);process.stdout.write(JSON.stringify(j?.last_run_at??null))' "$jobs" "$id")
  server_table notes "$notes"
  before_notes=$("$NODE" -e "$BRIEF_NOTES_COUNTER" "$notes")
  server_scheduled_brief_finished() {
    server_table jobs "$jobs" 2>/dev/null || return 1
    "$NODE" -e 'const fs=require("fs"),d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")),rows=Array.isArray(d)?d:d.data||[],j=rows.find(v=>v?.id===process.argv[2]),before=JSON.parse(process.argv[3]);process.exit(j?.last_run_at&&j.last_run_at!==before&&j?.last_status==="ok"?0:1)' "$jobs" "$id" "$before_run" || return 1
    server_table notes "$notes" 2>/dev/null || return 1
    [ "$("$NODE" -e "$BRIEF_NOTES_COUNTER" "$notes")" -gt "$before_notes" ] || return 1
    in_server_as_hermes hermes cron runs >"$EVIDENCE/brief-cron-runs.txt" 2>/dev/null || return 1
    grep -Eqi 'source[[:space:]]*[:=][[:space:]]*"?builtin' "$EVIDENCE/brief-cron-runs.txt"
  }
  wait_for "$2" 'the installed scheduler to run the morning brief' server_scheduled_brief_finished ||
    fail "the installed scheduler did not run the morning brief within $2 s"
  "$NODE" -e "$NEWEST_BRIEFING_NOTE" "$notes" >"$1" 2>/dev/null && [ "$(grep -c . "$1")" -gt 0 ] ||
    fail 'the scheduled morning brief saved no readable note'
  "$NODE" -e 'const fs=require("fs"),source=JSON.parse(fs.readFileSync(process.argv[1],"utf8")),rows=Array.isArray(source)?source:source.data||[],before=JSON.parse(process.argv[4]);fs.writeFileSync(process.argv[2],JSON.stringify({id:process.argv[3],before_last_run_at:before,data:rows},null,2)+"\n")' "$jobs" "$EVIDENCE/job-scheduled-brief.json" "$id" "$before_run"
  server_telegram_record "$EVIDENCE/scheduled-telegram-requests.json"
  "$NODE" -e 'const fs=require("fs"),brief=fs.readFileSync(process.argv[1],"utf8").replace(/\r\n?/g,"\n").trim(),record=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));process.exit((record.sent||[]).some(sent=>String(sent.text||"").replace(/\r\n?/g,"\n").trim()===brief)?0:1)' "$1" "$EVIDENCE/scheduled-telegram-requests.json" ||
    fail 'the scheduler ran the morning brief but it never reached the installed Telegram gateway'
  rm -f "$jobs" "$notes" "$EVIDENCE"/.scheduled-brief-*
}

# The advertised Docker Telegram route, driven through the installed notebook setup and
# supervisor.  Its helper stores a redacted Bot API record, runner state, and the same run.json
# shape the scenario checkers inspect.  The dedicated AI key is handed to the setup chat only;
# fake-telegram.py deliberately records neither inbound text nor Bot API path tokens.
SERVER_TELEGRAM_TOKEN='5550001111:SCENARIO-valid-aaaaaaaaaaaaaaaaaaaaaaaaaaaa'
SERVER_TELEGRAM_OWNER=31415
server_telegram_setup() { # [without-ai]
  local setup=()
  if [ "${1:-}" = without-ai ]; then
    setup=(--without-ai)
  else
    need_the_ai_key 'the Telegram setup chat'
    setup+=(--ai-key "$GODSPEED_SCENARIO_AI_KEY")
  fi
  # Keep this separate from compose.override.yaml: a scenario may already use that file to set its
  # clock, and the server's normal compose file must remain exactly what the /server installer made.
  printf 'services:\n  godspeed:\n    environment:\n      GODSPEED_TELEGRAM_API: "http://127.0.0.1:8081"\n' >"$EVIDENCE/.scenario-telegram-compose.yaml"
  if [ "${1:-}" = without-ai ]; then
    printf '      KB_SIGNIN_SKIP: "1"\n' >>"$EVIDENCE/.scenario-telegram-compose.yaml"
  fi
  sudo tee "$SERVER_DIR/compose.scenario-telegram.yaml" <"$EVIDENCE/.scenario-telegram-compose.yaml" >/dev/null ||
    fail 'the server could not direct its installed Telegram client to the local stand-in'
  server_compose -f "$SERVER_DIR/compose.scenario-telegram.yaml" up -d --force-recreate >&2 ||
    fail 'the server could not restart with its Telegram API endpoint set to the local stand-in'
  server_healthy 300 || fail 'the Docker server is not healthy after its Telegram endpoint was set'
  "$NODE" "$HERE/server-telegram.mjs" setup --server "$(server_container)" --evidence "$EVIDENCE" \
    --token "$SERVER_TELEGRAM_TOKEN" --owner "$SERVER_TELEGRAM_OWNER" "${setup[@]}" ||
    fail 'the installed Docker Telegram setup did not hand the bot to its gateway'
}
server_telegram_say() { # <label> <text>
  interaction_begin "$1"
  "$NODE" "$HERE/server-telegram.mjs" say --server "$(server_container)" --evidence "$EVIDENCE" \
    --owner "$SERVER_TELEGRAM_OWNER" --label "$1" --text "$2" ||
    fail "the installed Telegram gateway did not accept $1"
  SCENARIO_INTERACTION=''
}
server_telegram_press() { # <label> <callback data>
  interaction_begin "$1"
  "$NODE" "$HERE/server-telegram.mjs" press --server "$(server_container)" --evidence "$EVIDENCE" \
    --owner "$SERVER_TELEGRAM_OWNER" --label "$1" --button "$2" ||
    fail "the installed Telegram gateway did not accept $1"
  SCENARIO_INTERACTION=''
}
server_telegram_snapshot() {
  "$NODE" "$HERE/server-telegram.mjs" snapshot --server "$(server_container)" --evidence "$EVIDENCE" ||
    fail 'the installed Telegram gateway left no current evidence'
}
server_telegram_record() { # <target file>
  in_server cat /tmp/godspeed-scenario-telegram-record.json >"$1" 2>/dev/null ||
    fail 'the installed fake Telegram API wrote no request record'
}
server_telegram_mark() { # <label> [kind]
  interaction_begin "$1"
  if [ $# -eq 2 ]; then
    "$NODE" "$HERE/server-telegram.mjs" mark --server "$(server_container)" --evidence "$EVIDENCE" --label "$1" --kind "$2"
  else
    "$NODE" "$HERE/server-telegram.mjs" mark --server "$(server_container)" --evidence "$EVIDENCE" --label "$1"
  fi || fail "the installed Telegram gateway left no evidence for $1"
  SCENARIO_INTERACTION=''
}

server_copy_evidence() {
  # These folders are the installed mission-control's records and routine outputs, not host fixtures.
  # Neither contains the provider key, which remains under the separate Telegram connection directory.
  local source=$1 target=$2
  local container; container=$(server_container)
  [ -n "$container" ] && sudo docker cp "$container:$source" "$target" 2>/dev/null ||
    fail "the installed server did not retain $source as evidence"
}
server_manifest() {
  "$NODE" -e '
const crypto=require("crypto"),fs=require("fs"),path=require("path");
const [root,out]=process.argv.slice(1),files=[];
for(const walk=d=>{for(const entry of fs.readdirSync(d,{withFileTypes:true})){const file=path.join(d,entry.name);if(entry.isDirectory())walk(file);else if(entry.isFile()){const data=fs.readFileSync(file);files.push({file:path.relative(root,file),bytes:data.length,sha256:crypto.createHash("sha256").update(data).digest("hex")});}}})(root);
fs.writeFileSync(out,JSON.stringify({files},null,2)+"\\n");
' "$EVIDENCE" "$EVIDENCE/manifest.json" || fail 'the scenario could not write its evidence manifest'
}

server_job_id() { # <job name> <jobs JSON>
  "$NODE" -e 'const fs=require("fs"),d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")),rows=Array.isArray(d)?d:d.data||[],j=rows.find(v=>v&&(v.name===process.argv[2]||v.title===process.argv[2]));process.stdout.write(j?String(j.id):"")' "$2" "$1"
}
server_pause_all_jobs() {
  local jobs=$EVIDENCE/.jobs.json id
  server_table jobs "$jobs"
  for id in $("$NODE" -e 'const fs=require("fs"),d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")),rows=Array.isArray(d)?d:d.data||[];for(const j of rows)if(j?.id)console.log(j.id)' "$jobs"); do
    printf '{"id":%s,"paused":true}' "$(quoted_json "$id")" >"$EVIDENCE/.job-update.json"
    [ "$(server_post /api/jobs/update "$EVIDENCE/.job-update.json" "$EVIDENCE/.job-update.answer")" = 200 ] ||
      fail "Settings would not pause routine $id"
  done
}
server_run_job() { # <label> <job name> <seconds>
  local jobs=$EVIDENCE/jobs-$1.json id before
  server_table jobs "$jobs"
  id=$(server_job_id "$2" "$jobs")
  [ -n "$id" ] || fail "the installed server has no routine called \"$2\""
  before=$("$NODE" -e 'const fs=require("fs"),d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")),rows=Array.isArray(d)?d:d.data||[],j=rows.find(v=>v?.id===process.argv[2]);process.stdout.write(String(j?.last_run_at||""))' "$jobs" "$id")
  printf '{"id":%s}' "$(quoted_json "$id")" >"$EVIDENCE/.job-run.json"
  case $(server_post /api/jobs/run "$EVIDENCE/.job-run.json" "$EVIDENCE/job-$1-start.json") in
    200|202) ;;
    *) fail "Settings would not run \"$2\": $(tr -d '\n' <"$EVIDENCE/job-$1-start.json" | cut -c1-200)" ;;
  esac
  server_job_finished() {
    server_table jobs "$jobs" 2>/dev/null &&
      "$NODE" -e 'const fs=require("fs"),d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")),rows=Array.isArray(d)?d:d.data||[],j=rows.find(v=>v?.id===process.argv[2]);process.exit(j?.last_run_at&&j.last_run_at!==process.argv[3]&&j?.last_status==="ok"?0:1)' "$jobs" "$id" "$before"
  }
  wait_for "$3" "the installed routine $2" server_job_finished ||
    fail "the installed routine \"$2\" did not finish successfully within $3 s"
  cp "$jobs" "$EVIDENCE/job-$1.json"
}

server_snapshot_table() { # <label> <table>
  server_table "$2" "$EVIDENCE/$2-$1.json"
}
server_sparse_state() {
  # Query the installed notebook before the first goal, rather than asserting what a fresh install
  # ought to contain. These are the personal inputs a morning brief can otherwise draw on.
  local table
  for table in "${SERVER_SPARSE_TABLES[@]}"; do
    server_table "$table" "$EVIDENCE/sparse-${table//_/-}.json"
  done
}
server_install_asker() {
  local container; container=$(server_container)
  [ -n "$container" ] && sudo docker cp "$HERE/scenario-asker.py" "$container:/tmp/scenario-asker.py" ||
    fail 'the fixture asker could not reach the installed server'
  in_server_as_hermes sh -c 'mkdir -p "$HERMES_HOME/scripts" && cp /tmp/scenario-asker.py "$HERMES_HOME/scripts/scenario-asker.py" && /opt/hermes/bin/hermes cron create "0 0 1 1 *" --no-agent --name "Scenario asker" --script scenario-asker.py --deliver telegram --failure-deliver local --workdir "$GODSPEED_WORKSPACE"' >&2 ||
    fail 'the installed Hermes could not create the fixture asker routine'
}
server_set_asks() { # <file>
  local container; container=$(server_container)
  [ -n "$container" ] && sudo docker cp "$1" "$container:/opt/data/full-candidate/workspace/.scenario-asks.json" ||
    fail 'the installed server could not receive the fixture questions'
}
server_run_asker() { # <label>
  server_run_job "$1" 'Scenario asker' 300
  server_telegram_mark "$1" cron
}
server_set_telegram_token() { # <token>
  in_server_as_hermes sh -c 'key=$1; f="$HERMES_HOME/.env"; test -f "$f" && sed -i "s|^TELEGRAM_BOT_TOKEN=.*|TELEGRAM_BOT_TOKEN=$key|" "$f"' sh "$1" ||
    fail 'the installed Hermes Telegram key could not be changed for the connection check'
}
server_queue_notice() { # <text> <about> <facts JSON>
  in_server_as_hermes env NOTICE_TEXT="$1" NOTICE_ABOUT="$2" NOTICE_FACTS="$3" node --input-type=module -e '
import {queueNotice} from "/opt/godspeed/kit/notebook/core/notices.mjs";
import {Store} from "/opt/godspeed/kit/notebook/core/records/store.mjs";
import {machineDevice} from "/opt/godspeed/kit/notebook/core/device-id.mjs";
const root=process.env.GODSPEED_WORKSPACE,store=new Store(root,{device:machineDevice(root).id});
if(!queueNotice(store,{id:"scenario-backup-1",text:process.env.NOTICE_TEXT,about:process.env.NOTICE_ABOUT,facts:JSON.parse(process.env.NOTICE_FACTS)}))throw Error("the notice was already queued");
' || fail 'the installed notice queue would not retain the scenario report'
}
