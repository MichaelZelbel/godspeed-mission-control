import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createService} from '../server/main.mjs';
import {hash} from '../core/records/store.mjs';
import {chatContext,chatAttachments} from '../core/chat-context.mjs';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';

test('concurrent person context fields merge while conflicting edits remain reviewable',()=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-context-save-'))),query=new QueryService(store),person=store.save('contacts',{name:'Fictional conversation',conversation_context:'Original',conversation_intent:'Listen',conversation_updated_at:'2026-10-03T10:00:00Z'});
 person._hash=store.get('contacts',person.id)._hash; const write=values=>query.execute({table:'contacts',operation:'update',filters:[['eq','id',person.id]],values,expected:{[person.id]:person._hash},baselines:{[person.id]:person}});
 write({conversation_context:'Changed',conversation_updated_at:'2026-10-03T10:01:00Z'});
 assert.doesNotThrow(()=>write({conversation_intent:'Ask one question',conversation_updated_at:'2026-10-03T10:01:01Z'}));
 assert.equal(store.get('contacts',person.id).conversation_context,'Changed');assert.equal(store.get('contacts',person.id).conversation_intent,'Ask one question');
 assert.throws(()=>write({conversation_context:'Conflicting'}),error=>error.code==='CONFLICT');
});

test('person chat retains separate history and supplies current visible topics and facts',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-person-chat-'));let received;
 const s=await createService({root,port:0,provider:async input=>{received=input;return {reply:'What would make Thursday testing easier?'};}}),base='http://127.0.0.1:'+s.address.port;
 try{
  const person=s.store.save('contacts',{name:'Fictional Alex Garden'}),other=s.store.save('contacts',{name:'Fictional Other'});
  s.store.save('contact_topics',{contact_id:person.id,title:'Thursday testing is planned for the future',status:'active'});
  s.store.save('contact_topics',{contact_id:other.id,title:'Unrelated private topic',status:'active'});
  s.domains.writeFact({contact_id:person.id,label:'Preference',value:'Listen before advice'});
  s.store.save('conversation_messages',{conversation_id:'notebook:general',role:'assistant',content:'Unrelated general history'});
  const input={message:'Prepare one listening question.',personId:person.id,request_id:'01234567-1234-4234-8234-012345678905',conversationContext:{context:'Fictional context',intent:'Listen'},attachments:[{name:'fictional.txt',content:'Thursday remains a planned test.'}]};
  const post=()=>fetch(base+'/api/functions/conversation-chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
  const response=await post();assert.equal(response.status,200);assert.equal(received.context.person.id,person.id);
  assert.equal(received.context.person_topics.length,1);assert.match(received.context.person_topics[0].title,/future/);
  assert.equal(received.context.person_facts[0].value,'Listen before advice');assert.equal(received.context.messages.some(m=>m.content==='Unrelated general history'),false);
  assert.equal(received.context.documents[0].content,'Thursday remains a planned test.');
  const history=s.query.rows('conversation_messages').filter(m=>m.person_id===person.id);
  assert.equal(history.length,2);assert.equal(history.every(m=>m.conversation_id==='notebook:person:'+person.id),true);
  assert.equal((await post()).status,200);assert.equal(s.query.rows('conversation_messages').filter(m=>m.person_id===person.id).length,2);
 }finally{await s.close();}
});

