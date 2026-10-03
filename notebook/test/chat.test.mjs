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
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-chat-read-only-')),store=new Store(root),note=store.save('notes',{title:'Original',content:'Keep this exact content'}),domains=new Domains(new QueryService(store),{provider:async()=>JSON.stringify({reply:'The note contains the original text.',note_content:'Unexpected edit',note_changes:{title:'Changed'},trash_note:true})});
  const response=await domains.invoke('note-chat',{note_id:note.id,messages:[{role:'user',content:'What does the current note say?'}]});
  assert.equal(store.get('notes',note.id).content,'Keep this exact content');assert.equal(store.get('notes',note.id).title,'Original');assert.equal(store.get('notes',note.id).updated_at,note.updated_at);assert.equal(response.note_edit,undefined);assert.equal(response.tool_results.length,0);
});
test('stop aborts the running provider and prevents an assistant write',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-chat-stop-'));let running,started;const ready=new Promise(r=>started=r);
  const provider=input=>new Promise((resolve,reject)=>{running=input.signal;started();input.signal.addEventListener('abort',()=>reject(new Error('Reply stopped')),{once:true});});
  const s=await createService({root,port:0,provider}),base='http://127.0.0.1:'+s.address.port,id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const post=(route,body)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  try{const response=post('/api/functions/note-chat',{message:'hi',request_id:id});await ready;assert.equal((await post('/api/chat/stop',{id})).status,200);assert.equal((await response).status,400);assert.equal(running.aborted,true);assert.equal(s.query.rows('conversation_messages').length,0);}finally{await s.close();}
});
test('an assistant save overlapping background sync keeps the notebook service alive',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-chat-sync-lock-')),s=await createService({root,port:0}),lock=path.join(s.store.state,'workspace.lock');
  try{
    fs.writeFileSync(path.join(s.store.state,'sync-config.json'),'{}');s.store.save('notes',{title:'Background synchronization check',content:'Synthetic'});
    fs.writeFileSync(lock,JSON.stringify({pid:process.pid,at:new Date().toISOString()}));await new Promise(r=>setTimeout(r,6200));
    assert.equal((await fetch('http://127.0.0.1:'+s.address.port+'/health')).status,200);assert.equal(s.sync.last.state,'pending');assert.equal(s.sync.last.detail,'The assistant is saving its state.');
  }finally{if(fs.existsSync(lock))fs.unlinkSync(lock);await s.close();}
});
