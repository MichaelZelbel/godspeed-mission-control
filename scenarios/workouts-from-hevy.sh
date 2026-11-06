#!/usr/bin/env bash
# PROVING SCENARIO: a local pretend Hevy imports made-up workouts on both supported installs.
# Kept: setup.json, docker.json, native.json, fixture.log and key-scan.txt. The checker reads only
# these files so a future add-on change cannot make its own proof pass.
SCENARIO=workouts-from-hevy
. "$(dirname "$0")/scenario-lib.sh"
# shellcheck source=scenarios/numbers-lib.sh
. "$(dirname "$0")/numbers-lib.sh"
scenario_arguments "$@"

check() {
  local folder=$1
  [ -d "$folder" ] || fail "there is nothing at $folder, so this scenario kept no import evidence"
  need_node
  kept_all "$folder" 'the local fake and both installations' setup.json docker.json native.json fixture.log key-scan.txt
  "$NODE" - "$folder" <<'NODE' || fail "the kept import evidence is malformed or does not prove both initial workouts, the hourly routine, the update and deletion"
const fs=require('fs'), p=process.argv[2];
const read=n=>JSON.parse(fs.readFileSync(`${p}/${n}`,'utf8'));
const setup=read('setup.json'); if(setup.fixture!=='local-hevy'||setup.refused!==true)throw Error();
for(const name of ['docker.json','native.json']){
 const x=read(name); if(x.refusedKeyRetained||x.routine?.name!=='Workouts from Hevy'||!Number.isInteger(x.routine?.minute)||x.routine.minute<1||x.routine.minute>59)throw Error();
 const ids=x.initial?.map(r=>r.id).sort().join(','); if(ids!=='canal-pull,harbor-strength')throw Error();
 const after=x.after||[]; if(after.length!==1||after[0].id!=='harbor-strength'||after[0].weight_kg!==45)throw Error();
}
if(fs.readFileSync(`${p}/key-scan.txt`,'utf8').trim()!=='clean')throw Error();
NODE
  grep -q '"accepted":false' "$folder/fixture.log" || fail "the fixture log has no refused-key request"
  pass "the local Hevy fixture refused the made-up bad key; Docker and Linux each kept Harbor Strength updated, removed Canal Pull, and recorded one hourly Workouts from Hevy routine"
}

act() {
  fresh_evidence
  local state=$EVIDENCE/fixture-state.json port pid
  : >"$EVIDENCE/fixture.log"
  node "$HERE/hevy-fixture.mjs" --state "$state" --log "$EVIDENCE/fixture.log" >"$EVIDENCE/fixture-port" & pid=$!
  trap 'kill "$pid" 2>/dev/null || true' EXIT
  wait_for 20 'the local Hevy fixture to name its port' test -s "$EVIDENCE/fixture-port" || fail "the local Hevy fixture did not start"
  port=$(cat "$EVIDENCE/fixture-port")
  curl -fsS "http://127.0.0.1:$port/health" >"$EVIDENCE/setup.json" || fail "the local Hevy fixture did not answer health"
  curl -sS -H 'api-key: refused-scenario-key' "http://127.0.0.1:$port/v1/workouts" >/dev/null || true
  # Use distinct ports so the native installation and Docker server are independently real installs.
  server_install
  printf '{"api_key":"refused-scenario-key"}\n' >"$EVIDENCE/refused-key.json"
  server_post /api/workouts "$EVIDENCE/refused-key.json" "$EVIDENCE/docker-settings.json" >"$EVIDENCE/docker-settings.code"
  export GODSPEED_PORT=47832
  install_paths
  install_the_stage_line "$EVIDENCE/install.log"
  wait_for 180 'the native notebook to answer after install' notebook_is_up || fail "the native notebook did not answer after install"
  curl -sS -o "$EVIDENCE/native-settings.json" -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
    --data-binary @"$EVIDENCE/refused-key.json" "http://127.0.0.1:$NOTEBOOK_PORT/api/workouts" >"$EVIDENCE/native-settings.code" || true
  # The behavior ticket owns this endpoint. Both installations have now reached the same absent seam.
  if [ "$(cat "$EVIDENCE/docker-settings.code")" = 404 ] && [ "$(cat "$EVIDENCE/native-settings.code")" = 404 ]; then
    fail "the Docker and native notebooks have no Workouts Settings integration at /api/workouts yet (ticket 02 is the expected baseline failure)"
  fi
  fail "the Workouts Settings integration did not reject the made-up key consistently (Docker $(cat "$EVIDENCE/docker-settings.code"), native $(cat "$EVIDENCE/native-settings.code"))"
}

if [ "$CHECK_ONLY" = yes ]; then install_paths; check "$EVIDENCE"; else act; fi
