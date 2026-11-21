// #826: while the notebook runs, Settings and the chats agree on whether the saved AI connection can
// be used. A provider.json damaged (or repaired) after startup must reach the one availability state
// every surface reads (#806) within one status refresh, without a restart and without a second flag.
import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';
import {AI_CONNECTION_UNREADABLE_STATUS} from '../core/no-ai.mjs';

const KEY='sk-fictional-826-secret';
const chatInput={message:'Say the fictional word.',request_id:'01234567-1234-4234-8234-012345678901'};

async function notebook(t){
  const requests={count:0};
  const ai=http.createServer((req,res)=>{req.resume();req.on('end',()=>{requests.count++;
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:'{"reply":"Connected."}'}}]}));});});
  await new Promise(resolve=>ai.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>ai.close(resolve)));
  const names=['GODSPEED_ORIGINAL_RUNTIME','GODSPEED_ASSISTANT_CONFIG','GODSPEED_MODEL_URL','GODSPEED_MODEL_KEY','GODSPEED_MODEL'],saved=Object.fromEntries(names.map(n=>[n,process.env[n]]));
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-saved-connection-'));
  for(const n of names)delete process.env[n];process.env.GODSPEED_ASSISTANT_CONFIG=path.join(root,'no-assistant.json');
  const {createService}=await import('../server/main.mjs');
  const service=await createService({root:path.join(root,'workspace'),port:0});
  let closed=false;
  const close=async()=>{if(closed)return;closed=true;await service.close();for(const n of names)if(saved[n]===undefined)delete process.env[n];else process.env[n]=saved[n];};
  t.after(async()=>{await close();fs.rmSync(root,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+service.address.port;
  const get=async route=>{const r=await fetch(base+route);return {status:r.status,text:await r.text()};};
  const post=async(route,body)=>{const r=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,text:await r.text()};};
  const providerFile=path.join(root,'workspace','.godspeed','provider.json');
  const url='http://127.0.0.1:'+ai.address().port+'/v1/chat/completions',config={url,key:KEY,model:'fictional-model'};
  return {requests,root,base,get,post,providerFile,url,config,connect:()=>post('/api/provider',config),close,createService};
}

const damage=file=>fs.writeFileSync(file,'{ the notebook, the chat and the routines: not JSON');
const chatSend=nb=>nb.post('/api/functions/conversation-chat',chatInput);

test('a saved connection damaged while the notebook runs: Settings and the chats both say it cannot be read, and a chat send reaches no provider',async t=>{
  const nb=await notebook(t);
  assert.equal((await nb.connect()).status,200);
  assert.equal(JSON.parse((await nb.get('/api/status')).text).aiAvailability,'ready');
  // Damaged while running, with no restart: the next read of the state agrees everywhere.
  damage(nb.providerFile);
  const saved=await nb.get('/api/provider');
  assert.notEqual(saved.status,200,'Settings can no longer read the saved connection');
  const status=JSON.parse((await nb.get('/api/status')).text);
  assert.equal(status.aiAvailability,'unreadable');assert.equal(status.runtimeConfigured,false);assert.equal(status.aiConfigured,true);
  const options=JSON.parse((await nb.get('/api/chat/options')).text);
  assert.equal(options.availability,'unreadable');assert.equal(options.usable,false);
  // A chat send says the sentence Settings uses and asks the loaded provider nothing.
  const before=nb.requests.count;
  const sent=await chatSend(nb);
  assert.notEqual(sent.status,200);
  assert.equal(JSON.parse(sent.text).error,AI_CONNECTION_UNREADABLE_STATUS);
  assert.equal(nb.requests.count,before);
});

test('a saved connection repaired while the notebook runs: both surfaces connect again and the next chat send reaches the provider',async t=>{
  const nb=await notebook(t);
  assert.equal((await nb.connect()).status,200);
  damage(nb.providerFile);
  assert.equal(JSON.parse((await nb.get('/api/status')).text).aiAvailability,'unreadable');
  fs.writeFileSync(nb.providerFile,JSON.stringify(nb.config));
  const status=JSON.parse((await nb.get('/api/status')).text);
  assert.equal(status.aiAvailability,'ready');assert.equal(status.runtimeConfigured,true);
  assert.equal(JSON.parse((await nb.get('/api/chat/options')).text).usable,true);
  const before=nb.requests.count;
  assert.equal((await chatSend(nb)).status,200);
  assert.equal(nb.requests.count,before+1,'the next chat send reaches the provider');
});

test('a saved connection removed while the notebook runs: both surfaces show no AI, they still agree after a restart, and reconnecting from Settings connects them again',async t=>{
  const nb=await notebook(t);
  assert.equal((await nb.connect()).status,200);
  damage(nb.providerFile);
  assert.equal(JSON.parse((await nb.get('/api/status')).text).aiAvailability,'unreadable');
  const removed=JSON.parse((await nb.post('/api/provider/remove',{})).text);
  assert.equal(removed.removed,true);assert.equal(removed.connected,false);
  assert.equal(JSON.parse((await nb.get('/api/status')).text).aiAvailability,'none');
  assert.equal(JSON.parse((await nb.get('/api/chat/options')).text).connected,false);
  assert.equal(fs.existsSync(nb.providerFile),false,'nothing unreadable is left for a restart to trip over');
  // After a restart both surfaces still agree: no AI is connected. Reconnecting from Settings
  // (Remove, then connect: the form stays unavailable while the file cannot be read) brings both
  // surfaces back, and the chat reaches the provider.
  await nb.close();
  const second=await nb.createService({root:path.join(nb.root,'workspace'),port:0});
  try{
    const base='http://127.0.0.1:'+second.address.port;
    const get=async route=>{const r=await fetch(base+route);return {status:r.status,text:await r.text()};};
    const post=async(route,body)=>{const r=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,text:await r.text()};};
    const restarted=JSON.parse((await get('/api/status')).text);
    assert.equal(restarted.aiAvailability,'none');assert.equal(restarted.aiConfigured,false);
    assert.equal(JSON.parse((await get('/api/chat/options')).text).connected,false);
    assert.equal((await post('/api/provider',nb.config)).status,200);
    assert.equal(JSON.parse((await get('/api/status')).text).aiAvailability,'ready');
    assert.equal(JSON.parse((await get('/api/chat/options')).text).usable,true);
    const before=nb.requests.count;
    assert.equal((await post('/api/functions/conversation-chat',chatInput)).status,200);
    assert.equal(nb.requests.count,before+1);
  }finally{await second.close();}
});

test('with an intact saved connection, reading the state costs no provider request',async t=>{
  const nb=await notebook(t);
  assert.equal((await nb.connect()).status,200);
  const before=nb.requests.count;
  for(let n=0;n<3;n++){
    assert.equal(JSON.parse((await nb.get('/api/status')).text).aiAvailability,'ready');
    assert.equal(nb.requests.count,before,'a status read asks the provider nothing');
  }
});
