import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';
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
