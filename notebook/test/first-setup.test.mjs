import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createService} from '../server/main.mjs';
import {coachRoutineTimes} from '../core/starting-routines.mjs';
import {Store} from '../core/records/store.mjs';
import {setupResults} from '../core/jobs/scheduler.mjs';

// 13 November 2026 (#526): on a notebook without the original assistant, the first setup said
// "Invalid time value" for deadline-reminder, coaching, profiling and review. The setup asked
// the scheduler for its first run with options, and the scheduler read those options as the time.
test('the first setup gives each starting routine a real result, never "Invalid time value"',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-first-setup-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const service=await createService({root,device:'local',port:0});
 try{
  const reply=await fetch('http://127.0.0.1:'+service.address.port+'/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({goal:'Run a 10k by spring',timezone:'Europe/Berlin'})});
  assert.equal(reply.status,200);
  const {results}=await reply.json(),byId=Object.fromEntries(results.map(r=>[r.id,r]));
  assert.deepEqual(Object.keys(byId).sort(),['coaching','deadline-reminder','profiling','review']);
  for(const r of results)assert.doesNotMatch(String(r.error||''),/Invalid time value/,r.id);
  // The deadline reminder is due at once and runs; the other three are not due yet and say when they first run.
  assert.notEqual(byId['deadline-reminder'].state,'not run');assert.notEqual(byId['deadline-reminder'].state,'not due');
  for(const id of ['coaching','profiling','review']){
   assert.equal(byId[id].state,'not due',id);assert.match(byId[id].reason,/^Not due yet: it first runs on \d{4}-\d{2}-\d{2}\.$/,id);
   assert.equal(byId[id].next_run,service.store.get('jobs',id).next_run);
  }
  // The routines not due were not run early.
  for(const id of ['coaching','profiling','review'])assert.ok(Date.parse(service.store.get('jobs',id).next_run)>Date.now(),id);
 }finally{await service.close();}
});

test('a routine not due yet says the day it first runs on the person\'s own clock',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-first-setup-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const store=new Store(root,{device:'local'});
 store.save('settings',{id:'installation',owner:'local',timezone:'Europe/Berlin',delivery:'notebook'});
 store.save('jobs',{id:'review',kind:'review',owner:'local',paused:false,state:'pending',next_run:'2026-11-20T23:30:00.000Z',interval_ms:604800000});
 assert.deepEqual(setupResults(store,[]),[{id:'review',state:'not due',next_run:'2026-11-20T23:30:00.000Z',reason:'Not due yet: it first runs on 2026-11-21.'}]);
 // A result the run itself gave is kept as it is.
 assert.deepEqual(setupResults(store,[{id:'review',state:'verified'}]),[{id:'review',state:'verified'}]);
});

// 13 November 2026 (#537): a repeated setup said of a routine that had already run that it
// "first runs on" today. A routine that has run before says when it next runs.
test('a routine that has run before says when it next runs, not when it first runs',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-first-setup-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const store=new Store(root,{device:'local'});
 store.save('settings',{id:'installation',owner:'local',timezone:'Europe/Berlin',delivery:'notebook'});
 const job=(id,next_run,last_run)=>store.save('jobs',{id,kind:id,owner:'local',paused:false,state:'pending',next_run,...(last_run?{last_run}:{})});
 // Never run: the day it first runs.
 job('review','2026-11-20T10:00:00.000Z');
 // Ran before, next run later today in Berlin (14:00 UTC is 15:00 CET).
 job('deadline-reminder','2026-11-13T14:00:00.000Z','2026-11-12T14:00:00.000Z');
 // Ran before, next run at 23:30 UTC: still 13 November in UTC, but 00:30 on 14 November in Berlin.
 job('coaching','2026-11-13T23:30:00.000Z','2026-11-12T23:30:00.000Z');
 const now=Date.parse('2026-11-13T09:00:00.000Z');
 const byId=Object.fromEntries(setupResults(store,[],now).map(r=>[r.id,r.reason]));
 assert.deepEqual(byId,{
  review:'Not due yet: it first runs on 2026-11-20.',
  'deadline-reminder':'Not due yet: it next runs at 15:00.',
  coaching:'Not due yet: it next runs on 2026-11-14.'});
 // Paused stays paused.
 store.save('jobs',{id:'coaching',paused:true});
 assert.equal(setupResults(store,[],now).find(r=>r.id==='coaching').reason,'It is paused.');
});

test('a repeated setup says the deadline reminder that already ran next runs, never "first runs"',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-first-setup-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const service=await createService({root,device:'local',port:0});
 try{
  const setup=async()=>{const reply=await fetch('http://127.0.0.1:'+service.address.port+'/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({goal:'Run a 10k by spring',timezone:'Europe/Berlin'})});assert.equal(reply.status,200);return Object.fromEntries((await reply.json()).results.map(r=>[r.id,r]));};
  const first=await setup();assert.notEqual(first['deadline-reminder'].state,'not due');
  const again=await setup();
  assert.equal(again['deadline-reminder'].state,'not due');
  assert.match(again['deadline-reminder'].reason,/^Not due yet: it next runs (at \d{2}:\d{2}|on \d{4}-\d{2}-\d{2})\.$/);
  for(const r of Object.values(again))assert.doesNotMatch(String(r.reason||''),/Invalid time value/,r.id);
 }finally{await service.close();}
});

test('the tick routine reads "every minute" for a rhythm of 1 and "every N minutes" otherwise',()=>{
 const root=os.tmpdir(),tick=schedule=>coachRoutineTimes({title:'Coach reminders and habit check',schedule},root);
 assert.deepEqual(tick('*/1 * * * *'),{rhythm:'Checks every minute for a due reminder or habit question.'});
 assert.deepEqual(tick('*/5 * * * *'),{rhythm:'Checks every 5 minutes for a due reminder or habit question.'});
 assert.deepEqual(tick('*/15 * * * *'),{rhythm:'Checks every 15 minutes for a due reminder or habit question.'});
});
