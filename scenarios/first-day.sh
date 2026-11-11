#!/usr/bin/env bash
# PROVING SCENARIO: a freshly installed Docker server turns one fictional first goal into useful
# private work, a saved morning brief, and a matching reply on its installed Telegram gateway. Each
# direct routine run retains its lifecycle admission record and Hermes run log in the evidence folder.
SCENARIO=first-day
# shellcheck source=scenarios/scenario-lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/scenario-lib.sh"
# shellcheck source=scenarios/server-lib.sh
. "$HERE/server-lib.sh"
scenario_arguments "$@"

GOAL='Prepare a practical household emergency-kit checklist by Sunday.'
RESEARCH='Nightly goal research'
CHOOSE="Daily round: choose today's work"
WORK='Daily round: do the work'
WORK_ID='W-000-first-day-emergency-kit'
WORK_KEY='first-day-emergency-kit'
RESULT_FILE='work/emergency-kit-checklist.md'
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
file_first_day_work() {
  in_server_as_hermes env GODSPEED_ROOT=/opt/data/full-candidate/workspace /usr/local/bin/node /opt/godspeed/kit/tools/work.js file \
    --id "$WORK_ID" --key "$WORK_KEY" --what "Write a practical household emergency-kit checklist at $RESULT_FILE" \
    --done-when "A practical household emergency-kit checklist is written at $RESULT_FILE and ready for a reader" \
    --check "test -s $RESULT_FILE" --source first-day-scenario >"$EVIDENCE/first-day-work-filed.txt" 2>&1 ||
    fail "the scenario could not file its emergency-kit work: $(tr -d '\n' <"$EVIDENCE/first-day-work-filed.txt" | cut -c1-200)"
  grep -Fqx "$WORK_ID: planned" "$EVIDENCE/first-day-work-filed.txt" ||
    fail 'the scenario-filed emergency-kit work was not planned'
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
  server_remember_gateway
  printf '{"goal":%s,"timezone":"Etc/UTC","delivery":"telegram"}\n' "$(quoted_json "$GOAL")" >"$EVIDENCE/.setup.json"
  [ "$(server_post /api/setup "$EVIDENCE/.setup.json" "$EVIDENCE/setup.json")" = 200 ] ||
    fail "the installed notebook would not file the emergency-kit goal: $(tr -d '\n' <"$EVIDENCE/setup.json" | cut -c1-200)"
  server_pause_all_jobs
  server_settle_gateway
  # The Hermes runtime's /api/setup answers with the routines it made, not the goal it filed, so the
  # notebook's goals are read back for the proof that it kept the goal.
  server_table goals "$EVIDENCE/goals-after-setup.json"
  step_passed 'fictional emergency-kit goal filed through the notebook'
  first_day_phase 'installed research routine'
  server_run_job research "$RESEARCH" 1800
  server_telegram_mark research cron
  first_day_phase 'installed choice routine'
  server_run_job choice "$CHOOSE" 1800
  server_telegram_mark choice cron
  first_day_phase 'scenario files the emergency-kit work for the installed daily round'
  file_first_day_work
  first_day_phase 'installed work routine'
  server_run_job work "$WORK" 1800
  server_telegram_mark work cron
  step_passed 'installed research, choice, and work routines completed'
  first_day_phase 'installed morning brief and its Telegram delivery'
  server_scheduled_brief "$EVIDENCE/brief.txt" 1800
  server_telegram_mark scheduled-brief cron
  server_table notes "$EVIDENCE/notes-before-reply.json"
  server_telegram_say todays-brief "today's brief"
  server_telegram_snapshot
  server_table work_items "$EVIDENCE/work-items.json"
  server_table notes "$EVIDENCE/notes-after-reply.json"
  server_copy_evidence /opt/data/full-candidate/workspace/work "$EVIDENCE"
  server_copy_evidence_if_there /opt/data/full-candidate/workspace/goals "$EVIDENCE"
  server_copy_evidence_if_there /opt/data/full-candidate/workspace/ideas "$EVIDENCE"
  server_manifest
  step_passed 'morning brief was saved, delivered, and read back through Telegram'
  rm -f "$EVIDENCE"/.[a-z]*
}

