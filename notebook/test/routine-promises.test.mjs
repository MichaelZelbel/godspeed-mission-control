import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {installStarter} from '../core/starter-workspace.mjs';import {writeRoutinePromise,promiseDue} from '../core/routine-promises.mjs';
import {STARTING_ROUTINES} from '../core/starting-routines.mjs';
const {parsePromise}=createRequire(import.meta.url)('../../tools/promises.js');

// Setup writes the promise of each routine it schedules into work/promises/, once, and never over a
// promise that is already there.
const temporary=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-routine-promises-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;};
const NOW=new Date('2026-11-10T14:00:00Z');
const brief={kind:'brief',name:'Morning brief',what:'Writes your morning brief: the one thing that needs you, what changed, your dates and what your watches found.',schedule:'30 6 * * *',timezone:'Europe/Berlin',now:NOW};
const folder=root=>path.join(root,'work','promises');

test('a fresh install has the promises folder and its README inside work/, not at the top',t=>{
 const root=temporary(t);installStarter(root);
 assert.ok(fs.statSync(path.join(folder(root),'README.md')).isFile());
 assert.equal(fs.existsSync(path.join(root,'promises')),false);
});

test('a routine\'s promise is written once, readable by the checker, in plain words',t=>{
 const root=temporary(t);installStarter(root);
 assert.equal(writeRoutinePromise(root,brief),'written');
 const file=path.join(folder(root),'routine-brief.md'),text=fs.readFileSync(file,'utf8');
 assert.deepEqual(parsePromise(text).errors,[]);
 const {fields}=parsePromise(text);
 assert.equal(fields.DUE,'daily 06:30 Europe/Berlin');assert.equal(fields.STARTED,'2026-11-11');assert.equal(fields.ROUTINE,'brief');
 assert.equal(fields.PROOF,'dates-in routines/ran/brief.txt');
 assert.equal(text.includes('—'),false);
 assert.equal(writeRoutinePromise(root,brief),'kept');assert.equal(fs.readFileSync(file,'utf8'),text);
});

test('a promise the person edited or renamed keeps every byte',t=>{
 const root=temporary(t);installStarter(root);
 const edited=path.join(folder(root),'routine-brief.md');fs.writeFileSync(edited,'my own words\n');
 assert.equal(writeRoutinePromise(root,brief),'kept');assert.equal(fs.readFileSync(edited,'utf8'),'my own words\n');
 fs.renameSync(edited,path.join(folder(root),'my-brief.md'));fs.writeFileSync(path.join(folder(root),'my-brief.md'),'PROMISE: mine\nROUTINE: brief\n');
 assert.equal(writeRoutinePromise(root,brief),'kept');
 assert.deepEqual(fs.readdirSync(folder(root)).sort(),['README.md','my-brief.md']);
 assert.equal(fs.readFileSync(path.join(folder(root),'my-brief.md'),'utf8'),'PROMISE: mine\nROUTINE: brief\n');
});

test('a mission control without the folder gets nothing, not even the folder',t=>{
 const root=temporary(t);
 assert.equal(writeRoutinePromise(root,brief),'no-folder');assert.equal(fs.existsSync(path.join(root,'work')),false);
});

test('every starting routine\'s schedule is a promise the checker can read, and the odd ones are refused',t=>{
 const root=temporary(t);installStarter(root);
 for(const routine of STARTING_ROUTINES){
  assert.notEqual(promiseDue(routine.schedule),null,routine.schedule);
  assert.equal(writeRoutinePromise(root,{kind:routine.key,name:routine.name,what:routine.what,schedule:routine.schedule,timezone:'UTC',now:NOW}),'written',routine.key);
  assert.deepEqual(parsePromise(fs.readFileSync(path.join(folder(root),'routine-'+routine.key+'.md'),'utf8')).errors,[],routine.key);
 }
 assert.deepEqual(promiseDue('*/15 * * * *'),{cadence:'daily',when:'daily',time:'00:00'});
 assert.deepEqual(promiseDue('0 18 * * 0'),{cadence:'weekly',when:'sunday',time:'18:00'});
 assert.deepEqual(promiseDue('0 9 1 * *'),{cadence:'monthly',when:'1',time:'09:00'});
 for(const odd of ['0 8 * * 1-5','1440m','0 9 30 * *'])assert.equal(promiseDue(odd),null,odd);
 assert.equal(writeRoutinePromise(root,{...brief,kind:'weekdays',schedule:'0 8 * * 1-5'}),'unsupported');
});

