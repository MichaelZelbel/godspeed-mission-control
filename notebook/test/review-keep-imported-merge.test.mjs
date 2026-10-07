import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';

const fixture=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-review-merge-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const store=new Store(root),query=new QueryService(store),domains=new Domains(query);return {store,query,domains};};
const insert=(query,table,values)=>query.execute({table,operation:'insert',values}).data[0];
const keep=(domains,id)=>domains.invoke('review-queue-bulk',{action:'keep',scope:{ids:[id]}});

// Menerio's duplicate finder proposed merges ("These records will become
// one") and its relationship adjudicator left evidence to confirm. The
// import keeps both waiting. Their Keep button went to the server, which
// knew neither kind and answered "Unsupported review suggestion" (found
// 7 October 2026). Keep now carries out the merge, and confirms the evidence.
test('Keep on an imported duplicate-person suggestion merges the people',async t=>{
  const {store,query,domains}=fixture(t);
  const anna=insert(query,'contacts',{name:'Anna'}),twin=insert(query,'contacts',{name:'Anna'});
  const note=insert(query,'notes',{title:'Coffee',content:'With Anna',contact_id:twin.id});
  const item=store.save('review_queue',{suggestion_type:'merge_duplicate_person',status:'pending_review',payload:{name:'Anna',contact_ids:[anna.id,twin.id],keep_contact_id:anna.id}});
  const result=await keep(domains,item.id);
  assert.deepEqual(result.errors,[]);
  assert.deepEqual(query.rows('contacts').map(c=>c.id),[anna.id]);
  assert.equal(query.rows('notes').find(n=>n.id===note.id).contact_id,anna.id);
  const kept=store.get('review_queue',item.id);
  assert.equal(kept.status,'kept');
  assert.equal(kept.target_entity_id,anna.id);
  // A merge is final: Roll Back refuses rather than half-undoing it.
  assert.equal(kept.undo_supported,false);
});

test('Keep on an imported merge whose duplicate Menerio had already marked merged finishes it',async t=>{
  const {store,query,domains}=fixture(t);
  const anna=insert(query,'contacts',{name:'Anna'}),twin=insert(query,'contacts',{name:'Anna',merged_into:anna.id});
  const item=store.save('review_queue',{suggestion_type:'merge_duplicate_person',status:'pending',payload:{keep_contact_id:anna.id,merge_contact_ids:[twin.id]}});
  assert.deepEqual((await keep(domains,item.id)).errors,[]);
  const gone=store.get('contacts',twin.id);assert.ok(gone.removed_at);assert.equal(gone.merged_into,store.get('contacts',anna.id).uid);
  assert.equal(store.get('review_queue',item.id).status,'kept');
});

test('Keep on imported relationship evidence confirms it and changes nothing else',async t=>{
  const {store,query,domains}=fixture(t);
  const a=insert(query,'contacts',{name:'A'}),b=insert(query,'contacts',{name:'B'});
  const relationship=insert(query,'contact_relationships',{source_type:'contact',source_id:a.id,target_type:'contact',target_id:b.id,label:'sister'});
  const item=store.save('review_queue',{suggestion_type:'adjudicate_relationship',status:'pending_review',target_entity_type:'relationship',target_entity_id:relationship.id,payload:{evidence_quote:'my sister B',adjudication_reason:'stated directly'}});
  const before=store.get('contact_relationships',relationship.id)._hash;
  assert.deepEqual((await keep(domains,item.id)).errors,[]);
  assert.equal(store.get('review_queue',item.id).status,'kept');
  assert.equal(store.get('contact_relationships',relationship.id)._hash,before);
});
