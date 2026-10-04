import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';
import {mcp} from '../server/mcp.mjs';
import {runReviewOperation,reviewJobCounts} from '../ui/src/lib/review-operation.mjs';
const fixture=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-final-core-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const store=new Store(root),query=new QueryService(store),domains=new Domains(query);return {store,query,domains};};
const call=(env,name,args)=>mcp({id:1,method:'tools/call',params:{name,arguments:args}},env);
const review=(store,value='Town B')=>store.save('review_queue',{suggestion_type:'add_profile_entry',status:'pending_review',payload:{label:'Home city',attribute:'home_city',value}});

test('collection chat preserves a concurrent edit and keeps full oversized data out of prompt copies',async t=>{
 const env=fixture(t),collection=env.store.save('collections',{name:'Items',field_schema:[{key:'name',label:'Name',type:'text',primary:true},{key:'status',label:'Status',type:'text'},{key:'detail',label:'Detail',type:'longtext'}]});
 const row=env.store.save('collection_items',{collection_id:collection.id,data:{name:'Item',status:'old',detail:'x'.repeat(9000)}});
 env.domains.provider=async input=>{assert.ok(JSON.stringify(input.context.items).length<2000);env.store.save('collection_items',{id:row.id,data:{name:'Item',status:'newer human edit',detail:'x'.repeat(9000)}});return {reply:'Changed',item_updates:[{id:row.id,data:{name:'Renamed'}}]};};
 await assert.rejects(env.domains.invoke('collection-chat',{collection_id:collection.id,message:'Change Item name to Renamed'}),/changed/);
 assert.equal(env.store.get('collection_items',row.id).data.status,'newer human edit');
 env.domains.provider=async()=>({reply:'Changed',item_updates:[{id:row.id,data:{name:'Renamed'}}]});
 await env.domains.invoke('collection-chat',{collection_id:collection.id,message:'Change Item name to Renamed'});
 assert.deepEqual(env.store.get('collection_items',row.id).data,{name:'Renamed',status:'newer human edit',detail:'x'.repeat(9000)});
});

test('a collection update never persists compacted JSON data',async t=>{
 const env=fixture(t),collection=env.store.save('collections',{name:'Rows',field_schema:[{key:'name',type:'text',label:'Name',primary:true},{key:'detail',type:'longtext',label:'Detail'}]}),row=env.store.save('collection_items',{collection_id:collection.id,data:{name:'Item',detail:'x'.repeat(9000)}});
 env.domains.provider=async input=>{assert.equal(input.context.items[0].context_truncated,true);return {reply:'Changed',item_updates:[{id:row.id,data:{name:'Renamed'}}]};};
 await env.domains.invoke('collection-chat',{collection_id:collection.id,message:'Change Item name to Renamed'});assert.deepEqual(env.store.get('collection_items',row.id).data,{name:'Renamed',detail:'x'.repeat(9000)});
});

test('generic MCP save refuses hidden records, omitted hashes and hidden owning people/collections',async t=>{
 const env=fixture(t),note=env.store.save('notes',{title:'Private title',content:'Fictional private content'});
 let answer=await call({...env,scopes:['notes']},'save_record',{type:'notes',value:{id:note.id,title:'Wrong'}});assert.equal(answer.result.isError,true);assert.equal(env.store.get('notes',note.id).title,'Private title');
 env.store.save('notes',{id:note.id,ai_visibility:'hidden'});
 for(const value of [{id:note.id},{id:note.id,ai_visibility:'visible'}]){answer=await call({...env,scopes:['notes']},'save_record',{type:'notes',value,expected_hash:env.store.get('notes',note.id)._hash});assert.equal(answer.result.isError,true);assert.ok(!JSON.stringify(answer).includes('Fictional private content'));}
 const person=env.store.save('contacts',{name:'Person',ai_visibility:'hidden'}),linked=env.store.save('notes',{title:'Owned',contact_id:person.id});
 answer=await call(env,'save_record',{type:'notes',value:{id:linked.id,contact_id:null},expected_hash:linked._hash});assert.equal(answer.result.isError,true);
 const collection=env.store.save('collections',{name:'Hidden collection',ai_visibility:'hidden'}),item=env.store.save('collection_items',{collection_id:collection.id,data:{name:'Row'}});
 answer=await call(env,'save_record',{type:'collection_items',value:{id:item.id,data:{}},expected_hash:item._hash});assert.equal(answer.result.isError,true);
 // The authenticated owner still has correction rights.
 env.query.execute({table:'notes',operation:'update',values:{content:'Owner correction'},filters:[['eq','id',note.id]],expected:{[note.id]:env.store.get('notes',note.id)._hash}});assert.equal(env.store.get('notes',note.id).content,'Owner correction');
});

