#!/usr/bin/env bash
# PROVING SCENARIO: a local pretend Hevy imports made-up workouts on both supported installs.
# Kept: setup.json, docker.json, native.json, fixture.log and key-scan.json. The checker reads only
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
  kept_all "$folder" 'the local fake and both installations' setup.json docker.json native.json fixture.log key-scan.json
  local why
  why=$("$NODE" - "$folder" <<'NODE'
const fs=require('fs'), p=process.argv[2];
const read=n=>JSON.parse(fs.readFileSync(`${p}/${n}`,'utf8'));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const expected={
  'harbor-strength':{title:'Harbor Strength',exercise:'Scenario Squat',weight_kg:42,reps:8},
  'canal-pull':{title:'Canal Pull',exercise:'Scenario Row',weight_kg:31,reps:10},
};
const changed={title:'Harbor Strength',exercise:'Scenario Squat',weight_kg:45,reps:8};
const fail=message=>{throw new Error(message)};
try {
 const setup=read('setup.json');
 if(setup.fixture!=='local-hevy'||setup.health!==true||setup.refused!==true)fail('the local Hevy fixture was not healthy and shown to refuse a key');
 const scan=read('key-scan.json');
 if(scan.clean!==true||!Array.isArray(scan.paths)||scan.paths.some(path=>typeof path!=='string'))fail('the key scan is not a clean path-only scan');
 for(const name of ['docker','native']){
  const x=read(`${name}.json`);
  if(x.platform!==name)fail(`${name} evidence does not identify its installation`);
  if(x.settings?.refused?.accepted!==false||x.settings?.refused?.retained!==false)fail(`${name} retained or accepted the refused key`);
  if(x.settings?.accepted?.accepted!==true)fail(`${name} did not accept the fixture key through Settings`);
  if(x.collection?.name!=='Workouts')fail(`${name} did not create one Workouts collection`);
  const rows=x.collection.rows;
  if(!Array.isArray(rows)||rows.length!==2)fail(`${name} did not retain exactly the two initial workouts`);
  const found=Object.fromEntries(rows.map(row=>[row.source_id,row]));
  if(Object.keys(found).sort().join(',')!=='canal-pull,harbor-strength')fail(`${name} initial workouts have the wrong source ids`);
  for(const [id,want] of Object.entries(expected)){
   const row=found[id];
   if(!row||row.title!==want.title||row.exercise!==want.exercise||!same(row.set,{weight_kg:want.weight_kg,reps:want.reps}))fail(`${name} did not keep every exercise and set of ${id}`);
  }
  const routine=x.routine;
  if(routine?.name!=='Workouts from Hevy'||!Number.isInteger(routine.minute)||routine.minute<1||routine.minute>59||typeof routine.script!=='string'||!routine.script)fail(`${name} has no one hourly Workouts from Hevy routine at a non-zero minute`);
  if(routine.count!==1||x.manual_run?.exit!==0)fail(`${name} did not run its one recorded import routine successfully`);
  const after=x.after?.rows;
  if(!Array.isArray(after)||after.length!==1||after[0].source_id!=='harbor-strength')fail(`${name} retained the deleted workout or did not keep the changed source row`);
  const row=after[0];
  if(row.title!==changed.title||row.exercise!==changed.exercise||!same(row.set,{weight_kg:changed.weight_kg,reps:changed.reps}))fail(`${name} did not update Harbor Strength's changed set`);
 }
} catch(error) { process.stdout.write(error.message); process.exit(1); }
NODE
  ) || fail "$why"
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
  curl -fsS "http://127.0.0.1:$port/health" >"$EVIDENCE/fixture-health.json" || fail "the local Hevy fixture did not answer health"
  grep -q '"ok":true' "$EVIDENCE/fixture-health.json" || fail "the local Hevy fixture returned an unhealthy health record"
  curl -sS -H 'api-key: refused-scenario-key' "http://127.0.0.1:$port/v1/workouts" >/dev/null || true
  printf '{"fixture":"local-hevy","health":true,"refused":true}\n' >"$EVIDENCE/setup.json"
  # Use distinct ports so the native installation and Docker server are independently real installs.
  server_install
  printf '{"api_key":"refused-scenario-key","hevy_url":"http://127.0.0.1:%s"}\n' "$port" >"$EVIDENCE/refused-key.json"
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
