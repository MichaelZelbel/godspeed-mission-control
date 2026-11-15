#!/usr/bin/env bash
# PROVING SCENARIO: the notebook's 04:15 update path keeps a good Hermes and rolls back a bad one.
# Kept: releases.json, nights.json, notifications.json and fixture.log. The three night records
# include commits, restart evidence and the updater's decision rather than trusting its prose.
SCENARIO=hermes-update-rollback
. "$(dirname "${BASH_SOURCE[0]}")/scenario-lib.sh"

release_fixture_pid=''
release_source_manager=''
release_source_dropin=''
release_source_unit=''

cleanup_release_source() {
  if [ -n "$release_fixture_pid" ]; then
    kill "$release_fixture_pid" 2>/dev/null || true
    wait "$release_fixture_pid" 2>/dev/null || true
    release_fixture_pid=''
  fi
  [ -n "$release_source_dropin" ] || return 0
  case $release_source_manager in
    user)
      rm -f "$release_source_dropin" && systemctl --user daemon-reload && systemctl --user restart "$release_source_unit" || return 1
      ;;
    machine)
      sudo rm -f "$release_source_dropin" && sudo systemctl daemon-reload && sudo systemctl restart "$release_source_unit" || return 1
      ;;
  esac
  release_source_manager=''
  release_source_dropin=''
  release_source_unit=''
}

cleanup_on_exit() {
  local status=$?
  trap - EXIT
  cleanup_release_source || say 'the local Hermes release source could not be removed'
  exit "$status"
}

check() {
  local folder=$1
  [ -d "$folder" ] || fail "there is nothing at $folder, so this scenario kept no Hermes update evidence"
  need_node
  kept_all "$folder" 'the local releases and three nightly decisions' releases.json nights.json notifications.json fixture.log
  local why
  why=$("$NODE" - "$folder" <<'NODE'
const fs=require('fs'),p=process.argv[2],r=n=>JSON.parse(fs.readFileSync(`${p}/${n}`));
const fail=message=>{throw new Error(message)};
try {
 const releases=r('releases.json'); const byVersion=Object.fromEntries(releases.map(x=>[x.version,x]));
 if(!byVersion['1.1.0']?.healthy||byVersion['1.2.0']?.healthy!==false||byVersion['1.3.0']?.age_days!==3)fail('the local fixture does not describe the good, broken, and three-day releases');
 const n=r('nights.json'); if(!Array.isArray(n)||n.length!==3)fail('the evidence has not retained exactly three nightly decisions');
 const [good,broken,recent]=n;
 if(good.attempt!=='1.1.0'||good.version!=='1.1.0'||!good.commit||good.chat!==true||good.failure_bell!==false)fail('the good 1.1.0 release was not kept with a working chat and no bell');
 if(broken.attempt!=='1.2.0'||broken.failed_check!=='Hermes cron'||broken.version!=='1.1.0'||broken.commit!==good.commit||broken.restarts<2||broken.chat!==true)fail('the broken 1.2.0 release was not restored to the exact earlier commit after Hermes cron');
 if(recent.attempted!==false||recent.version!=='1.1.0'||recent.commit!==good.commit||recent.notification_count!==1)fail('the three-day 1.3.0 release was taken or changed the notification count');
 const bells=r('notifications.json');if(!Array.isArray(bells)||bells.length!==1||bells[0].version!=='1.2.0'||bells[0].pending!==true)fail('there is not exactly one pending bell for the broken 1.2.0 release');
} catch(error) { process.stdout.write(error.message); process.exit(1); }
NODE
  ) || fail "$why"
  pass "the nightly notebook path kept 1.1.0, restored it after 1.2.0 failed cron list with the gateway restarted, rang one bell for 1.2.0, and left the three-day-old 1.3.0 alone"
}

act() {
  trap cleanup_on_exit EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  fresh_evidence
  : >"$EVIDENCE/fixture.log"
  node "$HERE/hermes-update-fixture.mjs" --dir "$EVIDENCE/releases" --log "$EVIDENCE/fixture.log" >"$EVIDENCE/fixture-made.txt" ||
    fail "the local Hermes release fixture could not be made"
  install_paths; install_the_stage_line "$EVIDENCE/install.log"; need_node
  wait_for 180 'the notebook to answer after install' notebook_is_up || fail "the notebook did not answer after install"
  install_fixture_hermes
  local_release_source
  record_releases
  run_night 2026-11-06 1.1.0 good
  node "$HERE/hermes-update-fixture.mjs" --dir "$EVIDENCE/releases" --reveal 1.2.0 >/dev/null || fail "the broken local Hermes release could not be revealed"
  run_night 2026-11-07 1.2.0 broken
  node "$HERE/hermes-update-fixture.mjs" --dir "$EVIDENCE/releases" --reveal 1.3.0 >/dev/null || fail "the recent local Hermes release could not be revealed"
  run_night 2026-11-08 1.3.0 recent
  make_nights
  cleanup_release_source || fail "the local Hermes release source could not be removed"
  check "$EVIDENCE"
}