test('assistant linked writes and structural operations check every affected record before writing',async t=>{
 const env=fixture(t),hidden=env.store.save('notes',{title:'Hidden',ai_visibility:'hidden'}),collection=env.store.save('collections',{name:'Links',field_schema:[{key:'note',type:'link_note',label:'Note'}]});
 let answer=await call(env,'save_record',{type:'collection_items',value:{collection_id:collection.id,data:{note:hidden.id}}});assert.equal(answer.result.isError,true);assert.equal(env.store.list('collection_items').length,0);
 const source=env.store.save('contacts',{name:'Source'}),target=env.store.save('contacts',{name:'Target',ai_visibility:'hidden'});
 answer=await call(env,'structural_change',{type:'contacts',id:source.id,action:'merge',expected_hash:source._hash,options:{target_id:target.id,expected_hash:target._hash}});assert.equal(answer.result.isError,true);assert.equal(env.store.get('contacts',source.id).removed_at,undefined);
 env.query.execute({table:'notes',operation:'update',values:{references:[{type:'contacts',id:source.id,uid:source.uid,field:'metadata.person_id'}],metadata:{person_id:source.id}},filters:[['eq','id',hidden.id]]});
 answer=await call(env,'structural_change',{type:'contacts',id:source.id,action:'rename',expected_hash:source._hash,options:{id:'renamed-person'}});assert.equal(answer.result.isError,true);assert.equal(env.store.get('contacts',source.id).id,source.id);
});

test('individual Keep and bulk Undo restore prior current facts and complete slot settings',async t=>{
 const env=fixture(t);env.domains.writeFact({label:'Home city',attribute:'home_city',value:'Town A',is_pinned:true});const beforeSlot=env.query.rows('fact_slots')[0],item=review(env.store);
 const kept=await env.domains.invoke('normalize-profile',{action:'accept_profile_entry',review_id:item.id});assert.equal(kept.ok,true);assert.equal(env.query.rows('profile_facts').find(r=>r.is_current).value,'Town B');
 const undo=await env.domains.invoke('review-queue-bulk',{action:'rollback',scope:{ids:[item.id]}});assert.equal(undo.succeeded,1);assert.deepEqual(env.query.rows('profile_facts').filter(r=>r.is_current).map(r=>r.value),['Town A']);assert.equal(env.query.rows('fact_slots')[0].is_pinned,beforeSlot.is_pinned);assert.equal(env.query.rows('claims')[0].closure_evidence,undefined);
});

test('Undo validates all targets before mutation and refuses legacy receipts honestly',async t=>{
 const env=fixture(t);env.domains.writeFact({label:'Home city',value:'Town A'});const item=review(env.store);await env.domains.invoke('review-queue-bulk',{action:'keep',ids:[item.id]});
 const targets=env.store.get('review_queue',item.id).applied_targets;assert.ok(targets.length>=3);const late=targets.at(-1);env.store.save(late.type,{id:late.id,label:'Later edit',value:late.type==='claims'?'Town C':undefined});
 const hashes=targets.map(x=>env.store.get(x.type,x.id)._hash),undo=await env.domains.invoke('review-queue-bulk',{action:'rollback',ids:[item.id]});assert.equal(undo.succeeded,0);assert.equal(undo.errors.length,1);assert.deepEqual(targets.map(x=>env.store.get(x.type,x.id)._hash),hashes);assert.equal(env.store.get('review_queue',item.id).status,'kept');
 const legacy=env.store.save('review_queue',{suggestion_type:'add_profile_entry',status:'kept',applied_at:new Date().toISOString(),payload:{value:'Legacy'}}),result=await env.domains.invoke('review-queue-bulk',{action:'rollback',ids:[legacy.id]});assert.equal(result.succeeded,0);assert.match(result.errors[0].error,/receipt|evidence/);assert.equal(env.store.get('review_queue',legacy.id).status,'kept');
});

test('visible Never Again payload persists suppression and job counts match actual results',async t=>{
 const env=fixture(t),item=review(env.store,'Wrong town'),result=await env.domains.invoke('review-queue-bulk',{action:'never_again',scope:{ids:[item.id]}});assert.equal(result.succeeded,1);const job=env.store.get('review_queue_bulk_jobs',result.job_id);assert.equal(job.processed,1);assert.equal(job.succeeded,1);assert.equal(env.domains.writeFact(item.payload).facts[0].outcome,'suppressed');
});

