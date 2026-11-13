import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createService} from '../server/main.mjs';
import {coachRoutineTimes} from '../core/starting-routines.mjs';

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

test('the tick routine reads "every minute" for a rhythm of 1 and "every N minutes" otherwise',()=>{
 const root=os.tmpdir(),tick=schedule=>coachRoutineTimes({title:'Coach reminders and habit check',schedule},root);
 assert.deepEqual(tick('*/1 * * * *'),{rhythm:'Checks every minute for a due reminder or habit question.'});
 assert.deepEqual(tick('*/5 * * * *'),{rhythm:'Checks every 5 minutes for a due reminder or habit question.'});
 assert.deepEqual(tick('*/15 * * * *'),{rhythm:'Checks every 15 minutes for a due reminder or habit question.'});
});
