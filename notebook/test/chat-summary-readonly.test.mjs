import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createService} from '../server/main.mjs';

// The note, collection and assistant chat screens fold older turns into a
// rolling summary by sending {mode:'summarize', messages} to their chat
// function. The server ran that as one more chat turn: it saved the last
// user message of the transcript again, and when that message asked for a
// note the note was made again, once per summary (7 October 2026). A summary
// is a reading of the transcript: it saves nothing and runs no tool.
for(const chat of ['note-chat','collection-chat','conversation-chat'])test(chat+' summarize saves nothing and runs no tool',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-chat-summary-'));const calls=[];
  const s=await createService({root,port:0,provider:async input=>{calls.push(input);return input.kind==='chat-summary'?{summary:'They asked for a note about milk, and it was saved.'}:{reply:'Saved your note.',notes_created:[{title:'Buy milk',content:'Buy milk'}],item_updates:[],operations:[]};}});
  t.after(async()=>{await s.close();fs.rmSync(root,{recursive:true,force:true});});
  const note=s.store.save('notes',{title:'Shopping',content:'A list'}),collection=s.store.save('collections',{name:'Films',field_schema:[{key:'title',label:'Title',type:'text',primary:true}]});
  const before=s.store.list('notes').length,messages=s.store.list('conversation_messages').length;
  const transcript=[{role:'user',content:'Hello'},{role:'assistant',content:'Hi.'},{role:'user',content:'Please save a note: buy milk'},{role:'assistant',content:'Saved your note.'}];
  const response=await fetch('http://127.0.0.1:'+s.address.port+'/api/functions/'+chat,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'summarize',messages:transcript,...(chat==='note-chat'?{note_id:note.id}:chat==='collection-chat'?{collection_id:collection.id}:{})})});
  assert.equal(response.status,200);
  const {data}=await response.json();
  assert.equal(s.store.list('notes').length,before,'no note was made');
  assert.equal(s.store.list('conversation_messages').length,messages,'no message was saved');
  assert.equal(data.summary,'They asked for a note about milk, and it was saved.');
  assert.deepEqual(calls.map(c=>c.kind),['chat-summary']);
  assert.deepEqual(calls[0].input.messages,transcript);
  assert.equal(calls[0].context,undefined,'no records are sent with a summary');
});
