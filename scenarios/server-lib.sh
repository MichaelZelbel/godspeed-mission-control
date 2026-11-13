#!/usr/bin/env bash
# Shared Docker-server scenario helpers.  scenario-lib.sh must be sourced first.

SERVER_DIR=${GODSPEED_SCENARIO_SERVER_DIR:-/opt/godspeed-mission-control}
INGEST_PORT=${GODSPEED_SCENARIO_INGEST_PORT:-47832}
SERVER_SPARSE_TABLES=()

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
  if [ "${GODSPEED_SCENARIO_REUSE_SERVER:-}" = 1 ]; then
    server_healthy 300 || fail "the pooled Docker server is not healthy"
    return
  fi
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
  "$NODE" -e 'const fs=require("fs"),shown=value=>String(value||"").replace(/\r\n?/g,"\n").replace(/\[([^\]]*)\]\([^)]*\)/g,"$1").replace(/[*_~`#]/g,"").replace(/^[ \t]*>[ \t]?/gm,"").split("\n").map(line=>line.trim()).join("\n").trim(),brief=shown(fs.readFileSync(process.argv[1],"utf8")),record=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));process.exit((record.sent||[]).some(sent=>shown(sent.text)===brief)?0:1)' "$1" "$EVIDENCE/scheduled-telegram-requests.json" ||
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
    setup+=(--ai-key "$GODSPEED_SCENARIO_AI_KEY" --ai-url "$AI_URL" --ai-model "$AI_MODEL")
  fi
  # Keep this separate from compose.override.yaml: a scenario may already use that file to set its
  # clock, and the server's normal compose file must remain exactly what the /server installer made.
  printf 'services:\n  godspeed:\n    environment:\n      GODSPEED_TELEGRAM_API: "http://127.0.0.1:8081"\n' >"$EVIDENCE/.scenario-telegram-compose.yaml"
  if [ "${1:-}" = without-ai ]; then
    printf '      KB_SIGNIN_SKIP: "1"\n' >>"$EVIDENCE/.scenario-telegram-compose.yaml"
  else
    printf '      GODSPEED_TG_MODEL: %s\n' "$(quoted_json "$AI_MODEL")" >>"$EVIDENCE/.scenario-telegram-compose.yaml"
  fi
  sudo tee "$SERVER_DIR/compose.scenario-telegram.yaml" <"$EVIDENCE/.scenario-telegram-compose.yaml" >/dev/null ||
    fail 'the server could not direct its installed Telegram client to the local stand-in'
  server_compose -f "$SERVER_DIR/compose.scenario-telegram.yaml" up -d --force-recreate >&2 ||
    fail 'the server could not restart with its Telegram API endpoint set to the local stand-in'
  server_healthy 300 || fail 'the Docker server is not healthy after its Telegram endpoint was set'
  "$NODE" "$HERE/server-telegram.mjs" setup --server "$(server_container)" --evidence "$EVIDENCE" --notebook-port "$INGEST_PORT" \
    --token "$SERVER_TELEGRAM_TOKEN" --owner "$SERVER_TELEGRAM_OWNER" "${setup[@]}" ||
    fail 'the installed Docker Telegram setup did not hand the bot to its gateway'
}
# The gateway reads Hermes' time zone once, when it starts, so the Telegram runner starts it again
# half a minute after the zone changes (docker/full-candidate/telegram-runner.mjs), and the gateway
# tells the owner it is shutting down. A goal filed through /api/setup after the Telegram setup names
# the zone, so a scenario remembers the gateway before that goal and waits for the restart after it:
# otherwise the notice lands in the first routine's messages and a delivery made while the gateway
# drains is lost.
server_gateway_pid() {
  in_server cat /opt/data/full-candidate/telegram/runner.json 2>/dev/null |
    "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const r=JSON.parse(s);if(r.state==="gateway"&&r.pid)process.stdout.write(String(r.pid))}catch{}})'
}
server_gateway_zone() { in_server_as_hermes sh -c 'grep -E "^timezone:" "$HERMES_HOME/config.yaml" 2>/dev/null || true'; }
server_remember_gateway() {
  SERVER_GATEWAY_PID=$(server_gateway_pid)
  SERVER_GATEWAY_ZONE=$(server_gateway_zone)
}
# shellcheck disable=SC2317,SC2329  # asked by wait_for
server_gateway_restarted() { local pid; pid=$(server_gateway_pid); [ -n "$pid" ] && [ "$pid" != "$SERVER_GATEWAY_PID" ]; }
server_settle_gateway() {
  [ "$(server_gateway_zone)" = "$SERVER_GATEWAY_ZONE" ] && return 0
  wait_for 240 'the Telegram gateway to start again on the time zone the goal named' server_gateway_restarted ||
    fail 'the Telegram gateway did not start again within 240 s after the goal changed its time zone'
  server_telegram_mark gateway-restart cron
  server_remember_gateway
}
server_telegram_say() { # <label> <text>
  interaction_begin "$1"
  "$NODE" "$HERE/server-telegram.mjs" say --server "$(server_container)" --evidence "$EVIDENCE" \
    --owner "$SERVER_TELEGRAM_OWNER" --label "$1" --text "$2" ||
    fail "the installed Telegram gateway did not accept $1"
  SCENARIO_INTERACTION=''
}
# The line each button handler of the gateway logs where a press stopped, and when it registered
# (notebook/assistant-files/godspeed-buttons/buttons.py), kept after a press whether it worked or not,
# with the line the waiting-step match logs for each typed message (godspeed-context's waiting_step_block).
# The file is never empty: it says so when there was no log, no such line in it, or no way to read it.
server_keep_button_log() { # <label>
  local kept=$EVIDENCE/button-log-$1.txt
  in_server_as_hermes sh -c 'set -- "$HERMES_HOME"/logs/*.log
    [ -e "$1" ] || { echo "(no log under $HERMES_HOME/logs)"; exit 0; }
    grep -hE "godspeed-(buttons|step)" "$@" | sort -u | grep . || echo "(no godspeed-buttons line in $HERMES_HOME/logs)"' \
    >"$kept" 2>/dev/null || echo '(the gateway log could not be read)' >"$kept"
}
server_telegram_press() { # <label> <question text> <button label>
  interaction_begin "$1"
  if ! "$NODE" "$HERE/server-telegram.mjs" press --server "$(server_container)" --evidence "$EVIDENCE" \
    --owner "$SERVER_TELEGRAM_OWNER" --label "$1" --question "$2" --button "$3"; then
    server_keep_button_log "$1"
    fail "the installed Telegram gateway did not accept $1"
  fi
  server_keep_button_log "$1"
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
  if [ -n "$container" ] && sudo docker cp "$container:$source" "$target" 2>/dev/null; then
    sudo chmod -R a+rX "$target" || fail "the copied $source evidence is not readable by the runner"
  else
    fail "the installed server did not retain $source as evidence"
  fi
}
# The same for a folder the product makes only when it needs it (a goal's playbooks, its ideas).
server_copy_evidence_if_there() {
  local container; container=$(server_container)
  [ -n "$container" ] && sudo docker exec "$container" test -d "$1" || return 0
  server_copy_evidence "$1" "$2"
}
server_manifest() {
  "$NODE" -e '
const crypto=require("crypto"),fs=require("fs"),path=require("path");
const [root,out]=process.argv.slice(1),files=[];
const walk=d=>{
  for(const entry of fs.readdirSync(d,{withFileTypes:true})){
    const file=path.join(d,entry.name);
    if(entry.isDirectory())walk(file);
    else if(entry.isFile()){
      const data=fs.readFileSync(file);
      files.push({file:path.relative(root,file),bytes:data.length,sha256:crypto.createHash("sha256").update(data).digest("hex")});
    }
  }
};
walk(root);
fs.writeFileSync(out,JSON.stringify({files},null,2)+"\n");
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
server_routine_evidence_paths() {
  in_server node --input-type=module -e 'import {routineRunEvidencePaths} from "/opt/godspeed/kit/notebook/core/native-scheduler.mjs";process.stdout.write(JSON.stringify(routineRunEvidencePaths({workspace:process.env.GODSPEED_WORKSPACE,home:process.env.HERMES_HOME})));'
}
server_routine_evidence_path() { # <descriptor JSON> <diagnostics|output>
  "$NODE" -e 'const value=JSON.parse(process.argv[1])[process.argv[2]];if(typeof value!=="string"||!value.startsWith("/"))process.exit(1);process.stdout.write(value)' "$1" "$2"
}
server_keep_routine_diagnostics() { # <label>
  # The notebook writes the admission record before it starts Hermes, so this is
  # also available when Settings refuses a second routine run.
  local paths diagnostics output container
  paths=$(server_routine_evidence_paths) || fail 'the installed server did not name its routine evidence paths'
  diagnostics=$(server_routine_evidence_path "$paths" diagnostics) || fail 'the installed server named no routine diagnostics path'
  output=$(server_routine_evidence_path "$paths" output) || fail 'the installed server named no routine output path'
  server_copy_evidence "$diagnostics" "$EVIDENCE/routine-diagnostics-$1.json"
  container=$(server_container)
  if [ -n "$container" ] && sudo docker exec "$container" test -d "$output"; then
    server_copy_evidence "$output" "$EVIDENCE/routine-output-$1"
  fi
}
server_pause_job() { # <id> <label>
  printf '{"id":%s,"paused":true}' "$(quoted_json "$1")" >"$EVIDENCE/.job-$2-pause.json"
  [ "$(server_post /api/jobs/update "$EVIDENCE/.job-$2-pause.json" "$EVIDENCE/job-$2-pause.json")" = 200 ] ||
    fail "Settings would not pause routine $1 after its run"
}
server_keep_routine_diagnostics_or_pause() { # <label> <id> <job name>
  if (server_keep_routine_diagnostics "$1"); then return; fi
  server_pause_job "$2" "$1"
  fail "the installed server could not retain diagnostics for \"$3\" after its run"
}
# A run is over once the routine records a newer last run, whatever its status. A status other than
# the accepted ones (ok, or e.g. "ok|error") fails at once and names the routine's own last_error,
# instead of waiting out <seconds> for a status that will not come.
server_run_job() { # <label> <job name> <seconds> [accepted statuses, "|" between them]
  local jobs=$EVIDENCE/jobs-$1.json id before retry=0 accepted=${4:-ok} ended
  server_table jobs "$jobs"
  id=$(server_job_id "$2" "$jobs")
  [ -n "$id" ] || fail "the installed server has no routine called \"$2\""
  before=$("$NODE" -e 'const fs=require("fs"),d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")),rows=Array.isArray(d)?d:d.data||[],j=rows.find(v=>v?.id===process.argv[2]);process.stdout.write(String(j?.last_run_at||""))' "$jobs" "$id")
  printf '{"id":%s,"paused":false}' "$(quoted_json "$id")" >"$EVIDENCE/.job-$1-resume.json"
  [ "$(server_post /api/jobs/update "$EVIDENCE/.job-$1-resume.json" "$EVIDENCE/job-$1-resume.json")" = 200 ] ||
    fail "Settings would not resume routine \"$2\" for its run"
  printf '{"id":%s}' "$(quoted_json "$id")" >"$EVIDENCE/.job-run.json"
  while :; do
    case $(server_post /api/jobs/run "$EVIDENCE/.job-run.json" "$EVIDENCE/job-$1-start.json") in
      200|202) break ;;
    esac
    server_keep_routine_diagnostics_or_pause "$1" "$id" "$2"
    if [ "$retry" = 0 ] && "$NODE" -e 'const fs=require("fs"),runs=JSON.parse(fs.readFileSync(process.argv[1],"utf8")).runs||[],last=runs.at(-1);process.exit(last?.admitted===false&&last.lifecycle_owner==="routine tick"?0:1)' "$EVIDENCE/routine-diagnostics-$1.json"; then
      retry=1; sleep 5
    else
      server_pause_job "$id" "$1"
      fail "Settings would not run \"$2\": $(tr -d '\n' <"$EVIDENCE/job-$1-start.json" | cut -c1-200)"
    fi
  done
  server_job_finished() {
    server_table jobs "$jobs" 2>/dev/null &&
      "$NODE" -e 'const fs=require("fs"),d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")),rows=Array.isArray(d)?d:d.data||[],j=rows.find(v=>v?.id===process.argv[2]);process.exit(j?.last_run_at&&j.last_run_at!==process.argv[3]?0:1)' "$jobs" "$id" "$before"
  }
  if ! wait_for "$3" "the installed routine $2" server_job_finished; then
    server_keep_routine_diagnostics_or_pause "$1" "$id" "$2"
    server_pause_job "$id" "$1"
    fail "the installed routine \"$2\" did not finish within $3 s"
  fi
  server_keep_routine_diagnostics_or_pause "$1" "$id" "$2"
  cp "$jobs" "$EVIDENCE/job-$1.json"
  ended=$("$NODE" -e 'const fs=require("fs"),d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")),rows=Array.isArray(d)?d:d.data||[],j=rows.find(v=>v?.id===process.argv[2]),status=String(j?.last_status??"no status");if(!process.argv[3].split("|").includes(status))process.stdout.write(status+(j?.last_error?": "+String(j.last_error).replace(/\s+/g," ").slice(0,300):""))' "$jobs" "$id" "$accepted")
  server_pause_job "$id" "$1"
  [ -z "$ended" ] || fail "the installed routine \"$2\" ended with $ended"
}

