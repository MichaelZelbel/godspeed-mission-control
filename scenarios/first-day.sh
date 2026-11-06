#!/usr/bin/env bash
# PROVING SCENARIO: a freshly installed Docker server turns one fictional first goal into useful
# private work, a saved morning brief, and a matching reply on its installed Telegram gateway.
SCENARIO=first-day
# shellcheck source=scenarios/scenario-lib.sh
. "$(dirname "$0")/scenario-lib.sh"
# shellcheck source=scenarios/server-lib.sh
. "$HERE/server-lib.sh"
scenario_arguments "$@"

GOAL='Prepare a practical household emergency-kit checklist by Sunday.'
RESEARCH='Nightly goal research'
CHOOSE="Daily round: choose today's work"
WORK='Daily round: do the work'
CURRENT_STEP='fresh Docker server installation'

fail() {
  if [ "${CHECK_ONLY:-no}" = no ] && [ -n "${EVIDENCE:-}" ]; then
    printf 'FAIL %s: %s: %s\n' "$SCENARIO" "$CURRENT_STEP" "$*" | tee -a "$EVIDENCE/steps.tsv" >&2
  fi
  verdict "FAIL $SCENARIO: $*"
  exit 1
}

rows_with() { # <file> <needle>
  "$NODE" -e 'const fs=require("fs"),d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")),rows=Array.isArray(d)?d:d.data||[];process.stdout.write(String(rows.filter(r=>JSON.stringify(r).includes(process.argv[2])).length))' "$1" "$2"
}
step_passed() { # <name>
  printf 'PASS %s: %s\n' "$SCENARIO" "$1" | tee -a "$EVIDENCE/steps.tsv" >&2
}
first_day_phase() { # <step name>
  CURRENT_STEP=$1
  phase "$1"
}

act() {
  fresh_evidence
  install_paths
  need_node
  first_day_phase 'fresh Docker server installed the frozen stage'
  server_install
  step_passed 'fresh Docker server installed the frozen stage'
  server_connects_the_model
  step_passed 'dedicated test AI connected through Settings'
  first_day_phase 'fictional bot connects through the installed Docker Telegram setup'
  server_telegram_setup
  step_passed 'fictional bot reached the installed Telegram gateway'
  first_day_phase 'fictional emergency-kit goal is filed through the installed notebook'
  server_sparse_state
  printf '{"goal":%s,"timezone":"Etc/UTC","delivery":"telegram"}\n' "$(quoted_json "$GOAL")" >"$EVIDENCE/.setup.json"
  [ "$(server_post /api/setup "$EVIDENCE/.setup.json" "$EVIDENCE/setup.json")" = 200 ] ||
    fail "the installed notebook would not file the emergency-kit goal: $(tr -d '\n' <"$EVIDENCE/setup.json" | cut -c1-200)"
  server_pause_all_jobs
  step_passed 'fictional emergency-kit goal filed through the notebook'
  first_day_phase 'installed research, choice, and work routines'
  server_run_job research "$RESEARCH" 1800
  server_run_job choice "$CHOOSE" 1800
  server_run_job work "$WORK" 1800
  step_passed 'installed research, choice, and work routines completed'
  first_day_phase 'installed morning brief and its Telegram delivery'
  server_scheduled_brief "$EVIDENCE/brief.txt" 1800
  server_table notes "$EVIDENCE/notes-before-reply.json"
  server_telegram_say todays-brief "today's brief"
  server_telegram_snapshot
  server_table work_items "$EVIDENCE/work-items.json"
  server_table notes "$EVIDENCE/notes-after-reply.json"
  server_copy_evidence /opt/data/full-candidate/workspace/work "$EVIDENCE"
  server_copy_evidence /opt/data/full-candidate/hermes/cron/output "$EVIDENCE"
  server_manifest
  step_passed 'morning brief was saved, delivered, and read back through Telegram'
  rm -f "$EVIDENCE"/.[a-z]*
}

