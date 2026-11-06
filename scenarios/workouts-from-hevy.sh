#!/usr/bin/env bash
# PROVING SCENARIO: a local pretend Hevy imports made-up workouts on both supported installs.
# Kept: setup.json, fixture-health.json, docker.json, native.json, fixture.log and key-scan.json. The platform records
# retain refused-key scan paths as well, so the checker reads only durable observations a future add-on cannot make pass.
SCENARIO=workouts-from-hevy
. "$(dirname "$0")/scenario-lib.sh"
# shellcheck source=scenarios/numbers-lib.sh
. "$(dirname "$0")/numbers-lib.sh"

check() {
  local folder=$1
  [ -d "$folder" ] || fail "there is nothing at $folder, so this scenario kept no import evidence"
  need_node
  kept_all "$folder" 'the local fake and both installations' setup.json fixture-health.json docker.json native.json fixture.log key-scan.json
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
 const setup=read('setup.json'), health=read('fixture-health.json');
 if(setup.fixture!=='local-hevy')fail('the retained setup is not for the local Hevy fixture');
 if(health?.ok!==true)fail('the retained local Hevy health response is not healthy');
 const fixture=fs.readFileSync(`${p}/fixture.log`,'utf8').trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
 if(!fixture.some(row=>row.path==='/v1/workouts'&&row.accepted===false&&row.status===401))fail('the fixture log has no refused GET /v1/workouts HTTP 401 observation');
 const scan=read('key-scan.json');
 if(scan.clean!==true||!Array.isArray(scan.paths)||scan.paths.some(path=>typeof path!=='string'))fail('the key scan is not a clean path-only scan');
 for(const name of ['docker','native']){
  const x=read(`${name}.json`);
  if(x.platform!==name)fail(`${name} evidence does not identify its installation`);
  const refused=x.settings?.refused;
  if(refused?.accepted!==false||refused?.retained!==false||!Array.isArray(refused?.paths)||refused.paths.some(path=>typeof path!=='string')||refused.paths.length)fail(`${name} retained or accepted the refused key`);
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
  pass "the local Hevy fixture refused the made-up bad key; Docker and Linux each kept Harbor Strength updated, removed Canal Pull, and recorded one hourly Workouts from Hevy routine"
}

server_hevy_url() { # <port>
  cat >"$SERVER_DIR/compose.override.yaml" <<EOF
services:
  godspeed:
    extra_hosts:
      - "host.docker.internal:host-gateway"
    environment:
      GODSPEED_WORKOUTS_HEVY_URL: "http://host.docker.internal:$1"
EOF
  (cd "$SERVER_DIR" && sudo docker compose up -d --force-recreate) >&2 ||
    fail "the Docker notebook could not be restarted with the local Hevy address"
  server_healthy 300 || fail "the Docker notebook was not healthy with the local Hevy address"
}

native_hevy_url() { # <port>
  local unit=${UNIT:-godspeed-integrated-notebook.service} dropin
  if systemctl --user cat "$unit" >/dev/null 2>&1; then
    dropin=$HOME/.config/systemd/user/$unit.d
    mkdir -p "$dropin" || fail "the native notebook Hevy override folder could not be made"
    printf '[Service]\nEnvironment="GODSPEED_WORKOUTS_HEVY_URL=http://127.0.0.1:%s"\n' "$1" >"$dropin/scenario-hevy.conf" ||
      fail "the native notebook Hevy override could not be written"
    systemctl --user daemon-reload && systemctl --user restart "$unit" ||
      fail "the native notebook could not be restarted with the local Hevy address"
  elif systemctl cat "$unit" >/dev/null 2>&1; then
    dropin=/etc/systemd/system/$unit.d
    sudo mkdir -p "$dropin" || fail "the native notebook Hevy override folder could not be made"
    printf '[Service]\nEnvironment="GODSPEED_WORKOUTS_HEVY_URL=http://127.0.0.1:%s"\n' "$1" | sudo tee "$dropin/scenario-hevy.conf" >/dev/null ||
      fail "the native notebook Hevy override could not be written"
    sudo systemctl daemon-reload && sudo systemctl restart "$unit" ||
      fail "the native notebook could not be restarted with the local Hevy address"
  else
    fail "the native notebook has no service to receive the local Hevy address"
  fi
  wait_for 180 'the native notebook to answer with the local Hevy address' notebook_is_up ||
    fail "the native notebook did not answer with the local Hevy address"
}

settings_post() { # <docker|native> <json file> <answer file>
  case $1 in
    docker) server_post /api/workouts "$2" "$3" ;;
    native) curl -sS -o "$3" -w '%{http_code}' --max-time 300 -X POST -H 'Content-Type: application/json' \
      --data-binary @"$2" "http://127.0.0.1:$NOTEBOOK_PORT/api/workouts" || true ;;
  esac
}