server_snapshot_table() { # <label> <table>
  server_table "$2" "$EVIDENCE/$2-$1.json"
}
server_sparse_state() {
  # Query the installed product's own source inventory before the first goal, rather than asserting
  # what a fresh install ought to contain. These are the personal inputs a morning brief can draw on.
  local table
  in_server /usr/local/bin/node /opt/godspeed/kit/notebook/scripts/briefing-source-tables.mjs >"$EVIDENCE/briefing-source-tables.txt" ||
    fail 'the installed server could not name the records its morning brief reads'
  mapfile -t SERVER_SPARSE_TABLES <"$EVIDENCE/briefing-source-tables.txt"
  [ "${#SERVER_SPARSE_TABLES[@]}" -gt 0 ] || fail 'the installed server named no morning-brief source records'
  for table in "${SERVER_SPARSE_TABLES[@]}"; do
    server_table "$table" "$EVIDENCE/sparse-${table//_/-}.json"
  done
}
server_install_asker() {
  in_server_as_hermes sh -c 'source=/opt/godspeed/kit/scenarios/scenario-asker.py; target="$HERMES_HOME/scripts/scenario-asker.py"; test -f "$source" && mkdir -p "$HERMES_HOME/scripts" && rm -f "$target" && cp "$source" "$target" && /opt/hermes/bin/hermes cron create "0 0 1 1 *" --no-agent --name "Scenario asker" --script scenario-asker.py --deliver telegram --failure-deliver local --workdir "$GODSPEED_WORKSPACE"' >&2 ||
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
