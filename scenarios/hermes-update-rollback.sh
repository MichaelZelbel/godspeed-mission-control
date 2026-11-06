#!/usr/bin/env bash
# PROVING SCENARIO: the notebook's 04:15 update path keeps a good Hermes and rolls back a bad one.
# Kept: releases.json, nights.json, notifications.json and fixture.log.
SCENARIO=hermes-update-rollback
. "$(dirname "$0")/scenario-lib.sh"
scenario_arguments "$@"

check() {
  local folder=$1
  [ -d "$folder" ] || fail "there is nothing at $folder, so this scenario kept no Hermes update evidence"
  need_node
  kept_all "$folder" 'the local releases and three nightly decisions' releases.json nights.json notifications.json fixture.log
  "$NODE" - "$folder" <<'NODE' || fail "the kept update evidence does not keep 1.1.0, roll 1.2.0 back after cron list, and leave the three-day release alone"
const fs=require('fs'),p=process.argv[2],r=n=>JSON.parse(fs.readFileSync(`${p}/${n}`));const n=r('nights.json');
if(n.length!==3||n[0].version!=='1.1.0'||n[0].chat!==true||n[1].attempt!=='1.2.0'||n[1].failed_check!=='cron list'||n[1].version!=='1.1.0'||n[1].restarts<2||n[1].chat!==true||n[2].version!=='1.1.0'||n[2].attempted===true)throw Error();
const bells=r('notifications.json');if(bells.length!==1||bells[0].version!=='1.2.0')throw Error();
NODE
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
