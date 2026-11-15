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
import http from 'node:http';import {modelProvider} from '../core/runtime.mjs';
async function optionsFrom(t,provider){
 const names=['GODSPEED_ORIGINAL_RUNTIME','GODSPEED_ASSISTANT_CONFIG','GODSPEED_MODEL_URL','GODSPEED_MODEL_KEY','GODSPEED_MODEL'],saved=Object.fromEntries(names.map(n=>[n,process.env[n]]));
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-chat-options-'));
 for(const n of names)delete process.env[n];process.env.GODSPEED_ASSISTANT_CONFIG=path.join(root,'no-assistant.json');
 const {createService}=await import('../server/main.mjs');const service=await createService({root:path.join(root,'workspace'),port:0,provider});
 t.after(async()=>{await service.close();for(const n of names)if(saved[n]===undefined)delete process.env[n];else process.env[n]=saved[n];fs.rmSync(root,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+service.address.port,status=await (await fetch(base+'/api/status')).json();
 const readOptions=()=>loadChatOptions({fetcher:(url,init)=>fetch(base+url,init)});
 return {status,options:await readOptions(),readOptions};
}
test('with no AI connected the model choices say so rather than naming a connected model',async t=>{
 const {status,options}=await optionsFrom(t);
 assert.equal(status.aiConfigured,false);assert.equal(status.runtimeConfigured,false);assert.equal(options.connected,false);assert.equal(options.label,'No AI connected');assert.doesNotMatch(JSON.stringify(options),/Connected model/);
});
test('a connected AI keeps its own model choices',async t=>{
 let checks=0;const provider=Object.assign(async()=>({reply:'ok'}),{options:async()=>({current:'fictional-model',models:[{id:'fictional-model',efforts:['low','high']}]}),check:async()=>{checks++;}});
 const {status,options}=await optionsFrom(t,provider);
 assert.equal(status.aiConfigured,true);assert.equal(status.runtimeConfigured,true);assert.equal(options.connected,true);assert.equal(options.usable,true);assert.equal(options.current,'fictional-model');assert.deepEqual(options.models,[{id:'fictional-model',efforts:['low','high']}]);assert.equal(checks,1);
});
test('a configured AI that refuses its check keeps its model identity but is unusable',async t=>{
 const provider=Object.assign(async()=>{throw Error('Model provider failed with HTTP 401: secret provider detail');},{options:async()=>({current:'fictional-model',models:[{id:'fictional-model',efforts:[]}]}),check:async()=>{throw Error('Model provider failed with HTTP 401: secret provider detail');},health:()=> 'refused'});
 const {options}=await optionsFrom(t,provider);
 assert.equal(options.connected,true);assert.equal(options.usable,false);assert.equal(options.availability,'refused');assert.equal(options.current,'fictional-model');assert.doesNotMatch(JSON.stringify(options),/401|secret provider detail/);
});
test('a provider that connects and later refuses its key reports only the safe refusal category',async t=>{
 let calls=0;const endpoint=http.createServer(async(req,res)=>{for await(const chunk of req);calls++;res.setHeader('Content-Type','application/json');if(calls===1)return res.end(JSON.stringify({choices:[{message:{content:'Connected.'}}]}));res.statusCode=401;res.end(JSON.stringify({error:{message:'invalid fictional API key secret'}}));});
 await new Promise(resolve=>endpoint.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>endpoint.close(resolve)));
 const provider=modelProvider({url:'http://127.0.0.1:'+endpoint.address().port,key:'fictional-key',model:'fictional-model',retryWaits:[]});
 assert.equal(await provider({kind:'connection-test'}),'Connected.');
 const {options}=await optionsFrom(t,provider);
 assert.equal(options.connected,true);assert.equal(options.usable,false);assert.equal(options.availability,'refused');assert.doesNotMatch(JSON.stringify(options),/401|invalid|secret|fictional-key/);
});
test('AI usability is rechecked every five seconds in both directions',async t=>{
 let now=100000,usable=true;
 t.mock.method(Date,'now',()=>now);
 const provider=Object.assign(async()=>({reply:'ok'}),{check:async()=>{if(!usable)throw Error('Fictional provider refusal');}});
 const {options,readOptions}=await optionsFrom(t,provider);
 assert.equal(options.usable,true);
 usable=false;now+=5000;
 const unavailable=await readOptions();assert.equal(unavailable.usable,false);assert.equal(unavailable.availability,'unreachable');
 usable=true;now+=5000;
 assert.equal((await readOptions()).usable,true);
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
test('a chat send with no AI keeps the no-AI setup guidance',async t=>{
 const names=['GODSPEED_ORIGINAL_RUNTIME','GODSPEED_ASSISTANT_CONFIG'],saved=Object.fromEntries(names.map(n=>[n,process.env[n]]));
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-chat-no-ai-'));for(const n of names)delete process.env[n];process.env.GODSPEED_ASSISTANT_CONFIG=path.join(root,'no-assistant.json');
 const {createService}=await import('../server/main.mjs');const service=await createService({root:path.join(root,'workspace'),port:0});
 t.after(async()=>{await service.close();for(const n of names)if(saved[n]===undefined)delete process.env[n];else process.env[n]=saved[n];fs.rmSync(root,{recursive:true,force:true});});
 const result=await fetch('http://127.0.0.1:'+service.address.port+'/api/functions/conversation-chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:crypto.randomUUID(),message:'Hello'})});
 const body=await result.json();assert.equal(result.status,400);assert.match(body.error,/No AI is connected yet.*Settings, Your AI/);assert.doesNotMatch(body.error,/could not be used/);
});
test('a connected AI without a model list is still shown as the connected model',async t=>{
 const {options}=await optionsFrom(t,async()=>({reply:'ok'}));
 assert.equal(options.connected,true);assert.equal(options.current,'');assert.equal(options.label,'Connected model');
});
