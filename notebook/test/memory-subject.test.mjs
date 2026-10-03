import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';
import {chatContext,retrievedContext} from '../core/chat-context.mjs';
const fixture=provider=>{const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-memory-subject-'))),query=new QueryService(store);return {store,query,domains:new Domains(query,{provider})};};

test('another person’s confirmed memory and correction retain that subject and their history',async()=>{
 const {store,query,domains}=fixture(),person=store.save('contacts',{name:'Fictional Alex'});
 const input={type:'memory-confirm',label:'Listening preference',subject_type:'contact',subject_id:person.id,evidence_quote:'Fictional Alex prefers listening first.'};
 await domains.invoke('personal-operation',{...input,value:'Listening first'});
 await domains.invoke('personal-operation',{...input,value:'Questions first',evidence_quote:'Fictional Alex now prefers questions first.'});
 const claims=query.rows('claims');assert.equal(claims.length,2);assert.ok(claims.every(c=>c.subject_type==='contact'&&c.subject_id===person.id));
 assert.ok(claims.find(c=>c.value==='Listening first').valid_to);assert.equal(claims.find(c=>c.value==='Questions first').valid_to,null);
 assert.equal(query.rows('fact_slots')[0].contact_id,person.id);
});

test('memory proposals separate people and reject invented, hidden and inconsistent subjects',async()=>{
 const {store,query,domains}=fixture(),alex=store.save('contacts',{name:'Fictional Alex'}),bea=store.save('contacts',{name:'Fictional Bea'}),hidden=store.save('contacts',{name:'Hidden person',ai_visibility:'hidden'});
 const input={type:'memory-propose',label:'Favorite color',value:'Blue',source_id:'same-source',evidence_quote:'They prefer blue.',subject_type:'contact'};
 for(const person of [alex,bea])await domains.invoke('personal-operation',{...input,subject_id:person.id});
 assert.equal(query.rows('review_queue').length,2);assert.deepEqual(new Set(query.rows('review_queue').map(r=>r.payload.subject_id)),new Set([alex.id,bea.id]));
 for(const subject_id of ['invented',hidden.id])await assert.rejects(domains.invoke('personal-operation',{...input,subject_id}),/existing visible/);
 await assert.rejects(domains.invoke('personal-operation',{...input,subject_type:'self',subject_id:alex.id}),/inconsistent/);
 assert.equal(query.rows('claims').length,0);
});

test('conversation repairs an omitted memory subject before saving a named person’s fact',async()=>{
 let person,calls=0;const message='Remember that Fictional Alex prefers listening first.';
 const {store,query,domains}=fixture(async()=>{calls++;assert.equal(query.rows('claims').length,0);return {reply:'Saved Fictional Alex’s preference.',operations:[{type:'memory-confirm',label:'Listening preference',value:'Listening first',evidence_quote:message,source_quote:message,...(calls>1?{subject_type:'contact',subject_id:person.id}:{})}]};});
 person=store.save('contacts',{name:'Fictional Alex'});
 await domains.invoke('conversation-chat',{message,conversation_id:'fictional',request_id:'named-person'});
 assert.equal(calls,2);assert.equal(query.rows('claims').length,1);assert.equal(query.rows('claims')[0].subject_id,person.id);assert.equal(query.rows('claims')[0].subject_type,'contact');
});

test('a correction with a different label replaces the actual canonical claim and retains history',async()=>{
 const {store,query,domains}=fixture(),person=store.save('contacts',{name:'Fictional Alex'});
 await domains.invoke('personal-operation',{type:'memory-confirm',subject_type:'contact',subject_id:person.id,label:'Preferred communication style',value:'One question first',evidence_quote:'Fictional Alex prefers one question.'});
 const previous=query.rows('claims')[0];
 await domains.invoke('personal-operation',{type:'memory-confirm',subject_type:'contact',subject_id:person.id,label:'Listening preference',value:'Two questions first',evidence_quote:'Fictional Alex now prefers two questions.',replaces_claim_id:previous.id});
 const claims=query.rows('claims'),old=store.get('claims',previous.id),current=claims.find(c=>!c.valid_to);
 assert.equal(claims.length,2);assert.equal(current.attribute,previous.attribute);assert.equal(query.rows('fact_slots').length,1);assert.ok(old.valid_to);assert.equal(old.closure_evidence.quote,'Fictional Alex now prefers two questions.');assert.equal(current.subject_id,person.id);
});

test('an ordinary correction repairs a missing old-claim reference before making any change',async()=>{
 const f=fixture(),person=f.store.save('contacts',{name:'Fictional Alex'}),message='Correct Fictional Alex’s listening preference: two questions now replace one question.';
 await f.domains.invoke('personal-operation',{type:'memory-confirm',subject_type:'contact',subject_id:person.id,label:'Preferred communication style',value:'One question first',evidence_quote:'Fictional Alex prefers one question.'});
 const previous=f.query.rows('claims')[0];let calls=0;
 f.domains.provider=async input=>{calls++;assert.equal(f.query.rows('claims').length,1);assert.ok(input.context.world_claims.some(c=>c.id===previous.id&&c.attribute===previous.attribute&&c.subject_id===person.id));return {reply:'Corrected.',operations:[{type:'memory-confirm',subject_type:'contact',subject_id:person.id,label:'Listening preference',value:'Two questions first',source_quote:message,evidence_quote:message,...(calls>1?{replaces_claim_id:previous.id}:{})}]};};
 await f.domains.invoke('conversation-chat',{message,conversation_id:'fictional-correction',request_id:'canonical-correction'});
 assert.equal(calls,2);assert.equal(f.query.rows('claims').filter(c=>!c.valid_to).length,1);assert.ok(f.store.get('claims',previous.id).valid_to);
});

test('a correction refuses another person, a hidden slot or a historical claim',async()=>{
 const f=fixture(),alex=f.store.save('contacts',{name:'Fictional Alex'}),bea=f.store.save('contacts',{name:'Fictional Bea'});
 await f.domains.invoke('personal-operation',{type:'memory-confirm',subject_type:'contact',subject_id:alex.id,label:'Preference',value:'Blue',evidence_quote:'Fictional Alex prefers blue.'});const previous=f.query.rows('claims')[0],input={type:'memory-confirm',subject_type:'contact',subject_id:bea.id,label:'Preference',value:'Red',evidence_quote:'Fictional Bea prefers red.',replaces_claim_id:previous.id};
 await assert.rejects(f.domains.invoke('personal-operation',input),/same memory subject/);
 const slot=f.query.rows('fact_slots')[0];f.store.save('fact_slots',{id:slot.id,show_to_agent:false});await assert.rejects(f.domains.invoke('personal-operation',{...input,subject_id:alex.id}),/visible current/);
 f.store.save('fact_slots',{id:slot.id,show_to_agent:true});await f.domains.invoke('personal-operation',{...input,subject_id:alex.id});await assert.rejects(f.domains.invoke('personal-operation',{...input,subject_id:alex.id,value:'Green'}),/visible current/);
 assert.equal(f.query.rows('claims').filter(c=>!c.valid_to).length,1);
});

test('correcting one of many facts to an already current value still closes the old fact',async()=>{
 const f=fixture(),person=f.store.save('contacts',{name:'Fictional Alex'}),base={subject_type:'contact',subject_id:person.id,label:'Interests',attribute:'interests',cardinality:'many',evidence_quote:'Fictional interests.'};
 f.domains.writeFact({...base,value:'Gardening'});f.domains.writeFact({...base,value:'Reading'});
 const previous=f.query.rows('claims').find(c=>c.value==='Gardening');
 await f.domains.invoke('personal-operation',{type:'memory-confirm',...base,value:'Reading',replaces_claim_id:previous.id,evidence_quote:'Reading replaces gardening.'});
 assert.equal(f.query.rows('claims').length,2);assert.ok(f.store.get('claims',previous.id).valid_to);assert.equal(f.query.rows('claims').filter(c=>!c.valid_to).length,1);
});

test('world memory uses the profile day across midnight instead of dropping locally current facts',()=>{
 const f=fixture();f.store.save('profiles',{timezone:'Pacific/Kiritimati'});
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Pacific/Kiritimati'}).format(new Date());
 f.domains.writeFact({label:'Fictional midnight preference',value:'Fictional blue',valid_from:today});
 assert.equal(chatContext(f.query,{message:'Fictional midnight preference'}).world_claims.length,1);
});

test('an exact full person name resolves other people sharing that first word',async()=>{
 const f=fixture(),alex=f.store.save('contacts',{name:'Fictional Alex Garden'});f.store.save('contacts',{name:'Fictional Bea Garden'});
 const context=await retrievedContext(f.query,{message:'Remember Fictional Alex Garden prefers listening.'},async()=>({terms:[]}));
 assert.equal(context.ambiguities,undefined);assert.ok(context.contacts.some(c=>c.id===alex.id));
});

test('chat cannot acknowledge a memory correction without a corresponding operation',async()=>{
 const f=fixture(),person=f.store.save('contacts',{name:'Fictional Alex Garden'}),message='Correct the remembered one-question preference for Fictional Alex Garden: two questions now.';
 await f.domains.invoke('personal-operation',{type:'memory-confirm',subject_type:'contact',subject_id:person.id,label:'Listening preference',value:'One question',evidence_quote:'One question.'});
 const previous=f.query.rows('claims')[0];let calls=0;
 f.domains.provider=async input=>{if(input.kind==='retrieval-expansion')return {terms:[]};calls++;return {reply:'The remembered preference has been corrected. This is not about you.',...(calls>1?{operations:[{type:'memory-confirm',subject_type:'contact',subject_id:person.id,label:'Preference',value:'Two questions',evidence_quote:message,source_quote:message,replaces_claim_id:previous.id}]}:{})};};
 await f.domains.invoke('conversation-chat',{message,conversation_id:'fictional-ack',request_id:'real-correction'});
 assert.equal(calls,2);assert.ok(f.store.get('claims',previous.id).valid_to);
});
