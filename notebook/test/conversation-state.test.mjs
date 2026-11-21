import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createService} from '../server/main.mjs';

test('a stale panel cannot remove a saved reply, and a divergent history keeps both windows\' messages',async()=>{
 const service=await createService({root:fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-chat-history-')),port:0}),base='http://127.0.0.1:'+service.address.port;
 const key='note:fictional-independent',question={messages:[{role:'user',content:'Fictional current preference?'}],summary:'',summarizedUpTo:0},answer={...question,messages:[...question.messages,{role:'assistant',content:'Two listening questions'}]};
 const post=async(state,extra={})=>{const response=await fetch(base+'/api/chat-state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({context_key:key,state,...extra})});return {status:response.status,body:await response.json()};};
 try{
  assert.equal((await post(question)).status,200);assert.equal((await post(answer)).status,200);
  const revision=service.store.list('note_conversations')[0].revision;
  const stale=await post(question);assert.equal(stale.status,200);assert.equal(stale.body.ignored_stale,true);assert.deepEqual(stale.body.state,answer);
  assert.equal(service.store.list('note_conversations')[0].revision,revision);
  const branch={...answer,messages:[question.messages[0],{role:'assistant',content:'Competing old answer'}]};
  const joined={...answer,messages:[...answer.messages,branch.messages[1]]},merged=await post(branch);
  assert.equal(merged.status,200);assert.deepEqual(merged.body.state,joined);assert.deepEqual(service.store.list('note_conversations')[0].state,joined);
  assert.equal(merged.body.revision,service.store.list('note_conversations')[0].revision);
  const again=await post(branch);assert.equal(again.body.ignored_stale,true);assert.deepEqual(again.body.state,joined);
  const empty={messages:[],summary:'',summarizedUpTo:0};assert.equal((await post(empty,{clear:true,expected_state:question})).status,409);
  assert.equal((await post(empty,{clear:true,expected_state:joined})).status,200);
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

test('a turn sent from a second window that missed the first window\'s turn is kept once, after it, with what only that window knows',async()=>{
 const service=await createService({root:fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-chat-two-windows-')),port:0,provider:async()=>({reply:'Fictional pop-out answer'})}),base='http://127.0.0.1:'+service.address.port;
 const key='note:fictional-two-windows',m=(role,content)=>({role,content}),chat=(...messages)=>({messages,summary:'',summarizedUpTo:0});
 const save=async state=>(await fetch(base+'/api/chat-state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({context_key:key,state})})).json();
 const q1=m('user','Fictional first question'),a1=m('assistant','Fictional first answer'),q2=m('user','Fictional panel question'),a2=m('assistant','Fictional panel answer');
 const q3=m('user','Fictional pop-out question'),a3=m('assistant','Fictional pop-out answer');
 try{
  await save(chat(q1,a1));await save(chat(q1,a1,q2,a2));
  assert.deepEqual((await save(chat(q1,a1,q3))).state.messages,[q1,a1,q2,a2,q3]);
  const reply=await fetch(base+'/api/functions/conversation-chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:q3.content,conversation_id:'notebook:'+key,request_id:'aaaaaaaa-bbbb-cccc-dddd-222222222222'})});
  assert.equal(reply.status,200);
  assert.equal((await save(chat(q1,a1,q3,a3))).ignored_stale,true);
  const undo={...a3,noteEdit:{previousContent:'Fictional note before the edit'}},last=await save(chat(q1,a1,q3,undo));
  const kept=service.store.list('note_conversations')[0].state.messages;
  assert.equal(last.ignored_stale,undefined);assert.deepEqual(last.state.messages,kept);assert.deepEqual(kept.at(-1).noteEdit,undo.noteEdit);
  assert.deepEqual(kept.map(({role,content})=>({role,content})),[q1,a1,q2,a2,q3,a3]);
 }finally{await service.close();}
});

test('two windows that send at the same moment keep each question once, each followed by its own reply, whichever reply ends first',async()=>{
 for(const order of [['panel','popout'],['popout','panel']]){
  const q2='Fictional panel question',q3='Fictional pop-out question',replies={[q2]:'Fictional panel answer',[q3]:'Fictional pop-out answer'};
  let answering='';const provider=async()=>({reply:replies[answering]});
  const service=await createService({root:fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-chat-same-moment-')),port:0,provider}),base='http://127.0.0.1:'+service.address.port;
  const key='note:fictional-same-moment',m=(role,content)=>({role,content}),chat=(...messages)=>({messages,summary:'',summarizedUpTo:0});
  const save=async state=>(await fetch(base+'/api/chat-state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({context_key:key,state})})).json();
  const ask=async(message,request_id)=>(await fetch(base+'/api/functions/conversation-chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,conversation_id:'notebook:'+key,request_id})})).json();
  const q1=m('user','Fictional first question'),a1=m('assistant','Fictional first answer');
  const windows={panel:{question:m('user',q2),answer:m('assistant',replies[q2]),id:'aaaaaaaa-bbbb-cccc-dddd-333333333333'},popout:{question:m('user',q3),answer:m('assistant',replies[q3]),id:'aaaaaaaa-bbbb-cccc-dddd-444444444444'}};
  try{
   await save(chat(q1,a1));
   // Each window saves its question before it hears of the other's.
   await save(chat(q1,a1,windows.panel.question));await save(chat(q1,a1,windows.popout.question));
   for(const name of order){
    const w=windows[name];
    answering=w.question.content;assert.equal((await ask(w.question.content,w.id)).data.reply,w.answer.content);
    await save(chat(q1,a1,w.question,w.answer));
   }
   const kept=service.store.list('note_conversations')[0].state.messages.map(({role,content})=>({role,content}));
   assert.deepEqual(kept,[q1,a1,windows.panel.question,windows.panel.answer,windows.popout.question,windows.popout.answer],order.join(' first, then '));
  }finally{await service.close();}
 }
});