persistence_roots() {
  assistant_home
  DOCKER_PERSISTENCE_ROOTS=(/opt/data /root/.hermes)
  NATIVE_PERSISTENCE_ROOTS=("$ROOT" "$STATE" "$HERMES")
}

refused_not_retained() { # <docker|native>
  local platform=$1 key='refused-scenario-key' found paths=$EVIDENCE/.$1-refused-key-paths
  persistence_roots
  case $platform in
    docker) found=$(in_server sh -c "grep -rlF -- '$key' ${DOCKER_PERSISTENCE_ROOTS[*]} 2>/dev/null || true" 2>/dev/null || true) ;;
    native)
      found=$(grep -rlF -- "$key" "${NATIVE_PERSISTENCE_ROOTS[@]}" 2>/dev/null || true)
      ;;
  esac
  printf '%s\n' "$found" | sed '/^$/d' | sort -u >"$paths"
  [ ! -s "$paths" ] || fail "$platform kept the refused Hevy key in $(head -n 1 "$paths")"
}

workout_snapshot() { # <docker|native> <file> <routine file> <exit file>
  local platform=$1 output=$2 routine_file=$3 exit_file=$4 query collection items jobs routines script python code docker_home assistant_path
  query=$EVIDENCE/.workouts-$platform-query.json
  collection=$EVIDENCE/.workouts-$platform-collections.json
  items=$EVIDENCE/.workouts-$platform-items.json
  jobs=$EVIDENCE/.workouts-$platform-jobs.json
  routines=$EVIDENCE/.workouts-$platform-routines.json
  case $platform in
    docker)
      server_table collections "$collection"; server_table collection_items "$items"
      in_server sh -c 'find /opt/data -path "*/.godspeed/assistant.json" -type f -print -quit' >"$EVIDENCE/.docker-assistant-path" 2>/dev/null || :
      assistant_path=$(cat "$EVIDENCE/.docker-assistant-path")
      [ -n "$assistant_path" ] || fail "the Docker install recorded no assistant descriptor for the Hevy routine"
      docker_home=$(in_server node -e 'const fs=require("fs");process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1])).home||"")' "$assistant_path" 2>/dev/null || true)
      [ -n "$docker_home" ] || fail "the Docker install recorded no assistant home for the Hevy routine"
      in_server cat "$docker_home/cron/jobs.json" >"$jobs" 2>/dev/null || : >"$jobs"
      in_server cat /opt/data/.godspeed/notebook-routines.json >"$routines" 2>/dev/null || : >"$routines"
      ;;
    native)
      for query in collections collection_items; do
        curl -fsS --max-time 60 -X POST -H 'Content-Type: application/json' --data "{\"table\":\"$query\"}" \
          "http://127.0.0.1:$NOTEBOOK_PORT/api/query" >"$EVIDENCE/.workouts-$platform-$query.json" ||
          fail "the native notebook could not read $query for the Hevy import"
      done
      assistant_home
      cp "$HERMES/cron/jobs.json" "$jobs" 2>/dev/null || : >"$jobs"
      cp "$STATE/notebook-routines.json" "$routines" 2>/dev/null || : >"$routines"
      ;;
  esac
  "$NODE" - "$platform" "$collection" "$items" "$jobs" "$routines" "$output" "$routine_file" <<'NODE'