check() { # <evidence folder>
  local folder=$1 reason table
  local -a sparse_files=()
  for table in "${SERVER_SPARSE_TABLES[@]}"; do sparse_files+=("sparse-${table//_/-}.json"); done
  [ -d "$folder" ] || fail "there is nothing at $folder, so this scenario kept no first-day evidence"
  need_node
  kept_all "$folder" 'the installed first day' setup.json job-research.json job-choice.json job-work.json job-scheduled-brief.json brief.txt brief-cron-runs.txt scheduled-telegram-requests.json run.json runner.json telegram-requests.json work-items.json notes-before-reply.json notes-after-reply.json "${sparse_files[@]}" manifest.json
  grep -Fqx "$GOAL" <(json_value "$folder/setup.json" results.goal.title 2>/dev/null || true) ||
    grep -Fq "$GOAL" "$folder/setup.json" || fail 'the notebook did not retain the fictional emergency-kit goal'
  for label in research choice work; do
    "$NODE" -e 'const fs=require("fs"),d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")),rows=Array.isArray(d)?d:d.data||[];process.exit(rows.some(j=>j?.last_run_at&&j?.last_status==="ok")?0:1)' "$folder/job-$label.json" ||
      fail "the installed $label routine has no successful recorded run"
  done
  "$NODE" -e 'const fs=require("fs"),d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")),rows=Array.isArray(d)?d:d.data||[],hasBaseline=Object.hasOwn(d,"before_last_run_at"),baseline=d.before_last_run_at,job=rows.find(j=>j?.id===d.id);process.exit(d.id&&hasBaseline&&(baseline===null||typeof baseline==="string")&&job?.last_run_at&&job.last_run_at!==baseline&&job?.last_status==="ok"?0:1)' "$folder/job-scheduled-brief.json" ||
    fail 'the installed scheduled morning brief has no successful recorded run'
  grep -Eqi 'source[[:space:]]*[:=][[:space:]]*"?builtin' "$folder/brief-cron-runs.txt" ||
    fail 'the morning brief was not triggered by the installed scheduler'
  if ! reason=$("$NODE" - "$folder" "$GOAL" "${sparse_files[@]}" 2>&1 <<'NODE'
const fs=require('fs'),path=require('path');
const [folder,goal,...sparseFiles]=process.argv.slice(2),read=file=>fs.readFileSync(path.join(folder,file),'utf8');
const rows=file=>{const d=JSON.parse(read(file));return Array.isArray(d)?d:d.data||[]};
const fail=message=>{console.error(message);process.exit(1)};
const walk=dir=>fs.existsSync(dir)?fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]):[];
const normalized=value=>String(value||'').replace(/\r\n?/g,'\n').trim();
if(!normalized(read('brief.txt')))fail('the installed morning brief saved no readable text');
for(const file of sparseFiles){
 const state=JSON.parse(read(file)),rows=Array.isArray(state)?state:state.data||[];
 if(!Array.isArray(rows)||rows.length)fail('the brief was not run with the required sparse installed state');
}
const cards=walk(path.join(folder,'work')).filter(file=>/\.md$/i.test(file)).map(file=>({file,text:fs.readFileSync(file,'utf8')}));
const card=cards.find(({text})=>/^STATUS:\s*verified\s*$/mi.test(text)&&/VERIFIED check passed/i.test(text)&&/^RESULT:\s*\S/m.test(text));
if(!card)fail('no Godspeed-owned work card is verified by its recorded check and result');
const title=(card.text.match(/^WHAT:\s*(.+)$/mi)||[])[1]?.trim()||'';
const result=(card.text.match(/^RESULT:\s*(.+)$/mi)||[])[1]?.trim()||'';
if(!title||!result)fail('the verified work card lacks its title or result');
const artifacts=walk(folder).filter(file=>/\.(?:md|txt)$/i.test(file)&&!file.includes(`${path.sep}work${path.sep}`)&&path.basename(file)!=='brief.txt').map(file=>fs.readFileSync(file,'utf8'));
const practical=artifacts.find(text=>/[-*]\s*(?:\[[ xX]\]|\d+[.)])/.test(text)&&/\b(?:\d+\s*(?:lit(?:re|er)s?|days?|hours?|batter(?:y|ies)|ml|kg)|at least \d+)\b/i.test(text)&&['water','food','first aid|medication','light|power','communication|document'].every(group=>new RegExp(group,'i').test(text))&&!/\b(?:TODO|TBD|placeholder|outline only)\b/i.test(text));
if(!practical)fail('the result artifact is not a practical emergency-kit checklist');
const brief=normalized(read('brief.txt'));
if(!brief.includes(goal))fail('the saved brief does not name the emergency-kit goal');
if(!brief.includes(title)&&!brief.includes(result))fail('the saved brief does not identify the verified work');
const nextLine=brief.split('\n').map(line=>line.trim()).find(line=>/^(?:next|today)(?:\s+(?:today|step|action))?\s*:/i.test(line));
const nextTask=nextLine?.replace(/^[^:]*:\s*/,'')||'';
const words=nextTask.toLowerCase().match(/[a-z]+/g)||[];
const verbs=new Set(['add','arrange','book','buy','call','check','collect','complete','create','gather','make','organize','pack','prepare','replace','review','schedule','set','store','test','update','write']);
const filler=new Set(['a','an','and','at','for','in','it','more','next','now','on','the','this','that','them','to','today','with','your']);
const verb=words.findIndex(word=>verbs.has(word));
if(!nextLine||verb<0||!words.slice(verb+1).some(word=>!filler.has(word)))fail('the saved brief has no concrete next action');
const manifest=JSON.parse(read('manifest.json'));
if(!Array.isArray(manifest.files)||!manifest.files.length)fail('the evidence manifest names no retained files');
NODE
); then
    fail "$reason"
  fi
  [ "$(json_value "$folder/runner.json" state 2>/dev/null)" = gateway ] || fail 'the installed Telegram runner never reached gateway state'
  "$NODE" -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.exit((d.requests||[]).some(r=>r?.method==="getUpdates"&&r.authorized!==false)?0:1)' "$folder/telegram-requests.json" ||
    fail 'the installed Telegram gateway never polled the fake Bot API'
  if ! reason=$("$NODE" - "$folder" 2>&1 <<'NODE'
const fs=require('fs'),path=require('path'),folder=process.argv[2],read=file=>fs.readFileSync(path.join(folder,file),'utf8');
const normal=value=>String(value||'').replace(/\r\n?/g,'\n').trim();
const fail=message=>{console.error(message);process.exit(1)};
const run=JSON.parse(read('run.json')),messages=label=>(run.outbox||[]).filter(m=>m.label===label&&m.accepted!==false).map(m=>m.text).join('');
const saved=normal(read('brief.txt'));
const scheduled=JSON.parse(read('scheduled-telegram-requests.json')).sent||[];
if(!scheduled.some(message=>normal(message.text)===saved))fail('the installed scheduled morning brief was never delivered through Telegram');
if(!messages('todays-brief'))fail("the owner received no answer to today's brief through the installed gateway");
if(normal(messages('todays-brief'))!==saved)fail("today's brief differs from the saved note");
const rows=file=>{const data=JSON.parse(read(file));return Array.isArray(data)?data:data.data||[]};
const count=items=>items.filter(note=>normal(note.content||note.body||'')===saved).length;
if(count(rows('notes-after-reply.json'))!==count(rows('notes-before-reply.json')))fail("today's brief created a second saved brief");
NODE
); then
    fail "$reason"
  fi
  pass "a fresh Docker install connected its fictional Telegram bot, ran research, choice and work, saved a morning brief, and answered today's brief through the gateway"
}

if [ "$CHECK_ONLY" = yes ]; then
  install_paths
  need_node
  check "$EVIDENCE"
else
  act
  check "$EVIDENCE"
fi
