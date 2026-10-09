import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {fileURLToPath} from 'node:url';import {execFileSync,spawnSync} from 'node:child_process';
import {Store} from '../core/records/store.mjs';import {NativeScheduler} from '../core/native-scheduler.mjs';import {installStarter} from '../core/starter-workspace.mjs';
import {finalReply,saveRoutineResults,RESULTS_FOLDER,routineFiles,prepareCheckIn,coachRoutineTimes} from '../core/starting-routines.mjs';import {QueryService} from '../core/query.mjs';
import {withTimezone} from '../core/hermes-config.mjs';
import {routineRow,scheduleWords} from '../ui/src/local/routine-row.mjs';

const temporary=(t,name)=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-'+name+'-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;};
const python=process.env.GODSPEED_TEST_PYTHON||(process.platform==='win32'?'python':'python3');
const havePython=spawnSync(python,['--version']).status===0;
const tools=fileURLToPath(new URL('../../tools/',import.meta.url));

// Hermes keeps a run's document in cron/output/<job>/<time>.md and, with "local" delivery, sends it
// nowhere. These are its two shapes (cron/scheduler.py: an agent run, and a script run).
const agentRun=reply=>'# Cron Job: X\n\n**Job ID:** j\n**Run Time:** 2026-10-09 05:31:00\n**Schedule:** 30 5 * * *\n\n## Prompt\n\nFollow the recipe.\n\n## Response\n\n'+reply+'\n';
const scriptRun=out=>'# Cron Job: X\n\n**Job ID:** j\n**Run Time:** 2026-10-09 08:00:00\n**Mode:** no_agent (script)\n\n---\n\n'+out+'\n';
const silentScript='# Cron Job: X\n\n**Job ID:** j\n**Run Time:** 2026-10-09 08:00:00\n**Mode:** no_agent (script)\n**Status:** silent (empty output)\n';
function output(home,job,name,text){const folder=path.join(home,'cron','output',job);fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,name),text);}
function jobsFile(home,jobs){fs.mkdirSync(path.join(home,'cron'),{recursive:true});fs.writeFileSync(path.join(home,'cron','jobs.json'),JSON.stringify({jobs}));}

test('the reply of a routine run is read from Hermes\' own record, and a silent run has none',()=>{
 assert.equal(finalReply(agentRun('Your 10k plan needs one answer: any old injuries?')),'Your 10k plan needs one answer: any old injuries?');
 assert.equal(finalReply(scriptRun('From your deadline reminders:\nSoon. Tax: 9 days left.')),'From your deadline reminders:\nSoon. Tax: 9 days left.');
 for(const quiet of [agentRun('[SILENT]'),agentRun('(No response generated)'),silentScript,agentRun('Nothing new.\n[SILENT]'),'# Cron Job: X (FAILED)\n\nError: no model\n'])assert.equal(finalReply(quiet),null);
});

