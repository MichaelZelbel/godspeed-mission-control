// THE MORNING BRIEF ROUTINE RUNS THE NOTEBOOK'S OWN BRIEFING (3 November 2026, #160).
//
// On every install the assistant runs the routines, and its Morning brief was the starter recipe, so
// the notebook's briefing (core/briefing.mjs: the Charm Challenge line word for word, a sentence that
// breaks a writing rule cut) never reached anyone. These tests hold the new path to that: the entry
// the routine's script runs (scripts/morning-brief.mjs) saves the notebook's briefing and gives its
// words to deliver, never sends the same words twice, and refuses without an AI; and the
// routine's own script (godspeed_routines.py, brief) prints those words, or fails in one sentence.
// Everything in here is made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {addonCommand} from '../core/native-personal.mjs';
import {routineFiles} from '../core/starting-routines.mjs';
import {BRIEF_SCRIPT} from '../core/notebook-routines.mjs';
import {runMorningBrief} from '../scripts/morning-brief.mjs';

const python=process.env.GODSPEED_TEST_PYTHON||(process.platform==='win32'?'python':'python3');
const havePython=spawnSync(python,['--version']).status===0;
const OK='No fresh health observations are recorded. Review the fictional list today.';
// A failed fact check must name the records it rejects (Archon R1, round 3); these fixtures fail only the reader check.
const readerFails=(input,reason)=>input.check==='source-facts'?{passed:true,reason:'Fictional sources checked.'}:{passed:false,reason};
const verifies=input=>input.kind==='brief-verification'?{passed:true,reason:'Fictional sources checked.'}:null;

function workspace(t,{charm=false,rules=[]}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-brief-routine-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true,maxRetries:5}));
 const store=new Store(root);store.save('settings',{id:'installation',timezone:'Europe/Berlin'});
 fs.mkdirSync(path.join(root,'profile'),{recursive:true});
 fs.writeFileSync(path.join(root,'profile','voice.md'),'# Voice\n\n```voice-rules\n'+rules.join('\n')+'\n```\n');
 if(charm)addonCommand(store,{addon:'charm',args:['start']});
 return {root,store};
}

test('the routine\'s entry saves the notebook\'s own briefing, with the Charm line, and gives its words',async t=>{
 process.env.GODSPEED_CHARM_NOW='2026-10-21T08:00:00Z';process.env.GODSPEED_NOW='2026-10-21T08:00:00Z';
 t.after(()=>{delete process.env.GODSPEED_CHARM_NOW;delete process.env.GODSPEED_NOW;});
 const {root}=workspace(t,{charm:true});let line=null;
 const provider=async input=>{const v=verifies(input);if(v)return v;line=input.context.charm_line;return OK+'\n\n'+input.context.charm_line;};
 const {text,result}=await runMorningBrief({root,provider});
 assert.ok(line&&/^Charm Challenge: day 1 of 21/.test(line),'the briefing was given the Charm line: '+line);
 assert.ok(text.split(/\r?\n/).includes(line),'the words to deliver carry it as a line of its own');
 const notes=new QueryService(new Store(root)).rows('notes').filter(n=>n.source_app==='morning-brief');
 assert.equal(notes.length,1);assert.equal(notes[0].id,result.record_id);assert.equal(notes[0].content.trim(),text);
 // Asked again the same day, the saved briefing is given back and the AI is not asked.
 const again=await runMorningBrief({root,provider:async()=>{throw Error('the AI must not be asked');}});
 assert.equal(again.text,text);
});

test('the routine\'s entry cuts a sentence that breaks a writing rule and delivers the rest',async t=>{
 const {root}=workspace(t,{rules:['BANNED-WORD: realm']});let writes=0;
 const provider=async input=>{const v=verifies(input);if(v)return v;writes++;return 'Your realm is open today. Review the fictional list today. A useful closing remains.';};
 const {text}=await runMorningBrief({root,provider});
 assert.equal(writes,2,'the one rewrite');
 assert.doesNotMatch(text,/realm/i);assert.match(text,/Review the fictional list today\./);
});

