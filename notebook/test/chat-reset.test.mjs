import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createService} from '../server/main.mjs';
import {nativeAgent} from '../core/native-agent.mjs';

const empty={messages:[],summary:'',summarizedUpTo:0};
const post=(base,route,value)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
const history=(s,key='general')=>s.store.list('note_conversations').find(r=>r.context_key===key)?.state;
const clear=async(s,base,key='general')=>{
 const response=await post(base,'/api/chat-state',{context_key:key,state:empty,clear:true,expected_state:history(s,key)||empty});
 assert.equal(response.status,200);return (await response.json()).state;
};

test('Clear isolates backend history, survives restart and preserves notes and earlier messages',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-reset-provider-'));let received;
 const provider=async input=>{received=input;return {reply:input.context.messages.some(m=>m.content==='Fictional old phrase')?'old session':'fresh session'};};
 let s=await createService({root,port:0,provider}),base='http://127.0.0.1:'+s.address.port;
 try{
  const note=s.store.save('notes',{title:'Fictional preserved note',content:'Keep this exact content'});
  await post(base,'/api/functions/conversation-chat',{message:'Fictional old phrase',conversation_id:'notebook:general'});
  const before=history(s),archived=s.store.list('conversation_messages').length;
  const reset=await clear(s,base);assert.match(reset.session_id,/^[a-f0-9-]{36}$/);assert.deepEqual(reset.messages,[]);
  assert.equal(s.store.get('notes',note.id).content,note.content);assert.equal(s.store.list('conversation_messages').length,archived+1);
  const stale=await post(base,'/api/chat-state',{context_key:'general',state:before});assert.equal((await stale.json()).ignored_stale,true);assert.deepEqual(history(s),reset);
  const refused=await post(base,'/api/functions/conversation-chat',{message:'Stale tab message',conversation_id:'notebook:general',conversation_session:''});assert.equal(refused.status,409);
  const oldClient=await post(base,'/api/functions/conversation-chat',{message:'Old client history',conversation_id:'notebook:general',messages:before.messages});assert.equal(oldClient.status,409);
  await s.close();s=await createService({root,port:0,provider});base='http://127.0.0.1:'+s.address.port;
  assert.deepEqual(history(s),reset);
  const answer=await post(base,'/api/functions/conversation-chat',{message:'Hello again',conversation_id:'notebook:general',conversation_session:reset.session_id});assert.equal(answer.status,200);assert.equal((await answer.json()).data.reply,'fresh session');
  assert.equal(received.context.messages.some(m=>m.content==='Fictional old phrase'),false);
  assert.equal(history(s).messages.length,2);assert.equal(s.store.get('notes',note.id).content,note.content);
 }finally{await s.close();}
});

test('a reply already in flight and its late browser save cannot repopulate the cleared conversation',async()=>{
 let started,finish;const ready=new Promise(r=>started=r);
 const s=await createService({root:fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-reset-pending-')),port:0,provider:()=>{started();return new Promise(r=>finish=r);}}),base='http://127.0.0.1:'+s.address.port;
 try{
  const question={...empty,messages:[{role:'user',content:'Fictional slow request'}]};
  await post(base,'/api/chat-state',{context_key:'general',state:question});
  const pending=post(base,'/api/functions/conversation-chat',{message:'Fictional slow request',conversation_id:'notebook:general',conversation_session:''});
  await ready;const reset=await clear(s,base);finish({reply:'Fictional delayed reply'});assert.equal((await pending).status,200);
  assert.deepEqual(history(s),reset);
  const stale=await post(base,'/api/chat-state',{context_key:'general',state:{...question,messages:[...question.messages,{role:'assistant',content:'Fictional delayed reply'}]}});
  assert.equal((await stale.json()).ignored_stale,true);assert.deepEqual(history(s),reset);
  assert.ok(s.store.list('conversation_messages').some(m=>m.content==='Fictional delayed reply'));
 }finally{await s.close();}
});

test('note and collection resets isolate their own context without changing another conversation',async()=>{
 const received=[],s=await createService({root:fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-reset-scopes-')),port:0,provider:async input=>{received.push(input);return {reply:'Fictional scoped answer'};}}),base='http://127.0.0.1:'+s.address.port;
 try{
  const note=s.store.save('notes',{title:'Fictional note',content:'Keep this content'}),collection=s.store.save('collections',{name:'Fictional collection',field_schema:[]});
  for(const [name,key,fields] of [['note-chat','note:'+note.id,{note_id:note.id}],['collection-chat','collection:'+collection.id,{collection_id:collection.id}]]){
   const send=session=>post(base,'/api/functions/'+name,{...fields,message:'Fictional scoped question',conversation_session:session});
   assert.equal((await send('')).status,200);const before=history(s,key);const reset=await clear(s,base,key);
   assert.equal((await send(reset.session_id)).status,200);
   assert.equal(received.at(-1).context.messages.some(m=>m.role==='assistant'),false);
   assert.equal(history(s,key).messages.length,2);assert.equal(history(s,key).session_id,reset.session_id);
   assert.ok(s.store.list('conversation_messages').some(m=>m.content===before.messages[1].content));
  }
  assert.equal(s.store.get('notes',note.id).content,note.content);
 }finally{await s.close();}
});

test('Clear selects a fresh native Hermes session and leaves unrelated person chats in their own sessions',async()=>{
 const calls=[],transcripts=new Map();
 const agent=nativeAgent({executable:'hermes',home:'fixture-home',cwd:'fixture-workspace',spawnProcess:(exe,args)=>{
  const session=args[args.indexOf('--continue')+1],child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();
  child.stdin.on('data',data=>{calls.push({session,message:String(data)});const before=transcripts.get(session)||[];transcripts.set(session,[...before,String(data)]);queueMicrotask(()=>{child.stdout.write(before.length?'continued session':'fresh session');child.emit('close',0);});});return child;
 }});
 const s=await createService({root:fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-reset-native-')),port:0}),base='http://127.0.0.1:'+s.address.port;s.domains.nativeAgent=agent;
 try{
  const person=s.store.save('contacts',{name:'Fictional separate person'}),send=async(values={})=>{const r=await post(base,'/api/functions/conversation-chat',{message:'Fictional question',...values});assert.equal(r.status,200);return (await r.json()).data.reply;};
  assert.equal(await send(),'fresh session');assert.equal(await send(),'continued session');
  await send({person_id:person.id});const personSession=calls.at(-1).session;
  const reset=await clear(s,base);assert.equal(await send({conversation_session:reset.session_id}),'fresh session');
  assert.notEqual(calls[0].session,calls.at(-1).session);
  assert.equal(await send({person_id:person.id}),'continued session');assert.equal(calls.at(-1).session,personSession);
  const personReset=await clear(s,base,'person:'+person.id);assert.equal(await send({person_id:person.id,conversation_session:personReset.session_id}),'fresh session');assert.notEqual(calls.at(-1).session,personSession);
 }finally{await s.close();}
});
