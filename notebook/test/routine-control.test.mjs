import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createService} from '../server/main.mjs';
import {hash} from '../core/records/store.mjs';

async function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-routine-control-'));
 const service=await createService({root,port:0});
 t.after(async()=>{await service.close();fs.rmSync(root,{recursive:true,force:true});});
 service.scheduler.configure({goal:'Fictional rain notebook',timezone:'UTC'});
 for(const job of service.store.list('jobs'))service.store.save('jobs',{id:job.id,paused:true});
 const post=async(route,input)=>{const response=await fetch('http://127.0.0.1:'+service.address.port+'/api/jobs/'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});return {status:response.status,body:await response.json()};};
 return {...service,post};
}
for(const route of ['update','add'])test(route+' rearms a completed internal failure and keeps its receipt',async t=>{
 const s=await fixture(t),slot='2020-01-01T00:00:00.000Z',id='morning-brief';
 s.store.save('jobs',{id,kind:id,owner:'local',paused:true,state:'needs_review',next_run:slot,retry_count:3,interval_ms:60000,choices:{source:'fictional'}});
 const receipt=s.store.save('job_receipts',{id:id+'-'+Date.parse(slot),job_id:id,state:'failed',error:'Fictional local read failed',finished_at:slot});
 const response=await s.post(route,route==='update'?{id,paused:false}:{kind:id,interval_ms:60000});assert.equal(response.status,200);
 const resumed=s.store.get('jobs',id);assert.equal(resumed.state,'pending');assert.equal(resumed.retry_count,0);assert.notEqual(resumed.next_run,slot);assert.deepEqual(resumed.choices,{source:'fictional'});assert.equal(s.store.get('job_receipts',receipt.id).state,'failed');
 let calls=0;s.scheduler.executor=async()=>{calls++;return {verified:true,silent:true};};await s.scheduler.tick(Date.now()+100);assert.equal(calls,1);assert.equal(s.store.get('jobs',id).paused,false);
});
for(const route of ['update','add'])test(route+' preserves uncertain work and approval requirements',async t=>{
 const s=await fixture(t),id='watch',slot='2020-01-01T00:00:00.000Z';
 for(const setup of [{state:'attempted'},{state:'failed',outward:true},{state:'failed',delivery:'telegram'},{state:'failed',jobState:'awaiting_approval'}]){
 s.store.save('settings',{id:'installation',delivery:setup.delivery||'notebook'});
 s.store.save('jobs',{id,kind:id,owner:'local',paused:true,state:setup.jobState||'needs_review',outward:!!setup.outward,next_run:slot,retry_count:3,interval_ms:60000,payload:{message:'Fictional'},approval_id:'fictional'});
 s.store.save('job_receipts',{id:id+'-'+Date.parse(slot),job_id:id,state:setup.state,error:'Fictional failure'});
 const before=s.store.get('jobs',id);const response=await s.post(route,route==='update'?{id,paused:false}:{kind:id,interval_ms:60000});assert.equal(response.status,400);assert.deepEqual(s.store.get('jobs',id),before);
 }
});
test('pause and resume preserve a future outward slot, choices and exact approval',async t=>{
 const s=await fixture(t),id='watch',slot=new Date(Date.now()+86400000).toISOString(),payload={message:'Fictional rain reminder'};
 s.store.save('approvals',{id:'fictional',job_id:id,status:'approved',payload_hash:hash(payload)});
 s.store.save('jobs',{id,kind:id,owner:'local',paused:false,state:'pending',next_run:slot,interval_ms:60000,outward:true,payload,approval_id:'fictional',calendar:{time:'09:00'},choices:{source:'fictional'}});
 for(const paused of [true,false]){assert.equal((await s.post('update',{id,paused})).status,200);const job=s.store.get('jobs',id);assert.equal(job.next_run,slot);assert.equal(job.state,'pending');assert.equal(job.approval_id,'fictional');assert.deepEqual(job.payload,payload);assert.deepEqual(job.calendar,{time:'09:00'});}
});
test('routine controls reject authority edits and a foreign owner',async t=>{
 const s=await fixture(t);assert.equal((await s.post('update',{id:'coaching',paused:false,state:'pending',outward:false})).status,400);
 s.store.save('jobs',{id:'coaching',owner:'other'});assert.equal((await s.post('update',{id:'coaching',paused:false})).status,400);
});
test('Enable preserves future pending choices and waits for a writer before checking current state',async t=>{
 const s=await fixture(t),id='radar',slot=new Date(Date.now()+86400000).toISOString();
 s.store.save('jobs',{id,kind:id,owner:'local',paused:true,state:'pending',next_run:slot,retry_count:0,interval_ms:60000,discovery:false,calendar:{time:'08:00'},payload:{sources:['fictional']}});
 assert.equal((await s.post('add',{kind:id,interval_ms:120000})).status,200);
 let job=s.store.get('jobs',id);assert.equal(job.next_run,slot);assert.equal(job.discovery,false);assert.deepEqual(job.calendar,{time:'08:00'});assert.deepEqual(job.payload,{sources:['fictional']});
 const lock=path.join(s.store.state,'workspace.lock');fs.writeFileSync(lock,JSON.stringify({pid:process.pid}));
 const response=s.post('update',{id,paused:false});
 const timer=setTimeout(()=>{fs.unlinkSync(lock);s.store.save('jobs',{id,owner:'other'});},75);t.after(()=>clearTimeout(timer));
 assert.equal((await response).status,400);assert.equal(s.store.get('jobs',id).owner,'other');
});
test('an incomplete failed receipt cannot be rearmed as a completed internal failure',async t=>{
 const s=await fixture(t),id='watch',slot='2020-01-01T00:00:00.000Z';
 s.store.save('jobs',{id,kind:id,owner:'local',paused:true,state:'needs_review',next_run:slot,retry_count:3,interval_ms:60000});
 s.store.save('job_receipts',{id:id+'-'+Date.parse(slot),job_id:id,state:'failed',error:'Fictional interrupted failure'});
 const before=s.store.get('jobs',id);assert.equal((await s.post('update',{id,paused:false})).status,400);assert.deepEqual(s.store.get('jobs',id),before);
});
test('paired notebook controls retain VPS execution ownership and local scheduler stays silent',async t=>{
 const s=await fixture(t),id='watch',slot=new Date(Date.now()+86400000).toISOString();
 s.store.save('settings',{id:'installation',owner:'vps'});
 s.store.save('jobs',{id,kind:id,owner:'vps',paused:true,state:'pending',next_run:slot,interval_ms:60000,choices:{source:'fictional'}});
 assert.equal((await s.post('update',{id,paused:false})).status,200);
 const resumed=s.store.get('jobs',id);assert.equal(resumed.owner,'vps');assert.equal(resumed.next_run,slot);assert.deepEqual(resumed.choices,{source:'fictional'});
 assert.equal((await s.post('add',{kind:'health-summary',interval_ms:60000})).status,200);
 assert.equal(s.store.get('jobs','health-summary').owner,'vps');assert.equal(s.store.get('settings','installation').owner,'vps');
 let calls=0;s.scheduler.executor=async()=>{calls++;return {verified:true,silent:true};};assert.deepEqual(await s.scheduler.tick(Date.now()+86400001),[]);assert.equal(calls,0);assert.equal(s.store.list('job_receipts').length,0);
 s.store.save('jobs',{id,owner:'local'});assert.equal((await s.post('update',{id,paused:true})).status,400);assert.equal((await s.post('add',{kind:id,interval_ms:60000})).status,400);
});
