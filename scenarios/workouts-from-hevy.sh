#!/usr/bin/env bash
# PROVING SCENARIO: a local pretend Hevy imports made-up workouts on both supported installs.
# Kept: setup.json, fixture-health.json, docker.json, native.json, fixture.log and key-scan.json. The platform records
# retain refused-key scan paths as well, so the checker reads only durable observations a future add-on cannot make pass.
SCENARIO=workouts-from-hevy
. "$(dirname "$0")/scenario-lib.sh"
# shellcheck source=scenarios/numbers-lib.sh
. "$(dirname "$0")/numbers-lib.sh"
REFUSED_HEVY_KEY='refused-'"scenario-key"

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
  printf 'services:\n  godspeed:\n    extra_hosts:\n      - "host.docker.internal:host-gateway"\n    environment:\n      GODSPEED_WORKOUTS_TEST: "1"\n      GODSPEED_WORKOUTS_HEVY_API: "http://host.docker.internal:%s"\n' "$1" |
    sudo tee "$SERVER_DIR/compose.override.yaml" >/dev/null ||
    fail "the Docker notebook Hevy override could not be written"
  server_compose -f "$SERVER_DIR/compose.override.yaml" up -d --force-recreate >&2 ||
    fail "the Docker notebook could not be restarted with the local Hevy address"
  server_healthy 300 || fail "the Docker notebook was not healthy with the local Hevy address"
}

native_hevy_environment() { # <port>
  printf '[Service]\nEnvironment="GODSPEED_WORKOUTS_TEST=1"\nEnvironment="GODSPEED_WORKOUTS_HEVY_API=http://127.0.0.1:%s"\n' "$1"
}

native_hevy_url() { # <port>
  local unit=${UNIT:-godspeed-integrated-notebook.service} dropin
  if systemctl --user cat "$unit" >/dev/null 2>&1; then
    dropin=$HOME/.config/systemd/user/$unit.d
    mkdir -p "$dropin" || fail "the native notebook Hevy override folder could not be made"
    native_hevy_environment "$1" >"$dropin/scenario-hevy.conf" ||
      fail "the native notebook Hevy override could not be written"
    systemctl --user daemon-reload && systemctl --user restart "$unit" ||
      fail "the native notebook could not be restarted with the local Hevy address"
  elif systemctl cat "$unit" >/dev/null 2>&1; then
    dropin=/etc/systemd/system/$unit.d
    sudo mkdir -p "$dropin" || fail "the native notebook Hevy override folder could not be made"
    native_hevy_environment "$1" | sudo tee "$dropin/scenario-hevy.conf" >/dev/null ||
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

persistence_roots() { # <docker|native> <scan name>
  local platform=$1 scan=$2 descriptor home
  case $platform in
    native)
      assistant_home "$scan"
      # The carried add-on keeps its key in its own state folder, ~/.godspeed/workouts of the account
      # the notebook runs as (third-party/addons/godspeed-workouts/lib/paths.mjs): that hevy.json is the
      # key's one permitted file, and the folder is scanned with the rest once it exists.
      NATIVE_PERSISTENCE_ROOTS=("$ROOT" "$STATE" "$HERMES")
      [ ! -d "$HOME/.godspeed/workouts" ] || NATIVE_PERSISTENCE_ROOTS+=("$HOME/.godspeed/workouts")
      NATIVE_PERMITTED_HEVY_SETTINGS=$HOME/.godspeed/workouts/hevy.json
      ;;
    docker)
      descriptor=$(in_server find /opt/data -path '*/.godspeed/assistant.json' -type f -print -quit) ||
        fail "$scan could not find the Docker assistant descriptor"
      [ -n "$descriptor" ] || fail "$scan found no Docker assistant descriptor"
      home=$(in_server node -e 'const fs=require("fs");process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1])).home||"")' "$descriptor") ||
        fail "$scan could not read the Docker assistant home from $descriptor"
      [ -n "$home" ] || fail "$scan found no Docker assistant home in $descriptor"
      DOCKER_PERSISTENCE_ROOTS=(/opt/data "$home")
      # The image's HOME is the assistant's home (docker/full-candidate/Dockerfile), so the add-on's state
      # folder is ~/.godspeed/workouts there.
      DOCKER_PERMITTED_HEVY_SETTINGS=$home/.godspeed/workouts/hevy.json
      ;;
    *) fail "unknown $platform persistence scan" ;;
  esac
}