// On a computer a routine's reply went to Hermes' own folder and reached nobody (report of
// 8 October 2026). Now each run of a routine whose replies reach nobody becomes one note, whoever
// made the routine: the starting routines, one asked for in the chat, or one from Settings.
test('on a computer, every run of a routine that reaches nobody becomes one note in "From your routines"',t=>{
 const root=temporary(t,'results'),home=path.join(root,'.hermes');installStarter(root);
 const store=new Store(root,{device:'pc'});
 jobsFile(home,[{id:'daily',name:'Daily round: choose today\'s work',deliver:'local'},{id:'chat1',name:'Plan my day',deliver:'origin'},{id:'tg',name:'Morning brief',deliver:'telegram'},{id:'tg2',name:'From Telegram',deliver:'origin',origin:{platform:'telegram',chat_id:'1'}}]);
 const jobs=JSON.parse(fs.readFileSync(path.join(home,'cron','jobs.json'),'utf8')).jobs;
 assert.equal(saveRoutineResults(store,{home,jobs}).length,0,'the first look only starts the record');
 output(home,'daily','2026-10-09_05-31-00.md',agentRun('Three changes are ready for your yes.'));
 output(home,'daily','2026-10-10_05-31-00.md',agentRun('[SILENT]'));
 output(home,'chat1','2026-10-09_07-00-00.md',agentRun('Your plan for today: write, then call Anna.'));
 output(home,'tg','2026-10-09_06-00-00.md',agentRun('Went to Telegram.'));
 output(home,'tg2','2026-10-09_06-00-00.md',agentRun('Went to Telegram too.'));
 const saved=saveRoutineResults(store,{home,jobs});
 assert.deepEqual(saved.map(n=>n.title).sort(),['Daily round: choose today\'s work, 9 October 2026, 05:31','Plan my day, 9 October 2026, 07:00']);
 assert.ok(saved.every(n=>n.folder_path===RESULTS_FOLDER&&n.source_app==='routine'));
 assert.equal(saved.find(n=>n.routine_id==='daily').content,'Three changes are ready for your yes.');
 // Ticking again, or a restart that lost this machine's reading record, never saves a run twice.
 assert.equal(saveRoutineResults(store,{home,jobs}).length,0);
 fs.rmSync(path.join(store.state,'routine-results.json'));
 assert.equal(saveRoutineResults(store,{home,jobs}).length,0);
 assert.equal(store.list('notes').filter(n=>n.folder_path===RESULTS_FOLDER).length,2);
 // With a messenger, a routine from the chat goes to the chat it came from, not to a note.
 const other=temporary(t,'results-tg'),otherHome=path.join(other,'.hermes');installStarter(other);const otherStore=new Store(other,{device:'vps'});
 jobsFile(otherHome,[{id:'chat1',name:'Plan my day',deliver:'origin'}]);saveRoutineResults(otherStore,{home:otherHome,jobs:[{id:'chat1',deliver:'origin'}],messenger:true});
 output(otherHome,'chat1','2026-10-09_07-00-00.md',agentRun('Sent by Telegram.'));
 assert.equal(saveRoutineResults(otherStore,{home:otherHome,jobs:[{id:'chat1',deliver:'origin'}],messenger:true}).length,0);
});

test('an adopted mission control gets no notes from its routines',async t=>{
 const root=temporary(t,'adopted-results'),home=path.join(root,'.hermes');fs.mkdirSync(path.join(root,'rules'),{recursive:true});fs.writeFileSync(path.join(root,'AGENTS.md'),'# Mine\n');fs.writeFileSync(path.join(root,'rules','mine.md'),'Mine.\n');installStarter(root);
 const store=new Store(root,{device:'pc'});store.save('settings',{id:'installation',owner:'pc',timezone:'Europe/Berlin',delivery:'notebook'});
 jobsFile(home,[{id:'brief',name:'My brief',deliver:'local'}]);
 const scheduler=new NativeScheduler(store,{home,executable:'hermes',device:'pc',run:async()=>({stdout:''})});
 await scheduler.tick();output(home,'brief','2099-01-01_06-00-00.md',agentRun('My own brief.'));scheduler.lastTick=0;await scheduler.tick();
 assert.equal(store.list('notes').length,0);assert.equal(fs.existsSync(path.join(store.state,'routine-results.json')),false);
});

