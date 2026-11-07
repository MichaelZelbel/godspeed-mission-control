#!/usr/bin/env bash
# PROVING SCENARIO: the installed nightly routine files dated, source-linked facts once.
# Kept: archive.json, before.json, after.json, second.json and routine.json. archive.json names
# the four invented messages; all five record families are retained after each run.
SCENARIO=day-becomes-facts
. "$(dirname "$0")/scenario-lib.sh"
. "$(dirname "$0")/facts-lib.sh"
scenario_arguments "$@"

facts_routine_is_there() { grep -qF 'Remember what you said' "$HERMES/cron/jobs.json" 2>/dev/null; }
facts_routine_script() {
  installed_routine_script "$HERMES/cron/jobs.json" "$STATE/notebook-routines.json" - 'Remember what you said' -
}
run_facts_routine() { # <script> <label>
  local script=$1 label=$2 python code
  python=$(json_value "$HERMES/scripts/godspeed-routines.json" hermes_python) ||
    fail "the remembered-facts routine has no recorded assistant Python"
  [ -n "$python" ] && [ "$python" != null ] || fail "the remembered-facts routine recorded an empty assistant Python"
  (cd "$HERMES/scripts" && "$python" "$HERMES/scripts/$script") >"$EVIDENCE/$label-said.txt" 2>"$EVIDENCE/$label-log.txt"
  code=$?
  printf '%s\n' "$code" >"$EVIDENCE/$label-exit.txt"
  [ "$code" = 0 ] || fail "the remembered-facts routine ended $code (its log is $EVIDENCE/$label-log.txt)"
}
facts_snapshot() { # <destination>
  local destination=$1 table
  for table in "${FACT_FAMILIES[@]}"; do
    curl -fsS --max-time 60 -X POST -H 'Content-Type: application/json' --data "{\"table\":\"$table\"}" \
      "http://127.0.0.1:$NOTEBOOK_PORT/api/query" >"$EVIDENCE/.$(basename "$destination")-$table.json" ||
      fail "the notebook could not read $table after the remembered-facts routine"
  done
  FACT_FAMILIES=$(IFS=,; echo "${FACT_FAMILIES[*]}") "$NODE" - "$EVIDENCE" "$destination" <<'NODE'
const fs=require('fs'),dir=process.argv[2],out=process.argv[3],families=process.env.FACT_FAMILIES.split(',');
const rows=file=>{const d=JSON.parse(fs.readFileSync(file));return Array.isArray(d)?d:(d.data||[])};
const name=require('path').basename(out);
fs.writeFileSync(out,JSON.stringify(Object.fromEntries(families.map(f=>[f,rows(`${dir}/.${name}-${f}.json`)])))+'\n');
NODE
}

check() {
  local folder=$1
  [ -d "$folder" ] || fail "there is nothing at $folder, so this scenario kept no remembered-facts evidence"
  need_node
  kept_all "$folder" 'the seeded archive, routine and before/after snapshots' archive.json before.json after.json second.json routine.json
  local why
  why=$(FACT_FAMILIES=$(IFS=,; echo "${FACT_FAMILIES[*]}") "$NODE" - "$folder" <<'NODE'
const fs=require('fs'), p=process.argv[2], r=n=>JSON.parse(fs.readFileSync(`${p}/${n}`));
const families=process.env.FACT_FAMILIES.split(',');
const stable=value=>Array.isArray(value)?value.map(stable).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])):value;
const has=(rows,value)=>rows.find(row=>row&&row.value===value);
const quote=(row,text,id)=>row&&row.quote===text&&row.source_id===id;
const fail=message=>{throw new Error(message)};
try {
 const archive=r('archive.json');
 const messages=Object.fromEntries((archive.messages||[]).map(message=>[message.id,message]));
 if(messages['move-1']?.text!=='I moved to Hamburg on 1 November'||messages['doctor-1']?.text!=='my new doctor is Dr. Lang'||!messages['machine-1']?.text?.startsWith('[IMPORTANT: You are running as a scheduled job]')||!messages['track-1']?.text?.startsWith('track'))fail('the exact invented archive is not retained');
 const before=r('before.json'); if(!has(before.claims||[],'Berlin'))fail('the older Berlin fact was not present before the routine ran');
 const routine=r('routine.json');if(routine.name!=='Remember what you said'||routine.cron!=='40 3 * * *'||routine.exit!==0||typeof routine.script!=='string'||!routine.script)fail('the remembered-facts routine was not the successful 03:40 recorded routine');
 const a=r('after.json'),s=r('second.json');
 for(const family of families)if(!Array.isArray(a[family])||!Array.isArray(s[family]))fail(`${family} was not retained after both runs`);
 if(JSON.stringify(stable(a))!==JSON.stringify(stable(s)))fail('the second run changed a routine-writable record');
 const hamburg=has(a.claims,'Hamburg'), berlin=has(a.claims,'Berlin'),doctor=has(a.claims,'Dr. Lang');
 if(!hamburg||hamburg.valid_from!=='2026-11-01'||!quote(hamburg,'I moved to Hamburg on 1 November','move-1'))fail('Hamburg is not a dated fact with the exact move quote and source');
 if(!berlin||berlin.valid_to!=='2026-11-01')fail('Berlin was deleted or left current instead of closed');
 if(!doctor||doctor.valid_from!=='2026-11-01'||!quote(doctor,'my new doctor is Dr. Lang','doctor-1'))fail('Dr. Lang is not a dated fact with the exact doctor quote and source');
 for(const family of families)for(const row of a[family])if(['machine-1','track-1'].includes(row?.source_id)||['[IMPORTANT: You are running as a scheduled job]','track this'].includes(row?.quote))fail(`an excluded message was filed in ${family}`);
} catch(error) { process.stdout.write(error.message); process.exit(1); }
NODE
  ) || fail "$why"
  pass "the 1 November move to Hamburg and Dr. Lang were filed with their archive sources, Berlin was closed, excluded archive messages filed nothing, and a second run changed no records"
}