// THE ROUTINES THE SCHEDULER'S TICK MAKES (#436): the daily connection check, the notice sender, the
// journal's check-ins, the mail counts and the workouts import get their promise the moment the tick
// makes them, under the same rule as the starting routines.
const {NativeScheduler}=await import('../core/native-scheduler.mjs');const {Store}=await import('../core/records/store.mjs');
const {writeMachineRecord}=await import('../core/starting-routines.mjs');const {QueryService}=await import('../core/query.mjs');const {jobExecutor}=await import('../core/runtime.mjs');
const {execFileSync}=await import('node:child_process');
// A Hermes stand-in that keeps its jobs as Hermes does (cron/jobs.json); every other command succeeds.
function standIn(home,jobs=[]){
 let serial=0;const file=path.join(home,'cron','jobs.json'),read=()=>fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')).jobs:[],write=list=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify({jobs:list}));};
 write(jobs);const creates=[];
 const run=async(exe,args)=>{
  const [,verb,...rest]=args,flag=name=>rest[rest.indexOf(name)+1];
  if(verb==='create'){creates.push(flag('--name'));write([...read(),{id:'job'+(++serial),name:flag('--name'),schedule:{kind:'cron',expr:rest[0]},schedule_display:rest[0],script:flag('--script'),deliver:flag('--deliver'),workdir:flag('--workdir'),enabled:true}]);}
  if(verb==='pause')write(read().map(j=>j.id===rest[0]?{...j,enabled:false}:j));
  if(verb==='remove')write(read().filter(j=>j.id!==rest[0]));
  return {stdout:''};
 };
 return {run,jobs:read,write,creates};
}
// A mission control made from the starter whose starting routines are made, with one of them running,
// so the connection check is wanted.
function ticked(t,{now=Date.now}={}){
 const root=temporary(t),home=path.join(root,'.hermes-home');installStarter(root);fs.mkdirSync(home,{recursive:true});
 const store=new Store(root,{device:'pc'});store.save('settings',{id:'installation',owner:'pc',timezone:'Europe/Berlin',delivery:'notebook'});
 writeMachineRecord(store,{state:'created',device:'pc',created_at:new Date().toISOString(),timezone:'Europe/Berlin',delivery:'local',jobs:[]});
 const hermes=standIn(home,[{id:'theirs',name:'Deadline reminders',schedule:{kind:'cron',expr:'0 8 * * *'},script:'godspeed-deadline-reminders.py',enabled:true}]);
 return {root,home,store,hermes,scheduler:new NativeScheduler(store,{home,executable:'hermes',device:'pc',run:hermes.run,now})};
}
const CHECK='routine-connection-check.md';
const forgetCheck=({store,hermes})=>{hermes.write(hermes.jobs().filter(j=>j.name!=='Daily connection check'));const file=path.join(store.state,'notebook-routines.json');if(fs.existsSync(file)){const all=JSON.parse(fs.readFileSync(file,'utf8'));fs.writeFileSync(file,JSON.stringify({...all,jobs:all.jobs.filter(j=>j.key!=='connection-check')}));}};