local_release_source() {
  local url_file=$EVIDENCE/release-source-url.txt unit=${UNIT:-godspeed-integrated-notebook.service} dropin url
  node "$HERE/hermes-update-fixture.mjs" --dir "$EVIDENCE/releases" --serve >"$url_file" 2>"$EVIDENCE/release-source.log" &
  release_fixture_pid=$!
  wait_for 30 'the local Hermes release source to start' test -s "$url_file" || fail "the local Hermes release source did not start"
  url=$(cat "$url_file")
  if systemctl --user cat "$unit" >/dev/null 2>&1; then
    dropin=$HOME/.config/systemd/user/$unit.d
    release_source_manager=user
    release_source_dropin=$dropin/scenario-hermes-releases.conf
    release_source_unit=$unit
    mkdir -p "$dropin" || fail "the notebook release-source override folder could not be made"
    printf '[Service]\nEnvironment="GODSPEED_SCENARIO_HERMES_UPDATE_RELEASES_URL=%s"\n' "$url" >"$release_source_dropin" || fail "the notebook release-source override could not be written"
    systemctl --user daemon-reload && systemctl --user restart "$unit" || fail "the notebook could not be restarted with the local Hermes releases"
  elif systemctl cat "$unit" >/dev/null 2>&1; then
    dropin=/etc/systemd/system/$unit.d
    release_source_manager=machine
    release_source_dropin=$dropin/scenario-hermes-releases.conf
    release_source_unit=$unit
    sudo mkdir -p "$dropin" || fail "the notebook release-source override folder could not be made"
    printf '[Service]\nEnvironment="GODSPEED_SCENARIO_HERMES_UPDATE_RELEASES_URL=%s"\n' "$url" | sudo tee "$release_source_dropin" >/dev/null || fail "the notebook release-source override could not be written"
    sudo systemctl daemon-reload && sudo systemctl restart "$unit" || fail "the notebook could not be restarted with the local Hermes releases"
  else
    fail "the native notebook has no service to receive the local Hermes releases"
  fi
  wait_for 180 'the notebook to answer with the local Hermes releases' notebook_is_up || fail "the notebook did not answer with the local Hermes releases"
}

install_fixture_hermes() {
  local descriptor=$STATE/assistant.json fixture_home=$EVIDENCE/hermes-home
  mkdir -p "$fixture_home" || fail "the local Hermes home could not be made"
  "$NODE" - "$descriptor" "$fixture_home" "$EVIDENCE/releases/bin/hermes" "$EVIDENCE/releases" <<'NODE'
const fs=require('fs');const [file,home,executable,sourceRoot]=process.argv.slice(2);
let old;try{old=JSON.parse(fs.readFileSync(file,'utf8'))}catch{old={};}
fs.writeFileSync(file,JSON.stringify({...old,verified:true,home,executable,sourceRoot})+'\n');
NODE
  restart_notebook || fail "the notebook could not be restarted with the local Hermes checkout"
  wait_for 180 'the notebook to answer with the local Hermes checkout' notebook_is_up ||
    fail "the notebook did not answer with the local Hermes checkout"
}

restart_notebook() {
  local unit=${UNIT:-godspeed-integrated-notebook.service}
  if systemctl --user cat "$unit" >/dev/null 2>&1; then systemctl --user restart "$unit"
  elif systemctl cat "$unit" >/dev/null 2>&1; then sudo systemctl restart "$unit"
  else return 1
  fi
}

record_releases() {
  node "$HERE/hermes-update-fixture.mjs" --dir "$EVIDENCE/releases" --metadata >"$EVIDENCE/releases.json"
}

night_ready() { # <day>
  "$NODE" - "$STATE/hermes-update.json" "$1" >/dev/null 2>&1 <<'NODE'
const fs=require('fs');try{const s=JSON.parse(fs.readFileSync(process.argv[2]));process.exit(s.last?.day===process.argv[3]?0:1)}catch{process.exit(1)}
NODE
}

