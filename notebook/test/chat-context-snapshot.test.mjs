import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';
import {chatContext,retrievedContext} from '../core/chat-context.mjs';

test('one chat context uses one vault snapshot while retaining current and hidden fact policy',()=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-chat-snapshot-'))),query=new QueryService(store),domains=new Domains(query);
 const person=store.save('contacts',{name:'Fictional Alex Garden'}),hidden=store.save('contacts',{name:'Fictional Hidden',ai_visibility:'hidden'});
 domains.writeFact({contact_id:person.id,label:'Conversation preference',value:'One listening question',valid_from:'2026-01-01'});
 domains.writeFact({contact_id:person.id,label:'Conversation preference',value:'Two listening questions',valid_from:'2026-01-02'});
 domains.writeFact({contact_id:hidden.id,label:'Conversation preference',value:'A private secret'});
 store.save('notes',{title:'Fictional Alex Garden plan',content:'Planned software test only.'});
 const scan=store.scan.bind(store);let scans=0;store.scan=()=>{scans++;return scan();};
 const context=chatContext(query,{message:'What is Fictional Alex Garden’s current conversation preference?',person_id:person.id});
 assert.equal(scans,1);assert.equal(context.person_facts.length,1);assert.equal(context.person_facts[0].value,'Two listening questions');
 assert.equal(JSON.stringify(context).includes('A private secret'),false);
 assert.equal(JSON.stringify(context).includes('One listening question'),false);
 assert.equal(query.snapshotDepth,0);
 assert.throws(()=>chatContext(query,{person_id:hidden.id}),/hidden/);assert.equal(query.snapshotDepth,0);
});

test('meaning expansion ends its snapshot before waiting and rechecks changed visibility',async()=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-chat-expand-snapshot-'))),query=new QueryService(store);
 const note=store.save('notes',{title:'Fictional friendship preparation',content:'Listening question'});
 const context=await retrievedContext(query,{message:'Find friendship preparation'},async()=>{
  assert.equal(query.snapshotDepth,0);
  store.save('notes',{id:note.id,ai_visibility:'hidden'},store.get('notes',note.id)._hash);
  return {terms:['friendship','listening']};
 });
 assert.equal(context.notes.some(n=>n.id===note.id),false);assert.equal(query.snapshotDepth,0);
});
