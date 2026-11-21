// #826: while the notebook runs, Settings and the chats agree on whether the saved AI connection can
// be used. A provider.json damaged (or repaired) after startup must reach the one availability state
// every surface reads (#806) within one status refresh, without a restart and without a second flag.
import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';
import {AI_CONNECTION_UNREADABLE_STATUS} from '../core/no-ai.mjs';

const KEY='sk-fictional-826-secret';
const chatInput={message:'Say the fictional word.',request_id:'01234567-1234-4234-8234-012345678901'};

async function notebook(t,{settingsOnly=false,startConnected=false}={}){
  const requests={count:0,bodies:[]};
  const ai=http.createServer((req,res)=>{let text='';req.on('data',chunk=>{text+=chunk;});req.on('end',()=>{requests.count++;
    if(req.method==='POST'&&text)try{requests.bodies.push(JSON.parse(text));}catch{}
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:'{"reply":"Connected."}'}}]}));});});
  await new Promise(resolve=>ai.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>ai.close(resolve)));
  const names=['GODSPEED_ORIGINAL_RUNTIME','GODSPEED_ASSISTANT_CONFIG','GODSPEED_MODEL_URL','GODSPEED_MODEL_KEY','GODSPEED_MODEL'],saved=Object.fromEntries(names.map(n=>[n,process.env[n]]));
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-saved-connection-'));
  for(const n of names)delete process.env[n];process.env.GODSPEED_ASSISTANT_CONFIG=path.join(root,'no-assistant.json');
  if(settingsOnly){
    // An AI connected for the notebook only while Hermes has none of its own: the settings-only state.
    const home=path.join(root,'hermes-home');fs.mkdirSync(home,{recursive:true});
    fs.writeFileSync(path.join(root,'assistant.json'),JSON.stringify({verified:true,executable:'hermes',home}));
    process.env.GODSPEED_ASSISTANT_CONFIG=path.join(root,'assistant.json');process.env.GODSPEED_ORIGINAL_RUNTIME='on';
  }
  const {createService}=await import('../server/main.mjs');
  const providerFile=path.join(root,'workspace','.godspeed','provider.json');
  const url='http://127.0.0.1:'+ai.address().port+'/v1/chat/completions',config={url,key:KEY,model:'fictional-model'};
  if(startConnected){fs.mkdirSync(path.dirname(providerFile),{recursive:true});fs.writeFileSync(providerFile,JSON.stringify({...config,...startConnected}));}
  const service=await createService({root:path.join(root,'workspace'),port:0});
  let closed=false;
  const close=async()=>{if(closed)return;closed=true;await service.close();for(const n of names)if(saved[n]===undefined)delete process.env[n];else process.env[n]=saved[n];};
  t.after(async()=>{await close();fs.rmSync(root,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+service.address.port;
  const get=async route=>{const r=await fetch(base+route);return {status:r.status,text:await r.text()};};
  const post=async(route,body)=>{const r=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,text:await r.text()};};
  return {requests,root,base,get,post,providerFile,url,config,connect:(overrides={})=>post('/api/provider',{...config,...overrides}),close,createService};
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

test('a saved connection damaged while the notebook runs, with the AI connected for the notebook only: the chats still say it cannot be read, not the settings-only advice',async t=>{
  const nb=await notebook(t,{settingsOnly:true});
  assert.equal((await nb.connect({routines:false})).status,200,'connected for the notebook only');
  damage(nb.providerFile);
  assert.equal(JSON.parse((await nb.get('/api/status')).text).aiAvailability,'unreadable');
  const options=JSON.parse((await nb.get('/api/chat/options')).text);
  assert.equal(options.availability,'unreadable');assert.equal(options.usable,false);
  const before=nb.requests.count;
  const sent=await chatSend(nb);
  assert.notEqual(sent.status,200);
  assert.equal(JSON.parse(sent.text).error,AI_CONNECTION_UNREADABLE_STATUS,'the settings-only advice is not said for a damaged file');
  assert.equal(nb.requests.count,before);
});

test('a chat summary is refused with the same sentence while the saved connection cannot be read',async t=>{
  const nb=await notebook(t);
  assert.equal((await nb.connect()).status,200);
  damage(nb.providerFile);
  const before=nb.requests.count;
  const sent=await nb.post('/api/functions/conversation-chat',{mode:'summarize',messages:[{role:'user',content:'Summarize this conversation.'}]});
  assert.notEqual(sent.status,200,'the summary must not reach the provider loaded before the damage');
  assert.equal(JSON.parse(sent.text).error,AI_CONNECTION_UNREADABLE_STATUS);
  assert.equal(nb.requests.count,before);
});

test('a saved connection replaced with a different one while the notebook runs: the chats follow the saved file, not the connection loaded before',async t=>{
  const nb=await notebook(t);
  assert.equal((await nb.connect()).status,200);
  const reached={count:0};
  const other=http.createServer((req,res)=>{req.resume();req.on('end',()=>{reached.count++;
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:'{"reply":"Connected."}'}}]}));});});
  await new Promise(resolve=>other.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>other.close(resolve)));
  damage(nb.providerFile);
  assert.equal(JSON.parse((await nb.get('/api/status')).text).aiAvailability,'unreadable');
  fs.writeFileSync(nb.providerFile,JSON.stringify({url:'http://127.0.0.1:'+other.address().port+'/v1/chat/completions',key:KEY,model:'other-model'}));
  // Options first: the picker's own first read after a file change must already name the saved model.
  const options=JSON.parse((await nb.get('/api/chat/options')).text);
  assert.equal(options.usable,true);assert.equal(options.current,'other-model','the picker names the saved model');
  const status=JSON.parse((await nb.get('/api/status')).text);
  assert.equal(status.aiAvailability,'ready');assert.equal(status.runtimeConfigured,true);
  const saved=JSON.parse((await nb.get('/api/provider')).text);
  assert.equal(saved.model,'other-model');assert.equal(saved.configured,true);
  const before=reached.count;
  assert.equal((await chatSend(nb)).status,200);
  assert.equal(reached.count,before+1,'the chat send reaches the saved connection');
  assert.equal(nb.requests.count,1,'the connection loaded before the replacement is asked nothing more');
});

