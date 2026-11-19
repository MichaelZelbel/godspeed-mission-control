// #779: outside the chats, a refused key or an AI that cannot be reached was told in the provider's
// own words (Suggest), or not at all (Classify with AI, the moment save), and a saved AI connection
// could not be removed. Here the AI actions say it as the chats do, and removal forgets the key.
import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';
import {AI_REFUSED_STATUS,AI_UNREACHABLE_STATUS,NO_AI_STATUS} from '../core/no-ai.mjs';

const KEY='sk-fictional-779-secret';
const REFUSED=AI_REFUSED_STATUS+'. Check it in Settings, Your AI, then try again.';
const UNREACHABLE=AI_UNREACHABLE_STATUS+'. Check its connection in Settings, Your AI, then try again.';
const RAW=/HTTP|\b[45]\d\d\b|Model provider|Incorrect API key|Internal server error|provider wording|127\.0\.0\.1/;

async function standIn(t){
  const ai={status:200,requests:0};
  const server=http.createServer((req,res)=>{req.resume();req.on('end',()=>{ai.requests++;
    if(ai.status!==200){res.writeHead(ai.status,{'content-type':'application/json'});return res.end(JSON.stringify({error:{message:ai.status===500?'Internal server error, provider wording':'Incorrect API key provided: '+KEY}}));}
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:'{"title":"Connected"}'}}]}));});});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  ai.url='http://127.0.0.1:'+server.address().port+'/v1/chat/completions';
  ai.close=()=>new Promise(resolve=>server.close(resolve));
  t.after(()=>ai.close());
  return ai;
}

