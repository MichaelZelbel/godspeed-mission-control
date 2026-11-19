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
async function optionsFrom(t,provider,{defer=false}={}){
 const names=['GODSPEED_ORIGINAL_RUNTIME','GODSPEED_ASSISTANT_CONFIG','GODSPEED_MODEL_URL','GODSPEED_MODEL_KEY','GODSPEED_MODEL'],saved=Object.fromEntries(names.map(n=>[n,process.env[n]]));
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-chat-options-'));
 for(const n of names)delete process.env[n];process.env.GODSPEED_ASSISTANT_CONFIG=path.join(root,'no-assistant.json');
 const {createService}=await import('../server/main.mjs');const service=await createService({root:path.join(root,'workspace'),port:0,provider});
 t.after(async()=>{await service.close();for(const n of names)if(saved[n]===undefined)delete process.env[n];else process.env[n]=saved[n];fs.rmSync(root,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+service.address.port,readStatus=async()=>await (await fetch(base+'/api/status')).json(),status=await readStatus();
 const readOptions=()=>loadChatOptions({fetcher:(url,init)=>fetch(base+url,init)});
 return {status,options:defer?null:await readOptions(),readOptions,readStatus};
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
 const provider=Object.assign(async()=>{throw Error('Model provider failed with HTTP 401: secret provider detail');},{options:async()=>({current:'fictional-model',models:[{id:'fictional-model',efforts:[]}]}),check:async()=>{throw Error('Model provider failed with HTTP 401: secret provider detail');}});
 const {options}=await optionsFrom(t,provider);
 assert.equal(options.connected,true);assert.equal(options.usable,false);assert.equal(options.current,'fictional-model');assert.doesNotMatch(JSON.stringify(options),/401|secret provider detail/);
});
test('AI usability is rechecked every five seconds in both directions',async t=>{
 let now=100000,usable=true;
 t.mock.method(Date,'now',()=>now);
 const provider=Object.assign(async()=>({reply:'ok'}),{check:async()=>{if(!usable)throw Error('Fictional provider refusal');}});
 const {options,readOptions,readStatus}=await optionsFrom(t,provider);
 assert.equal(options.usable,true);
 usable=false;now+=5000;
 assert.equal((await readOptions()).usable,false);
 assert.equal((await readStatus()).runtimeConfigured,false);
 usable=true;now+=5000;
 assert.equal((await readOptions()).usable,true);
 assert.equal((await readStatus()).runtimeConfigured,true);
});
test('overlapping availability reads share a failed health check result over a cached ready one, and a newer passing check restores ready',async t=>{
 let now=100000,checks=0,optionReads=0,failNext=false,rejectCheck,checkStarted,secondArrived;
 t.mock.method(Date,'now',()=>now);
 const started=new Promise(resolve=>{checkStarted=resolve;}),arrived=new Promise(resolve=>{secondArrived=resolve;});
 const provider=Object.assign(async()=>({reply:'ok'}),{
  options:async()=>{optionReads++;if(failNext&&optionReads===3)secondArrived();return {current:'fictional-model',models:[{id:'fictional-model',efforts:[]}]};},
  check:()=>{checks++;if(!failNext)return Promise.resolve();checkStarted();return new Promise((resolve,reject)=>{rejectCheck=reject;});}});
 const {readOptions,readStatus}=await optionsFrom(t,provider,{defer:true});
 // A passing check reports ready at once and is cached for the next five seconds.
 assert.equal((await readOptions()).usable,true);assert.equal((await readStatus()).runtimeConfigured,true);assert.equal(checks,1);
 // Five seconds later one shared check is held in flight while a second reader overlaps it, then the check fails.
 failNext=true;now+=5000;
 const first=readOptions();await started;
 const second=readOptions();await arrived;await new Promise(resolve=>setImmediate(resolve));
 rejectCheck(new Error('Fictional private provider failure'));
 const results=await Promise.all([first,second]);
 assert.deepEqual(results.map(result=>result.usable),[false,false]);
 assert.equal(checks,2,'the overlapping readers share one provider check');
 assert.equal((await readOptions()).usable,false,'a later cached read keeps the failure');
 assert.equal((await readStatus()).runtimeConfigured,false);
 assert.equal(checks,2);
 assert.doesNotMatch(JSON.stringify(results),/Fictional private provider failure/);
 // Only a newer passing check restores ready.
 failNext=false;now+=5000;
 assert.equal((await readOptions()).usable,true);assert.equal((await readStatus()).runtimeConfigured,true);assert.equal(checks,3);
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

// #764: an AI connected in Settings is usable at once, without a chat having been opened first.
import http from 'node:http';
async function fakeEndpoint(t){
 const state={status:200,kinds:[]};
 const server=http.createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{try{state.kinds.push(JSON.parse(JSON.parse(raw).messages[1].content).kind);}catch{}res.statusCode=state.status;res.setHeader('content-type','application/json');res.end(JSON.stringify(state.status===200?{choices:[{message:{content:'Connected'}}]}:{error:{message:'Fictional refused key'}}));});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 return {state,address:'http://127.0.0.1:'+server.address().port+'/v1'};
}
async function notebookAt(t,root,provider){
 const names=['GODSPEED_ORIGINAL_RUNTIME','GODSPEED_ASSISTANT_CONFIG','GODSPEED_MODEL_URL','GODSPEED_MODEL_KEY','GODSPEED_MODEL'],saved=Object.fromEntries(names.map(n=>[n,process.env[n]]));
 for(const n of names)delete process.env[n];process.env.GODSPEED_ASSISTANT_CONFIG=path.join(root,'no-assistant.json');
 const {createService}=await import('../server/main.mjs');const service=await createService({root:path.join(root,'workspace'),port:0,provider});
 let closed=false;const close=async()=>{if(closed)return;closed=true;await service.close();for(const n of names)if(saved[n]===undefined)delete process.env[n];else process.env[n]=saved[n];};t.after(close);
 const base='http://127.0.0.1:'+service.address.port;
 return {close,status:async()=>await (await fetch(base+'/api/status')).json(),options:()=>loadChatOptions({fetcher:(url,init)=>fetch(base+url,init)}),connect:address=>fetch(base+'/api/provider',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:address,key:'fictional-key',model:'fictional-model',routines:false})})};
}
const tempRoot=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-ai-connect-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;};
test('an AI connected in Settings is available at once on a fresh notebook, with no chat opened',async t=>{
 const ai=await fakeEndpoint(t),notebook=await notebookAt(t,tempRoot(t));
 assert.equal((await notebook.status()).runtimeConfigured,false);
 const connected=await notebook.connect(ai.address);assert.equal(connected.status,200);
 const status=await notebook.status();
 assert.equal(status.aiConfigured,true);assert.equal(status.runtimeConfigured,true,'the Dashboard, Add Moment and every runtimeConfigured reader see the AI at once');
 assert.deepEqual(ai.state.kinds,['connection-test'],'no chat or chat options were read to get there');
});
test('a fresh start with a saved, working connection is available before any chat is opened',async t=>{
 const ai=await fakeEndpoint(t),root=tempRoot(t),first=await notebookAt(t,root);
 assert.equal((await first.connect(ai.address)).status,200);await first.close();
 const reopened=await notebookAt(t,root);
 assert.equal((await reopened.status()).runtimeConfigured,true);
 assert.equal((await reopened.options()).usable,true);
});
test('connecting a working AI after a failed check makes it available again at once',async t=>{
 let now=100000;t.mock.method(Date,'now',()=>now);
 const ai=await fakeEndpoint(t),root=tempRoot(t),first=await notebookAt(t,root);
 assert.equal((await first.connect(ai.address)).status,200);await first.close();
 const notebook=await notebookAt(t,root);
 ai.state.status=401;
 assert.equal((await notebook.options()).usable,false);assert.equal((await notebook.status()).runtimeConfigured,false);
 ai.state.status=200;now+=1000;
 assert.equal((await notebook.connect(ai.address)).status,200);
 assert.equal((await notebook.status()).runtimeConfigured,true);
});
test('a refused key at connect time leaves the AI off',async t=>{
 const ai=await fakeEndpoint(t),notebook=await notebookAt(t,tempRoot(t));
 ai.state.status=401;
 assert.notEqual((await notebook.connect(ai.address)).status,200);
 const status=await notebook.status();assert.equal(status.aiConfigured,false);assert.equal(status.runtimeConfigured,false);
});
test('a check still running for the AI that was replaced does not turn the new one off',async t=>{
 let rejectCheck,checkStarted;const started=new Promise(resolve=>{checkStarted=resolve;});
 const old=Object.assign(async()=>({reply:'ok'}),{check:()=>{checkStarted();return new Promise((resolve,reject)=>{rejectCheck=reject;});}});
 const ai=await fakeEndpoint(t),notebook=await notebookAt(t,tempRoot(t),old);
 const reading=notebook.options();await started;
 assert.equal((await notebook.connect(ai.address)).status,200);
 rejectCheck(new Error('Fictional old provider failure'));await reading;
 assert.equal((await notebook.status()).runtimeConfigured,true);
});
