import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../core/records/store.mjs';
import { QueryService } from '../core/query.mjs';
import { Domains } from '../core/domains.mjs';
import { Scheduler } from '../core/jobs/scheduler.mjs';
import { jobExecutor } from '../core/runtime.mjs';
const setup=()=>{const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-domain-test-')));const query=new QueryService(store);return {store,query,domains:new Domains(query)};};
test('Menerio collection schemas and row data, favorites and filters survive restart',()=>{
  const {store,query}=setup();
  const collection=query.execute({table:'collections',operation:'insert',values:{name:'Habit log',field_schema:[{key:'done',type:'boolean'},{key:'date',type:'date'}]},single:true}).data;
  query.execute({table:'collection_items',operation:'insert',values:[{collection_id:collection.id,data:{done:true,date:'2026-10-02'},title:'Walk',is_favorite:true},{collection_id:collection.id,data:{done:false,date:'2026-10-03'},title:'Walk'}]});
  const restarted=new QueryService(new Store(store.root));
  assert.equal(restarted.rows('collections')[0].field_schema.length,2);
  assert.equal(restarted.execute({table:'collection_items',filters:[['eq','data->>done',true]],single:true}).data.is_favorite,true);
});
test('world reads source records, changed claims close history, profile facts preserve evidence',()=>{
  const {store,query,domains}=setup(),person=store.save('contacts',{name:'Alex'});
  domains.writeFact({contact_id:person.id,label:'Home city',value:'Town A',valid_from:'2026-01-01',evidence_quote:'I live in Town A'});
  domains.writeFact({contact_id:person.id,label:'Home city',value:'Town B',valid_from:'2026-09-01'});
  assert.equal(query.rows('world_entities')[0].id,person.id);
  const claims=query.rows('world_claims');assert.equal(claims.length,2);assert.equal(claims.find(c=>c.value==='Town A').valid_to,'2026-09-01');
  assert.equal(query.rows('profile_facts').filter(c=>c.is_current).length,1);
  assert.equal(query.rows('profile_facts').find(c=>c.value==='Town A').evidence_quote,'I live in Town A');
});
test('AI inference creates review entries and cannot silently replace confirmed facts',async()=>{
  const {store,query,domains}=setup();domains.writeFact({label:'Home city',value:'Town A'});
  const note=store.save('notes',{title:'Travel',content:'I moved to Town B.'});
  domains.provider=async()=>({suggestions:[{type:'add_claim',title:'Home city',payload:{label:'Home city',value:'Town B'},evidence_quote:'I moved to Town B.'}]});
  await domains.invoke('process-note',{note_id:note.id});await domains.invoke('process-note',{note_id:note.id});
  assert.equal(query.rows('review_queue').length,1);assert.equal(query.rows('claims').length,1);
  await domains.invoke('normalize-profile',{action:'accept_profile_entry',review_id:query.rows('review_queue')[0].id});
  assert.equal(query.rows('claims').length,2);assert.equal(query.rows('review_queue')[0].status,'kept');
});
test('onboarding produces saved useful work, repeated setup preserves choices, paired client does not run jobs',async()=>{
  const {store,query}=setup();let calls=0;
  const provider=async input=>{calls++;if(input.kind==='goal-decision')return JSON.stringify({action:'Prepare the conversation',kind:'draft',check:'Explain the shared goal and ask a question',reason:'Clarify the next step'});if(input.kind==='work-verification')return JSON.stringify({passed:true,evidence:'Draft explains the shared goal and asks what matters most'});return 'Conversation preparation: explain the shared goal, ask what matters most, and agree one concrete commitment.';};
  const owner=new Scheduler(store,{device:'local',executor:jobExecutor(provider,query)});
  owner.configure({goal:'Prepare a difficult conversation',timezone:'Europe/Berlin'});await owner.tick();
  assert.equal(calls,3);assert.ok(query.rows('notes').some(n=>n.content.includes('Conversation preparation')));
  owner.configure({goal:'Overwrite',timezone:'UTC'});assert.equal(query.rows('settings')[0].timezone,'Europe/Berlin');
  owner.transfer('vps');const client=new Scheduler(store,{device:'local',executor:jobExecutor(provider,query)});await client.tick(Date.now()+86400000);assert.equal(calls,3);
});
test('outward routine waits for permission and interrupted attempted receipt never replays',async()=>{
  const {store}=setup();let calls=0;const workCalls=[];const scheduler=new Scheduler(store,{executor:async job=>{calls++;workCalls.push(job.id);return {verified:true};}});
  scheduler.configure({goal:'Send a draft',timezone:'UTC'});
  store.save('jobs',{id:'send',kind:'delivery',owner:'local',outward:true,permission:'email.send',next_run:new Date(0).toISOString(),state:'pending'});
  await scheduler.tick();assert.equal(store.get('jobs','send').state,'awaiting_approval');
  const job=store.get('jobs','goal-work'),id=job.id+'-'+Date.parse(job.next_run);store.save('job_receipts',{id,state:'attempted'});
  const before=workCalls.filter(id=>id==='goal-work').length;await scheduler.tick(Date.parse(job.next_run)+1);assert.equal(store.get('jobs','goal-work').state,'needs_review');assert.equal(workCalls.filter(id=>id==='goal-work').length,before);
});