act() {
  fresh_evidence; install_paths; install_the_stage_line "$EVIDENCE/install.log"; need_node
  wait_for 180 'the notebook to answer after install' notebook_is_up || fail "the notebook did not answer after install"
  mkdir -p "$ROOT/prompts/archive"
  printf '%s\n' '{"id":"move-1","at":"2026-11-01","text":"I moved to Hamburg on 1 November"}' '{"id":"doctor-1","at":"2026-11-01","text":"my new doctor is Dr. Lang"}' '{"id":"machine-1","at":"2026-11-01","text":"[IMPORTANT: You are running as a scheduled job]"}' '{"id":"track-1","at":"2026-11-01","text":"track this"}' >"$ROOT/prompts/archive/scenario-facts.jsonl"
  curl -fsS --max-time 60 -X POST -H 'Content-Type: application/json' \
    --data '{"type":"memory-confirm","label":"Home city","value":"Berlin","evidence_quote":"I live in Berlin","subject_type":"self","source_id":"before-berlin"}' \
    "http://127.0.0.1:$NOTEBOOK_PORT/api/functions/personal-operation" >"$EVIDENCE/memory-confirm.json" ||
    fail "the installed notebook did not accept the older Berlin fact through memory-confirm"
  facts_snapshot "$EVIDENCE/before.json"
  printf '%s\n' '{"messages":[{"id":"move-1","at":"2026-11-01","text":"I moved to Hamburg on 1 November"},{"id":"doctor-1","at":"2026-11-01","text":"my new doctor is Dr. Lang"},{"id":"machine-1","at":"2026-11-01","text":"[IMPORTANT: You are running as a scheduled job]"},{"id":"track-1","at":"2026-11-01","text":"track this"}]}' >"$EVIDENCE/archive.json"
  # The routine is intentionally looked up before an AI credential is requested.
  assistant_home
  if ! facts_routine_is_there; then
    fail "the installed assistant has no routine named Remember what you said (ticket 03 is the expected baseline failure)"
  fi
  need_the_ai_key "extracting the invented archived facts"
  local provider script
  printf '{"url":%s,"key":%s,"model":%s,"routines":true}\n' \
    "$(quoted_json "$AI_URL")" "$(quoted_json "$GODSPEED_SCENARIO_AI_KEY")" "$(quoted_json "$AI_MODEL")" >"$EVIDENCE/provider.json"
  provider=$(curl -sS -o "$EVIDENCE/provider-answer.json" -w '%{http_code}' --max-time 300 -X POST -H 'Content-Type: application/json' \
    --data-binary @"$EVIDENCE/provider.json" "http://127.0.0.1:$NOTEBOOK_PORT/api/provider") ||
    fail "Settings could not be reached to connect the remembered-facts model"
  [ "$provider" = 200 ] || fail "Settings refused the remembered-facts model (HTTP $provider)"
  script=$(facts_routine_script)
  [ -n "$script" ] && [ -f "$HERMES/scripts/$script" ] || fail "the recorded Remember what you said routine has no installed script"
  run_facts_routine "$script" first
  facts_snapshot "$EVIDENCE/after.json"
  run_facts_routine "$script" second
  facts_snapshot "$EVIDENCE/second.json"
  "$NODE" - "$HERMES/cron/jobs.json" "$script" >"$EVIDENCE/routine.json" <<'NODE'
const fs=require('fs'),file=process.argv[2],script=process.argv[3],data=JSON.parse(fs.readFileSync(file));
const rows=Array.isArray(data)?data:(data.jobs||[]);const job=rows.find(row=>row&&row.script===script)||{};
console.log(JSON.stringify({name:job.name,cron:job.cron||job.schedule?.expr||job.schedule,script,exit:0}));
NODE
  check "$EVIDENCE"
}

if [ "$CHECK_ONLY" = yes ]; then install_paths; check "$EVIDENCE"; else act; fi