test('chat waits for local integration before saving without repeating the provider or blocking health',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-chat-write-wait-'));let calls=0;
 let lock;
 const s=await createService({root,port:0,provider:async()=>{calls++;fs.writeFileSync(lock,JSON.stringify({pid:process.pid,at:new Date().toISOString()}));setTimeout(()=>fs.unlinkSync(lock),120);return {reply:'Fictional check retained.'};}}),base='http://127.0.0.1:'+s.address.port;lock=path.join(s.store.state,'workspace.lock');
 const input={message:'Read the fictional check.',request_id:'01234567-1234-4234-8234-012345678901'};
 try{
  fs.writeFileSync(lock,JSON.stringify({pid:process.pid,at:new Date().toISOString()}));
  const pending=fetch(base+'/api/functions/conversation-chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
  assert.equal((await fetch(base+'/health')).status,200);await new Promise(r=>setTimeout(r,120));assert.equal(calls,0);fs.unlinkSync(lock);
  assert.equal((await pending).status,200);
  const repeated=await fetch(base+'/api/functions/conversation-chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
  assert.equal(repeated.status,200);assert.equal(calls,1);assert.equal(s.store.list('conversation_messages').filter(m=>m.role==='assistant').length,1);
 }finally{if(fs.existsSync(lock))fs.unlinkSync(lock);await s.close();}
});

test('chat retrieves relevant records without sending a thousand notes or hidden people',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-chat-context-'));
  const rows={notes:Array.from({length:1300},(_,i)=>({id:String(i),title:i===900?'Lighthouse project':'Other project',content:'x'.repeat(10000)})),contacts:[{id:'secret',name:'Lighthouse secret',ai_visibility:'hidden'}],mcp_preferences:[]};
  const query={store:{root},withSnapshot:fn=>fn(),rows:type=>rows[type]||[]};
  const greeting=chatContext(query,{message:'hi'});assert.equal(greeting.notes.length,0);assert.equal(greeting.retrieval.counts.notes,1300);
  const relevant=chatContext(query,{message:'Lighthouse'});assert.equal(relevant.notes.length,1);assert.equal(relevant.notes[0].id,'900');assert.equal(relevant.contacts.length,0);assert.ok(JSON.stringify(relevant).length<12000);
  assert.equal(chatContext(query,{note_id:'900'}).notes[0].id,'900');assert.throws(()=>chatContext(query,{person_id:'secret'}),/hidden/);
});
test('uploaded document contents require a valid saved binary and supported type',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-chat-file-')),data=Buffer.from('silver anchor'),mapping={file:hash(data)+'-document.txt',sha256:hash(data),contentType:'text/plain'};
  fs.writeFileSync(path.join(root,mapping.file),data);fs.writeFileSync(path.join(root,hash('chat/document.txt')+'.mapping.json'),JSON.stringify(mapping));
  assert.equal(chatAttachments(root,[{path:'chat/document.txt',name:'document.txt'}]).documents[0].content,'silver anchor');
  fs.writeFileSync(path.join(root,mapping.file),'changed');assert.throws(()=>chatAttachments(root,[{path:'chat/document.txt'}]),/integrity/);
});
test('a question about a note cannot turn a model-supplied edit into a saved change',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-chat-read-only-')),store=new Store(root),note=store.save('notes',{title:'Original',content:'Keep this exact content'}),domains=new Domains(new QueryService(store),{provider:async()=>JSON.stringify({reply:'The note contains the original text.',note_content:'Unexpected edit',note_changes:{title:'Changed'},trash_note:true,notes_created:[{title:'Unrequested',content:'Unrequested'}]})});
  const response=await domains.invoke('note-chat',{note_id:note.id,messages:[{role:'user',content:'What does the current note say?'}]});
  assert.equal(store.get('notes',note.id).content,'Keep this exact content');assert.equal(store.get('notes',note.id).title,'Original');assert.equal(store.get('notes',note.id).updated_at,note.updated_at);assert.equal(response.note_edit,undefined);assert.equal(response.tool_results.length,0);
  assert.equal(store.list('notes').length,1);
});
test('stop aborts the running provider and prevents an assistant write',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-chat-stop-'));let running,started;const ready=new Promise(r=>started=r);
  const provider=input=>new Promise((resolve,reject)=>{running=input.signal;started();input.signal.addEventListener('abort',()=>reject(new Error('Reply stopped')),{once:true});});
  const s=await createService({root,port:0,provider}),base='http://127.0.0.1:'+s.address.port,id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const post=(route,body)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  try{const response=post('/api/functions/note-chat',{message:'hi',request_id:id});await ready;assert.equal((await post('/api/chat/stop',{id})).status,200);assert.equal((await response).status,400);assert.equal(running.aborted,true);assert.equal(s.query.rows('conversation_messages').filter(m=>m.role==='assistant').length,0);assert.equal(s.query.rows('conversation_messages').find(m=>m.role==='user').content,'hi');}finally{await s.close();}
});
test('reading a collection cannot cause a provider to add rows',async()=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-collection-read-'))),collection=store.save('collections',{name:'Fictional reading list',field_schema:[{key:'title',type:'text'}]}),domains=new Domains(new QueryService(store),{provider:async()=>({reply:'An empty fictional reading list.',items_created:[{data:{title:'Unrequested'}}]})});
 const result=await domains.invoke('collection-chat',{collection_id:collection.id,message:'What is in this collection?'});assert.equal(store.list('collection_items').length,0);assert.equal(result.tool_results.length,0);
});
test('asking how to create a note cannot authorize model-supplied new notes',async()=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-note-instructions-'))),domains=new Domains(new QueryService(store),{provider:async()=>({reply:'Use New Note.',notes_created:[{title:'Unrequested',content:'Unrequested'}]})});await domains.invoke('conversation-chat',{message:'How do I create a note?'});assert.equal(store.list('notes').length,0);
});
test('an assistant save overlapping background sync keeps the notebook service alive',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-chat-sync-lock-')),s=await createService({root,port:0}),lock=path.join(s.store.state,'workspace.lock');
  try{
    fs.writeFileSync(path.join(s.store.state,'sync-config.json'),'{}');s.store.save('notes',{title:'Background synchronization check',content:'Synthetic'});
    fs.writeFileSync(lock,JSON.stringify({pid:process.pid,at:new Date().toISOString()}));
    const until=Date.now()+20000;while(!s.sync.last&&Date.now()<until)await new Promise(r=>setTimeout(r,50));assert.ok(s.sync.last,'Background synchronization must report an outcome');
    assert.equal((await fetch('http://127.0.0.1:'+s.address.port+'/health')).status,200);assert.equal(s.sync.last.state,'pending');assert.equal(s.sync.last.detail,'The assistant is saving its state.');
  }finally{if(fs.existsSync(lock))fs.unlinkSync(lock);await s.close();}
});
