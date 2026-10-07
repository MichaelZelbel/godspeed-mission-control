import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';
import {visibleRows} from '../core/visibility.mjs';

const fixture=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-self-merge-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const store=new Store(root),query=new QueryService(store),domains=new Domains(query);return {store,query,domains};};
const insert=(query,table,values)=>query.execute({table,operation:'insert',values}).data[0];
const seen=(query,value)=>['claims','profile_facts','world_claims'].filter(type=>visibleRows(query,type).some(r=>r.value===value));

// A card of yourself (made before you were the owner, or by an import) holds
// a private Health section. Merging it into yourself moved its facts and
// settings to you but left the section on the card: the facts then sat in
// no private section of yours, and every assistant read them (7 October
// 2026). The whole private section comes with them.
test('merging a card into yourself keeps its private facts private',async t=>{
  const {query,domains}=fixture(t);
  const card=insert(query,'contacts',{name:'Me (old card)'});
  insert(query,'profile_categories',{slug:'health',name:'Health',contact_id:card.id,visibility_scope:'private'});
  insert(query,'fact_slots',{subject_type:'contact',subject_id:card.id,attribute:'diagnosis',label:'Diagnosis',category_slug:'health'});
  insert(query,'claims',{subject_type:'contact',subject_id:card.id,attribute:'diagnosis',value:'Migraine with aura'});
  insert(query,'fact_slots',{subject_type:'contact',subject_id:card.id,attribute:'favourite_food',label:'Favourite food'});
  insert(query,'claims',{subject_type:'contact',subject_id:card.id,attribute:'favourite_food',value:'Pasta'});
  assert.deepEqual(seen(query,'Migraine with aura'),[]);

  await domains.invoke('merge-contacts',{merge_into_self:true,source_contact_id:card.id});

  assert.ok(query.rows('profile_facts').some(f=>f.subject_type==='self'&&f.value==='Migraine with aura'),'the fact is yours now');
  assert.deepEqual(seen(query,'Migraine with aura'),[]);
  assert.deepEqual(seen(query,'Pasta'),['claims','profile_facts','world_claims']);
  const section=query.rows('profile_categories').filter(c=>c.slug==='health'&&!c.contact_id);
  assert.deepEqual(section.map(c=>c.visibility_scope),['private']);
});

// You have a Health section of your own that assistants may read, and a
// setting for the same fact: yours stay, and the card's private value still
// reaches no assistant.
test('a private fact merged under your own open section stays hidden',async t=>{
  const {query,domains}=fixture(t);
  insert(query,'profile_categories',{slug:'health',name:'Health',visibility_scope:'all'});
  insert(query,'fact_slots',{subject_type:'self',attribute:'allergy',label:'Allergy',category_slug:'health',cardinality:'many'});
  insert(query,'claims',{subject_type:'self',attribute:'allergy',value:'Pollen'});
  const card=insert(query,'contacts',{name:'Me (old card)'});
  insert(query,'profile_categories',{slug:'health',name:'Health',contact_id:card.id,visibility_scope:'private'});
  insert(query,'fact_slots',{subject_type:'contact',subject_id:card.id,attribute:'allergy',label:'Allergy',category_slug:'health',cardinality:'many'});
  insert(query,'claims',{subject_type:'contact',subject_id:card.id,attribute:'allergy',value:'Penicillin'});

  await domains.invoke('merge-contacts',{merge_into_self:true,source_contact_id:card.id});

  assert.deepEqual(seen(query,'Penicillin'),[]);
  assert.deepEqual(seen(query,'Pollen'),['claims','profile_facts','world_claims']);
  assert.equal(query.rows('profile_categories').filter(c=>c.slug==='health').length,1,'one Health section, yours');
});