refused_not_retained() { # <docker|native>
  local platform=$1 key=$REFUSED_HEVY_KEY paths=$EVIDENCE/.$1-refused-key-paths code
  persistence_roots "$platform" "$platform refused-key scan"
  case $platform in
    docker)
      if in_server grep -rlF -- "$key" "${DOCKER_PERSISTENCE_ROOTS[@]}" >"$paths"; then :; else
        code=$?
        [ "$code" -eq 1 ] || fail "$platform refused-key scan could not run (server grep ended $code)"
      fi
      ;;
    native)
      if grep -rlF -- "$key" "${NATIVE_PERSISTENCE_ROOTS[@]}" >"$paths"; then :; else
        code=$?
        [ "$code" -eq 1 ] || fail "$platform refused-key scan could not run (grep ended $code)"
      fi
      ;;
  esac
  [ -f "$paths" ] || fail "$platform refused-key scan produced no path record"
  sort -u -o "$paths" "$paths" || fail "$platform refused-key scan could not collect its path record"
  [ ! -s "$paths" ] || fail "$platform kept the refused Hevy key in $(head -n 1 "$paths")"
}

workout_snapshot() { # <docker|native> <file> <routine file> <exit file>
  local platform=$1 output=$2 routine_file=$3 exit_file=$4 query collection items jobs script python code docker_home assistant_path
  query=$EVIDENCE/.workouts-$platform-query.json
  collection=$EVIDENCE/.workouts-$platform-collections.json
  items=$EVIDENCE/.workouts-$platform-items.json
  jobs=$EVIDENCE/.workouts-$platform-jobs.json
  case $platform in
    docker)
      server_table collections "$collection"; server_table collection_items "$items"
      in_server sh -c 'find /opt/data -path "*/.godspeed/assistant.json" -type f -print -quit' >"$EVIDENCE/.docker-assistant-path" 2>/dev/null || :
      assistant_path=$(cat "$EVIDENCE/.docker-assistant-path")
      [ -n "$assistant_path" ] || fail "the Docker install recorded no assistant descriptor for the Hevy routine"
      docker_home=$(in_server node -e 'const fs=require("fs");process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1])).home||"")' "$assistant_path" 2>/dev/null || true)
      [ -n "$docker_home" ] || fail "the Docker install recorded no assistant home for the Hevy routine"
      in_server cat "$docker_home/cron/jobs.json" >"$jobs" 2>/dev/null || : >"$jobs"
      ;;
    native)
      for query in collections collection_items; do
        curl -fsS --max-time 60 -X POST -H 'Content-Type: application/json' --data "{\"table\":\"$query\"}" \
          "http://127.0.0.1:$NOTEBOOK_PORT/api/query" >"$EVIDENCE/.workouts-$platform-$query.json" ||
          fail "the native notebook could not read $query for the Hevy import"
      done
      collection=$EVIDENCE/.workouts-$platform-collections.json items=$EVIDENCE/.workouts-$platform-collection_items.json
      assistant_home
      cp "$HERMES/cron/jobs.json" "$jobs" 2>/dev/null || : >"$jobs"
      ;;
  esac
  "$NODE" - "$platform" "$collection" "$items" "$jobs" "$output" "$routine_file" <<'NODE'
const fs=require('fs');const [platform,collectionsFile,itemsFile,jobsFile,out,routineOut]=process.argv.slice(2);
const read=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8'))}catch{return null}};
const rows=data=>Array.isArray(data)?data:(Array.isArray(data?.data)?data.data:(Array.isArray(data?.jobs)?data.jobs:[]));
const named=rows(read(collectionsFile)).filter(row=>row?.name==='Workouts'),all=rows(read(itemsFile));
const collection=named.find(row=>row?.source_app==='godspeed-workouts')||named[0];
const items=collection?all.filter(row=>row?.collection_id===collection.id):[];
process.stderr.write(`${platform} snapshot: ${named.length} Workouts collection(s) [${named.map(row=>`${row.id}/${row.source_app||'-'}`).join(' ')}], ${all.length} item(s) [${[...new Set(all.map(row=>row?.collection_id))].join(' ')}], ${items.length} in the one read
`);
const value=(item,...names)=>names.map(name=>item?.[name]??item?.data?.[name]).find(value=>value!==undefined&&value!==null);
// A row as the carried add-on writes it (third-party/addons/godspeed-workouts/lib/rows.mjs): the Hevy id as
// the item's source_id, the title in "workout", and each exercise with its sets as "Scenario Squat: 8 x 42 kg".
const workoutRows=items.map(item=>{const logged=/^(.+?): (\d+(?:\.\d+)?) x (\d+(?:\.\d+)?) kg$/.exec(String(value(item,'exercises')||''));return {source_id:value(item,'source_id'),title:value(item,'workout'),exercise:logged?.[1],set:logged?{weight_kg:Number(logged[3]),reps:Number(logged[2])}:null};});
const jobs=rows(read(jobsFile));
const routine=jobs.filter(job=>job?.name==='Workouts from Hevy');const job=routine[0]||{};
const cron=String(job.cron||job.schedule?.expr||job.schedule||'');const minute=/^([0-9]+)\s+\*/.exec(cron)?.[1];
fs.writeFileSync(out,JSON.stringify({platform,collection:collection&&{name:collection.name,rows:workoutRows},routine:{name:job.name,minute:minute===undefined?null:Number(minute),script:job.script||'',count:routine.length}})+'\n');
fs.writeFileSync(routineOut,String(job.script||''));
NODE
  script=$(cat "$routine_file")
  [ -n "$script" ] || { printf '1\n' >"$exit_file"; return; }
  case $platform in
    docker)
      # As the account the notebook and its routines run as; root would read another state folder.
      in_server_as_hermes sh -c "cd \"$docker_home/scripts\" && python3 \"$docker_home/scripts/$script\"" >/dev/null 2>&1; code=$?
      ;;
    native)
      python=$(json_value "$HERMES/scripts/godspeed-routines.json" hermes_python) || { printf '1\n' >"$exit_file"; return; }
      # With the local Hevy address the notebook's service has (native_hevy_url), as its routines run.
      (cd "$HERMES/scripts" && GODSPEED_WORKOUTS_TEST=1 GODSPEED_WORKOUTS_HEVY_API="http://127.0.0.1:$HEVY_FIXTURE_PORT" "$python" "$HERMES/scripts/$script") >/dev/null 2>&1; code=$?
      ;;
  esac
  printf '%s\n' "$code" >"$exit_file"
}

