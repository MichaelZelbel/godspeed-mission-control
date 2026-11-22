import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';
import {mcp} from '../server/mcp.mjs';

// Asking the assistant to delete a Timeline moment. A moments delete is kept
// as an event_corrections row whose reference is the moment itself, so the
// assistant guard's projected link check saw the moment already removed and
// refused every delete with "Choose a visible existing record".
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-assistant-moment-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store=new Store(root),query=new QueryService(store),domains=new Domains(query);
  const call=(name,args)=>mcp({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}},{store,query,domains}).then(r=>r.result);
  const moment=title=>store.save('moments',{title,happened_at:'2026-05-01',status:'past_fact'});
  return {store,query,call,moment};
}

const refusal='Choose a visible existing record';

test('the assistant deletes a visible moment, and nothing else',async t=>{
  const {store,query,call,moment}=fixture(t);
  const person=store.save('contacts',{name:'Jamie Rivers'});
  const gone=moment('Old trip'),kept=moment('Quiet week');
  query.execute({table:'moment_participants',operation:'insert',values:{moment_id:gone.id,person_id:person.id}});
  const participant=store.list('moment_participants')[0];
  const current=query.rows('moments').find(m=>m.id===gone.id);
  const result=await call('structural_change',{type:'moments',id:gone.id,action:'remove',expected_hash:current._hash});
  assert.ok(!result.isError,JSON.stringify(result));
  assert.equal(query.rows('moments').some(m=>m.id===gone.id),false,'the deleted moment is gone from the timeline');
  assert.ok(store.list('event_corrections').some(c=>c.moment_id===gone.id&&c.patch?.removed_at),'the delete is kept as a removal correction');
  assert.ok(store.get('moment_participants',participant.id),'the participant row stays');
  assert.equal(store.get('contacts',person.id).removed_at,undefined,'the person stays');
  assert.ok(query.rows('moments').some(m=>m.id===kept.id),'the other moment stays');
  // A moment already deleted is no longer there to delete.
  const again=await call('structural_change',{type:'moments',id:gone.id,action:'remove',expected_hash:current._hash});
  assert.equal(again.isError,true,JSON.stringify(again));
  assert.equal(again.content[0].text,refusal);
});

test('the assistant refuses to delete a moment that does not exist',async t=>{
  const {store,query,call,moment}=fixture(t);
  const kept=moment('Quiet week');
  const result=await call('structural_change',{type:'moments',id:'no-such-moment',action:'remove',expected_hash:'irrelevant'});
  assert.equal(result.isError,true,JSON.stringify(result));
  assert.equal(result.content[0].text,refusal);
  assert.equal(query.rows('moments').length,1,'nothing was removed');
  assert.ok(store.list('event_corrections').length===0,'no correction was written');
});

test('the assistant refuses a moment hidden from it',async t=>{
  const {store,query,call,moment}=fixture(t);
  const hidden=store.save('moments',{title:'Private trip',happened_at:'2026-05-01',status:'past_fact',ai_visibility:'hidden'});
  
  const result=await call('structural_change',{type:'moments',id:hidden.id,action:'remove',expected_hash:'irrelevant'});
  assert.equal(result.isError,true,JSON.stringify(result));
  assert.equal(result.content[0].text,refusal);
  assert.ok(query.rows('moments').some(m=>m.id===hidden.id),'the hidden moment stays');
});

test('save_record cannot delete a moment by writing the removal correction itself',async t=>{
  const {store,query,call,moment}=fixture(t);
  const gone=moment('Old trip');
  const result=await call('save_record',{type:'event_corrections',value:{moment_id:gone.id,patch:{removed_at:new Date().toISOString()}}});
  assert.equal(result.isError,true,JSON.stringify(result));
  assert.match(result.content[0].text,/structural_change/);
  assert.ok(query.rows('moments').some(m=>m.id===gone.id),'the moment stays');
  assert.equal(store.list('event_corrections').length,0,'no correction was written');
});

test('rolling back the suggestion that added a moment refuses once the moment is hidden from the assistant',async t=>{
  const {store,query,call,moment}=fixture(t);
  const added=moment('Suggested trip');
  const item=store.save('review_queue',{suggestion_type:'add_moment',status:'kept',origin:'ai',title:'Suggested trip',target_entity_id:added.id,applied_at:new Date().toISOString(),payload:{title:'Suggested trip',happened_at:'2026-05-01'}});
  query.execute({table:'moments',operation:'update',values:{id:added.id,ai_visibility:'hidden'},filters:[['eq','id',added.id]]});
  const result=await call('review_suggestions',{action:'rollback',ids:[item.id]});
  const answer=JSON.parse(result.content[0].text);
  assert.equal(answer.succeeded,0,JSON.stringify(answer));
  assert.match(answer.errors[0].error,/Choose a visible existing record/);
  assert.ok(query.rows('moments').some(m=>m.id===added.id),'the hidden moment stays');
  assert.equal(store.get('review_queue',item.id).status,'kept','the suggestion stays kept');
});

test('rolling back the suggestion that added a visible moment still removes it',async t=>{
  const {store,query,call,moment}=fixture(t);
  const added=moment('Suggested trip');
  const item=store.save('review_queue',{suggestion_type:'add_moment',status:'kept',origin:'ai',title:'Suggested trip',target_entity_id:added.id,applied_at:new Date().toISOString(),payload:{title:'Suggested trip',happened_at:'2026-05-01'}});
  const result=await call('review_suggestions',{action:'rollback',ids:[item.id]});
  const answer=JSON.parse(result.content[0].text);
  assert.equal(answer.succeeded,1,JSON.stringify(answer));
  assert.equal(query.rows('moments').some(m=>m.id===added.id),false,'the moment is gone from the timeline');
  assert.ok(store.list('event_corrections').some(c=>c.moment_id===added.id&&c.patch?.removed_at),'kept as a removal correction');
});

test('a version-stamped delete of a moment that is already gone refuses instead of succeeding',async t=>{
  // The screen stamps the pinned version onto its delete (record-writes.mjs).
  // When the moment was deleted elsewhere between fetch and click, the delete
  // matched nothing: an empty success said "Moment deleted" for a moment still
  // listed. Without a stamp (the journal's background cleanup) it stays
  // idempotent.
  const {store,query,moment}=fixture(t);
  const gone=moment('Old trip');
  const current=query.rows('moments').find(m=>m.id===gone.id);
  query.execute({table:'moments',operation:'delete',filters:[['eq','id',gone.id]]});
  assert.throws(()=>query.execute({table:'moments',operation:'delete',filters:[['eq','id',gone.id]],expected:{[gone.id]:current._hash}}),/already gone/);
  const other=moment('Quiet week');
  query.execute({table:'moments',operation:'delete',filters:[['eq','id','no-such-moment']]});
  assert.ok(query.rows('moments').some(m=>m.id===other.id),'the unstamped no-match delete stays a silent no-op');
});
