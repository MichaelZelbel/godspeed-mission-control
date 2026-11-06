#!/usr/bin/env bash
# PROVING SCENARIO: the notebook's 04:15 update path keeps a good Hermes and rolls back a bad one.
# Kept: releases.json, nights.json, notifications.json and fixture.log. The three night records
# include commits, restart evidence and the updater's decision rather than trusting its prose.
SCENARIO=hermes-update-rollback
. "$(dirname "$0")/scenario-lib.sh"
scenario_arguments "$@"

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
 if(broken.attempt!=='1.2.0'||broken.failed_check!=='cron list'||broken.version!=='1.1.0'||broken.commit!==good.commit||broken.restarts<2||broken.chat!==true)fail('the broken 1.2.0 release was not restored to the exact earlier commit after cron list');
 if(recent.attempted!==false||recent.version!=='1.1.0'||recent.commit!==good.commit||recent.notification_count!==1)fail('the three-day 1.3.0 release was taken or changed the notification count');
 const bells=r('notifications.json');if(!Array.isArray(bells)||bells.length!==1||bells[0].version!=='1.2.0'||bells[0].pending!==true)fail('there is not exactly one pending bell for the broken 1.2.0 release');
} catch(error) { process.stdout.write(error.message); process.exit(1); }
NODE
  ) || fail "$why"
  pass "the nightly notebook path kept 1.1.0, restored it after 1.2.0 failed cron list with the gateway restarted, rang one bell for 1.2.0, and left the three-day-old 1.3.0 alone"
}

act() {
  fresh_evidence; node "$HERE/hermes-update-fixture.mjs" --dir "$EVIDENCE/releases" >"$EVIDENCE/fixture.log" || fail "the local Hermes release fixture could not be made"
  install_paths; install_the_stage_line "$EVIDENCE/install.log"; need_node
  wait_for 180 'the notebook to answer after install' notebook_is_up || fail "the notebook did not answer after install"
  if ! grep -Rqs '04:15\|04 15\|15 4' "$ROOT/notebook"; then
    fail "the installed notebook has no 04:15 Hermes updater (ticket 04 is the expected baseline failure)"
  fi
  fail "the 04:15 Hermes updater exists but this pre-behavior actor has no recorded decision"
}

if [ "$CHECK_ONLY" = yes ]; then install_paths; check "$EVIDENCE"; else act; fi