async function notebook(t,env={}){
  const names=['GODSPEED_ORIGINAL_RUNTIME','GODSPEED_ASSISTANT_CONFIG','GODSPEED_MODEL_URL','GODSPEED_MODEL_KEY','GODSPEED_MODEL'],saved=Object.fromEntries(names.map(n=>[n,process.env[n]]));
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-ai-actions-'));
  for(const n of names)delete process.env[n];process.env.GODSPEED_ASSISTANT_CONFIG=path.join(root,'no-assistant.json');Object.assign(process.env,env);
  const {createService}=await import('../server/main.mjs');const service=await createService({root:path.join(root,'workspace'),port:0});
  t.after(async()=>{await service.close();for(const n of names)if(saved[n]===undefined)delete process.env[n];else process.env[n]=saved[n];fs.rmSync(root,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+service.address.port;
  const post=async(route,body)=>{const r=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,text:await r.text()};};
  const get=async route=>{const r=await fetch(base+route);return {status:r.status,text:await r.text()};};
  const insert=async(table,values)=>{const r=await post('/api/query',{table,operation:'insert',values,selection:'*',single:true});assert.equal(r.status,200,r.text);return JSON.parse(r.text).data;};
  return {root,base,post,get,insert,providerFile:path.join(root,'workspace','.godspeed','provider.json')};
}

async function seeded(t,env){
  const nb=await notebook(t,env);
  const note=await nb.insert('notes',{title:'Lunch',content:'Lunch with Ada about the garden.'});
  const moment=await nb.insert('moments',{title:'Lunch with Ada',description:'We talked about the garden.',happened_at:'2026-11-01'});
  const actions={
    'draft-event':{message:'Lunch with Ada yesterday'},
    'process-note':{note_id:note.id,reason:'manual'},
    'extract-moment-profile':{moment_id:moment.id},
  };
  const run=name=>nb.post('/api/functions/'+name,actions[name]);
  return {...nb,actions,run};
}

const errorOf=answer=>JSON.parse(answer.text).error;

test('a refused key is said as the chats say it by Suggest, Classify with AI and the moment save, never in the provider\'s words',async t=>{
  const ai=await standIn(t),nb=await seeded(t);
  assert.equal(JSON.parse((await nb.get('/api/status')).text).aiAvailability,'none');
  assert.equal((await nb.post('/api/provider',{url:ai.url,key:KEY,model:'fictional-model'})).status,200);
  for(const status of [401,403]){
    ai.status=status;
    for(const name of Object.keys(nb.actions)){
      const answer=await nb.run(name);
      assert.notEqual(answer.status,200,name);
      assert.equal(errorOf(answer),REFUSED,name+' '+status);
      assert.doesNotMatch(answer.text,RAW);assert.equal(answer.text.includes(KEY),false);
    }
    // What the Dashboard's AI card reads (local/Home.tsx): the same refusal, from the real provider.
    const options=await nb.get('/api/chat/options');
    assert.equal(JSON.parse(options.text).availability,'refused',String(status));assert.doesNotMatch(options.text,RAW);
  }
  assert.equal(JSON.parse((await nb.get('/api/status')).text).aiAvailability,'refused');
});

test('an AI that answers with a server error or cannot be reached is said as an outage by all three actions',async t=>{
  const ai=await standIn(t),nb=await seeded(t);
  assert.equal((await nb.post('/api/provider',{url:ai.url,key:KEY,model:'fictional-model'})).status,200);
  // A 500 is retried twice (core/runtime.mjs) before it fails, so one action is enough for it.
  ai.status=500;
  const failed=await nb.run('extract-moment-profile');
  assert.equal(errorOf(failed),UNREACHABLE);assert.doesNotMatch(failed.text,RAW);
  await ai.close();
  for(const name of Object.keys(nb.actions)){
    const answer=await nb.run(name);
    assert.equal(errorOf(answer),UNREACHABLE,name);
    assert.doesNotMatch(answer.text,RAW);assert.equal(answer.text.includes(KEY),false);
  }
  assert.equal(JSON.parse((await nb.get('/api/status')).text).aiAvailability,'unreachable');
});

test('with no AI connected each action keeps its own no-AI sentence and asks no AI',async t=>{
  const ai=await standIn(t),nb=await seeded(t);
  for(const name of Object.keys(nb.actions)){
    const message=errorOf(await nb.run(name));
    assert.ok(message.startsWith(NO_AI_STATUS),name+': '+message);
    assert.doesNotMatch(message,/refused|could not be reached/);
  }
  assert.equal(ai.requests,0);
});

test('removing the saved AI connection forgets its key and leaves no AI connected',async t=>{
  const ai=await standIn(t),nb=await seeded(t);
  assert.equal((await nb.post('/api/provider',{url:ai.url,key:KEY,model:'fictional-model'})).status,200);
  const removed=await nb.post('/api/provider/remove',{});
  assert.equal(removed.status,200);
  assert.deepEqual(JSON.parse(removed.text),{removed:true,connected:false,provider:{configured:false,key:false},routines:{available:false}});
  assert.equal(fs.existsSync(nb.providerFile),false);
  const provider=await nb.get('/api/provider'),options=await nb.get('/api/chat/options'),status=await nb.get('/api/status'),draft=await nb.run('draft-event');
  assert.deepEqual(JSON.parse(provider.text),{configured:false,key:false});
  assert.equal(JSON.parse(options.text).connected,false);assert.equal(JSON.parse(options.text).current,'No AI connected');
  assert.equal(JSON.parse(status.text).runtimeConfigured,false);assert.equal(JSON.parse(status.text).aiAvailability,'none');
  assert.ok(errorOf(draft).startsWith(NO_AI_STATUS));
  for(const answer of [removed,provider,options,status,draft])assert.equal(answer.text.includes(KEY),false);
  assert.equal(JSON.parse((await nb.post('/api/provider/remove',{})).text).removed,false);
});

test('removing the saved connection hands the notebook back to the GODSPEED_MODEL_* address',async t=>{
  const ai=await standIn(t),nb=await seeded(t,{GODSPEED_MODEL_URL:ai.url,GODSPEED_MODEL_KEY:'env-key',GODSPEED_MODEL:'env-model'});
  assert.equal((await nb.post('/api/provider',{url:ai.url,key:KEY,model:'fictional-model'})).status,200);
  const removed=JSON.parse((await nb.post('/api/provider/remove',{})).text);
  assert.equal(removed.removed,true);assert.equal(removed.connected,true);
  assert.equal(JSON.parse((await nb.get('/api/chat/options')).text).connected,true);
  assert.equal(JSON.parse((await nb.get('/api/status')).text).runtimeConfigured,true);
  const asked=ai.requests,draft=await nb.run('draft-event');
  assert.ok(ai.requests>asked,draft.text);assert.equal(draft.text.includes(NO_AI_STATUS),false);
});

test('a saved connection that no longer reads as one can still be removed',async t=>{
  const nb=await notebook(t);
  fs.mkdirSync(path.dirname(nb.providerFile),{recursive:true});fs.writeFileSync(nb.providerFile,'{broken '+KEY);
  assert.notEqual((await nb.get('/api/provider')).status,200);
  const removed=await nb.post('/api/provider/remove',{});
  assert.equal(removed.status,200,removed.text);assert.equal(JSON.parse(removed.text).removed,true);
  assert.equal(fs.existsSync(nb.providerFile),false);
  assert.deepEqual(JSON.parse((await nb.get('/api/provider')).text),{configured:false,key:false});
});