clock_at_update() { # <day>
  local moment=$1T04:15:30Z unit=${UNIT:-godspeed-integrated-notebook.service}
  if systemctl --user cat "$unit" >/dev/null 2>&1; then clock_of_this_account "$moment"
  elif systemctl cat "$unit" >/dev/null 2>&1; then clock_of_the_machine "$moment"
  else return 1
  fi
}

run_night() { # <day> <revealed version> <label>
  local day=$1 revealed=$2 label=$3
  clock_at_update "$day" || fail "the notebook clock could not move to the 04:15 update on $day"
  wait_for 180 "the notebook's 04:15 Hermes update decision on $day" night_ready "$day" ||
    fail "the notebook made no 04:15 Hermes update decision on $day"
  wait_for 180 "the notebook to answer after the Hermes update decision on $day" notebook_is_up ||
    fail "the notebook did not answer after its Hermes update decision on $day"
  chat_panel_new_conversation "$EVIDENCE/$label-chat-start.json"
  chat_panel_says 'Reply with the single words Scenario answer.' "$EVIDENCE/$label-chat.txt"
  grep -qx 'Scenario answer' "$EVIDENCE/$label-chat.txt" ||
    fail "the notebook chat did not answer through the local Hermes after $label: $(tr '\n' ' ' <"$EVIDENCE/$label-chat.txt" | cut -c1-200)"
  curl -fsS --max-time 60 -X POST -H 'Content-Type: application/json' --data '{"table":"notifications"}' \
    "http://127.0.0.1:$NOTEBOOK_PORT/api/query" >"$EVIDENCE/$label-notifications.json" ||
    fail "the notebook could not read its Hermes update notifications after $label"
  "$NODE" - "$STATE/hermes-update.json" "$EVIDENCE/releases" "$EVIDENCE/$label-notifications.json" "$EVIDENCE/fixture.log" "$revealed" "$label" >"$EVIDENCE/$label.json" <<'NODE'
const fs=require('fs'),{execFileSync}=require('child_process');const [stateFile,source,noticesFile,logFile,revealed,label]=process.argv.slice(2);
const read=file=>JSON.parse(fs.readFileSync(file,'utf8')),rows=data=>Array.isArray(data)?data:(data.data||[]);
const state=read(stateFile),notices=rows(read(noticesFile)),hermes=source+'/bin/hermes';
const version=execFileSync(hermes,['--version'],{encoding:'utf8'}).trim(),commit=execFileSync('git',['-C',source,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
const log=fs.readFileSync(logFile,'utf8').trim().split(/\r?\n/).filter(Boolean);
const hermesNotices=notices.filter(n=>String(n.id||'').startsWith('hermes-update-'));
console.log(JSON.stringify({label,attempt:revealed,attempted:log.includes('update '+revealed),version,commit,restarts:log.filter(line=>line==='gateway restart 1.2.0'||line==='gateway restart 1.1.0').length,failed_check:state.last?.reason||null,chat:true,failure_bell:hermesNotices.length>0,notification_count:hermesNotices.length,notifications:hermesNotices.map(n=>({version:String(n.id||'').replace(/^hermes-update-/,''),pending:n.status==='pending'}))}));
NODE
}

make_nights() {
  "$NODE" - "$EVIDENCE" <<'NODE'
const fs=require('fs'),dir=process.argv[2],read=name=>JSON.parse(fs.readFileSync(`${dir}/${name}.json`));
const good=read('good'),broken=read('broken'),recent=read('recent');
fs.writeFileSync(`${dir}/nights.json`,JSON.stringify([
 {attempt:good.attempt,version:good.version,commit:good.commit,chat:good.chat,failure_bell:good.failure_bell},
 {attempt:broken.attempt,failed_check:broken.failed_check,version:broken.version,commit:broken.commit,restarts:broken.restarts,chat:broken.chat},
 {version:recent.version,commit:recent.commit,attempted:recent.attempted,notification_count:recent.notification_count}
])+'\n');
fs.writeFileSync(`${dir}/notifications.json`,JSON.stringify(broken.notifications)+'\n');
NODE
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  scenario_arguments "$@"
  if [ "$CHECK_ONLY" = yes ]; then install_paths; check "$EVIDENCE"; else act; fi
fi
