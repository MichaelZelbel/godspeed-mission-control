#!/usr/bin/env bash
# What the scenarios of 2.0.0-beta.18 ("numbers come in": phone-health-days, incomplete-day,
# phone-goes-quiet, mail-count, talk-on-talk-day) share beyond scenario-lib.sh, which it needs
# sourced first. The first three drive the Docker server install, because the phone receiver
# (POST /ingest/<token>, issue #214) exists only there.
#
# THE INTERFACES THIS READS FROM THE TICKETS and cannot read from the code until they merge are
# each named once, here, so a ticket that chose differently is one edit:
#   INGEST_PORT       the notebook's port inside the container
#   ingest_token()    where the notebook keeps its token: a file whose name holds "ingest" and
#                     "token", anywhere under the container's state folder
#   health_observations rows: metric, value, observed_on, source (the CSV feed's own shape)
# A scenario that cannot find one of them FAILs saying which, as a scenario for a ticket that has
# not merged is meant to.

SERVER_NAME=${GODSPEED_SCENARIO_SERVER_NAME:-godspeed}
SERVER_DIR=${GODSPEED_SCENARIO_SERVER_DIR:-/opt/godspeed-mission-control}
INGEST_PORT=${GODSPEED_SCENARIO_INGEST_PORT:-47831}

# ----------------------------------------------------------------------- the Docker server install
in_server() { sudo docker exec -i "$SERVER_NAME" "$@"; }

# The /server line against the stage, as the docker-server job runs it, then healthy.
server_install() {
  say "The /server line, against the stage: $STAGE_REF"
  curl -fsSL https://godspeedmissioncontrol.com/server |
    sudo GODSPEED_STAGE_REF="$STAGE_REF" GODSPEED_STAGE_RAW="$RAW" GODSPEED_HOST=localhost bash >&2 ||
    fail "the /server line for $STAGE_REF failed before this scenario could do anything (its output is in the step log)"
  server_healthy 300 || fail "the Docker server is not healthy after the /server line"
}
# shellcheck disable=SC2317,SC2329  # asked by wait_for
server_is_healthy() {
  [ "$(sudo docker inspect -f '{{.State.Health.Status}}' "$SERVER_NAME" 2>/dev/null)" = healthy ]
}
server_healthy() { wait_for "$1" "the server container to be healthy" server_is_healthy; }

# POST a JSON file to a path of the notebook inside the container; prints "<code>" and leaves the
# answer in <answer file>.
server_post() { # <path> <json file> <answer file>
  in_server curl -sS -o /tmp/answer -w '%{http_code}' --max-time 300 -X POST -H 'Content-Type: application/json' \
    --data-binary @- "http://127.0.0.1:$INGEST_PORT$1" <"$2" >"$3.code" 2>"$3.err" || true
  in_server cat /tmp/answer >"$3" 2>/dev/null || : >"$3"
  cat "$3.code"
}
# A table of the server's notebook as the query operation answers it.
server_table() { # <table> <file>
  printf '{"table":"%s"}' "$1" >"$EVIDENCE/.q.json"
  [ "$(server_post /api/query "$EVIDENCE/.q.json" "$2")" = 200 ] ||
    fail "the server's notebook would not answer a query of $1: $(tr -d '\n' <"$2" | cut -c1-200)"
}
# The upload address's token, read where the notebook keeps it.
ingest_token() {
  local found
  found=$(in_server sh -c "find /opt/data -type f -iname '*ingest*token*' 2>/dev/null | head -n 1")
  [ -n "$found" ] || fail "the notebook keeps no phone-upload token anywhere under its state folder (no file named *ingest*token*), so there is no address to upload to"
  in_server cat "$found" | tr -d '[:space:]'
}
# One upload: the body of <file> to /ingest/<token>; prints the HTTP code.
upload() { # <token> <file>
  in_server curl -sS -o /dev/null -w '%{http_code}' --max-time 120 -X POST -H 'Content-Type: application/json' \
    --data-binary @- "http://127.0.0.1:$INGEST_PORT/ingest/$1" <"$2"
}
# The notebook's clock moved on the server: a compose override carrying GODSPEED_NOW, the container
# made again (its volume stays).
server_clock_at() { # <moment, ISO with Z>
  say "The server notebook's own clock is set to $1"
  printf 'services:\n  godspeed:\n    environment:\n      GODSPEED_NOW: "%s"\n' "$1" |
    sudo tee "$SERVER_DIR/compose.override.yaml" >/dev/null || fail "the server's clock could not be moved"
  (cd "$SERVER_DIR" && sudo docker compose up -d --force-recreate) >&2 ||
    fail "the server could not be started again with its clock moved to $1"
  server_healthy 300 || fail "the server is not healthy after its clock was moved to $1"
}

