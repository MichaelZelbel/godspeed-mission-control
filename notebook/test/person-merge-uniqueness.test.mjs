import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';

const fixture=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-person-merge-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const store=new Store(root),query=new QueryService(store),domains=new Domains(query);return {store,query,domains};};
const insert=(query,table,values)=>query.execute({table,operation:'insert',values}).data[0];

// Two records of one person, both in the same group, both with a "Family"
// section, a setting for their home city and a current home city. Until
// 7 October 2026 the merge rewrote every link to the person it went into and
// kept them all: two memberships of one group, two Family sections, two
// settings for one fact and two current home cities.
test('merging two people keeps one membership, one section, one setting and one current value',async t=>{
  const {store,query,domains}=fixture(t);
  const anna=insert(query,'contacts',{name:'Anna'}),twin=insert(query,'contacts',{name:'Anna B.'});
  const group=insert(query,'contact_groups',{name:'Friends'});
  insert(query,'contact_group_memberships',{group_id:group.id,contact_id:anna.id,status:'close'});
  insert(query,'contact_group_memberships',{group_id:group.id,contact_id:twin.id,status:'new'});
  for(const person of [anna,twin]){
    insert(query,'profile_categories',{slug:'family',name:'Family',contact_id:person.id});
    insert(query,'fact_slots',{subject_type:'contact',subject_id:person.id,attribute:'home_city',label:'Home city',category_slug:'family',cardinality:'one'});
  }
  insert(query,'claims',{subject_type:'contact',subject_id:anna.id,attribute:'home_city',value:'Berlin',valid_from:'2020-01-01'});
  insert(query,'claims',{subject_type:'contact',subject_id:twin.id,attribute:'home_city',value:'Munich',valid_from:'2021-01-01'});
  // A waiting suggestion about the twin follows them to Anna.
  const waiting=store.save('review_queue',{suggestion_type:'add_profile_entry',status:'pending_review',payload:{contact_id:twin.id,label:'Hobby',value:'Chess'}});

  await domains.invoke('merge-contacts',{source_contact_id:twin.id,target_contact_id:anna.id});

  const memberships=query.rows('contact_group_memberships').filter(m=>m.group_id===group.id);
  assert.deepEqual(memberships.map(m=>[m.contact_id,m.status]),[[anna.id,'close']]);
  assert.equal(query.rows('profile_categories').filter(c=>c.contact_id===anna.id&&c.slug==='family').length,1);
  assert.equal(query.rows('fact_slots').filter(s=>s.subject_id===anna.id&&s.attribute==='home_city').length,1);
  const current=query.rows('profile_facts').filter(f=>f.subject_id===anna.id&&f.attribute==='home_city'&&f.is_current);
  assert.deepEqual(current.map(f=>f.value),['Berlin']);
  assert.equal(current[0].has_conflict,false);
  // The twin's value is kept as history, not lost.
  assert.ok(query.rows('claims').some(c=>c.subject_id===anna.id&&c.value==='Munich'&&c.valid_to));
  assert.equal(store.get('review_queue',waiting.id).payload.contact_id,anna.id);
  assert.deepEqual(store.validateReferences([...store.scan().values()]),[]);
});

// The record a person was merged into is the one to merge into; a tombstone
// cannot take anyone in, and a person cannot be merged twice.
test('a merge into a merged person, or of a merged person, is refused',async t=>{
  const {query,domains}=fixture(t);
  const a=insert(query,'contacts',{name:'A'}),b=insert(query,'contacts',{name:'B'}),c=insert(query,'contacts',{name:'C'});
  await domains.invoke('merge-contacts',{source_contact_id:b.id,target_contact_id:a.id});
  await assert.rejects(domains.invoke('merge-contacts',{source_contact_id:c.id,target_contact_id:b.id}),/merged/i);
  await assert.rejects(domains.invoke('merge-contacts',{source_contact_id:b.id,target_contact_id:c.id}),/merged/i);
  await assert.rejects(domains.invoke('merge-contacts',{source_contact_id:a.id,target_contact_id:a.id}),/merge/i);
  assert.ok(!query.rows('contacts').find(r=>r.id===c.id).merged_into);
});

// A waiting duplicate-person suggestion that this merge carried out is done.
test('a duplicate-person suggestion the merge carried out stops waiting',async t=>{
  const {store,query,domains}=fixture(t);
  const a=insert(query,'contacts',{name:'A'}),b=insert(query,'contacts',{name:'B'}),c=insert(query,'contacts',{name:'C'});
  const both=store.save('review_queue',{suggestion_type:'merge_duplicate_person',status:'pending_review',payload:{keep_contact_id:a.id,merge_contact_ids:[b.id]}});
  const three=store.save('review_queue',{suggestion_type:'merge_duplicate_person',status:'pending_review',payload:{keep_contact_id:b.id,merge_contact_ids:[a.id,c.id]}});
  await domains.invoke('merge-contacts',{source_contact_id:b.id,target_contact_id:a.id});
  assert.equal(store.get('review_queue',both.id).status,'kept');
  const rest=store.get('review_queue',three.id);
  assert.equal(rest.status,'pending_review');
  assert.deepEqual(rest.payload,{keep_contact_id:a.id,merge_contact_ids:[c.id]});
});
