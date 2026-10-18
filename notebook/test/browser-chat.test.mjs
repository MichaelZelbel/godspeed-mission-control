import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createService} from '../server/main.mjs';
import {hermesResponse,hermesFailureMessage} from '../core/runtime.mjs';

test('browser chat authenticates, saves messages and recalls history after restart',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-browser-chat-'));
  const provider=async input=>JSON.stringify({reply:input.context.messages.some(m=>m.content==='Remember lighthouse')?'lighthouse':'Hello'});
  let service=await createService({root,host:'0.0.0.0',port:0,token:'synthetic-token',provider});
  let base='http://127.0.0.1:'+service.address.port;
  const post=async(route,value,cookie)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(value)});
  const login=async()=>{const response=await post('/api/login',{token:'synthetic-token'});assert.equal(response.status,200);return response.headers.get('set-cookie').split(';')[0];};
  try{
    assert.equal((await fetch(base+'/api/browser-chat')).status,401);
    const page=await fetch(base+'/chat',{redirect:'manual'});assert.equal(page.status,303);assert.equal(page.headers.get('location'),'/dashboard/chat');
    let cookie=await login();assert.equal((await post('/api/browser-chat',{message:'Remember lighthouse'},cookie)).status,200);
    await service.close();service=await createService({root,host:'0.0.0.0',port:0,token:'synthetic-token',provider});base='http://127.0.0.1:'+service.address.port;
    assert.equal((await fetch(base+'/api/browser-chat',{headers:{Cookie:cookie}})).status,200);
    cookie=await login();const result=await(await post('/api/browser-chat',{message:'What word?'},cookie)).json();assert.equal(result.reply,'lighthouse');
    const history=await(await fetch(base+'/api/browser-chat',{headers:{Cookie:cookie}})).json();assert.equal(history.messages.filter(m=>m.role==='user').length,2);assert.equal(history.messages.filter(m=>m.role==='assistant').length,2);
  }finally{await service.close();}
});
test('Hermes startup diagnostics do not become model JSON',()=>{
  assert.equal(hermesResponse('Warning: Unknown toolsets: none\n\n\x1b[2m  ⚠ tirith security scanner enabled but not available — command scanning will use pattern matching only\x1b[0m\n{"reply":"hello"}\n'),'{"reply":"hello"}');
  assert.equal(hermesResponse('{"reply":"Warning: keep this actual response"}'),'{"reply":"Warning: keep this actual response"}');
});
// The three waiting lines that ended chat replies in the live run of 9 October 2026.
test('Hermes\' waiting lines never reach a chat reply, and lines like them that belong to it stay',()=>{
  for(const line of ['  [tool] ( ˘⌣˘)♡ brainstorming...','  [tool] (⊙_⊙) ruminating...','  [tool] ヽ(>∀<☆)☆ mulling...'])
    assert.equal(hermesResponse('Saved: "Captured note" in Health.\n\nI left your original briefing unchanged.\n'+line+'\n'),'Saved: "Captured note" in Health.\n\nI left your original briefing unchanged.',line);
  assert.equal(hermesResponse('First part.\n(◔_◔) pondering…\nSecond part.'),'First part.\nSecond part.','one in the middle goes too');
  for(const kept of ['- reviewing...','Still thinking...','I am pondering...','[tool] terminal: ls','Step 2... done'])
    assert.equal(hermesResponse('Answer.\n'+kept),'Answer.\n'+kept,kept);
});
test('Hermes failures distinguish context, usage and sign-in without exposing diagnostics',()=>{
 const secret='synthetic-private-credential';
 for(const [diagnostic,expected] of [['Context length exceeded: 413,274 tokens. Cannot compress further.',/context limit/],['rate_limit_exceeded',/usage limit/],['AuthenticationError: token expired',/needs sign-in/],['unclassified process failure',/diagnostics/]]){
  const message=hermesFailureMessage(diagnostic+' '+secret);assert.match(message,expected);assert.ok(!message.includes(secret));assert.ok(!message.includes('413,274'));
 }
 assert.match(hermesFailureMessage('Context length exceeded; AuthenticationError'),/context limit/);
});
test('browser request retries return the saved result without duplicate notes',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-browser-retry-')),service=await createService({root,port:0,provider:async()=>({reply:'Saved.',notes_created:[{title:'Fictional draft',content:'Fictional content'}]})}),base='http://127.0.0.1:'+service.address.port;
 try{for(let i=0;i<2;i++){const response=await fetch(base+'/api/browser-chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:'fictional-retry',message:'Create a note with fictional content'})});assert.equal(response.status,200);}assert.equal(service.query.rows('notes').length,1);}finally{await service.close();}
});
