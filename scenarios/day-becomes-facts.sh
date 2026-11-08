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
  kept_all "$folder" 'the seeded archive, provider connection, routine and before/after snapshots' archive.json provider.json provider-answer.json before.json after.json second.json routine.json
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
 const provider=r('provider.json'),providerAnswer=r('provider-answer.json');
 const messages=Object.fromEntries((archive.messages||[]).map(message=>[message.id,message]));
 const move=messages['move-1'],doctorMessage=messages['doctor-1'],archiveDay=move?.at?.slice(0,10);
 if(typeof move?.text!=='string'||typeof doctorMessage?.text!=='string'||!/^\d{4}-\d\d-\d\d$/.test(archiveDay)||doctorMessage.at?.slice(0,10)!==archiveDay||!messages['machine-1']?.text?.startsWith('[IMPORTANT: You are running as a scheduled job]')||!messages['track-1']?.text?.startsWith('track'))fail('the exact invented archive is not retained');
 if(typeof provider?.url!=='string'||!provider.url.startsWith('https://')||typeof provider?.model!=='string'||!provider.model||provider?.routines!==true||Object.hasOwn(provider,'key')||providerAnswer?.connected!==true||providerAnswer?.routines?.model!==provider.model||providerAnswer?.routines?.check?.ok!==true)fail('the retained provider evidence is incomplete or includes its key');
 const before=r('before.json'); if(!has(before.claims||[],'Berlin'))fail('the older Berlin fact was not present before the routine ran');
 const routine=r('routine.json');if(routine.name!=='Remember what you said'||routine.cron!=='40 3 * * *'||routine.exit!==0||typeof routine.script!=='string'||!routine.script)fail('the remembered-facts routine was not the successful 03:40 recorded routine');
 const a=r('after.json'),s=r('second.json');
 for(const family of families)if(!Array.isArray(a[family])||!Array.isArray(s[family]))fail(`${family} was not retained after both runs`);
 if(JSON.stringify(stable(a))!==JSON.stringify(stable(s)))fail('the second run changed a routine-writable record');
 const hamburg=has(a.claims,'Hamburg'), berlin=has(a.claims,'Berlin'),doctor=has(a.claims,'Dr. Lang');
 if(!hamburg||hamburg.valid_from!==archiveDay||!quote(hamburg,move.text,move.id))fail('Hamburg is not a dated fact with the exact move quote and source');
 if(!berlin||berlin.valid_to!==archiveDay)fail('Berlin was deleted or left current instead of closed');
 if(!doctor||doctor.valid_from!==archiveDay||!quote(doctor,doctorMessage.text,doctorMessage.id))fail('Dr. Lang is not a dated fact with the exact doctor quote and source');
 for(const family of families)for(const row of a[family])if(['machine-1','track-1'].includes(row?.source_id)||['[IMPORTANT: You are running as a scheduled job]','track this'].includes(row?.quote))fail(`an excluded message was filed in ${family}`);
} catch(error) { process.stdout.write(error.message); process.exit(1); }
NODE
  ) || fail "$why"
  pass "the dated move to Hamburg and Dr. Lang were filed with their archive sources, Berlin was closed, excluded archive messages filed nothing, and a second run changed no records"
}

