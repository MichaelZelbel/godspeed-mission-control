import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';
const fixture=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-imported-undo-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const store=new Store(root),query=new QueryService(store),domains=new Domains(query);return {store,query,domains};};
const current=env=>env.query.rows('profile_facts').filter(r=>r.is_current).map(r=>r.attribute+': '+r.value).sort();
// Shaped like the Menerio import: applied there, so no Godspeed undo receipt.
const imported=(store,value)=>store.save('review_queue',{status:'auto_applied_unreviewed',applied_at:'2026-10-03 19:13:11.958+00',metadata:{menerio_source_table:'review_queue'},...value});
const claim=(store,attribute,value,extra={})=>store.save('claims',{subject_type:'self',subject_id:null,attribute,value,valid_from:'2026-09-01',valid_to:null,origin:'ai_note',...extra});

test('Never Again on an imported applied fact removes it from the profile and keeps it out',async t=>{
 const env=fixture(t),gaming=claim(env.store,'gaming','Level 55');claim(env.store,'hobbies','Level 55 unlocked');
 const item=imported(env.store,{suggestion_type:'add_profile_entry',title:'Add to your profile: Gaming',target_entity_type:'claim',target_entity_id:gaming.id,payload:{label:'Gaming',value:'Level 55',is_owner:true,contact_id:null,category_slug:'hobbies'}});
 const result=await env.domains.invoke('review-queue-bulk',{action:'never_again',scope:{ids:[item.id]}});
 assert.deepEqual(result.errors,[]);assert.equal(result.succeeded,1);
 assert.deepEqual(current(env),['hobbies: Level 55 unlocked']);
 assert.equal(env.store.get('review_queue',item.id).status,'blocked');
 assert.equal(env.domains.writeFact({label:'Gaming',value:'Level 55'}).facts[0].outcome,'suppressed');
});

test('Roll Back finds an imported fact by what it says when its old id did not come across',async t=>{
 const env=fixture(t);claim(env.store,'topic-of-interest','Level 55 unlocked today!');claim(env.store,'topic-of-interest','Lego');
 const item=imported(env.store,{status:'kept',suggestion_type:'add_profile_entry',target_entity_type:'claim',target_entity_id:'menerio-only-id',payload:{label:'Topic of interest',value:'Level 55 unlocked today!',contact_id:null}});
 const result=await env.domains.invoke('review-queue-bulk',{action:'rollback',ids:[item.id]});
 assert.deepEqual(result.errors,[]);assert.deepEqual(current(env),['topic-of-interest: Lego']);
 assert.equal(env.store.get('review_queue',item.id).status,'removed');
});

test('an imported fact that is already gone from the profile can still be blocked',async t=>{
 const env=fixture(t);claim(env.store,'gaming','Level 55 unlocked',{valid_to:'2026-10-03'});
 const item=imported(env.store,{status:'kept',suggestion_type:'unknown_profile_field',target_entity_type:'profile_entry',target_entity_id:'menerio-entry',payload:{label:'Gaming',canonical_label:'Gaming',value:'Level 55 unlocked',contact_id:null,fact_store_switch:{revertible:false,entry_missing:true}}});
 const result=await env.domains.invoke('review-queue-bulk',{action:'never_again',ids:[item.id]});
 assert.deepEqual(result.errors,[]);assert.equal(env.store.get('review_queue',item.id).status,'blocked');
 assert.equal(env.domains.writeFact({label:'Gaming',value:'Level 55 unlocked'}).facts[0].outcome,'suppressed');
});

test('Never Again on an imported person or relationship removes exactly that record',async t=>{
 const env=fixture(t),anna=env.store.save('contacts',{name:'Anna'}),ben=env.store.save('contacts',{name:'Ben'});
 const person=imported(env.store,{status:'kept',suggestion_type:'add_contact',target_entity_type:'contact',target_entity_id:anna.id,payload:{name:'Anna'}});
 const link=env.store.save('contact_relationships',{source_type:'contact',source_id:ben.id,target_type:'self',target_id:null,label:'friend'});
 const relationship=imported(env.store,{status:'kept',suggestion_type:'add_relationship',target_entity_type:'relationship',target_entity_id:'menerio-only-id',payload:{source_type:'contact',source_id:ben.id,target_type:'self',target_id:null,label:'friend'}});
 const result=await env.domains.invoke('review-queue-bulk',{action:'never_again',ids:[person.id,relationship.id]});
 assert.deepEqual(result.errors,[]);assert.equal(result.succeeded,2);
 assert.ok(env.store.get('contacts',anna.id).removed_at);assert.equal(env.store.get('contacts',ben.id).removed_at,undefined);
 assert.ok(env.store.get('contact_relationships',link.id).removed_at);
});

test('an imported change Godspeed cannot identify or reverse is refused, not reported as undone',async t=>{
 const env=fixture(t),anna=env.store.save('contacts',{name:'Anna Renamed'});
 const renamed=imported(env.store,{status:'kept',suggestion_type:'add_contact',target_entity_id:anna.id,payload:{name:'Anna'}});
 const merge=imported(env.store,{status:'kept',suggestion_type:'merge_duplicate_person',target_entity_type:'contact',target_entity_id:anna.id,payload:{}});
 const result=await env.domains.invoke('review-queue-bulk',{action:'never_again',ids:[renamed.id,merge.id]});
 assert.equal(result.succeeded,0);assert.equal(result.errors.length,2);
 assert.equal(env.store.get('contacts',anna.id).removed_at,undefined);
 for(const item of [renamed,merge])assert.equal(env.store.get('review_queue',item.id).status,'kept');
 assert.equal(env.store.list('ai_suggestion_suppressions').length,0);
});

test('a blocked fact is not suggested again',async t=>{
 const env=fixture(t),note=env.store.save('notes',{title:'Discord Status Log',content:'Level 55 unlocked today! Built a Lego tower.'});
 const item=imported(env.store,{status:'pending_review',applied_at:null,suggestion_type:'add_profile_entry',payload:{label:'Gaming',value:'Level 55',contact_id:null}});
 await env.domains.invoke('review-queue-bulk',{action:'never_again',ids:[item.id]});
 env.domains.provider=async()=>({suggestions:[
  {type:'add_profile_entry',title:'Add to your profile: Gaming',payload:{label:'Gaming',value:'level 55',subject_type:'self'},evidence_quote:'Level 55 unlocked'},
  {type:'add_profile_entry',title:'Add to your profile: Hobbies',payload:{label:'Hobbies',value:'Lego',subject_type:'self'},evidence_quote:'Built a Lego tower'}]});
 const result=await env.domains.invoke('process-note',{note_id:note.id});
 assert.deepEqual(result.suggestions.map(s=>s.title),['Add to your profile: Hobbies']);
});
