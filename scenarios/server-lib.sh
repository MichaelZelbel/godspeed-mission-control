#!/usr/bin/env bash
# Shared Docker-server scenario helpers.  scenario-lib.sh must be sourced first.

SERVER_NAME=${GODSPEED_SCENARIO_SERVER_NAME:-godspeed}
SERVER_DIR=${GODSPEED_SCENARIO_SERVER_DIR:-/opt/godspeed-mission-control}
INGEST_PORT=${GODSPEED_SCENARIO_INGEST_PORT:-47831}

in_server() { sudo docker exec -i "$SERVER_NAME" "$@"; }

server_install() {
  say "The /server line, against the stage: $STAGE_REF"
  curl -fsSL https://godspeedmissioncontrol.com/server |
    sudo GODSPEED_STAGE_REF="$STAGE_REF" GODSPEED_STAGE_RAW="$RAW" GODSPEED_HOST=localhost bash >&2 ||
    fail "the /server line for $STAGE_REF failed before this scenario could do anything (its output is in the step log)"
  server_healthy 300 || fail "the Docker server is not healthy after the /server line"
}
# shellcheck disable=SC2317,SC2329  # asked by wait_for
server_is_healthy() { [ "$(sudo docker inspect -f '{{.State.Health.Status}}' "$SERVER_NAME" 2>/dev/null)" = healthy ]; }
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
  (cd "$SERVER_DIR" && sudo docker compose up -d --force-recreate) >&2 ||
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

# The advertised Docker Telegram route, driven through the installed notebook setup and
# supervisor.  Its helper stores a redacted Bot API record, runner state, and the same run.json
# shape the scenario checkers inspect.  The dedicated AI key is handed to the setup chat only;
# fake-telegram.py deliberately records neither inbound text nor Bot API path tokens.
SERVER_TELEGRAM_TOKEN='5550001111:SCENARIO-valid-aaaaaaaaaaaaaaaaaaaaaaaaaaaa'
SERVER_TELEGRAM_OWNER=31415
server_telegram_setup() {
  need_the_ai_key 'the Telegram setup chat'
  # Keep this separate from compose.override.yaml: a scenario may already use that file to set its
  # clock, and the server's normal compose file must remain exactly what the /server installer made.
  printf 'services:\n  godspeed:\n    environment:\n      GODSPEED_TELEGRAM_API: "http://127.0.0.1:8081"\n' |
    sudo tee "$SERVER_DIR/compose.scenario-telegram.yaml" >/dev/null ||
    fail 'the server could not direct its installed Telegram client to the local stand-in'
  (cd "$SERVER_DIR" && sudo docker compose -f compose.yaml -f compose.scenario-telegram.yaml up -d --force-recreate) >&2 ||
    fail 'the server could not restart with its Telegram API endpoint set to the local stand-in'
  server_healthy 300 || fail 'the Docker server is not healthy after its Telegram endpoint was set'
  "$NODE" "$HERE/server-telegram.mjs" setup --server "$SERVER_NAME" --evidence "$EVIDENCE" \
    --token "$SERVER_TELEGRAM_TOKEN" --owner "$SERVER_TELEGRAM_OWNER" --ai-key "$GODSPEED_SCENARIO_AI_KEY" ||
    fail 'the installed Docker Telegram setup did not hand the bot to its gateway'
}
server_telegram_say() { # <label> <text>
  "$NODE" "$HERE/server-telegram.mjs" say --server "$SERVER_NAME" --evidence "$EVIDENCE" \
    --owner "$SERVER_TELEGRAM_OWNER" --label "$1" --text "$2" ||
    fail "the installed Telegram gateway did not accept $1"
}
server_telegram_press() { # <label> <callback data>
  "$NODE" "$HERE/server-telegram.mjs" press --server "$SERVER_NAME" --evidence "$EVIDENCE" \
    --owner "$SERVER_TELEGRAM_OWNER" --label "$1" --button "$2" ||
    fail "the installed Telegram gateway did not accept $1"
}
server_telegram_snapshot() {
  "$NODE" "$HERE/server-telegram.mjs" snapshot --server "$SERVER_NAME" --evidence "$EVIDENCE" ||
    fail 'the installed Telegram gateway left no current evidence'
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
  local jobs=$EVIDENCE/jobs-$1.json id
  server_table jobs "$jobs"
  id=$(server_job_id "$2" "$jobs")
  [ -n "$id" ] || fail "the installed server has no routine called \"$2\""
  printf '{"id":%s}' "$(quoted_json "$id")" >"$EVIDENCE/.job-run.json"
  case $(server_post /api/jobs/run "$EVIDENCE/.job-run.json" "$EVIDENCE/job-$1-start.json") in
    200|202) ;;
    *) fail "Settings would not run \"$2\": $(tr -d '\n' <"$EVIDENCE/job-$1-start.json" | cut -c1-200)" ;;
  esac
  server_job_finished() {
    server_table jobs "$jobs" 2>/dev/null &&
      "$NODE" -e 'const fs=require("fs"),d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")),rows=Array.isArray(d)?d:d.data||[],j=rows.find(v=>v?.id===process.argv[2]);process.exit(j?.last_run_at&&j?.last_status==="ok"?0:1)' "$jobs" "$id"
  }
  wait_for "$3" "the installed routine $2" server_job_finished ||
    fail "the installed routine \"$2\" did not finish successfully within $3 s"
  cp "$jobs" "$EVIDENCE/job-$1.json"
}
