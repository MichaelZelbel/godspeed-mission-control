#!/usr/bin/env bash
# PROVING SCENARIO: the installed nightly routine files dated, source-linked facts once.
# Kept: archive.json, before.json, after.json, second.json and routine.json.
SCENARIO=day-becomes-facts
. "$(dirname "$0")/scenario-lib.sh"
scenario_arguments "$@"

check() {
  local folder=$1
  [ -d "$folder" ] || fail "there is nothing at $folder, so this scenario kept no remembered-facts evidence"
  need_node
  kept_all "$folder" 'the seeded archive, routine and before/after snapshots' archive.json before.json after.json second.json routine.json
  "$NODE" - "$folder" <<'NODE' || fail "the kept facts do not show Hamburg and Dr. Lang with their sources, Berlin closed, excluded messages absent, and an unchanged second run"
const fs=require('fs'), p=process.argv[2], r=n=>JSON.parse(fs.readFileSync(`${p}/${n}`));
const routine=r('routine.json');if(routine.name!=='Remember what you said'||routine.cron!=='40 3 * * *'||routine.exit!==0)throw Error();
const a=r('after.json'),s=r('second.json');if(JSON.stringify(a)!==JSON.stringify(s))throw Error();
const claims=a.claims||[];const hamburg=claims.find(x=>x.value==='Hamburg'), berlin=claims.find(x=>x.value==='Berlin'),doctor=claims.find(x=>x.value==='Dr. Lang');
if(!hamburg||hamburg.valid_from!=='2026-11-01'||hamburg.source_id!=='move-1'||!berlin||berlin.valid_to!=='2026-11-01'||!doctor||doctor.source_id!=='doctor-1')throw Error();
for(const family of ['claims','fact_slots','contacts','entities','moments'])for(const x of a[family]||[])if(['machine-1','track-1'].includes(x.source_id))throw Error();
NODE
  pass "the 1 November move to Hamburg and Dr. Lang were filed with their archive sources, Berlin was closed, excluded archive messages filed nothing, and a second run changed no records"
}

act() {
  fresh_evidence; install_paths; install_the_stage_line "$EVIDENCE/install.log"; need_node
  wait_for 180 'the notebook to answer after install' notebook_is_up || fail "the notebook did not answer after install"
  mkdir -p "$ROOT/prompts/archive"
  printf '%s\n' '{"id":"move-1","at":"2026-11-01","text":"I moved to Hamburg on 1 November"}' '{"id":"doctor-1","at":"2026-11-01","text":"my new doctor is Dr. Lang"}' '{"id":"machine-1","at":"2026-11-01","text":"[IMPORTANT: You are running as a scheduled job]"}' '{"id":"track-1","at":"2026-11-01","text":"track this"}' >"$ROOT/prompts/archive/scenario-facts.jsonl"
  # The routine is intentionally looked up before an AI credential is requested.
  assistant_home
  if [ ! -f "$HERMES/cron/jobs.json" ] || ! grep -qF 'Remember what you said' "$HERMES/cron/jobs.json"; then
    fail "the installed assistant has no routine named Remember what you said (ticket 03 is the expected baseline failure)"
  fi
  fail "the Remember what you said routine exists but this pre-behavior actor has no recorder adapter yet"
}

if [ "$CHECK_ONLY" = yes ]; then install_paths; check "$EVIDENCE"; else act; fi
