// "TODAY'S BRIEF" IN THE CHAT IS THE NOTEBOOK'S OWN BRIEFING (3 November 2026).
// scripts/morning-brief.mjs --today (the assistant's command mc-brief) shows today's saved
// "Your morning briefing" as it is and writes nothing; with none saved it runs the briefing once.
// The starter recipe sends the chat there, and keeps its own writing part only for a mission control
// without that command (the server job). Everything in here is made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Store,hash} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {runMorningBrief,briefToday,todaysBriefing} from '../scripts/morning-brief.mjs';

const OK='No fresh health observations are recorded. Review the fictional list today.';
const verifies=input=>input.kind==='brief-verification'?{passed:true,reason:'Fictional sources checked.'}:null;
const script=fileURLToPath(new URL('../scripts/morning-brief.mjs',import.meta.url));
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8').replaceAll('\r','');

function workspace(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-brief-chat-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true,maxRetries:5}));
 new Store(root).save('settings',{id:'installation',timezone:'Europe/Berlin'});
 return root;
}
const briefNotes=root=>new QueryService(new Store(root)).rows('notes').filter(n=>n.source_app==='morning-brief');
const snapshot=root=>{const out=[],walk=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=path.join(d,e.name);if(e.isDirectory())walk(f);else{const s=fs.statSync(f);out.push([path.relative(root,f),s.size,s.mtimeMs].join('|'));}}};walk(root);return out.sort();};
const noAI=()=>{throw Error('the AI must not be called');};

test('with today\'s briefing saved, asking prints it unchanged and writes nothing',async t=>{
 const root=workspace(t);
 const {text}=await runMorningBrief({root,provider:async i=>verifies(i)||OK});
 const before=snapshot(root);
 const asked=await briefToday({root,provider:noAI});
 assert.equal(asked.text,text);assert.equal(asked.saved,true);
 const run=execFileSync(process.execPath,[script,'--today','--godspeed',root],{encoding:'utf8',env:{...process.env,GODSPEED_WORKSPACE:''}});
 assert.equal(run,text+'\n');
 assert.deepEqual(snapshot(root),before,'nothing was written');
 assert.equal(briefNotes(root).length,1);
});

test('without one the run saves exactly one note, and asking again saves no second',async t=>{
 const root=workspace(t);let writes=0;
 const provider=async i=>verifies(i)||(writes++,OK);
 assert.equal(todaysBriefing({root}),null);
 const first=await briefToday({root,provider});
 assert.equal(first.saved,false);assert.equal(briefNotes(root).length,1);
 assert.equal(briefNotes(root)[0].content.trim(),first.text);
 const second=await briefToday({root,provider:noAI});
 assert.equal(second.text,first.text);assert.equal(briefNotes(root).length,1,'no second note');
 assert.equal(writes,1);
});

test('a briefing the notebook keeps silent stays silent, and yesterday\'s note is not today\'s',async t=>{
 const root=workspace(t),store=new Store(root);
 // The notebook already delivered these very words (its notification), so it keeps them silent.
 store.save('notifications',{id:'brief-'+hash(OK)});
 const silent=await briefToday({root,provider:async i=>verifies(i)||OK});
 assert.equal(silent.text,'');assert.equal(briefNotes(root).length,0,'nothing saved');
 // A note of another day does not count as today\'s.
 store.save('notes',{id:'old-briefing',title:'Your morning briefing',content:'Yesterday, made up.',source_app:'morning-brief',created_at:'2020-01-01T10:00:00Z'});
 assert.equal(todaysBriefing({root}),null);
});

test('wire-assistant writes mc-brief, which shows the saved briefing',{skip:process.platform==='win32'&&'sh form'},async t=>{
 const root=workspace(t),home=path.join(root,'.hermes-test');
 const {text}=await runMorningBrief({root,provider:async i=>verifies(i)||OK});
 fs.cpSync(new URL('../../starter-godspeed/',import.meta.url),root,{recursive:true,force:false});
 const wire=fileURLToPath(new URL('../scripts/wire-assistant.mjs',import.meta.url));
 execFileSync(process.execPath,[wire,home],{env:{...process.env,GODSPEED_WORKSPACE:root,GODSPEED_PORT:'41990',GODSPEED_DEVICE:'local'},windowsHide:true});
 const out=execFileSync('sh',[path.join(home,'bin','mc-brief')],{encoding:'utf8',env:{...process.env,GODSPEED_WORKSPACE:''}});
 assert.equal(out,text+'\n');
});

test('the recipe runs mc-brief where it exists and keeps the hand-written brief as the fallback',()=>{
 const recipe=read('../../starter-godspeed/skills/morning-brief/SKILL.md');
 const description=recipe.match(/^description: (.*)$/m)[1];
 assert.match(description,/`mc-brief`/);assert.match(description,/only as the fallback/);
 const fallback=recipe.indexOf('## Where there is no `mc-brief`');
 assert.ok(fallback>0&&recipe.indexOf('`mc-brief`')<fallback);
 const before=recipe.slice(recipe.indexOf('\n---\n',4),fallback);
 assert.doesNotMatch(before,/brief\/YYYY-MM-DD\.md/,'never hand-written where the command exists');
 assert.match(before,/never write a brief file into `brief\/` by hand/);
 const after=recipe.slice(fallback);
 for(const said of [/brief\/YYYY-MM-DD\.md/,/## What to write/,/`mc-check-brief`/,/## Your answer/])assert.match(after,said);
 for(const duty of [/mc-work stop --today/,/mc-work stop <id>/,/before\.txt/,/## Switching it on/])assert.match(recipe,duty);
 assert.doesNotMatch(recipe,/[–—]/);
});

test('the server\'s morning job still runs the recipe and expects brief/',()=>{
 const job=read('../../server/install-hermes.sh');
 assert.match(job,/Run the recipe in skills\/morning-brief\/SKILL\.md/);
 assert.match(job,/It writes today's brief into brief\//);
 assert.doesNotMatch(job,/mc-brief\b(?!-)/.source?new RegExp('mc-brief(?![-\\w])'):/x/,'the server has no mc-brief');
});