check() { # <evidence folder>
  local folder=$1 reason table
  local -a sparse_files=()
  [ -d "$folder" ] || fail "there is nothing at $folder, so this scenario kept no first-day evidence"
  need_node
  kept_all "$folder" 'the installed first day' setup.json job-research.json job-choice.json job-work.json first-day-work-filed.txt job-scheduled-brief.json brief.txt brief-cron-runs.txt scheduled-telegram-requests.json run.json runner.json telegram-requests.json work-items.json notes-before-reply.json notes-after-reply.json briefing-source-tables.txt manifest.json
  mapfile -t SERVER_SPARSE_TABLES <"$folder/briefing-source-tables.txt"
  [ "${#SERVER_SPARSE_TABLES[@]}" -gt 0 ] || fail 'the installed server named no morning-brief source records'
  for table in "${SERVER_SPARSE_TABLES[@]}"; do sparse_files+=("sparse-${table//_/-}.json"); done
  kept_all "$folder" 'the installed first day' "${sparse_files[@]}"
  { [ -f "$folder/goals-after-setup.json" ] &&
    "$NODE" -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")),rows=Array.isArray(d)?d:d.data||[];process.exit(rows.some(g=>String(g?.title||"").trim()===process.argv[2])?0:1)' "$folder/goals-after-setup.json" "$GOAL"; } ||
    grep -Fqx "$GOAL" <(json_value "$folder/setup.json" results.goal.title 2>/dev/null || true) ||
    grep -Fq "$GOAL" "$folder/setup.json" || fail 'the notebook did not retain the fictional emergency-kit goal'
  grep -Fqx "$WORK_ID: planned" "$folder/first-day-work-filed.txt" ||
    fail 'the scenario did not retain its emergency-kit work filing'
  for label in research choice work; do
    "$NODE" -e 'const fs=require("fs"),d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")),rows=Array.isArray(d)?d:d.data||[];process.exit(rows.some(j=>j?.last_run_at&&j?.last_status==="ok")?0:1)' "$folder/job-$label.json" ||
      fail "the installed $label routine has no successful recorded run"
  done
  "$NODE" -e 'const fs=require("fs"),d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")),rows=Array.isArray(d)?d:d.data||[],hasBaseline=Object.hasOwn(d,"before_last_run_at"),baseline=d.before_last_run_at,job=rows.find(j=>j?.id===d.id);process.exit(d.id&&hasBaseline&&(baseline===null||typeof baseline==="string")&&job?.last_run_at&&job.last_run_at!==baseline&&job?.last_status==="ok"?0:1)' "$folder/job-scheduled-brief.json" ||
    fail 'the installed scheduled morning brief has no successful recorded run'
  grep -Eqi 'source[[:space:]]*[:=][[:space:]]*"?builtin' "$folder/brief-cron-runs.txt" ||
    fail 'the morning brief was not triggered by the installed scheduler'
  if ! reason=$("$NODE" - "$folder" "$GOAL" "$WORK_ID" "$WORK_KEY" "$RESULT_FILE" "${sparse_files[@]}" 2>&1 <<'NODE'
const fs=require('fs'),path=require('path');
const [folder,goal,workId,workKey,resultFile,...sparseFiles]=process.argv.slice(2),read=file=>fs.readFileSync(path.join(folder,file),'utf8');
const rows=file=>{const d=JSON.parse(read(file));return Array.isArray(d)?d:d.data||[]};
const fail=message=>{console.error(message);process.exit(1)};
const normalized=value=>String(value||'').replace(/\r\n?/g,'\n').trim();
if(!normalized(read('brief.txt')))fail('the installed morning brief saved no readable text');
for(const file of sparseFiles){
 const state=JSON.parse(read(file)),rows=Array.isArray(state)?state:state.data||[];
 if(!Array.isArray(rows)||rows.length)fail('the brief was not run with the required sparse installed state');
}
// The finished work is the scenario's own card when the daily round took it, held to its checklist,
// or else work the product chose for this goal itself (since 9 November 2026: the choice files its
// own items and the round takes those first): a card under its own ID, verified by its recorded
// check, with a title, a result and the file its check names, kept here and not a placeholder.
const cards=fs.existsSync(path.join(folder,'work'))?fs.readdirSync(path.join(folder,'work')).filter(name=>/^W-[A-Za-z0-9._-]+\.md$/.test(name)):[];
const card=name=>{const text=fs.readFileSync(path.join(folder,'work',name),'utf8');const field=key=>(text.match(new RegExp(`^${key}:\\s*(.+)$`,'mi'))||[])[1]?.trim()||'';return {name,text,field};};
const verified=c=>c.field('ID')===c.name.replace(/\.md$/,'')&&c.field('STATUS')==='verified'&&/VERIFIED check passed/i.test(c.text);
const slug=value=>value.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const own=cards.includes(`${workId}.md`)?card(`${workId}.md`):null;
let named,told=[];
if(own&&verified(own)){
 const field=own.field,text=own.text;
 if(field('KEY')!==workKey||field('SOURCE')!=='first-day-scenario')fail('the selected emergency-kit work card does not retain the scenario filing');
 const title=field('WHAT'),result=field('RESULT');
 if(!title||!result)fail('the verified work card lacks its title or result');
 named=[[title,result]];
 const declared=(text.match(/^DONE WHEN:\s*A practical household emergency-kit checklist is written at (work\/(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)*[A-Za-z0-9][A-Za-z0-9._-]*\.md) and ready for a reader\s*$/mi)||[])[1];
 if(!declared||declared!==resultFile)fail('the selected emergency-kit work card does not name its result file');
 const artifact=path.join(folder,declared);
 if(!fs.existsSync(artifact)||!fs.statSync(artifact).isFile())fail('the result artifact is not a practical emergency-kit checklist');
 const practical=fs.readFileSync(artifact,'utf8');
 if(!/[-*]\s*(?:\[[ xX]\]|\d+[.)])/.test(practical)||!/\b(?:\d+\s*(?:lit(?:re|er)s?|days?|hours?|batter(?:y|ies)|ml|kg)|at least \d+)\b/i.test(practical)||!['water','food','first aid|medication','light|power','communication|document'].every(group=>new RegExp(group,'i').test(practical))||/\b(?:TODO|TBD|placeholder|outline only)\b/i.test(practical))fail('the result artifact is not a practical emergency-kit checklist');
}else{
 const goalSlug=slug(goal);
 const kept=c=>(`${c.field('CHECK')} ${c.field('DONE WHEN')}`.match(/\b((?:work|goals|ideas)\/[A-Za-z0-9._\/-]+\.md)\b/)||[])[1];
 const chosen=cards.filter(name=>name!==`${workId}.md`).map(card).filter(c=>verified(c)&&c.field('GOAL').length>=10&&goalSlug.startsWith(c.field('GOAL'))&&c.field('WHAT')&&c.field('RESULT')).filter(c=>{
  const relative=kept(c),file=relative&&path.join(folder,relative);
  return file&&fs.existsSync(file)&&fs.statSync(file).isFile()&&fs.readFileSync(file,'utf8').trim().split(/\s+/).length>=50&&!/\b(?:TODO|TBD|placeholder|outline only)\b/i.test(fs.readFileSync(file,'utf8'));
 });
 if(!chosen.length)fail('the selected emergency-kit work card is not verified by its recorded check, and no other work for the goal was verified with its result kept');
 // Any of them may be the work the brief tells: by its title or result, the file it wrote, or what
 // that file is (a goal's playbook, its ideas), since a brief written by the model uses its own words.
 named=chosen.map(c=>{const file=kept(c),kind=file.startsWith('goals/playbooks/')?'playbook':file.startsWith('ideas/')?'idea':null;return [c.field('WHAT'),c.field('RESULT'),file,...(kind?[kind]:[])];});
 told=chosen.map(c=>c.field('RESULT').replace(/\S*\/\S*/g,' '));
}
const brief=normalized(read('brief.txt'));
// A brief the model wrote names the goal in its own words (planner, 9 November 2026): the title, or
// at least two of its significant words ("kit" and "Sunday").
const stop=new Set(['a','an','and','at','by','for','from','in','into','it','its','of','on','or','the','to','with','your','my','our','this','that']);
const goalWords=[...new Set((goal.toLowerCase().match(/[a-z0-9]+/g)||[]).filter(word=>!stop.has(word)))];
const briefWords=new Set(brief.toLowerCase().match(/[a-z0-9]+/g)||[]);
if(!brief.includes(goal)&&goalWords.filter(word=>briefWords.has(word)).length<2)fail('the saved brief does not name the emergency-kit goal');
const nextLine=brief.split('\n').map(line=>line.trim()).find(line=>/^(?:next|today)(?:\s+(?:today|step|action))?\s*:/i.test(line));
const nextTask=nextLine?.replace(/^[^:]*:\s*/,'')||'';
const words=nextTask.toLowerCase().match(/[a-z]+/g)||[];
const verbs=new Set(['add','arrange','book','buy','call','check','collect','complete','create','gather','make','organize','pack','prepare','replace','review','schedule','set','store','test','update','write']);
const filler=new Set(['a','an','and','at','for','in','it','more','next','now','on','the','this','that','them','to','today','with','your']);
const verb=words.findIndex(word=>verbs.has(word));
// Or, in a brief the model wrote, a numbered or bulleted step that opens with something to do, under
// a heading or sentence about the next steps (planner, 9 November 2026).
const lines=brief.split('\n').map(line=>line.trim());
const stepVerbs=new Set([...verbs,'open','tick','fill','mark','read','send','tell','answer','choose','decide','pick','count','list','print','sign','save','order','ask','reply','measure','label','put','keep','start','finish','note']);
const listItem=/^(?:\d+[.)]|[-*\u2022])\s/;
const step=line=>{const m=line.match(/^(?:\d+[.)]|[-*\u2022])\s+(.+)$/);if(!m)return false;const w=m[1].toLowerCase().match(/[a-z]+/g)||[];return stepVerbs.has(w[0])&&w.slice(1).some(word=>!filler.has(word));};
// Or, for work the product chose, by at least three words of its recorded result that the goal does
// not already say (a checklist "written", with a "source link" on every "item"), told outside its
// list items and its lines about next steps: those that reuse such words ask for work, they do not
// report it.
const aboutNext=line=>/\b(?:next|steps?|what would help|need from you|to do|do today|today|first|action)\b/i.test(line);
const plain=new Set(['about','also','been','check','does','done','each','every','from','goal','goals','godspeed','have','here','into','least','more','most','only','some','than','that','their','them','then','there','they','this','what','when','where','which','will','with','work','would','your']);
const ownWords=text=>[...new Set((text.toLowerCase().match(/[a-z0-9]+/g)||[]).filter(word=>word.length>=4&&!plain.has(word)&&!goalWords.includes(word)))];
const reported=new Set(lines.filter(line=>!listItem.test(line)&&!aboutNext(line)).join(' ').toLowerCase().match(/[a-z0-9]+/g)||[]);
if(!named.some(names=>names.some(name=>brief.toLowerCase().includes(name.toLowerCase())))&&!told.some(text=>ownWords(text).filter(word=>reported.has(word)).length>=3))fail('the saved brief does not identify the verified work');
const listed=lines.some((line,at)=>{if(!step(line))return false;for(let i=at-1;i>=0;i--){if(!lines[i]||listItem.test(lines[i]))continue;return aboutNext(lines[i]);}return false;});
if(!listed&&(!nextLine||verb<0||!words.slice(verb+1).some(word=>!filler.has(word))))fail('the saved brief has no concrete next action');
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
// The words the owner reads: Telegram shows Markdown marks as formatting, not as characters.
const normal=value=>String(value||'').replace(/\r\n?/g,'\n').replace(/\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/[*_~`#]/g,'').replace(/^[ \t]*>[ \t]?/gm,'').split('\n').map(line=>line.trim()).join('\n').trim();
const fail=message=>{console.error(message);process.exit(1)};
const run=JSON.parse(read('run.json')),messages=label=>(run.outbox||[]).filter(m=>m.label===label&&m.accepted!==false).map(m=>m.text);
const saved=normal(read('brief.txt'));
const scheduled=JSON.parse(read('scheduled-telegram-requests.json')).sent||[];
if(!scheduled.some(message=>normal(message.text)===saved))fail('the installed scheduled morning brief was never delivered through Telegram');
if(messages('scheduled-brief').length!==1||normal(messages('scheduled-brief')[0])!==saved)fail('the scheduled brief was not retained as its own Telegram interaction');
if(messages('todays-brief').length!==1)fail("the owner received no single answer to today's brief through the installed gateway");
if(normal(messages('todays-brief')[0])!==saved)fail("today's brief differs from the saved note");
const rows=file=>{const data=JSON.parse(read(file));return Array.isArray(data)?data:data.data||[]};
const count=items=>items.filter(note=>normal(note.content||note.body||'')===saved).length;
if(count(rows('notes-after-reply.json'))!==count(rows('notes-before-reply.json')))fail("today's brief created a second saved brief");
NODE
); then
    fail "$reason"
  fi
  pass "a fresh Docker install connected its fictional Telegram bot, ran research, choice and work, saved a morning brief, and answered today's brief through the gateway"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  if [ "$CHECK_ONLY" = yes ]; then
    install_paths
    need_node
    check "$EVIDENCE"
  else
    act
    check "$EVIDENCE"
  fi
fi