platform_before() { # <docker|native> <accepted settings json>
  # $1, not $platform: a word of `local` is expanded before the line sets platform, so it would be the caller's.
  local platform=$1 accepted=$2 response=$EVIDENCE/$1-accepted.json code routine before=$EVIDENCE/.$1-before.json
  code=$(settings_post "$platform" "$accepted" "$response")
  [ "$code" -ge 200 ] 2>/dev/null && [ "$code" -lt 300 ] ||
    fail "$platform Settings did not accept the made-up Hevy key (HTTP $code): $(tr -d '\n' <"$response" | cut -c1-200)"
  routine=$EVIDENCE/.$platform-routine
  workout_snapshot "$platform" "$before" "$routine" "$EVIDENCE/.$platform-manual-exit"
}

platform_after() { # <docker|native>
  local platform=$1 response=$EVIDENCE/$1-accepted.json before=$EVIDENCE/.$1-before.json after=$EVIDENCE/.$1-after.json routine=$EVIDENCE/.$1-routine refused_paths=$EVIDENCE/.$1-refused-key-paths
  # A snapshot reads the tables before it runs the routine by hand: the first run brings Hevy's change
  # in and its exit is the one kept, the second snapshot reads what that run left.
  workout_snapshot "$platform" "$EVIDENCE/.$1-applied.json" "$routine" "$EVIDENCE/.$platform-manual-exit"
  workout_snapshot "$platform" "$after" "$routine" "$EVIDENCE/.$platform-reread-exit"
  "$NODE" - "$before" "$after" "$response" "$EVIDENCE/.$platform-manual-exit" "$refused_paths" "$EVIDENCE/$platform.json" <<'NODE'
const fs=require('fs');const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const before=read(process.argv[2]),after=read(process.argv[3]);
const paths=fs.readFileSync(process.argv[6],'utf8').trim().split(/\r?\n/).filter(Boolean);
fs.writeFileSync(process.argv[7],JSON.stringify({...before,settings:{refused:{accepted:false,retained:paths.length!==0,paths},accepted:{accepted:true}},manual_run:{exit:Number(fs.readFileSync(process.argv[5],'utf8'))},after:{rows:after.collection?.rows||[]}})+'\n');
NODE
}