test('a saved connection the notebook loaded at startup is followed too when the file is replaced while it runs',async t=>{
  const nb=await notebook(t,{startConnected:true});
  assert.equal(JSON.parse((await nb.get('/api/status')).text).aiAvailability,'ready');
  const reached={count:0};
  const other=http.createServer((req,res)=>{req.resume();req.on('end',()=>{reached.count++;
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:'{"reply":"Connected."}'}}]}));});});
  await new Promise(resolve=>other.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>other.close(resolve)));
  fs.writeFileSync(nb.providerFile,JSON.stringify({url:'http://127.0.0.1:'+other.address().port+'/v1/chat/completions',key:KEY,model:'other-model'}));
  const options=JSON.parse((await nb.get('/api/chat/options')).text);
  assert.equal(options.usable,true);assert.equal(options.current,'other-model');
  const status=JSON.parse((await nb.get('/api/status')).text);
  assert.equal(status.aiAvailability,'ready');assert.equal(status.runtimeConfigured,true);
  const before=reached.count;
  assert.equal((await chatSend(nb)).status,200);
  assert.equal(reached.count,before+1,'the chat send reaches the saved connection');
  assert.equal(nb.requests.count,0,'the connection loaded at startup is asked nothing');
});

test('a saved connection whose settings beyond its address change while the notebook runs: the chats follow the whole saved connection',async t=>{
  const nb=await notebook(t,{startConnected:{maxTokens:9999}});
  fs.writeFileSync(nb.providerFile,JSON.stringify({...nb.config,maxTokens:1111}));
  assert.equal(JSON.parse((await nb.get('/api/status')).text).aiAvailability,'ready');
  assert.equal((await chatSend(nb)).status,200);
  assert.equal(nb.requests.bodies.at(-1)?.max_tokens,1111,'the chat follows the saved maxTokens, not the one loaded at startup');
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
