import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {jobExecutor} from '../core/runtime.mjs';
import {Domains} from '../core/domains.mjs';
import {Scheduler} from '../core/jobs/scheduler.mjs';
const fixture=()=>{const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-follow-')));return {store,query:new QueryService(store)};};
test('a stopped read-only routine is repaired automatically once while an uncertain outward attempt stays paused',async()=>{
 const {store}=fixture();const at=new Date().toISOString();store.save('settings',{id:'installation',owner:store.device,timezone:'UTC'});
 for(const id of ['fictional-read','fictional-send']){store.save('jobs',{id,kind:id==='fictional-read'?'disk-check':'browser-post',owner:store.device,next_run:at,paused:false,state:'pending',interval_ms:60000,outward:id==='fictional-send'});store.save('job_receipts',{id:id+'-'+Date.parse(at),job_id:id,kind:id==='fictional-read'?'disk-check':'browser-post',state:'attempted',started_at:at});}
 let runs=0;const scheduler=new Scheduler(store,{executor:async()=>{runs++;return {verified:true,silent:true};}});
 await scheduler.tick();assert.equal(runs,1);assert.equal(store.get('jobs','fictional-send').paused,true);assert.equal(store.get('jobs','fictional-read').paused,false);
 const receipt=store.list('job_receipts').find(r=>r.job_id==='fictional-read');assert.equal(receipt.state,'verified');assert.equal(receipt.interruptions.length,1);
 assert.equal(store.list('work_items').filter(w=>w.kind==='repair'&&w.state==='verified').length,1);
 await scheduler.tick();assert.equal(runs,1);
});
test('scheduled coaching opens a lasting talk and uses previous reply and observations',async()=>{
 const {store,query}=fixture(),calls=[],run=jobExecutor(async i=>{calls.push(i);return 'How did your fictional screen break go?';},query);
 await run({kind:'coaching',id:'health-coach',area:'health'},{store,settings:{}});const talk=query.rows('coach_talks')[0];assert.ok(talk);assert.equal(talk.status,'open');
 const domains=new Domains(query);await domains.invoke('personal-operation',{type:'coach-reply',id:talk.id,content:'It helped me pause.'});await domains.invoke('personal-operation',{type:'coach-close',id:talk.id});
 // The original add-on opens one conversation per calendar day. Retain the
 // closed prior-day file before exercising the next scheduled conversation.
 const previousDay=new Date(Date.now()-86400000).toISOString().slice(0,10);
 const oldFile=path.join(store.root,talk.native_file);fs.renameSync(oldFile,path.join(path.dirname(oldFile),previousDay+'.md'));
 store.save('health_observations',{metric:'Fictional energy',value:7,observed_at:new Date().toISOString()});
 await run({kind:'coaching',id:'health-coach',area:'health'},{store,settings:{}});assert.ok(JSON.stringify(calls.at(-1)).includes('It helped me pause.'));assert.ok(JSON.stringify(calls.at(-1)).includes('Fictional energy'));
});
test('failed receipts produce one durable repair item and healthy repeated check stays quiet',async()=>{
 const {store,query}=fixture(),run=jobExecutor(null,query);store.save('job_receipts',{id:'fictional-failure',job_id:'fictional-job',kind:'goal-work',state:'failed',error:'Synthetic failed check'});
 await run({kind:'job-check',id:'check'},{store,settings:{}});await run({kind:'job-check',id:'check'},{store,settings:{}});assert.equal(store.list('work_items').filter(w=>w.kind==='repair').length,1);
 const clean=fixture();assert.equal((await jobExecutor(null,clean.query)({kind:'job-check',id:'check'},{store:clean.store,settings:{}})).silent,true);
});