act() {
  fresh_evidence; install_paths; install_the_stage_line "$EVIDENCE/install.log"; need_node
  wait_for 180 'the notebook to answer after install' notebook_is_up || fail "the notebook did not answer after install"
  mkdir -p "$ROOT/prompts/archive"
  local archive_day archive_at move_text doctor_text machine_text track_text
  archive_day=$(day_in -1); archive_at="${archive_day}T12:00:00Z"
  move_text="I moved to Hamburg on $archive_day"; doctor_text="my new doctor is Dr. Lang as of $archive_day"
  machine_text='[IMPORTANT: You are running as a scheduled job]'; track_text='track this'
  printf '{"id":"move-1","at":"%s","text":"%s"}\n' "$archive_at" "$move_text" >"$ROOT/prompts/archive/scenario-facts.jsonl"
  printf '{"id":"doctor-1","at":"%s","text":"%s"}\n' "$archive_at" "$doctor_text" >>"$ROOT/prompts/archive/scenario-facts.jsonl"
  printf '{"id":"machine-1","at":"%s","text":"%s"}\n' "$archive_at" "$machine_text" >>"$ROOT/prompts/archive/scenario-facts.jsonl"
  printf '{"id":"track-1","at":"%s","text":"%s"}\n' "$archive_at" "$track_text" >>"$ROOT/prompts/archive/scenario-facts.jsonl"
  curl -fsS --max-time 60 -X POST -H 'Content-Type: application/json' \
    --data '{"type":"memory-confirm","label":"Home city","value":"Berlin","evidence_quote":"I live in Berlin","subject_type":"self","source_id":"before-berlin"}' \
    "http://127.0.0.1:$NOTEBOOK_PORT/api/functions/personal-operation" >"$EVIDENCE/memory-confirm.json" ||
    fail "the installed notebook did not accept the older Berlin fact through memory-confirm"
  facts_snapshot "$EVIDENCE/before.json"
  printf '{"messages":[{"id":"move-1","at":"%s","text":"%s"},{"id":"doctor-1","at":"%s","text":"%s"},{"id":"machine-1","at":"%s","text":"%s"},{"id":"track-1","at":"%s","text":"%s"}]}\n' "$archive_at" "$move_text" "$archive_at" "$doctor_text" "$archive_at" "$machine_text" "$archive_at" "$track_text" >"$EVIDENCE/archive.json"
  local provider provider_request provider_request_exit_trap provider_request_int_trap provider_request_term_trap script
  curl -fsS --max-time 60 -X POST -H 'Content-Type: application/json' \
    --data '{"goal":"Keep my remembered facts current","timezone":"Etc/UTC"}' \
    "http://127.0.0.1:$NOTEBOOK_PORT/api/setup" >"$EVIDENCE/setup.json" ||
    fail "the installed notebook could not accept the first goal that starts routines"
  # The routine is intentionally looked up before an AI credential is requested.
  assistant_home
  if ! facts_routine_is_there; then
    fail "the installed assistant has no routine named Remember what you said (ticket 03 is the expected baseline failure)"
  fi
  need_the_ai_key "extracting the invented archived facts"
  printf '{"url":%s,"model":%s,"routines":true}\n' \
    "$(quoted_json "$AI_URL")" "$(quoted_json "$AI_MODEL")" >"$EVIDENCE/provider.json"
  provider_request=$(mktemp) || fail 'the private Settings request could not be made'
  provider_request_exit_trap=$(trap -p EXIT || true)
  provider_request_int_trap=$(trap -p INT || true)
  provider_request_term_trap=$(trap -p TERM || true)
  cleanup_provider_request() { rm -f "$provider_request"; }
  run_saved_trap() {
    local saved_trap=$1 status=$2
    [ -z "$saved_trap" ] && return
    eval "set -- $saved_trap"
    (exit "$status")
    eval "$3"
  }
  restore_provider_request_traps() {
    trap - EXIT INT TERM
    [ -z "$provider_request_exit_trap" ] || eval "$provider_request_exit_trap"
    [ -z "$provider_request_int_trap" ] || eval "$provider_request_int_trap"
    [ -z "$provider_request_term_trap" ] || eval "$provider_request_term_trap"
  }
  finish_provider_request() {
    local status=$?
    cleanup_provider_request || say 'the private Settings request could not be removed during EXIT cleanup'
    trap - EXIT
    run_saved_trap "$provider_request_exit_trap" "$status"
    return "$status"
  }
  cancel_provider_request() {
    local signal=$1 status=$2
    cleanup_provider_request
    restore_provider_request_traps
    kill -s "$signal" "$$"
    exit "$status"
  }
  trap finish_provider_request EXIT
  trap 'cancel_provider_request INT 130' INT
  trap 'cancel_provider_request TERM 143' TERM
  printf '{"url":%s,"key":%s,"model":%s,"routines":true}\n' \
    "$(quoted_json "$AI_URL")" "$(quoted_json "$GODSPEED_SCENARIO_AI_KEY")" "$(quoted_json "$AI_MODEL")" >"$provider_request"
  if ! provider=$(curl -sS -o "$EVIDENCE/provider-answer.json" -w '%{http_code}' --max-time 300 -X POST -H 'Content-Type: application/json' \
    --data-binary @"$provider_request" "http://127.0.0.1:$NOTEBOOK_PORT/api/provider"); then
    fail "Settings could not be reached to connect the remembered-facts model"
  fi
  cleanup_provider_request || fail 'the private Settings request could not be removed'
  restore_provider_request_traps
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

if [ "${GODSPEED_SCENARIO_SOURCE_ONLY:-no}" != yes ]; then
  if [ "$CHECK_ONLY" = yes ]; then install_paths; check "$EVIDENCE"; else act; fi
fi