test('the daily connection check the tick makes gets its promise, once, readable by the checker',async t=>{
 const made=ticked(t),{root,scheduler,hermes}=made;
 await scheduler.followConnectionCheck();
 assert.deepEqual(hermes.creates,['Daily connection check']);
 const text=fs.readFileSync(path.join(folder(root),CHECK),'utf8'),{fields,errors}=parsePromise(text);
 assert.deepEqual(errors,[]);
 assert.equal(fields.PROMISE,'routine-connection-check');assert.equal(fields.ROUTINE,'connection-check');
 assert.equal(fields.DUE,'daily 05:00 Europe/Berlin');assert.equal(fields.PROOF,'dates-in routines/ran/connection-check.txt');
 assert.match(text,/^# Daily connection check$/m);assert.match(fields['WHAT YOU GET'],/^Early every morning, before your morning brief, it checks each connection you set up/);
 // A tick that finds it there writes nothing new and changes nothing.
 const before=fs.readdirSync(folder(root)).map(n=>[n,fs.readFileSync(path.join(folder(root),n),'utf8')]);
 await scheduler.followConnectionCheck();
 assert.deepEqual(hermes.creates,['Daily connection check']);
 assert.deepEqual(fs.readdirSync(folder(root)).map(n=>[n,fs.readFileSync(path.join(folder(root),n),'utf8')]),before);
});

test('a connection check made paused, wanted by nothing, promises nothing',async t=>{
 const {root,scheduler,hermes}=ticked(t);hermes.write([]);
 await scheduler.followConnectionCheck();
 assert.equal(hermes.jobs()[0].enabled,false);assert.equal(fs.existsSync(path.join(folder(root),CHECK)),false);
});

test('a connection-check promise the person edited keeps every byte when the tick makes the routine again',async t=>{
 const made=ticked(t),{root,scheduler,hermes}=made;
 await scheduler.followConnectionCheck();
 fs.writeFileSync(path.join(folder(root),CHECK),'my own words\n');forgetCheck(made);
 await scheduler.followConnectionCheck();
 assert.deepEqual(hermes.creates,['Daily connection check','Daily connection check']);
 assert.equal(fs.readFileSync(path.join(folder(root),CHECK),'utf8'),'my own words\n');
});

test('without the promises folder the tick makes the connection check and no folder',async t=>{
 const {root,scheduler,hermes}=ticked(t);fs.rmSync(path.join(root,'work','promises'),{recursive:true});
 await scheduler.followConnectionCheck();
 assert.deepEqual(hermes.creates,['Daily connection check']);assert.equal(fs.existsSync(path.join(root,'work','promises')),false);
});

test('a promise that cannot be written never stops the tick making the connection check',{skip:process.platform==='win32'||process.getuid?.()===0},async t=>{
 const {root,scheduler,hermes,store}=ticked(t);fs.chmodSync(folder(root),0o500);
 try{assert.equal(await scheduler.followConnectionCheck(),hermes.jobs().find(j=>j.name==='Daily connection check').id);}finally{fs.chmodSync(folder(root),0o700);}
 assert.equal(fs.existsSync(path.join(folder(root),CHECK)),false);
 assert.ok(JSON.parse(fs.readFileSync(path.join(store.state,'notebook-routines.json'),'utf8')).jobs.some(j=>j.key==='connection-check'));
});

test('the notice sender the tick makes on a mission control not made from the starter gets its promise',async t=>{
 const root=temporary(t),home=path.join(root,'.hermes-home');fs.mkdirSync(folder(root),{recursive:true});fs.mkdirSync(home,{recursive:true});
 const store=new Store(root,{device:'pc'});store.save('settings',{id:'installation',owner:'pc',timezone:'UTC',delivery:'notebook'});
 const hermes=standIn(home),scheduler=new NativeScheduler(store,{home,executable:'hermes',device:'pc',run:hermes.run});
 await scheduler.followNoticeSenderNow();
 assert.deepEqual(hermes.creates,['Godspeed notices']);
 const {fields,errors}=parsePromise(fs.readFileSync(path.join(folder(root),'routine-notices.md'),'utf8'));
 assert.deepEqual(errors,[]);assert.equal(fields.ROUTINE,'notices');assert.equal(fields.DUE,'daily 00:00 UTC');
 await scheduler.followNoticeSenderNow();assert.deepEqual(hermes.creates,['Godspeed notices']);
});

test('the hourly workouts import promises a run each day',()=>{
 assert.deepEqual(promiseDue('17 * * * *'),{cadence:'daily',when:'daily',time:'00:00'});
 assert.equal(promiseDue('60 * * * *'),null);
});

test('a connection check that stopped running is told as missed by mc-due today and at the top of the morning brief',async t=>{
 const {root,store,scheduler}=ticked(t,{now:()=>Date.parse('2026-11-01T12:00:00Z')});
 await scheduler.followConnectionCheck();
 fs.mkdirSync(path.join(root,'routines','ran'),{recursive:true});fs.writeFileSync(path.join(root,'routines','ran','connection-check.txt'),'2026-11-05\n');
 const due=execFileSync(process.execPath,[fileURLToPath(new URL('../../tools/due.js',import.meta.url)),'today','--godspeed',root],{encoding:'utf8',env:{...process.env,GODSPEED_ROOT:root}});
 assert.match(due.split('\n')[0],/^A promise was not kept: Early every morning, before your morning brief, it checks each connection you set up .*\. Last kept 2026-11-05\.$/);
 const OK='No fresh health observations are recorded. Your day is open.',query=new QueryService(store);
 const provider=async input=>input.kind==='brief-verification'?{passed:true,reason:'Fictional sources checked.'}:OK;
 const result=await jobExecutor(provider,query)({kind:'morning-brief',id:'brief-missed-check'},{store,settings:{}});
 const content=store.get('notes',result.record_id).content;
 assert.match(content.split('\n')[0],/^A promise was not kept: .*Last kept 2026-11-05\.$/);assert.ok(content.endsWith(OK));
});