test('Hermes\' clock is set to the reader\'s zone where none was chosen, by setup and by every wiring',t=>{
 assert.equal(withTimezone('memory:\n  memory_enabled: false\n','Asia/Tokyo'),'memory:\n  memory_enabled: false\ntimezone: "Asia/Tokyo"\n');
 assert.equal(withTimezone('timezone: ""\nx: 1\n','Asia/Tokyo'),'timezone: "Asia/Tokyo"\nx: 1\n');
 assert.equal(withTimezone('timezone: Europe/London\n','Asia/Tokyo'),'timezone: Europe/London\n','a zone already chosen stays');
 assert.equal(withTimezone('  timezone: nested\n','Asia/Tokyo'),'  timezone: nested\ntimezone: "Asia/Tokyo"\n','only the top-level key counts');
 const script=fileURLToPath(new URL('../scripts/wire-assistant.mjs',import.meta.url)),wire=(root,home)=>execFileSync(process.execPath,[script,home],{env:{...process.env,GODSPEED_WORKSPACE:root,GODSPEED_PORT:'41990',GODSPEED_DEVICE:'local',GODSPEED_ORIGINAL_RUNTIME:'on'},windowsHide:true});
 // A Linux server made from the starter: the installer wires before the first goal, then again on
 // every upgrade or start, by when the reader's zone is known.
 const base=temporary(t,'wire-zone'),root=path.join(base,'workspace'),home=path.join(base,'assistant');installStarter(root);
 wire(root,home);assert.doesNotMatch(fs.readFileSync(path.join(home,'config.yaml'),'utf8'),/^timezone:/m,'no zone known yet');
 new Store(root).save('settings',{id:'installation',owner:'local',timezone:'America/Chicago',delivery:'notebook'});
 wire(root,home);assert.match(fs.readFileSync(path.join(home,'config.yaml'),'utf8'),/^timezone: "America\/Chicago"$/m);
 // The assistant's terminal is a shell: it can type godspeed-coach on every system.
 assert.match(fs.readFileSync(path.join(home,'bin','godspeed-coach'),'utf8'),/^#!\/bin\/sh\nexec .+godspeed-coach\.mjs' "\$@" --godspeed /);
 // An adopted mission control is the owner's: its assistant's clock is left alone.
 const adoptedBase=temporary(t,'wire-adopted'),adopted=path.join(adoptedBase,'workspace'),adoptedHome=path.join(adoptedBase,'assistant');
 fs.mkdirSync(path.join(adopted,'rules'),{recursive:true});fs.writeFileSync(path.join(adopted,'AGENTS.md'),'# Mine\n');fs.writeFileSync(path.join(adopted,'rules','mine.md'),'Mine.\n');installStarter(adopted);
 new Store(adopted).save('settings',{id:'installation',owner:'local',timezone:'America/Chicago',delivery:'notebook'});
 wire(adopted,adoptedHome);assert.doesNotMatch(fs.readFileSync(path.join(adoptedHome,'config.yaml'),'utf8'),/^timezone:/m);
});

test('Settings > Routines says in plain words when a routine runs, when it last ran and whether that worked',()=>{
 const now=Date.parse('2026-10-09T12:00:00Z'),options={now,timeZone:'Europe/Berlin'};
 assert.equal(scheduleWords('30 5 * * *'),'every day at 05:30');
 assert.equal(scheduleWords('0 10,16 * * *'),'every day at 10:00 and 16:00');
 assert.equal(scheduleWords('*/15 * * * *'),'every 15 minutes');
 assert.equal(scheduleWords('0 7 * * 1,2,3,4,5'),'every weekday at 07:00');
 assert.equal(scheduleWords('0 18 * * 0'),'every Sunday at 18:00');
 assert.equal(scheduleWords('every 30m'),'every 30 minutes');
 const base={id:'j',title:'Deadline reminders',what:'Every morning at 08:00 it tells you about your dates.',native:true,schedule:'0 8 * * *',next_run:'2026-10-10T08:00:00+02:00',paused:false};
 const worked=routineRow({...base,last_run_at:'2026-10-09T08:00:03+02:00',last_status:'ok'},options);
 assert.deepEqual(worked,{name:'Deadline reminders',what:'Every morning at 08:00 it tells you about your dates.',when:'Runs every day at 08:00.',next:'Next run tomorrow at 08:00.',last:'Last ran today at 08:00, and it worked.',paused:false});
 assert.equal(routineRow({...base,last_run_at:'2026-10-08T08:00:03+02:00',last_status:'error',last_error:'RuntimeError: The deadline reminders could not read your dates.\nTraceback'},options).last,'Last ran yesterday at 08:00, and it failed: RuntimeError: The deadline reminders could not read your dates.');
 assert.equal(routineRow({...base,last_run_at:'2026-10-08T08:00:03+02:00',last_status:'error',last_error:'Script exited with code 1\nstderr:\nThe deadline reminders could not read your dates.\nNode.js v22.23.3'},options).last,'Last ran yesterday at 08:00, and it failed: The deadline reminders could not read your dates.','a failed script says what it said');
 assert.equal(routineRow({...base,last_run_at:'2026-10-09T08:00:03+02:00',last_status:'delivery_failed'},options).last,'Last ran today at 08:00. It worked, but its message could not be sent.');
 assert.equal(routineRow(base,options).last,'It has not run yet.');
 assert.equal(routineRow({...base,paused:true},options).next,'Paused. Nothing runs until you resume it.');
 assert.equal(routineRow({id:'watch-sweeper',kind:'watch',interval_ms:60000,next_run:'2026-10-09T12:01:00Z',last_outcome:'verified'},options).last,'Last run: verified');
});

// The routines' own scripts, as Hermes runs them: its Python, the original programs.
function scriptFixture(t,{brief}={}){
 const root=temporary(t,'routine-scripts'),home=path.join(root,'.hermes'),state=path.join(root,'.godspeed');installStarter(root);
 const files=routineFiles({root,home,state,timezone:'Europe/Berlin'});files['godspeed-routines.json']=JSON.stringify({...JSON.parse(files['godspeed-routines.json']),bin:tools});
 fs.mkdirSync(path.join(home,'scripts'),{recursive:true});for(const [name,text] of Object.entries(files))fs.writeFileSync(path.join(home,'scripts',name),text);
 jobsFile(home,brief?[brief]:[]);
 return {root,home};
}
const runScript=(home,name,env={})=>spawnSync(python,[path.join(home,'scripts',name)],{cwd:path.join(home,'scripts'),encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8',...env},timeout:120000});
const berlinDay=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin'}).format(new Date());
const plus=days=>new Date(Date.parse(berlinDay+'T12:00:00Z')+days*86400000).toISOString().slice(0,10);
function addDue(root){execFileSync(process.execPath,[path.join(tools,'due.js'),'add','tax','--title','Tax return','--from',plus(-30),'--to',plus(2),'--done-when','it is filed','--cost','a late fee','--godspeed',root],{cwd:root,env:{...process.env,GODSPEED_ROOT:root,GODSPEED_DIR:root,GODSPEED_TODAY:berlinDay},windowsHide:true});}

test('deadline reminders: the dates that need a mention today, without a morning brief',{skip:!havePython&&'no Python here'},t=>{
 const {root,home}=scriptFixture(t);addDue(root);
 const run=runScript(home,'godspeed-deadline-reminders.py');
 assert.equal(run.status,0,run.stderr);
 assert.match(run.stdout,/^From your deadline reminders:\r?\nRunning out\. Tax return: \d+ days left, and the last one is /);
 // Nothing to say: nothing printed, which is Hermes' silence.
 const empty=scriptFixture(t),quiet=runScript(empty.home,'godspeed-deadline-reminders.py');
 assert.equal(quiet.status,0,quiet.stderr);assert.equal(quiet.stdout,'');
});

test('deadline reminders say nothing on a day a morning brief carries the dates, and speak when it is paused',{skip:!havePython&&'no Python here'},t=>{
 const brief={id:'brief',name:'Morning brief',skill:'morning-brief',enabled:true,state:'scheduled',next_run_at:berlinDay+'T23:59:00+02:00',last_run_at:null};
 const later=scriptFixture(t,{brief});addDue(later.root);
 const quiet=runScript(later.home,'godspeed-deadline-reminders.py');assert.equal(quiet.status,0,quiet.stderr);assert.equal(quiet.stdout,'','the brief will carry them');
 const ran=scriptFixture(t,{brief:{...brief,last_run_at:berlinDay+'T00:01:00+02:00',next_run_at:plus(1)+'T06:00:00+02:00'}});addDue(ran.root);
 assert.equal(runScript(ran.home,'godspeed-deadline-reminders.py').stdout,'','the brief carried them this morning');
 const paused=scriptFixture(t,{brief:{...brief,enabled:false,state:'paused'}});addDue(paused.root);
 assert.match(runScript(paused.home,'godspeed-deadline-reminders.py').stdout,/Tax return/);
});

// The whole morning choice as Hermes runs it: the routine's script runs the original mc-decide,
// which runs the next-action recipe through mc-run and "hermes" (here a stand-in that writes the
// day's record the way the recipe does), and the person gets the record's line.
const bash=process.platform==='win32'?['C:\\Program Files\\Git\\bin\\bash.exe','C:\\Program Files (x86)\\Git\\bin\\bash.exe'].find(f=>fs.existsSync(f)):spawnSync('bash',['--version']).status===0;
test('the daily round\'s morning choice runs mc-decide and tells the person its one line',{skip:(!havePython||!bash)&&'no Python or bash here'},t=>{
 const {root,home}=scriptFixture(t),fake=path.join(root,'.fake-assistant');fs.mkdirSync(fake,{recursive:true});
 fs.writeFileSync(path.join(fake,'hermes'),'#!/usr/bin/env bash\n# A stand-in for the assistant: writes the record the next-action recipe writes.\n# The recipe comes on standard input (mc-run, 9 October 2026: on Windows it is longer than a command line).\ncase " $* " in *" --query-file - "*) ;; *) echo "the prompt did not come on standard input: $*" >&2; exit 9 ;; esac\nprompt="$(cat)"\ndir="$(printf \'%s\\n\' "$prompt" | sed -n \'s/^.*The run folder is \\([^ ]*\\) and it.*$/\\1/p\' | head -1)"\n[ -n "$dir" ] || dir="$(printf \'%s\\n\' "$prompt" | sed -n \'s/^.*Today.s decision in \\([^ ]*\\) is written.*$/\\1/p\' | head -1)"\nprintf \'# Decision\\n\\n## For you today\\nOne question: is the race still on 19 April?\\n\' > "$dir/decision.md"\nprintf \'Is your race still on 19 April? nothing\\n\'\n',{mode:0o755});
 const settings=path.join(home,'scripts','godspeed-routines.json');fs.writeFileSync(settings,JSON.stringify({...JSON.parse(fs.readFileSync(settings,'utf8')),hermes:path.join(fake,'hermes')}));
 const run=runScript(home,'godspeed-daily-round-choose.py');
 assert.equal(run.status,0,run.stderr);
 assert.equal(run.stdout.trim(),'Is your race still on 19 April?');
 assert.ok(fs.existsSync(path.join(root,'routines','next-action',berlinDay,'decision.md')),'the day\'s record is in the mission control');
 // Run again the same day (a catch-up after the computer slept): decided once, said once.
 const again=runScript(home,'godspeed-daily-round-choose.py');assert.equal(again.status,0,again.stderr);assert.equal(again.stdout,'');
});

test('the daily round\'s line for the person comes from the decision\'s "For you today"',{skip:!havePython&&'no Python here'},()=>{
 const code=`import sys;sys.path.insert(0,${JSON.stringify(fileURLToPath(new URL('../core/routine-scripts/',import.meta.url)))});from godspeed_routines import for_you
cases=[
 ("Three changes are ready for your yes: reply ship all or the numbers. ship-list-2026-10-09","# Decision\\n## For you today\\nship-list-2026-10-09: 1. bio 2. price\\n","Three changes are ready for your yes: reply ship all or the numbers."),
 ("Nothing today, because the playbook research runs first. nothing","# Decision\\n## For you today\\nnothing today, because the playbook research runs first\\n",""),
 ("Is your race still on 19 April? nothing","# Decision\\n## For you today\\nOne question: is the race still on 19 April?\\n","Is your race still on 19 April?"),
 ("[SILENT]","",""),
]
for answer,decision,want in cases:
  got=for_you(answer,decision)
  assert got==want,(answer,got)
print("ok")`;
 const run=spawnSync(python,['-c',code],{encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8'}});
 assert.equal(run.status,0,run.stderr);assert.equal(run.stdout.trim(),'ok');
});

// 9 October 2026, a live run on Windows: the reader's whole message from the daily round was Hermes'
// "File-mutation verifier" block, which Hermes appends after the model's real line; the other answer
// of that day ended with the model's own "Verified: ..." note and began with a line Hermes printed.
// These are those two answers, word for word.
const LIVE_MOVES='For you today: ship list `ship-list-2026-10-09` (refreshed, same card, no second card) — 3 moves ready: (1) file 50-name pitch list; (2) portfolio audit file; (3) cold-email draft approval only (send blocked). Plus the weekly LEAD question (confirm this week\'s pitch count; recorded 0 on your word). Nothing ships until you reply.\n\n⚠️ File-mutation verifier: 1 file(s) were NOT modified this turn despite any wording above that may suggest otherwise. Run `git status` or `read_file` to confirm.\n  • `/workspace/routines/next-action/2026-10-09/moves.md` — [write_file] Failed to write file: mkdir: cannot create directory ‘/workspace’: Permission denied\n';
const LIVE_ANSWER='\u{1f527} Auto-repaired tool name: \'file_files\' -> \'write_file\'\nFor you today: ship-list card `ship-list-2026-10-09` — 3 lines to approve: (1) build 50-name pitch list file; (2) portfolio audit vs board-game checklist; (3) approve cold-email template.\n\nVerified: decision.md and moves.md written, all 3 blocks have NOW/AFTER/BET/WHO/UNDONE/APPLY; playbook current; `mc-check-moves` not installed (checked by eye).\n';
const LIVE_DECISION='# Decision 2026-10-09\n## For you today\nShip-list card `ship-list-2026-10-09` refreshed (same file). (1) build 50-name pitch list file; (2) portfolio audit; (3) approve cold-email template.\n## Not done and why\nnothing\n';
test('the daily round\'s line is never a Hermes trailer or the model\'s note after it',{skip:!havePython&&'no Python here'},()=>{
 const code=`import sys,json;sys.path.insert(0,${JSON.stringify(fileURLToPath(new URL('../core/routine-scripts/',import.meta.url)))});from godspeed_routines import for_you,strip_trailers
cases=json.loads(sys.stdin.read())
print(json.dumps([for_you(a,d) for a,d in cases]+[strip_trailers(cases[0][0])]))`;
 const verifierOnly='⚠️ File-mutation verifier: 1 file(s) were NOT modified this turn despite any wording above that may suggest otherwise.\n  • `/workspace/x.md` — [write_file] Failed';
 const cases=[
  [LIVE_MOVES,LIVE_DECISION],
  [LIVE_ANSWER,LIVE_DECISION],
  // Only the trailer, or the model's own note: the decision's own section speaks.
  [verifierOnly,LIVE_DECISION],
  ['Verified: decision.md written; the moves check printed OK.',LIVE_DECISION],
  // A reply Hermes replaced because the model looped is no line either.
  ['⚠️ **Response Stopped — Repetition Detected**\n\nThe model fell into a repetition loop while writing this response.\n\n→ Switch to a different model with `/model`',LIVE_DECISION],
  // "I changed nothing." is a sentence, not the recipe's ending: the section speaks.
  ['I changed nothing.','# Decision\n## For you today\nOne question: is the race still on 19 April?\n'],
  // A day with nothing for the person stays silent whatever the answer says.
  [LIVE_MOVES,'# Decision\n## For you today\nnothing today, because the playbook comes first\n'],
 ];
 const run=spawnSync(python,['-c',code],{input:JSON.stringify(cases),encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8'}});
 assert.equal(run.status,0,run.stderr);const got=JSON.parse(run.stdout);
 assert.match(got[0],/^ship list `ship-list-2026-10-09` \(refreshed, same card, no second card\) — 3 moves ready: .+ Nothing ships until you reply\.$/);
 assert.match(got[1],/^ship-list card `ship-list-2026-10-09` — 3 lines to approve: .+ approve cold-email template\.$/);
 const section='Ship-list card `ship-list-2026-10-09` refreshed (same file). (1) build 50-name pitch list file; (2) portfolio audit; (3) approve cold-email template.';
 assert.equal(got[2],section);assert.equal(got[3],section);assert.equal(got[4],section);
 assert.equal(got[5],'One question: is the race still on 19 April?');
 assert.equal(got[6],'');
 for(const line of got)assert.doesNotMatch(line,/verifier|Auto-repaired|Verified:|Repetition|\/workspace/);
 assert.doesNotMatch(got.at(-1),/File-mutation verifier/);assert.match(got.at(-1),/Nothing ships until you reply\.$/,'stripping keeps the real line');
});

test('a routine\'s note never holds a Hermes trailer, and one that is only a trailer is no note',()=>{
 assert.equal(finalReply(agentRun(LIVE_MOVES)),LIVE_MOVES.split('\n\n⚠')[0]);
 assert.equal(finalReply(scriptRun('Your brief is ready.\n\n⚠️ File-mutation verifier: 1 file(s) were NOT modified this turn.\n  • `/workspace/a.md` — [write_file] Failed')),'Your brief is ready.');
 assert.equal(finalReply(agentRun('⚠️ File-mutation verifier: 1 file(s) were NOT modified this turn.\n  • `/workspace/a.md` — [write_file] Failed')),null);
 assert.equal(finalReply(agentRun('⚠️ **Response Stopped — Repetition Detected**\n\nThe model fell into a repetition loop.\n\n→ Or resend your message')),null);
 assert.equal(finalReply(agentRun('\u{1f527} Auto-repaired tool name: \'a\' -> \'b\'\nThree findings are new.')),'Three findings are new.');
});

// 9 October 2026, the same run: the morning choice ran out of time, and a work item failed its
// check; both reached nobody but the Routines list. Each now says so in one line, the way any of
// the daily round's lines reaches the person, and the Routines list still says the run failed.
test('a daily round that went wrong tells the person in one line, once a day, and the Routines list says it failed',{skip:(!havePython||!bash)&&'no Python or bash here'},t=>{
 const {root,home}=scriptFixture(t),fake=path.join(root,'.fake-assistant');fs.mkdirSync(fake,{recursive:true});
 // An assistant that stops before writing anything, as the free model did after 25 minutes.
 fs.writeFileSync(path.join(fake,'hermes'),'#!/usr/bin/env bash\ncat >/dev/null\necho "Upstream idle timeout exceeded" >&2\nexit 1\n',{mode:0o755});
 const settings=path.join(home,'scripts','godspeed-routines.json');fs.writeFileSync(settings,JSON.stringify({...JSON.parse(fs.readFileSync(settings,'utf8')),hermes:path.join(fake,'hermes')}));
 const run=runScript(home,'godspeed-daily-round-choose.py');
 assert.equal(run.status,0,run.stderr);
 assert.equal(run.stdout.trim(),'This morning\'s daily round did not finish, so nothing was decided today.');
 const status=JSON.parse(fs.readFileSync(path.join(home,'godspeed-routines-status.json'),'utf8'));
 assert.equal(status.decide.failed,'This morning\'s daily round did not finish, so nothing was decided today.');
 // Hermes records the run as having worked; the row says it failed, with the same sentence.
 jobsFile(home,[{id:'choose',name:'Daily round: choose today\'s work',script:'godspeed-daily-round-choose.py',deliver:'local',last_run_at:new Date().toISOString(),last_status:'ok'}]);
 const query=new QueryService(new Store(root));query.nativeHermesHome=home;
 const row=routineRow(query.rows('jobs').find(j=>j.id==='choose'),{timeZone:'Europe/Berlin'});
 assert.match(row.last,/and it failed: This morning's daily round did not finish, so nothing was decided today\.$/);
 // On a computer the line becomes a note in "From your routines", like any other line.
 const store=new Store(root,{device:'pc'}),jobs=[{id:'choose',name:'Daily round: choose today\'s work',deliver:'local'}];
 saveRoutineResults(store,{home,jobs});output(home,'choose','2099-01-01_05-30-00.md',scriptRun(run.stdout.trim()));
 assert.deepEqual(saveRoutineResults(store,{home,jobs}).map(n=>n.content),['This morning\'s daily round did not finish, so nothing was decided today.']);
 // A second run the same day that fails the same way says nothing new, and the row still says it failed.
 const again=runScript(home,'godspeed-daily-round-choose.py');assert.equal(again.status,0,again.stderr);assert.equal(again.stdout,'');
 assert.match(routineRow(query.rows('jobs').find(j=>j.id==='choose'),{timeZone:'Europe/Berlin'}).last,/and it failed: /);
 // A row whose run is not the one that wrote the record (an old failure) is Hermes' own.
 jobsFile(home,[{id:'choose',name:'Daily round: choose today\'s work',script:'godspeed-daily-round-choose.py',last_run_at:'2026-01-01T05:30:00+01:00',last_status:'ok'}]);
 assert.match(routineRow(query.rows('jobs').find(j=>j.id==='choose'),{timeZone:'Europe/Berlin'}).last,/and it worked\.$/);
});

test('a piece of the daily round\'s work that failed its check is said in one line',{skip:!havePython&&'no Python here'},t=>{
 const {home}=scriptFixture(t);
 // mc-work-run's own log lines (tools/mc-work-run), as the routine reads them.
 const log=['08:00:01Z W-1 taken (learn): How do people who reached two new clients get there?','  verified: no','08:04:00Z W-1 attempted, not verified (verify exit 2)','08:04:02Z W-2 taken (make): Draft the pitch email','08:05:00Z W-2 failed: the assistant ended (exit 1) without a RESULT line','08:06:00Z W-3 taken (make): Write the price list','08:07:00Z W-3 verified','08:07:01Z run end: 3 taken, 2 attempted, 1 verified'].join('\n');
 const code=`import sys,json,types;sys.path.insert(0,${JSON.stringify(path.join(home,'scripts'))})
import godspeed_routines as g
g.bash=lambda:"bash"
g.run=lambda args,c,env,timeout=None:types.SimpleNamespace(returncode=0,stdout=sys.stdin.read(),stderr="")
print(json.dumps(g.work(g.config())))`;
 const run=spawnSync(python,['-c',code],{cwd:path.join(home,'scripts'),input:log,encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8'}});
 assert.equal(run.status,0,run.stderr);
 assert.deepEqual(JSON.parse(run.stdout).split('\n'),['Today\'s work did not pass its check, so it is not done yet: "How do people who reached two new clients get there?".','Today\'s work could not be finished, so it is not done yet: "Draft the pitch email".']);
 const status=JSON.parse(fs.readFileSync(path.join(home,'godspeed-routines-status.json'),'utf8'));assert.match(status.work.failed,/did not pass its check/);
});

// 9 October 2026, a live run: the Weekly check-in row said "Runs every 15 minutes.", which is only
// how often it looks whether a talk is due. It says the talk's day and time, and the next talk.
test('Settings > Routines gives the coach routines their real rhythm, not the 15-minute look',t=>{
 const root=temporary(t,'coach-rhythm'),home=path.join(root,'.hermes');installStarter(root);
 prepareCheckIn(root,{timezone:'Europe/Berlin',delivery:'notebook',goal:'fictional-goal',now:new Date('2026-10-09T10:00:00Z')});
 const now=new Date('2026-10-09T12:00:00Z'),gate={title:'Weekly check-in',schedule:'*/15 * * * *'},tick={title:'Coach reminders and habit check',schedule:'*/15 * * * *'};
 assert.deepEqual(coachRoutineTimes(gate,root,{now}),{rhythm:'Runs every Sunday at 18:00.',next_talk:'2026-10-11T16:00:00.000Z'});
 assert.deepEqual(coachRoutineTimes(tick,root,{now}),{rhythm:'Checks every 15 minutes for a due reminder or habit question.'});
 assert.deepEqual(coachRoutineTimes({title:'Deadline reminders',schedule:'0 8 * * *'},root,{now}),{});
 const options={now:now.getTime(),timeZone:'Europe/Berlin'},row=routineRow({...gate,native:true,...coachRoutineTimes(gate,root,{now}),next_run:'2026-10-09T14:15:00+02:00'},options);
 assert.equal(row.when,'Runs every Sunday at 18:00.');assert.equal(row.next,'Next talk Sunday 11 October at 18:00.');
 assert.equal(routineRow({...tick,native:true,...coachRoutineTimes(tick,root,{now})},options).when,'Checks every 15 minutes for a due reminder or habit question.');
 // The rows the page is given carry it.
 fs.mkdirSync(path.join(home,'cron'),{recursive:true});fs.writeFileSync(path.join(home,'cron','jobs.json'),JSON.stringify({jobs:[{id:'gate',name:'Weekly check-in',schedule_display:'*/15 * * * *'},{id:'tick',name:'Coach reminders and habit check',schedule_display:'*/15 * * * *'}]}));
 const query=new QueryService(new Store(root));query.nativeHermesHome=home;const rows=query.rows('jobs');
 assert.equal(rows.find(j=>j.id==='gate').rhythm,'Runs every Sunday at 18:00.');
 assert.match(rows.find(j=>j.id==='tick').rhythm,/^Checks every 15 minutes/);
});