test('actual UI request adapter uses the same Keep, individual Undo, Never Again and displayed count contract',async t=>{
 const env=fixture(t),payloads=[],client={functions:{invoke:async(name,{body})=>{assert.equal(name,'review-queue-bulk');payloads.push(body);return {data:await env.domains.invoke(name,body),error:null};}}};
 env.domains.writeFact({label:'Home city',value:'Town A'});const item=review(env.store),kept=await runReviewOperation(client,'keep');assert.equal(reviewJobCounts(env.store.get('review_queue_bulk_jobs',kept.job_id)).succeeded,1);const saved=env.store.get('review_queue',item.id);assert.equal(saved.target_entity_type,'claim');assert.equal(env.store.get('claims',saved.target_entity_id).value,'Town B');
 await runReviewOperation(client,'rollback',[item.id]);assert.deepEqual(env.query.rows('profile_facts').filter(r=>r.is_current).map(r=>r.value),['Town A']);
 const rejected=review(env.store,'Wrong town');await runReviewOperation(client,'never_again',[rejected.id]);assert.equal(env.domains.writeFact(rejected.payload).facts[0].outcome,'suppressed');assert.deepEqual(payloads,[{action:'keep',scope:'all'},{action:'rollback',scope:{ids:[item.id]}},{action:'never_again',scope:{ids:[rejected.id]}}]);
 const legacy=env.store.save('review_queue',{status:'kept',applied_at:'2026-10-04T00:00:00Z',suggestion_type:'add_profile_entry'});await assert.rejects(runReviewOperation(client,'rollback',[legacy.id]),/receipt/);
});

test('existing assistant updates succeed only with the current hash and linked structural hashes',async t=>{
 const env=fixture(t),note=env.store.save('notes',{title:'Original',content:'Keep'});let result=await call(env,'save_record',{type:'notes',value:{id:note.id,title:'Changed'},expected_hash:env.store.get('notes',note.id)._hash});assert.equal(result.result.isError,undefined);assert.equal(env.store.get('notes',note.id).content,'Keep');
 const person=env.store.save('contacts',{name:'Source'}),linked=env.query.execute({table:'notes',operation:'insert',values:{title:'Linked',contact_id:person.id}}).data[0],expected={[`notes/${linked.id}`]:env.store.get('notes',linked.id)._hash};
 result=await call(env,'structural_change',{type:'contacts',id:person.id,action:'rename',expected_hash:env.store.get('contacts',person.id)._hash,expected,options:{id:'renamed-person'}});assert.equal(result.result.isError,undefined,result.result.content[0].text);assert.equal(env.store.get('notes',linked.id).contact_id,'renamed-person');
});

test('an event review Undo remains append-only and refuses a later correction without partial participant removal',async t=>{
 const env=fixture(t),person=env.store.save('contacts',{name:'Fictional guest'}),item=env.store.save('review_queue',{suggestion_type:'add_moment',payload:{title:'Fictional meeting',happened_at:'2026-10-04',participants:[{contact_id:person.id}]}});
 const kept=await env.domains.invoke('review-queue-bulk',{action:'keep',ids:[item.id]});assert.equal(kept.succeeded,1,JSON.stringify(kept.errors));const saved=env.store.get('review_queue',item.id),moment=env.store.get('moments',saved.target_entity_id),bytes=fs.readFileSync(env.store.file(moment),'utf8');
 const undo=await env.domains.invoke('review-queue-bulk',{action:'rollback',ids:[item.id]});assert.equal(undo.succeeded,1);assert.equal(fs.readFileSync(env.store.file(moment),'utf8'),bytes);assert.equal(env.query.rows('moments').length,0);assert.equal(env.query.rows('moment_participants').length,0);
 const second=env.store.save('review_queue',{suggestion_type:'add_moment',payload:{title:'Another meeting',happened_at:'2026-10-04',participants:[{contact_id:person.id}]}});await env.domains.invoke('review-queue-bulk',{action:'keep',ids:[second.id]});const secondMoment=env.store.get('review_queue',second.id).target_entity_id;
 env.query.execute({table:'moments',operation:'update',values:{title:'Owner correction'},filters:[['eq','id',secondMoment]]});const refusal=await env.domains.invoke('review-queue-bulk',{action:'rollback',ids:[second.id]});assert.equal(refusal.succeeded,0);assert.equal(env.query.rows('moment_participants').length,1);assert.equal(env.query.rows('moments')[0].title,'Owner correction');
});