test('without an AI the routine\'s entry says so in one sentence',async t=>{
 const {root}=workspace(t);
 await assert.rejects(runMorningBrief({root,env:{GODSPEED_ASSISTANT_CONFIG:path.join(root,'none.json')}}),/no AI to write with: connect one in Settings/);
});

// WITH THE ORIGINAL ASSISTANT (#163). Where the assistant runs the routines, goals and work are its
// cards, and the notebook server reads them there; the routine's entry must read them the same way,
// and the repair item the briefing files for a left-out line must be in the notebook's work list,
// beside the cards. On candidate/2.0.0-beta.15 it was saved on disk and listed nowhere.
test('with the original assistant the routine\'s entry reads the goal cards, and its repair item is listed beside the work cards',async t=>{
 process.env.GODSPEED_CHARM_NOW='2026-10-21T08:00:00Z';process.env.GODSPEED_NOW='2026-10-21T08:00:00Z';
 t.after(()=>{delete process.env.GODSPEED_CHARM_NOW;delete process.env.GODSPEED_NOW;});
 const {root,store}=workspace(t,{charm:true,rules:['BANNED-WORD: Challenge']});
 fs.mkdirSync(path.join(root,'rules'),{recursive:true});
 const tools=fileURLToPath(new URL('../../tools/',import.meta.url)),cli=(file,...args)=>execFileSync(process.execPath,[path.join(tools,file),...args,'--godspeed',root],{cwd:root,env:{...process.env,GODSPEED_ROOT:root},encoding:'utf8'});
 cli('goals.js','file','--kind','outcome','--status','adopted','--id','garden','--title','Plant the fictional garden','--source','test','--date','2026-10-20');
 const work=cli('work.js','file','--what','Buy fictional seeds','--done-when','seeds.md lists them','--goal','garden','--source','test','--date','2026-10-20').split(':')[0];
 // A work item the notebook keeps that is not a repair stays out, as before.
 store.save('work_items',{id:'fictional-draft',kind:'draft',title:'A fictional draft',state:'verified'});
 const config=path.join(root,'assistant.json');fs.writeFileSync(config,JSON.stringify({verified:true,home:path.join(root,'.hermes')}));
 const env={GODSPEED_ORIGINAL_RUNTIME:'on',GODSPEED_ASSISTANT_CONFIG:config};let seen=null;
 const provider=async input=>{const v=verifies(input);if(v)return v;seen=input.context;return OK;};
 const {text}=await runMorningBrief({root,provider,env});
 assert.deepEqual(seen.goals.map(g=>g.title),['Plant the fictional garden'],'the briefing read the goal card, as the notebook server does');
 assert.ok(seen.work.some(w=>w.id===work),'and the work card');
 assert.equal(seen.charm_line,null,'the Charm line breaks the rule, so it is left out');
 assert.doesNotMatch(text,/Challenge/);
 // The notebook server's own list, with the original assistant.
 const query=new QueryService(new Store(root));query.nativeHermesHome=path.join(root,'.hermes');
 const listed=query.rows('work_items'),repairs=listed.filter(w=>w.kind==='repair');
 assert.equal(repairs.length,1,'the repair item is in the work list: '+JSON.stringify(listed.map(w=>w.id)));
 assert.equal(repairs[0].line_name,'the Charm Challenge line');assert.match(repairs[0].error,/Challenge/);
 assert.ok(listed.some(w=>w.id===work),'beside the work card');
 assert.ok(!listed.some(w=>w.id==='fictional-draft'),'a kept item that is not a repair is not listed');
 assert.equal(listed.filter(w=>w.id===work).length,1,'and each card once');
 // Without the original assistant the entry reads the notebook's own records, as before.
 seen=null;process.env.GODSPEED_CHARM_NOW='2026-10-22T08:00:00Z';process.env.GODSPEED_NOW='2026-10-22T08:00:00Z';
 await runMorningBrief({root,provider:async input=>{const v=verifies(input);if(v)return v;seen=input.context;return OK+' Fictional second day.';},env:{GODSPEED_ASSISTANT_CONFIG:config},now:new Date('2026-10-22T08:00:00Z')});
 assert.deepEqual(seen.goals,[],'no goal records were kept, only the card');
 // With the original assistant but none connected, the server would not start; the briefing
 // refuses in one sentence rather than write without the cards.
 fs.writeFileSync(config,JSON.stringify({verified:false,home:path.join(root,'.hermes')}));
 const third=new Date('2026-10-23T08:00:00Z');
 await assert.rejects(runMorningBrief({root,provider,env,now:third}),/cannot read your goals and work: the assistant this notebook runs with is not connected/);
 await assert.rejects(runMorningBrief({root,provider,now:third,env:{...env,GODSPEED_ASSISTANT_CONFIG:path.join(root,'none.json')}}),/not connected/);
});

