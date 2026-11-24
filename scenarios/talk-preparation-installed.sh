#!/usr/bin/env bash
# PROVING SCENARIO: the installed "Coaching talk preparation" routine, started with Run now the way
# Settings starts it, prepares the next talk and leaves a preparation the coach accepts.
#
# What it proves (issue #616; the product behaviour landed in #618): on a fresh install whose person
# has filed a first goal, the first-goal routines include "Coaching talk preparation". Pressing Run
# now on it (POST /api/jobs/run with the row's id, from POST /api/query "jobs") makes the installed
# assistant write coach/<area>/prep/<talk day>.md, STATE: ready, PREPARED at that run's own time,
# and the coach's own gate (`godspeed-coach prep-check`) accepts it. Nothing here writes a
# preparation, a receipt or a seal: the only fixture is the person (one goal, one daily area).
#
# THE MODEL. The preparation is written by the installed assistant with the model Settings connects,
# so this route needs a real one (a loopback stand-in cannot drive the assistant's own tools):
#
#   GODSPEED_SCENARIO_AI_KEY    the model that writes the preparation, with GODSPEED_SCENARIO_AI_URL
#                               and GODSPEED_SCENARIO_AI_MODEL. Without it: FAIL.
#
# THE AREA names no research domains, so the preparation needs no research receipts and review
# seal (tools/mc-coach-prep); the judged behaviour is the installed routine, the public Run now and
# the ready preparation. The route starts no process of its own and sends nothing outward.
#
#   bash scenarios/talk-preparation-installed.sh candidate/2.0.0-beta.16
#   bash scenarios/talk-preparation-installed.sh <full product commit>
#   bash scenarios/talk-preparation-installed.sh --check <folder>
#
# What it keeps for its checking part:
#   goal.txt             the person's first goal
#   run-requested.txt    the instant before Run now was pressed, as epoch seconds
#   routine.json         the "Coaching talk preparation" row Settings lists (id, title)
#   run-now.json         what the notebook answered to Run now
#   routine-after.json   the same row after the run (last_run_at, last_status, last_error)
#   routine-status.json  the assistant's own record of the coach-prep routine
#   summary.txt          the routine's own summary of the run
#   prep-path.txt        the preparation's path below the workspace
#   prep.md              the preparation as written
#   prep-check.txt       what the coach's gate said of it
#   brief.txt            the coach's brief for the talk
#   cleanup.txt          the processes this route started and whether any remains
SCENARIO=talk-preparation-installed
# shellcheck source=scenarios/scenario-lib.sh
. "$(dirname "$0")/scenario-lib.sh"
scenario_arguments "$@"

GOAL='Run a fictional 10k'
ROUTINE='Coaching talk preparation'
PREPARE_SECONDS=3000

# shellcheck disable=SC2317,SC2329  # asked by wait_for, which takes the command to try as its arguments
notebook_answers() { curl -fsS "http://127.0.0.1:$NOTEBOOK_PORT/health" >/dev/null 2>&1; }

# The routine's row as Settings lists it: one JSON line, or nothing.
ROUTINE_ROW='
const fs=require("fs");const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
const row=(Array.isArray(d)?d:(d.data||[])).find(j=>j&&j.title===process.argv[2]);
if(row)process.stdout.write(JSON.stringify({id:row.id,title:row.title,last_run_at:row.last_run_at||null,last_status:row.last_status||null,last_error:row.last_error||null}));
'
read_the_routine() { # <file for the row>
  curl -fsS --max-time 120 -X POST -H 'Content-Type: application/json' -d '{"table":"jobs"}' \
    "http://127.0.0.1:$NOTEBOOK_PORT/api/query" -o "$EVIDENCE/.jobs.json" ||
    fail "the notebook's own routines could not be read"
  "$NODE" -e "$ROUTINE_ROW" "$EVIDENCE/.jobs.json" "$ROUTINE" >"$1" || fail "the notebook's routines could not be read as a list"
  [ -s "$1" ]
}
# shellcheck disable=SC2317,SC2329  # asked by wait_for
routine_has_run() {
  read_the_routine "$EVIDENCE/routine-after.json" &&
    "$NODE" -e '
const row=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")),since=Number(process.argv[2]);
process.exit(row.last_run_at&&Date.parse(row.last_run_at)/1000>=since?0:1);' "$EVIDENCE/routine-after.json" "$(cat "$EVIDENCE/run-requested.txt")"
}