# --------------------------------------------------------------------- the made-up phone uploads
# Health Auto Export's format as ticket 01 describes it. Every number is invented. The phone's day
# is the date in the point's own string, whatever the offset.
# <file> <json>: kept as plain files in the evidence folder so the scenario's checking part can name
# what was sent.
pt() { printf '{"date":"%s","qty":%s,"source":"Scenario phone"}' "$1" "$2"; }
metric() { # <name> <units> <points, comma separated>
  printf '{"name":"%s","units":"%s","data":[%s]}' "$1" "$2" "$3"
}
workout() { # <id> <name> <start> <end> <seconds> <km>
  printf '{"id":"%s","name":"%s","start":"%s","end":"%s","duration":%s,"distance":{"qty":%s,"units":"km"}}' "$@"
}
upload_body() { # <metrics, comma separated> <workouts, comma separated>
  printf '{"data":{"metrics":[%s],"workouts":[%s]}}\n' "$1" "$2"
}

# --------------------------------------------------------------------- reading rows as plain lines
# "<day> <metric> <value>" for every record of health_observations (source: Health Auto Export).
OBSERVATIONS_AS_LINES='
const fs=require("fs");const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
for(const r of Array.isArray(d)?d:(d.data||[])){
 if(!r||r.is_trashed||r.source!=="Health Auto Export")continue;
 process.stdout.write([r.observed_on,r.metric,r.value].join(" ")+"\n");
}
'
observation_lines() { # <file>
  "$NODE" -e "$OBSERVATIONS_AS_LINES" "$1" | sort
}
# FAILs unless the day record holds exactly this value.
want_day() { # <observation lines file> <day> <metric> <value>
  local got
  got=$(awk -v d="$2" -v m="$3" '$1==d && $2==m {print $3}' "$1" | head -n 1)
  [ -n "$got" ] || fail "no record of $3 on $2 (the notebook holds: $(awk -v d="$2" '$1==d {print $2}' "$1" | tr '\n' ' '))"
  [ "$got" = "$4" ] || fail "$3 on $2 is $got, not $4"
}
# FAILs when the day holds a record of this metric at all.
no_day() { # <observation lines file> <day> <metric> <why>
  ! awk -v d="$2" -v m="$3" '$1==d && $2==m {found=1} END{exit !found}' "$1" || fail "$3 on $2 was written although $4"
}

# The briefing note the morning brief saved last, as plain text, for the scenarios that read it.
NEWEST_BRIEFING_NOTE='
const fs=require("fs");const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
const notes=(Array.isArray(d)?d:(d.data||[])).filter(n=>n&&n.source_app==="morning-brief"&&!n.is_trashed)
 .sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)));
const n=notes[notes.length-1];if(!n)process.exit(1);process.stdout.write(String(n.content||""));
'

# ------------------------------------------------------------- the model and the brief, on the server
# The model connected the way Settings connects it (POST /api/provider), inside the container.
server_connects_the_model() {
  need_the_ai_key "the briefing"
  printf '{"url":%s,"key":%s,"model":%s,"routines":true}\n' \
    "$(quoted_json "$AI_URL")" "$(quoted_json "$GODSPEED_SCENARIO_AI_KEY")" "$(quoted_json "$AI_MODEL")" >"$EVIDENCE/.provider.json"
  [ "$(server_post /api/provider "$EVIDENCE/.provider.json" "$EVIDENCE/.provider.answer")" = 200 ] ||
    fail "Settings on the server refused the model $AI_MODEL at $AI_URL: $(tr -d '\n' <"$EVIDENCE/.provider.answer" | cut -c1-200)"
  rm -f "$EVIDENCE/.provider.json" "$EVIDENCE/.provider.answer"*
}
# The morning brief run on the server the way Settings runs it; leaves the newest briefing note in
# <note file>. The routine is added once and run each time, a new note being what ends the wait.
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
    sleep 5
    waited=$((waited + 5))
  done
  "$NODE" -e "$NEWEST_BRIEFING_NOTE" "$notes" >"$1" 2>/dev/null && [ "$(grep -c . "$1")" -gt 0 ] &&
    [ "$("$NODE" -e "$BRIEF_NOTES_COUNTER" "$notes")" -gt "$before" ] ||
    fail "the morning brief on the server saved no note within $2 s"
  rm -f "$notes" "$EVIDENCE"/.brief-*
}
