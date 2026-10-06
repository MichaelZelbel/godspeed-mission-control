import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';

// One current value per single-valued fact, and the review queue's Keep and Roll
// Back (review of 6 October 2026).
const fixture=(t,provider=null)=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-domain-review-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const store=new Store(root),query=new QueryService(store),domains=new Domains(query,{provider});return {root,store,query,domains};};
const current=(query,attribute)=>query.rows('profile_facts').filter(f=>f.is_current&&f.attribute===attribute).map(f=>f.value).sort();

test('an undated imported value is current, so a new value replaces it',async t=>{
 const env=fixture(t);
 env.store.save('claims',{subject_type:'self',subject_id:null,attribute:'home_city',value:'Town A',valid_from:null,valid_to:null});
 env.domains.writeFact({label:'Home city',attribute:'home_city',value:'Town B'});assert.deepEqual(current(env.query,'home_city'),['Town B']);
 env.domains.writeFact({label:'Home city',attribute:'home_city',value:'Town A'});assert.deepEqual(current(env.query,'home_city'),['Town A']);
 assert.equal(env.query.rows('profile_facts').some(f=>f.has_conflict),false);
});

test('merging a person into yourself leaves one current answer and one setting per fact',async t=>{
 const env=fixture(t);
 env.domains.writeFact({label:'Home city',attribute:'home_city',value:'Town A'});
 const twin=env.store.save('contacts',{name:'Michael (old card)'});
 env.domains.writeFact({label:'Home city',attribute:'home_city',value:'Town Z',contact_id:twin.id});
 env.domains.writeFact({label:'Shoe size',attribute:'shoe_size',value:'44',contact_id:twin.id});
 await env.domains.invoke('merge-contacts',{merge_into_self:true,source_contact_id:twin.id});
 const self=env.query.rows('profile_facts').filter(f=>f.subject_type==='self');
 assert.deepEqual(self.filter(f=>f.is_current&&f.attribute==='home_city').map(f=>f.value),['Town A']);
 assert.ok(self.some(f=>!f.is_current&&f.value==='Town Z'),'the other card\'s value is kept as history');
 assert.deepEqual(self.filter(f=>f.is_current&&f.attribute==='shoe_size').map(f=>f.value),['44']);
 assert.equal(env.query.rows('fact_slots').filter(s=>s.subject_type==='self'&&s.attribute==='home_city').length,1);
 assert.equal(env.query.rows('fact_slots').filter(s=>s.subject_type==='self'&&s.attribute==='shoe_size').length,1);
});

test('Roll Back of an imported replacing fact brings back the value it replaced, or refuses',async t=>{
 const env=fixture(t),claim=v=>env.store.save('claims',{subject_type:'self',subject_id:null,attribute:'home_city',...v});
 claim({value:'Town A',valid_from:'2026-01-01',valid_to:'2026-10-01'});
 const b=claim({value:'Town B',valid_from:'2026-10-01',valid_to:null,origin:'ai_note'});
 const item=env.store.save('review_queue',{status:'kept',applied_at:'2026-10-01T10:00:00+00:00',suggestion_type:'add_profile_entry',target_entity_type:'claim',target_entity_id:b.id,payload:{label:'Home city',value:'Town B'},metadata:{menerio_source_table:'review_queue'}});
 const r=await env.domains.invoke('review-queue-bulk',{action:'rollback',ids:[item.id]});
 assert.deepEqual(r.errors,[]);assert.deepEqual(current(env.query,'home_city'),['Town A']);assert.equal(env.store.get('review_queue',item.id).status,'removed');
 // Two earlier values that both ended that day: which one it replaced cannot be told.
 const two=fixture(t),add=v=>two.store.save('claims',{subject_type:'self',subject_id:null,attribute:'home_city',...v});
 add({value:'Town A',valid_from:'2026-01-01',valid_to:'2026-10-01'});add({value:'Town C',valid_from:'2026-02-01',valid_to:'2026-10-01'});
 const d=add({value:'Town D',valid_from:'2026-10-01',valid_to:null});
 const kept=two.store.save('review_queue',{status:'kept',applied_at:'2026-10-01T10:00:00+00:00',suggestion_type:'add_profile_entry',target_entity_id:d.id,payload:{label:'Home city',value:'Town D'}});
 const refused=await two.domains.invoke('review-queue-bulk',{action:'rollback',ids:[kept.id]});
 assert.equal(refused.succeeded,0);assert.equal(refused.errors.length,1);assert.deepEqual(current(two.query,'home_city'),['Town D']);assert.equal(two.store.get('review_queue',kept.id).status,'kept');
});

test('Keep on the review queue finishes imported items and reuses people and memberships that exist',async t=>{
 const env=fixture(t);
 const c=env.store.save('claims',{subject_type:'self',subject_id:null,attribute:'gaming',value:'Level 55',valid_from:'2026-09-01'});
 const item=env.store.save('review_queue',{status:'auto_applied_unreviewed',applied_at:'2026-10-03 19:13:11.958+00',suggestion_type:'add_profile_entry',target_entity_id:c.id,payload:{label:'Gaming',value:'Level 55'}});
 const kept=await env.domains.invoke('review-queue-bulk',{action:'keep',scope:{ids:[item.id]}});
 assert.equal(kept.succeeded,1);assert.equal(env.store.get('review_queue',item.id).status,'kept');
 assert.equal(env.query.execute({table:'review_queue',filters:[['in','status',['pending','pending_review','auto_applied_unreviewed']]],options:{count:'exact',head:true}}).count,0);
 const anna=['n1','n2'].map(source_note_id=>env.store.save('review_queue',{suggestion_type:'add_contact',status:'pending_review',payload:{name:'Anna Example',source_note_id}}));
 const people=await env.domains.invoke('review-queue-bulk',{action:'keep',scope:{ids:anna.map(a=>a.id)}});
 assert.equal(people.succeeded,2);assert.equal(env.query.rows('contacts').filter(p=>p.name==='Anna Example').length,1);
 // Undoing the Keep that only linked to her, which created no one, leaves her.
 const linked=anna.map(a=>env.store.get('review_queue',a.id)).find(a=>!a.applied_targets.length);assert.ok(linked);assert.equal(linked.target_entity_id,env.query.rows('contacts').find(p=>p.name==='Anna Example').id);
 await env.domains.invoke('review-queue-bulk',{action:'rollback',scope:{ids:[linked.id]}});assert.equal(env.query.rows('contacts').filter(p=>p.name==='Anna Example').length,1);
 const g=env.query.execute({table:'contact_groups',operation:'insert',values:{name:'Dream 100',stages:[{id:'lead',label:'Lead'},{id:'won',label:'Won'}]}}).data[0];
 const ben=env.store.save('contacts',{name:'Ben'}),cleo=env.store.save('contacts',{name:'Cleo'});
 const suggest=person=>env.store.save('review_queue',{suggestion_type:'group_member_suggestion',status:'pending_review',payload:{group_id:g.id,contact_id:person.id}});
 const forBen=suggest(ben),forCleo=suggest(cleo);
 env.query.execute({table:'contact_group_memberships',operation:'insert',values:{group_id:g.id,contact_id:ben.id}});
 const groups=await env.domains.invoke('review-queue-bulk',{action:'keep',scope:{ids:[forBen.id,forCleo.id]}});assert.equal(groups.succeeded,2);
 const of=person=>env.query.rows('contact_group_memberships').filter(m=>m.group_id===g.id&&m.contact_id===person.id).map(m=>m.status);
 assert.deepEqual(of(ben),['new']);assert.deepEqual(of(cleo),['lead']);
});