act() {
  fresh_evidence
  install_paths
  need_the_ai_key "the installed assistant that writes the talk preparation"
  use_commit_stage
  install_the_stage_line "$EVIDENCE/.install.log"
  need_node
  wait_for 180 "the notebook to answer after the install" notebook_answers ||
    fail "the notebook does not answer after the install, so there is no first goal to file"
  read_version "$ROOT"
  assistant_home
  connect_the_ai
  local coach
  coach=$(product_script "$ROOT" third-party/addons/godspeed-coach/bin/godspeed-coach.mjs)
  [ -f "$coach" ] || fail "the installed version has no coach program at $coach"

  phase 'the first goal, filed the way the notebook files it'
  printf '%s\n' "$GOAL" >"$EVIDENCE/goal.txt"
  printf '{"goal":%s,"timezone":"Etc/UTC"}\n' "$(quoted_json "$GOAL")" >"$EVIDENCE/.setup.json"
  local code
  code=$(curl -sS -o "$EVIDENCE/.setup-answer.json" -w '%{http_code}' --max-time 600 -X POST \
    -H 'Content-Type: application/json' --data-binary @"$EVIDENCE/.setup.json" \
    "http://127.0.0.1:$NOTEBOOK_PORT/api/setup") ||
    fail "the notebook could not be reached to file the first goal"
  [ "$code" = 200 ] ||
    fail "the notebook would not file the first goal (HTTP $code): $(tr -d '\n' <"$EVIDENCE/.setup-answer.json" | cut -c1-200)"
  # The weekly check-in the first goal made, talking every day, so there is a talk tomorrow to prepare.
  "$NODE" "$coach" area set weekly-check-in RHYTHM daily --godspeed "$ROOT" >"$EVIDENCE/.area.txt" 2>&1 ||
    fail "the coach would not let the weekly check-in talk every day: $(tr -d '\n' <"$EVIDENCE/.area.txt" | cut -c1-200)"

  phase "Run now on \"$ROUTINE\", as Settings does it"
  read_the_routine "$EVIDENCE/routine.json" ||
    fail "Settings lists no routine named \"$ROUTINE\" after the first goal was filed, so there is nothing to run now"
  local id
  id=$(json_value "$EVIDENCE/routine.json" id) && [ -n "$id" ] || fail "the \"$ROUTINE\" row names no routine id"
  date -u +%s >"$EVIDENCE/run-requested.txt"
  code=$(curl -sS -o "$EVIDENCE/run-now.json" -w '%{http_code}' --max-time 600 -X POST \
    -H 'Content-Type: application/json' -d "{\"id\":$(quoted_json "$id")}" \
    "http://127.0.0.1:$NOTEBOOK_PORT/api/jobs/run") ||
    fail "the notebook could not be reached to run \"$ROUTINE\""
  sed 's/^/  | /' "$EVIDENCE/run-now.json" >&2
  { [ "$code" = 200 ] || [ "$code" = 202 ]; } && grep -qE '"started": *true' "$EVIDENCE/run-now.json" ||
    fail "the notebook did not start \"$ROUTINE\" (HTTP $code): $(tr -d '\n' <"$EVIDENCE/run-now.json" | cut -c1-200)"
  wait_for "$PREPARE_SECONDS" "\"$ROUTINE\" to finish its run" routine_has_run ||
    fail "\"$ROUTINE\" finished no run within $PREPARE_SECONDS s of Run now"

  phase 'what the run left'
  cp "$HERMES/godspeed-routines-status.json" "$EVIDENCE/routine-status.json" 2>/dev/null || : >"$EVIDENCE/routine-status.json"
  local prep summary
  prep=$(cd "$ROOT" && find coach -path '*/prep/*.md' -newer "$EVIDENCE/run-requested.txt" 2>/dev/null | sort | head -n 1)
  summary=$(cd "$ROOT" && find routines/coach-prep -name summary.txt -newer "$EVIDENCE/run-requested.txt" 2>/dev/null | sort | tail -n 1)
  [ -z "$summary" ] && : >"$EVIDENCE/summary.txt" || cp "$ROOT/$summary" "$EVIDENCE/summary.txt"
  if [ -z "$prep" ]; then
    : >"$EVIDENCE/prep.md"
    : >"$EVIDENCE/prep-path.txt"
    : >"$EVIDENCE/prep-check.txt"
    : >"$EVIDENCE/brief.txt"
  else
    printf '%s\n' "$prep" >"$EVIDENCE/prep-path.txt"
    cp "$ROOT/$prep" "$EVIDENCE/prep.md"
    local area day
    area=$(printf '%s' "$prep" | cut -d/ -f2)
    day=$(basename "$prep" .md)
    "$NODE" "$coach" prep-check "$area" --date "$day" --godspeed "$ROOT" >"$EVIDENCE/prep-check.txt" 2>&1 || true
    "$NODE" "$coach" brief "$area" --date "$day" --godspeed "$ROOT" >"$EVIDENCE/brief.txt" 2>&1 || true
  fi
  printf 'started-by-this-route=none\nrunning-after=none\n' >"$EVIDENCE/cleanup.txt"
  rm -f "$EVIDENCE"/.[a-z]*
}