// The routine's own script, as Hermes runs it: its Python, and the entry above replaced by a stand-in.
function scripts(t,entry,{telegram=false,config={}}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-brief-script-')),home=path.join(root,'.hermes'),state=path.join(root,'.godspeed');
 t.after(()=>fs.rmSync(root,{recursive:true,force:true,maxRetries:5}));
 const files=routineFiles({root,home,state,timezone:'Europe/Berlin'}),stub=path.join(root,'stand-in-brief.mjs');
 fs.writeFileSync(stub,entry);
 files['godspeed-routines.json']=JSON.stringify({...JSON.parse(files['godspeed-routines.json']),brief:stub,...config});
 fs.mkdirSync(path.join(home,'scripts'),{recursive:true});if(telegram)fs.writeFileSync(path.join(home,'.env'),'TELEGRAM_BOT_TOKEN=123:abc\n');for(const [name,text] of Object.entries(files))fs.writeFileSync(path.join(home,'scripts',name),text);
 return {...spawnSync(python,[path.join(home,'scripts',BRIEF_SCRIPT)],{cwd:path.join(home,'scripts'),encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8'},timeout:120000}),root};
}

test('the Morning brief routine\'s script prints the briefing for Hermes to deliver',{skip:!havePython&&'no Python here'},t=>{
 const run=scripts(t,"if(!process.env.GODSPEED_WORKSPACE)process.exit(3);process.stdout.write('Your morning briefing, made up.\\n\\nCharm Challenge: day 1 of 21.\\n');");
 assert.equal(run.status,0,run.stderr);
 assert.equal(run.stdout.trim(),'Your morning briefing, made up.\n\nCharm Challenge: day 1 of 21.'.replace(/\n/g,process.platform==='win32'?'\r\n':'\n').replace(/\r\n/g,'\n'));
 const silent=scripts(t,'process.exit(0);');
 assert.equal(silent.status,0,silent.stderr);assert.equal(silent.stdout,'','nothing printed is Hermes\' silence');
 assert.equal(fs.existsSync(path.join(silent.root,'notebook','_system','conversation_messages')),false,'and nothing is recorded');
 const folder=path.join(run.root,'notebook','_system','conversation_messages'),[file,...others]=fs.readdirSync(folder);
 const saved=JSON.parse(fs.readFileSync(path.join(folder,file),'utf8'));
 assert.equal(others.length,0);assert.equal(saved.content,'Your morning briefing, made up.\n\nCharm Challenge: day 1 of 21.');assert.equal(saved.report.written,'routine','recorded as printed, not rewritten');
});

test('a briefing sent to Telegram is recorded in the Telegram chat, unchanged',{skip:!havePython&&'no Python here'},t=>{
 const run=scripts(t,"process.stdout.write('Your morning briefing, made up.\\n');",{telegram:true});
 assert.equal(run.status,0,run.stderr);
 const folder=path.join(run.root,'notebook','_system','conversation_messages'),[file]=fs.readdirSync(folder);
 const saved=JSON.parse(fs.readFileSync(path.join(folder,file),'utf8'));
 assert.deepEqual([saved.content,saved.conversation_id,saved.delivered_to],['Your morning briefing, made up.','telegram-owner','telegram']);
});

test('a briefing that cannot be recorded is not sent',{skip:!havePython&&'no Python here'},t=>{
 const run=scripts(t,"process.stdout.write('Your morning briefing, made up.\\n');",{config:{reports:'/nonexistent/background-report.mjs'}});
 assert.notEqual(run.status,0);assert.equal(run.stdout,'');
 assert.match(run.stderr,/^What was sent to you could not be recorded in your notebook\./);
});

test('a briefing that could not be written fails the routine in one sentence',{skip:!havePython&&'no Python here'},t=>{
 const run=scripts(t,"console.error('The morning brief has no AI to write with: connect one in Settings, Your AI.');process.exit(1);");
 assert.notEqual(run.status,0);
 assert.match(run.stderr,/^The morning brief could not be written\.\r?\nThe morning brief has no AI to write with/);
});

// "TODAY'S BRIEF" IN THE CHAT (#193). The chat runs `godspeed-brief` (morning-brief.mjs --today): the
// morning's own note when it is saved, else the briefing once; never a second note.
const briefNotes=root=>new QueryService(new Store(root)).rows('notes').filter(n=>n.source_app==='morning-brief');

test('asked for in the chat, a saved briefing of today is printed unchanged and nothing is written',async t=>{
 const {root}=workspace(t);
 const provider=async input=>verifies(input)||OK;
 const {text}=await runMorningBrief({root,provider});
 const before=JSON.stringify(briefNotes(root));
 const asked=await runMorningBrief({root,provider:async()=>{throw Error('the AI must not be asked');}});
 assert.equal(asked.text,text);assert.equal(JSON.stringify(briefNotes(root)),before);
});

test('asking in chat returns the saved factual fallback exactly once',async t=>{
 const {root,store}=workspace(t);store.save('goals',{title:'Prepare a fictional guide',status:'adopted'});
 const provider=async input=>input.kind==='brief-verification'?readerFails(input,'No actionable next step'):'Unsupported private outcome.';
 const first=await runMorningBrief({root,provider});
 assert.equal(first.result.fallback,true);assert.equal(briefNotes(root).length,1);
 const again=await runMorningBrief({root,provider:async()=>{throw Error('the AI must not be asked');}});
 assert.equal(again.text,first.text);assert.equal(briefNotes(root).length,1);
});

test('a saved briefing keeps its boundary whitespace when asked for in the chat',async t=>{
 const {root}=workspace(t);
 const provider=async input=>verifies(input)||OK;
 await runMorningBrief({root,provider});
 const store=new Store(root),note=briefNotes(root)[0],content='\n  '+note.content+'  \n\n';
 store.save('notes',{...store.get('notes',note.id),content});
 const asked=await runMorningBrief({root,provider:async()=>{throw Error('the AI must not be asked');}});
 assert.equal(asked.text,content);
});

test('asked for in the chat with none saved, the briefing is saved once, and asking again saves no second note',async t=>{
 const {root}=workspace(t);let writes=0;
 const provider=async input=>verifies(input)||(writes++,OK);
 const first=await runMorningBrief({root,provider});
 assert.equal(briefNotes(root).length,1);
 const again=await runMorningBrief({root,provider});
 assert.equal(again.text,first.text);assert.equal(briefNotes(root).length,1);assert.equal(writes,1);
});

test('a briefing saved on an earlier day is not today\'s, and the same words may open the next day',async t=>{
 const {root}=workspace(t);
 const provider=async input=>verifies(input)||OK;
 const first=await runMorningBrief({root,provider});
 const tomorrow=new Date(Date.now()+2*86400000);
 const next=await runMorningBrief({root,provider,now:tomorrow});
 assert.equal(next.text,first.text);assert.equal(briefNotes(root).length,2,'two notes, one for each day');
});

test('the recipe names the command first and keeps hand-writing only as the fallback without it',()=>{
 const recipe=fs.readFileSync(fileURLToPath(new URL('../../starter-godspeed/skills/morning-brief/SKILL.md',import.meta.url)),'utf8');
 const command=recipe.indexOf('godspeed-brief'),fallback=recipe.indexOf('## The fallback'),write=recipe.indexOf('## What to write');
 assert.ok(command>0&&command<fallback&&fallback<write,'the command comes before the fallback, which comes before the writing part');
 assert.match(recipe,/where `godspeed-brief` does not exist/);
 assert.match(recipe,/Save a new file as `brief\/YYYY-MM-DD\.md`/,'a mission control without the command is still told what to write');
 assert.match(recipe,/Never write\s+`brief\/YYYY-MM-DD\.md` by hand for "today's brief"/);
});

test('the routine after the chat prints nothing for the briefing the chat showed, and saves no second one',async t=>{
 const {root}=workspace(t);let n=0;
 const provider=async input=>verifies(input)||(n++,OK);
 const chat=await runMorningBrief({root,provider});
 const script=fileURLToPath(new URL('../scripts/morning-brief.mjs',import.meta.url));
 const run=(...args)=>spawnSync(process.execPath,[script,...args],{encoding:'utf8',env:{...process.env,GODSPEED_WORKSPACE:root}});
 const routine=run();
 assert.equal(routine.status,0,routine.stderr);assert.equal(routine.stdout,'','the routine says nothing for a briefing already saved');
 assert.equal(briefNotes(root).length,1);assert.equal(n,1,'one AI draft');
 assert.equal(run('--today').stdout,chat.text+'\n','the chat still gets the saved note');
});

test('the recipe has the one-sentence answer for a briefing the notebook keeps silent',()=>{
 const recipe=fs.readFileSync(fileURLToPath(new URL('../../starter-godspeed/skills/morning-brief/SKILL.md',import.meta.url)),'utf8');
 assert.match(recipe,/prints nothing and succeeds[^]*?say in one\s+sentence that there is no briefing today/);
});

// The person's day is the installation's (Europe/Berlin here), not UTC, and a briefing keeps the day
// it was asked for even when it is committed after local midnight.
const save=(store,fields)=>store.save('notes',{title:'Your morning briefing',content:'MADE-UP',source_app:'morning-brief',...fields});
const seen=(root,at)=>runMorningBrief({root,provider:async()=>{throw Error('asked');},now:new Date(at)}).then(r=>r.text,e=>e.message);

test('a saved briefing without a day belongs to the installation\'s day, not the UTC day',async t=>{
 const {root,store}=workspace(t);
 save(store,{created_at:'2026-11-04T22:30:00Z'});
 assert.equal(await seen(root,'2026-11-04T22:50:00Z'),'MADE-UP','23:30 in Berlin is still 4 November');
 assert.equal(await seen(root,'2026-11-04T23:10:00Z'),'asked','5 November in Berlin has none');
 assert.equal(await seen(root,'2026-11-04T10:00:00Z'),'MADE-UP','same Berlin day, earlier');
 const late=workspace(t);
 save(late.store,{created_at:'2026-11-04T23:30:00Z'});
 assert.equal(await seen(late.root,'2026-11-04T12:00:00Z'),'asked','00:30 on 5 November is not 4 November');
 assert.equal(await seen(late.root,'2026-11-05T12:00:00Z'),'MADE-UP');
});

test('a briefing asked for before local midnight and committed after it stays that day\'s',async t=>{
 const {root}=workspace(t);
 const provider=async input=>verifies(input)||OK;
 const asked=new Date('2026-11-04T22:45:00Z');
 await runMorningBrief({root,provider,now:asked});
 const [note]=briefNotes(root);
 assert.equal(note.brief_day,'2026-11-04');
 // Its commit time lands after midnight in Berlin; the next day's request must still run its own.
 new Store(root).save('notes',{...note,created_at:'2026-11-04T23:30:00Z'});
 assert.equal(await seen(root,'2026-11-04T23:50:00Z'),'asked','5 November does not take 4 November\'s note');
 assert.equal((await runMorningBrief({root,provider:async()=>{throw Error('asked');},now:new Date('2026-11-04T22:55:00Z')})).text,note.content.trim());
});

for(const [name,fields] of [['hidden',{ai_visibility:'hidden'}],['sensitive',{is_sensitive:true}]])
 test(`a ${name} briefing of today is not given to the assistant, and no second one is written`,async t=>{
  const {root,store}=workspace(t);
  save(store,{content:'PRIVATE',brief_day:'2026-11-04',created_at:'2026-11-04T08:00:00Z',...fields});
  const r=await runMorningBrief({root,provider:async()=>{throw Error('the AI must not be asked');},now:new Date('2026-11-04T09:00:00Z')});
  assert.equal(r.text,'');assert.equal(briefNotes(root).length,1);
 });