const fs=require('fs');const [platform,collectionsFile,itemsFile,jobsFile,routinesFile,out,routineOut]=process.argv.slice(2);
const read=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8'))}catch{return null}};
const rows=data=>Array.isArray(data)?data:(Array.isArray(data?.data)?data.data:(Array.isArray(data?.jobs)?data.jobs:[]));
const collection=rows(read(collectionsFile)).find(row=>row?.name==='Workouts');
const items=collection?rows(read(itemsFile)).filter(row=>row?.collection_id===collection.id):[];
const value=(item,...names)=>names.map(name=>item?.[name]??item?.data?.[name]).find(value=>value!==undefined&&value!==null);
const workoutRows=items.map(item=>({source_id:value(item,'source_id','hevy_id','workout_id','id'),title:value(item,'title','name'),exercise:value(item,'exercise','exercise_name'),set:value(item,'set')||{weight_kg:value(item,'weight_kg'),reps:value(item,'reps')}));
const jobs=rows(read(jobsFile)), routines=rows(read(routinesFile));
const routine=jobs.filter(job=>job?.name==='Workouts from Hevy');const job=routine[0]||{};
const cron=String(job.cron||job.schedule?.expr||job.schedule||'');const minute=/^([0-9]+)\s+\*/.exec(cron)?.[1];
fs.writeFileSync(out,JSON.stringify({platform,collection:collection&&{name:collection.name,rows:workoutRows},routine:{name:job.name,minute:minute===undefined?null:Number(minute),script:job.script||'',count:routine.length}})+'\n');
fs.writeFileSync(routineOut,String(job.script||''));
NODE
  script=$(cat "$routine_file")
  [ -n "$script" ] || { printf '1\n' >"$exit_file"; return; }
  case $platform in
    docker)
      in_server sh -c "cd \"$docker_home/scripts\" && python3 \"$docker_home/scripts/$script\"" >/dev/null 2>&1; code=$?
      ;;
    native)
      python=$(json_value "$HERMES/scripts/godspeed-routines.json" hermes_python) || { printf '1\n' >"$exit_file"; return; }
      (cd "$HERMES/scripts" && "$python" "$HERMES/scripts/$script") >/dev/null 2>&1; code=$?
      ;;
  esac
  printf '%s\n' "$code" >"$exit_file"
}

platform_before() { # <docker|native> <accepted settings json>
  local platform=$1 accepted=$2 response=$EVIDENCE/$platform-accepted.json code routine before=$EVIDENCE/.$platform-before.json after=$EVIDENCE/.$platform-after.json
  code=$(settings_post "$platform" "$accepted" "$response")
  [ "$code" -ge 200 ] 2>/dev/null && [ "$code" -lt 300 ] ||
    fail "$platform Settings did not accept the made-up Hevy key (HTTP $code): $(tr -d '\n' <"$response" | cut -c1-200)"
  routine=$EVIDENCE/.$platform-routine
  workout_snapshot "$platform" "$before" "$routine" "$EVIDENCE/.$platform-manual-exit"
}

platform_after() { # <docker|native>
  local platform=$1 response=$EVIDENCE/$platform-accepted.json before=$EVIDENCE/.$platform-before.json after=$EVIDENCE/.$platform-after.json routine=$EVIDENCE/.$platform-routine refused_paths=$EVIDENCE/.$platform-refused-key-paths
  workout_snapshot "$platform" "$after" "$routine" "$EVIDENCE/.$platform-manual-exit"
  "$NODE" - "$before" "$after" "$response" "$EVIDENCE/.$platform-manual-exit" "$refused_paths" "$EVIDENCE/$platform.json" <<'NODE'
const fs=require('fs');const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const before=read(process.argv[2]),after=read(process.argv[3]);
const paths=fs.readFileSync(process.argv[6],'utf8').trim().split(/\r?\n/).filter(Boolean);
fs.writeFileSync(process.argv[7],JSON.stringify({...before,settings:{refused:{accepted:false,retained:paths.length!==0,paths},accepted:{accepted:true}},manual_run:{exit:Number(fs.readFileSync(process.argv[5],'utf8'))},after:{rows:after.collection?.rows||[]}})+'\n');
NODE
}