# ------------------------------------------------------------------------------ what it judges
check() { # <evidence folder>
  local folder=$1 file id failed
  [ -d "$folder" ] || fail "there is nothing at $folder, so this scenario kept no evidence of a prepared talk"
  kept_all "$folder" 'what Run now left' goal.txt run-requested.txt routine.json run-now.json routine-after.json \
    cleanup.txt
  for file in routine-status.json summary.txt prep-path.txt prep.md prep-check.txt brief.txt; do
    [ -f "$folder/$file" ] || fail "$file is not in what the scenario kept: what the run or the coach left"
  done
  need_node

  # 1. The public Run now: the row Settings lists, started by its own id.
  [ "$(json_value "$folder/routine.json" title)" = "$ROUTINE" ] ||
    fail "the routine the scenario ran is not \"$ROUTINE\""
  id=$(json_value "$folder/routine.json" id)
  [ -n "$id" ] || fail "the routine row names no id, so no public Run now was pressed on it"
  grep -qE '"started": *true' "$folder/run-now.json" && [ "$(json_value "$folder/run-now.json" id)" = "$id" ] ||
    fail "the notebook did not answer Run now for routine $id with started:true for that id: $(tr -d '\n' <"$folder/run-now.json" | cut -c1-200)"

  # 2. The routine's own record of a finished, successful run that began after Run now.
  [ "$(json_value "$folder/routine-after.json" id)" = "$id" ] ||
    fail "the record kept after the run belongs to another routine than $id"
  "$NODE" -e '
const fs=require("fs"),row=JSON.parse(fs.readFileSync(process.argv[1],"utf8")),since=Number(fs.readFileSync(process.argv[2],"utf8"));
process.exit(row.last_run_at&&Date.parse(row.last_run_at)/1000>=since?0:1);' "$folder/routine-after.json" "$folder/run-requested.txt" ||
    fail "the routine records no run that began after Run now was pressed"
  [ "$(json_value "$folder/routine-after.json" last_status)" = ok ] ||
    fail "the routine ended its run as \"$(json_value "$folder/routine-after.json" last_status)\": $(json_value "$folder/routine-after.json" last_error)"
  [ -n "$(json_value "$folder/routine-status.json" coach-prep.at 2>/dev/null || true)" ] ||
    fail "the assistant's record has no coach-prep entry, so whether the routine failed is unknown"
  failed=$(json_value "$folder/routine-status.json" coach-prep.failed 2>/dev/null || true)
  case $failed in
    '' | null) ;;
    *) fail "the assistant's own record says the coach-prep routine failed: $failed" ;;
  esac

  # 3. A ready, dated preparation that the coach's own gate accepts, written by that run.
  [ -s "$folder/prep-path.txt" ] ||
    fail "the run wrote no coach/<area>/prep/<day>.md (the routine says: $(tr '\n' ' ' <"$folder/summary.txt" | cut -c1-240))"
  file=$(head -n 1 "$folder/prep-path.txt")
  grep -qE '^coach/[a-z0-9-]+/prep/[0-9]{4}-[0-9]{2}-[0-9]{2}\.md$' <<<"$file" ||
    fail "the preparation's path ($file) is not coach/<area>/prep/<day>.md"
  grep -qx 'STATE: ready' "$folder/prep.md" ||
    fail "the preparation is not ready (its STATE is $(sed -n 's/^STATE: //p' "$folder/prep.md" | head -n 1)): $(tr '\n' ' ' <"$folder/prep.md" | cut -c1-200)"
  local prepared since
  prepared=$(sed -n 's/^PREPARED: //p' "$folder/prep.md" | head -n 1)
  since=$(cat "$folder/run-requested.txt")
  { [ -n "$prepared" ] && [ "$(date -u -d "$prepared" +%s 2>/dev/null || echo 0)" -ge "$since" ]; } ||
    fail "the preparation is not dated at the run: PREPARED is \"$prepared\", and Run now was pressed at $since (epoch seconds)"
  grep -q '^ready: ' "$folder/prep-check.txt" ||
    fail "the coach's own gate does not accept the preparation: $(tr '\n' ' ' <"$folder/prep-check.txt" | cut -c1-200)"
  grep -qF -- "$file" "$folder/summary.txt" ||
    fail "the routine's own summary does not name the preparation $file: $(tr '\n' ' ' <"$folder/summary.txt" | cut -c1-200)"
  [ -s "$folder/brief.txt" ] || fail "the coach printed no brief for the prepared talk"

  # 4. Nothing left behind, and nothing leaked.
  grep -qx 'started-by-this-route=none' "$folder/cleanup.txt" && grep -qx 'running-after=none' "$folder/cleanup.txt" ||
    fail "the cleanup record does not show that the route left no process of its own behind"
  if [ -n "${GODSPEED_SCENARIO_AI_KEY:-}" ] && grep -RIlF --exclude=install.log -- "$GODSPEED_SCENARIO_AI_KEY" "$folder" >/dev/null 2>&1; then
    fail "the AI key leaked into retained evidence at $(grep -RIlF --exclude=install.log -- "$GODSPEED_SCENARIO_AI_KEY" "$folder" | head -n 1)"
  fi

  local leak_clause="; the AI key was not given to this check, so its evidence was not scanned for it"
  [ -z "${GODSPEED_SCENARIO_AI_KEY:-}" ] || leak_clause="; the AI key is not in its evidence"
  pass "Run now on the installed \"$ROUTINE\" routine (routine $id) ended ok after it was pressed and wrote a ready preparation at $(head -n 1 "$folder/prep-path.txt"), dated at the run, that the coach's own gate accepts; the route started no process of its own${leak_clause}"
}

if [ "$CHECK_ONLY" = yes ]; then
  install_paths
  check "$EVIDENCE"
else
  act
  check "$EVIDENCE"
fi