scan_fixture_key() { # [accepted fixture key]
  local key=${1:-'00000000-0000-4000-8000-000000000001'} code native_paths=$EVIDENCE/.native-key-hits docker_paths=$EVIDENCE/.docker-key-hits
  persistence_roots native 'native accepted-key scan'
  if grep -rlF --exclude-dir=.git --exclude-dir=node_modules -- "$key" "${NATIVE_PERSISTENCE_ROOTS[@]}" >"$native_paths"; then
    [ -s "$native_paths" ] || fail 'native accepted-key scan completed with no path output after a match'
  else
    code=$?
    [ "$code" -eq 1 ] || fail "native accepted-key scan could not run (grep ended $code)"
  fi
  [ -f "$native_paths" ] || fail "native accepted-key scan produced no path record"
  persistence_roots docker 'docker accepted-key scan'
  if in_server grep -rlF --exclude-dir=node_modules -- "$key" "${DOCKER_PERSISTENCE_ROOTS[@]}" >"$docker_paths"; then
    [ -s "$docker_paths" ] || fail 'docker accepted-key scan completed with no path output after a match'
  else
    code=$?
    [ "$code" -eq 1 ] || fail "docker accepted-key scan could not run (server grep ended $code)"
  fi
  [ -f "$docker_paths" ] || fail "docker accepted-key scan produced no path record"
  if "$NODE" - "$native_paths" "$NATIVE_PERMITTED_HEVY_SETTINGS" "$docker_paths" "$DOCKER_PERMITTED_HEVY_SETTINGS" >"$EVIDENCE/.key-hits" <<'NODE'
const fs=require('fs'),[nativePaths,nativePermitted,dockerPaths,dockerPermitted]=process.argv.slice(2);
for (const [pathsFile,permitted] of [[nativePaths,nativePermitted],[dockerPaths,dockerPermitted]]) {
  for (const path of fs.readFileSync(pathsFile,'utf8').trim().split(/\r?\n/).filter(Boolean)) {
    if (path!==permitted) console.log(path);
  }
}
NODE
  then :; else
    fail 'accepted-key scan could not filter its path records'
  fi
  sort -u -o "$EVIDENCE/.key-hits" "$EVIDENCE/.key-hits" ||
    fail 'accepted-key scan could not sort its path records'
  if "$NODE" - "$EVIDENCE/.key-hits" >"$EVIDENCE/key-scan.json" <<'NODE'
const fs=require('fs'),paths=fs.readFileSync(process.argv[2],'utf8').trim().split(/\r?\n/).filter(Boolean);
console.log(JSON.stringify({clean:paths.length===0,paths}));
NODE
  then :; else
    fail 'accepted-key scan could not write its record'
  fi
  [ -s "$EVIDENCE/key-scan.json" ] || fail 'accepted-key scan produced no record'
  rm -f "$native_paths" "$docker_paths" "$EVIDENCE/.key-hits"
}

act() {
  need_node
  fresh_evidence
  local state=$EVIDENCE/fixture-state.json port pid fixture_key
  fixture_key=$("$NODE" -p 'require("crypto").randomUUID()') || fail "the selected Node could not make the local Hevy fixture key"
  : >"$EVIDENCE/fixture.log"
  GODSPEED_HEVY_FIXTURE_KEY="$fixture_key" GODSPEED_HEVY_FIXTURE_HOST=0.0.0.0 "$NODE" "$HERE/hevy-fixture.mjs" --state "$state" --log "$EVIDENCE/fixture.log" >"$EVIDENCE/fixture-port" & pid=$!
  trap 'kill "$pid" 2>/dev/null || true' EXIT
  wait_for 20 'the local Hevy fixture to name its port' test -s "$EVIDENCE/fixture-port" || fail "the local Hevy fixture did not start"
  port=$(cat "$EVIDENCE/fixture-port")
  HEVY_FIXTURE_PORT=$port
  curl -fsS "http://127.0.0.1:$port/health" >"$EVIDENCE/fixture-health.json" || fail "the local Hevy fixture did not answer health"
  grep -q '"ok":true' "$EVIDENCE/fixture-health.json" || fail "the local Hevy fixture returned an unhealthy health record"
  curl -sS -H "api-key: $REFUSED_HEVY_KEY" "http://127.0.0.1:$port/v1/workouts" >/dev/null || true
  printf '{"fixture":"local-hevy"}\n' >"$EVIDENCE/setup.json"
  # Use distinct ports so the native installation and Docker server are independently real installs.
  server_install; server_hevy_url "$port"
  printf '{"key":"%s"}\n' "$REFUSED_HEVY_KEY" >"$EVIDENCE/.refused-key.json"
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
  printf '{"key":"%s"}\n' "$fixture_key" >"$EVIDENCE/.accepted-key.json"
  platform_before docker "$EVIDENCE/.accepted-key.json"
  platform_before native "$EVIDENCE/.accepted-key.json"
  "$NODE" "$HERE/hevy-fixture.mjs" --state "$EVIDENCE/fixture-state.json" --log "$EVIDENCE/fixture.log" --mutate ||
    fail "the local Hevy fixture could not change its made-up workouts"
  platform_after docker
  platform_after native
  rm -f "$EVIDENCE/.refused-key.json" "$EVIDENCE/.accepted-key.json"
  scan_fixture_key "$fixture_key"
  check "$EVIDENCE"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  scenario_arguments "$@"
  if [ "$CHECK_ONLY" = yes ]; then install_paths; check "$EVIDENCE"; else act; fi
fi
