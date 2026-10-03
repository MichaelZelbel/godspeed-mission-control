import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createService} from '../server/main.mjs';
import {hermesResponse} from '../core/runtime.mjs';

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
