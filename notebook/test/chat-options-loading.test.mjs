import test from 'node:test';import assert from 'node:assert/strict';
import {loadChatOptions} from '../ui/src/local/chat-options.mjs';
test('model option loading times out rather than leaving the composer loading forever',async()=>{
 const hanging=(url,{signal})=>new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});const keepAlive=setInterval(()=>{},1000);try{await assert.rejects(loadChatOptions({fetcher:hanging,timeoutMs:15}),/did not load/);}finally{clearInterval(keepAlive);}
});
test('a fresh retry loads actual connected choices without replaying a message',async()=>{
 let calls=0;const fetcher=async()=>{calls++;return new Response(JSON.stringify({current:'fictional-model',models:[{id:'fictional-model',efforts:['low']}]}),{headers:{'content-type':'application/json'}});};const result=await loadChatOptions({fetcher});assert.equal(result.current,'fictional-model');assert.deepEqual(result.models[0].efforts,['low']);assert.equal(calls,1);
});
test('endpoint default choices use the empty default model ID and retain its readable label',async()=>{
 const result=await loadChatOptions({fetcher:async()=>new Response(JSON.stringify({current:'Connected model',models:[{id:'',efforts:[]}]}))});assert.equal(result.current,'');assert.equal(result.label,'Connected model');
});
test('invalid choices fail visibly rather than making up a model',async()=>{
 await assert.rejects(loadChatOptions({fetcher:async()=>new Response(JSON.stringify({current:'missing',models:[]}))}),/No model choices/);
});

// #563: with no AI connected the picker said "Connected model" while the Dashboard and the chat said no AI is connected.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
async function optionsFrom(t,provider){
 const names=['GODSPEED_ORIGINAL_RUNTIME','GODSPEED_ASSISTANT_CONFIG','GODSPEED_MODEL_URL','GODSPEED_MODEL_KEY','GODSPEED_MODEL'],saved=Object.fromEntries(names.map(n=>[n,process.env[n]]));
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-chat-options-'));
 for(const n of names)delete process.env[n];process.env.GODSPEED_ASSISTANT_CONFIG=path.join(root,'no-assistant.json');
 const {createService}=await import('../server/main.mjs');const service=await createService({root:path.join(root,'workspace'),port:0,provider});
 t.after(async()=>{await service.close();for(const n of names)if(saved[n]===undefined)delete process.env[n];else process.env[n]=saved[n];fs.rmSync(root,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+service.address.port,status=await (await fetch(base+'/api/status')).json();
 return {status,options:await loadChatOptions({fetcher:(url,init)=>fetch(base+url,init)})};
}
test('with no AI connected the model choices say so rather than naming a connected model',async t=>{
 const {status,options}=await optionsFrom(t);
 assert.equal(status.aiConfigured,false);assert.equal(status.runtimeConfigured,false);assert.equal(options.connected,false);assert.equal(options.label,'No AI connected');assert.doesNotMatch(JSON.stringify(options),/Connected model/);
});
test('a connected AI keeps its own model choices',async t=>{
 const provider=Object.assign(async()=>({reply:'ok'}),{options:async()=>({current:'fictional-model',models:[{id:'fictional-model',efforts:['low','high']}]})});
 const {status,options}=await optionsFrom(t,provider);
 assert.equal(status.aiConfigured,true);assert.equal(status.runtimeConfigured,true);assert.equal(options.connected,true);assert.equal(options.current,'fictional-model');assert.deepEqual(options.models,[{id:'fictional-model',efforts:['low','high']}]);
});
test('a configured AI that refuses its check keeps its model identity but is unusable',async t=>{
 const provider=Object.assign(async()=>{throw Error('Model provider failed with HTTP 401: secret provider detail');},{options:async()=>({current:'fictional-model',models:[{id:'fictional-model',efforts:[]}]}),check:async()=>{throw Error('Model provider failed with HTTP 401: secret provider detail');}});
 const {options}=await optionsFrom(t,provider);
 assert.equal(options.connected,true);assert.equal(options.usable,false);assert.equal(options.current,'fictional-model');assert.doesNotMatch(JSON.stringify(options),/401|secret provider detail/);
});
test('a refused chat returns plain guidance instead of provider diagnostics',async t=>{
 const provider=async()=>{throw Error('Model provider failed with HTTP 401: secret provider detail');};
 const names=['GODSPEED_ORIGINAL_RUNTIME','GODSPEED_ASSISTANT_CONFIG'],saved=Object.fromEntries(names.map(n=>[n,process.env[n]]));
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-chat-refused-'));for(const n of names)delete process.env[n];process.env.GODSPEED_ASSISTANT_CONFIG=path.join(root,'no-assistant.json');
 const {createService}=await import('../server/main.mjs');const service=await createService({root:path.join(root,'workspace'),port:0,provider});
 t.after(async()=>{await service.close();for(const n of names)if(saved[n]===undefined)delete process.env[n];else process.env[n]=saved[n];fs.rmSync(root,{recursive:true,force:true});});
 const result=await fetch('http://127.0.0.1:'+service.address.port+'/api/functions/conversation-chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:crypto.randomUUID(),message:'Hello'})});
 const body=await result.json();assert.equal(result.status,400);assert.match(body.error,/Your AI could not be used.*Settings, Your AI/);assert.doesNotMatch(body.error,/401|secret provider detail/);
});
test('a connected AI without a model list is still shown as the connected model',async t=>{
 const {options}=await optionsFrom(t,async()=>({reply:'ok'}));
 assert.equal(options.connected,true);assert.equal(options.current,'');assert.equal(options.label,'Connected model');
});
