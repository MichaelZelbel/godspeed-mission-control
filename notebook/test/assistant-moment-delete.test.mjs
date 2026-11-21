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