scan_fixture_key() {
  local key='00000000-0000-4000-8000-000000000001' native_hits docker_hits
  persistence_roots
  native_hits=$(grep -rlF --exclude-dir=.git --exclude-dir=node_modules -- "$key" "${NATIVE_PERSISTENCE_ROOTS[@]}" 2>/dev/null || true)
  docker_hits=$(in_server sh -c "grep -rlF --exclude-dir=node_modules -- '$key' ${DOCKER_PERSISTENCE_ROOTS[*]} 2>/dev/null || true" 2>/dev/null || true)
  printf '%s\n%s\n' "$native_hits" "$docker_hits" | sed '/^$/d' | grep -vE '/hevy\.json$' | sort -u >"$EVIDENCE/.key-hits"
  "$NODE" - "$EVIDENCE/.key-hits" >"$EVIDENCE/key-scan.json" <<'NODE'
const fs=require('fs'),paths=fs.readFileSync(process.argv[2],'utf8').trim().split(/\r?\n/).filter(Boolean);
console.log(JSON.stringify({clean:paths.length===0,paths}));
NODE
  rm -f "$EVIDENCE/.key-hits"
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
  printf '{"fixture":"local-hevy"}\n' >"$EVIDENCE/setup.json"
  # Use distinct ports so the native installation and Docker server are independently real installs.
  server_install; server_hevy_url "$port"
  printf '{"api_key":"refused-scenario-key"}\n' >"$EVIDENCE/.refused-key.json"
  settings_post docker "$EVIDENCE/.refused-key.json" "$EVIDENCE/docker-settings.json" >"$EVIDENCE/docker-settings.code"
  export GODSPEED_PORT=47832
  install_paths
  install_the_stage_line "$EVIDENCE/install.log"
  wait_for 180 'the native notebook to answer after install' notebook_is_up || fail "the native notebook did not answer after install"
  native_hevy_url "$port"
  settings_post native "$EVIDENCE/.refused-key.json" "$EVIDENCE/native-settings.json" >"$EVIDENCE/native-settings.code"
  # The behavior ticket owns this endpoint. Both installations have now reached the same absent seam.
  if [ "$(cat "$EVIDENCE/docker-settings.code")" = 404 ] && [ "$(cat "$EVIDENCE/native-settings.code")" = 404 ]; then
    fail "the Docker and native notebooks have no Workouts Settings integration at /api/workouts yet (ticket 02 is the expected baseline failure)"
  fi
  for platform in docker native; do
    code=$(cat "$EVIDENCE/$platform-settings.code")
    [ "$code" -ge 400 ] 2>/dev/null && [ "$code" -lt 500 ] ||
      fail "$platform Settings did not reject the made-up Hevy key (HTTP $code)"
    refused_not_retained "$platform"
  done
  printf '{"api_key":"00000000-0000-4000-8000-000000000001"}\n' >"$EVIDENCE/.accepted-key.json"
  platform_before docker "$EVIDENCE/.accepted-key.json"
  platform_before native "$EVIDENCE/.accepted-key.json"
  node "$HERE/hevy-fixture.mjs" --state "$EVIDENCE/fixture-state.json" --log "$EVIDENCE/fixture.log" --mutate ||
    fail "the local Hevy fixture could not change its made-up workouts"
  platform_after docker
  platform_after native
  rm -f "$EVIDENCE/.refused-key.json" "$EVIDENCE/.accepted-key.json"
  scan_fixture_key
  check "$EVIDENCE"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  scenario_arguments "$@"
  if [ "$CHECK_ONLY" = yes ]; then install_paths; check "$EVIDENCE"; else act; fi
fi
