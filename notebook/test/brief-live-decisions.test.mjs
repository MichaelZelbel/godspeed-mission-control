import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {briefing} from '../core/briefing.mjs';

const now=new Date('2026-11-17T08:00:00Z');
const checked=input=>input.kind==='brief-verification'?{passed:true,reason:'Fixture checked the bounded sources.'}:null;

test('the briefing exposes only today\'s current decision and delivered pending unexpired steps',async()=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-brief-live-'))),query=new QueryService(store);
 store.save('settings',{id:'installation',timezone:'UTC'});
 store.save('decisions',{title:'Old seven-proposal approval list',state:'selected',created_at:'2026-11-16T08:00:00Z'});
 store.save('decisions',{title:'Cancelled proposal',state:'cancelled',created_at:'2026-11-17T06:00:00Z'});
 const current=store.save('decisions',{title:'Choose Alpha and Beta',state:'selected',proposals:['Alpha','Beta'],created_at:'2026-11-17T07:00:00Z'});
 const alpha=store.save('approvals',{title:'Alpha',status:'pending',asked_at:'2026-11-17T07:10:00Z'});
 const beta=store.save('approvals',{title:'Beta',status:'pending',asked_at:'2026-11-17T07:20:00Z'});
 store.save('approvals',{title:'Answered',status:'approved',asked_at:'2026-11-17T07:00:00Z'});
 store.save('approvals',{title:'Expired',status:'pending',expires_at:'2026-11-17T07:30:00Z'});
 store.save('approvals',{title:'Not delivered',status:'pending',asked_in:'telegram',asked_at:'2026-11-17T07:00:00Z'});
 fs.mkdirSync(path.join(store.root,'work'),{recursive:true});fs.writeFileSync(path.join(store.root,'work','old-approvals.md'),'Seven stale proposals');
 const provider=async input=>{const verdict=checked(input);if(verdict)return verdict;
  assert.equal(input.context.current_decision.id,current.id);assert.deepEqual(input.context.waiting_steps.map(step=>step.id),[alpha.id,beta.id]);
  assert.ok(!input.context.workspace_sources.files.some(file=>file.path.startsWith('work/')));assert.match(input.context.approval_contract,/only from current_decision and waiting_steps/);
  return 'No fresh health observations are available. Alpha and Beta are waiting for your decision.\n\nNext: choose Alpha or Beta.';
 };
 const result=await briefing({id:'brief-live'},{store,query,provider,now});
 const text=store.get('notes',result.record_id).content;assert.match(text,/Alpha and Beta/);assert.doesNotMatch(text,/seven|Answered|Expired/i);
});

test('a waiting step answered during verification invalidates the draft',async()=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-brief-step-stale-'))),query=new QueryService(store);store.save('settings',{id:'installation',timezone:'UTC'});
 const step=store.save('approvals',{title:'Alpha',status:'pending',asked_at:'2026-11-17T07:10:00Z'});let checks=0;
 const provider=async input=>{if(input.kind==='brief-verification'){if(++checks===2)store.save('approvals',{id:step.id,status:'approved',answered_at:'2026-11-17T08:01:00Z'});return {passed:true,reason:'Fixture checked.'};}return 'No fresh health observations are available. Alpha is waiting.\n\nNext: choose Alpha.';};
 await assert.rejects(briefing({id:'brief-step-stale'},{store,query,provider,now}),/sources changed/);
 assert.equal(store.list('notes').filter(note=>note.source_app==='morning-brief').length,0);
});
