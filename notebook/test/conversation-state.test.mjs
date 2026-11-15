import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createService} from '../server/main.mjs';

test('a stale panel cannot remove a saved reply, and divergent histories are retained for review',async()=>{
 const service=await createService({root:fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-chat-history-')),port:0}),base='http://127.0.0.1:'+service.address.port;
 const key='note:fictional-independent',question={messages:[{role:'user',content:'Fictional current preference?'}],summary:'',summarizedUpTo:0},answer={...question,messages:[...question.messages,{role:'assistant',content:'Two listening questions'}]};
 const post=async(state,extra={})=>{const response=await fetch(base+'/api/chat-state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({context_key:key,state,...extra})});return {status:response.status,body:await response.json()};};
 try{
  assert.equal((await post(question)).status,200);assert.equal((await post(answer)).status,200);
  const revision=service.store.list('note_conversations')[0].revision;
  const stale=await post(question);assert.equal(stale.status,200);assert.equal(stale.body.ignored_stale,true);assert.deepEqual(stale.body.state,answer);
  assert.equal(service.store.list('note_conversations')[0].revision,revision);
  const branch={...answer,messages:[question.messages[0],{role:'assistant',content:'Competing old answer'}]};
  assert.equal((await post(branch)).status,409);assert.deepEqual(service.store.list('note_conversations')[0].state,answer);
  const conflicts=fs.readdirSync(path.join(service.store.root,'conflicts')).filter(n=>n.endsWith('.json'));
  assert.equal(conflicts.length,1);assert.match(fs.readFileSync(path.join(service.store.root,'conflicts',conflicts[0]),'utf8'),/Competing old answer/);
  const empty={messages:[],summary:'',summarizedUpTo:0};assert.equal((await post(empty,{clear:true,expected_state:question})).status,409);
  assert.equal((await post(empty,{clear:true,expected_state:answer})).status,200);
  assert.equal(service.store.list('record_history').some(h=>h.source_type==='note_conversations'&&h.snapshot.state.messages.at(-1)?.content==='Two listening questions'),true);
 }finally{await service.close();}
});

test('the completed reply is durable before HTTP returns without a later browser save',async()=>{
 const service=await createService({root:fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-chat-reply-durable-')),port:0,provider:async()=>({reply:'Two listening questions'})}),base='http://127.0.0.1:'+service.address.port;
 const input={message:'Current fictional preference?',conversation_id:'notebook:note:fictional-context',request_id:'aaaaaaaa-bbbb-cccc-dddd-111111111111'};
 try{
  const post=()=>fetch(base+'/api/functions/conversation-chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
  assert.equal((await post()).status,200);
  const chat=service.store.list('note_conversations')[0];assert.equal(chat.context_key,'note:fictional-context');assert.equal(chat.state.messages.length,2);assert.equal(chat.state.messages[1].content,'Two listening questions');
  const stale=await fetch(base+'/api/chat-state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({context_key:chat.context_key,state:{messages:[{role:'user',content:input.message}],summary:'',summarizedUpTo:0}})});
  assert.equal((await stale.json()).ignored_stale,true);
  assert.equal((await post()).status,200);assert.equal(service.store.list('note_conversations')[0].state.messages.length,2);
 }finally{await service.close();}
});
