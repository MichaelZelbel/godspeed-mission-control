// #762: with an AI connected, every open page read /api/chat/options every 5 seconds and each read
// could send the AI a billed chat. The check now asks the service's free key endpoint, and sends a
// chat at most once every 10 minutes only when that endpoint cannot tell a refused key apart.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';
import {loadChatOptions} from '../ui/src/local/chat-options.mjs';
import {modelProvider} from '../core/runtime.mjs';
import {trackAIHealth} from '../core/ai-health.mjs';

async function standIn(t,{modelsNeedKey}){
 const state={key:'fictional-key',billed:0};
 const server=http.createServer(async(req,res)=>{for await(const chunk of req)void chunk;
  const keyed=req.headers.authorization==='Bearer '+state.key;
  const json=(code,body)=>{res.statusCode=code;res.setHeader('content-type','application/json');res.end(JSON.stringify(body));};
  if(req.method==='GET'&&req.url==='/v1/models')return modelsNeedKey&&!keyed?json(401,{error:{message:'Invalid key'}}):json(200,{data:[{id:'fictional-model'}]});
  if(req.method==='POST'&&req.url==='/v1/chat/completions'){state.billed++;return keyed?json(200,{choices:[{message:{content:JSON.stringify({reply:'Stand-in answer.'})}}]}):json(401,{error:{message:'Invalid key'}});}
  json(404,{});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>{server.closeAllConnections?.();return new Promise(resolve=>server.close(resolve));});
 return {state,url:'http://127.0.0.1:'+server.address().port+'/v1/chat/completions'};
}

async function notebook(t){
 const names=['GODSPEED_ORIGINAL_RUNTIME','GODSPEED_ASSISTANT_CONFIG','GODSPEED_MODEL_URL','GODSPEED_MODEL_KEY','GODSPEED_MODEL'],saved=Object.fromEntries(names.map(name=>[name,process.env[name]]));
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-idle-'));for(const name of names)delete process.env[name];process.env.GODSPEED_ASSISTANT_CONFIG=path.join(root,'none.json');
 const {createService}=await import('../server/main.mjs');const service=await createService({root:path.join(root,'workspace'),port:0});
 t.after(async()=>{await service.close();for(const name of names)if(saved[name]===undefined)delete process.env[name];else process.env[name]=saved[name];fs.rmSync(root,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+service.address.port;
 return {
  options:()=>loadChatOptions({fetcher:(url,init)=>fetch(base+url,init)}),
  connect:url=>fetch(base+'/api/provider',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url,key:'fictional-key',model:'fictional-model'})}),
 };
}

async function tenIdleMinutes(t,modelsNeedKey){
 let now=1_000_000;t.mock.method(Date,'now',()=>now);
 const ai=await standIn(t,{modelsNeedKey}),page=await notebook(t);
 assert.equal((await page.connect(ai.url)).status,200);
 const billedBefore=ai.state.billed;
 for(let read=0;read<120;read++){
  now+=5000;
  const [home,chat]=await Promise.all([page.options(),page.options()]);
  assert.equal(home.availability,'ready');assert.equal(chat.availability,'ready');
 }
 return {ai,page,billed:ai.state.billed-billedBefore,advance:ms=>{now+=ms;},now:()=>now};
}

test('ten idle minutes with Home and a chat open send no billed request when the service checks keys on its model list',async t=>{
 const idle=await tenIdleMinutes(t,true);
 assert.equal(idle.billed,0);
 idle.ai.state.key='rotated-key';
 const since=idle.now();let state;
 do{idle.advance(5000);state=await idle.page.options();}while(state.availability!=='refused'&&idle.now()-since<10000);
 assert.equal(state.availability,'refused');assert.equal(state.usable,false);
 assert.equal(idle.ai.state.billed,idle.billed+1,'only the connection test was billed');
});

test('ten idle minutes with Home and a chat open send at most one billed request when the service\'s model list is public',async t=>{
 const idle=await tenIdleMinutes(t,false);
 assert.ok(idle.billed<=1,'billed '+idle.billed);
});

test('OpenRouter is asked its key endpoint, never a chat, and a chat\'s own answer settles the state at once',async()=>{
 const original=globalThis.fetch,requests=[];let keyAnswer=200,chatAnswer=200;
 globalThis.fetch=async(url,init={})=>{
  const method=init.method||'GET',keyed=Boolean(init.headers?.Authorization);requests.push({url,method,keyed});
  if(method==='POST')return new Response(JSON.stringify(chatAnswer===200?{choices:[{message:{content:'OK'}}]}:{error:{message:'Invalid key'}}),{status:chatAnswer,headers:{'Content-Type':'application/json'}});
  return new Response('{}',{status:keyed?keyAnswer:401});
 };
 try{
  const provider=trackAIHealth(modelProvider({url:'https://openrouter.ai/api/v1/chat/completions',key:'fictional-key',model:'fictional-model',retryWaits:[]}));
  await provider.check();
  assert.equal(provider.health(),'ready');
  assert.deepEqual(requests,[{url:'https://openrouter.ai/api/v1/key',method:'GET',keyed:false},{url:'https://openrouter.ai/api/v1/key',method:'GET',keyed:true}]);
  keyAnswer=401;
  const refused=await provider.check().then(()=>null,error=>error);
  assert.equal(provider.health(),'refused');assert.doesNotMatch(refused.message,/fictional-key/);
  assert.equal(requests.filter(request=>request.method==='POST').length,0);
  keyAnswer=200;
  await provider({kind:'chat',message:'Hello'});
  assert.equal(provider.health(),'ready');
  await provider.check();
  assert.equal(provider.health(),'ready');
  assert.equal(requests.filter(request=>request.method==='POST').length,1,'only the person\'s own chat was sent');
 }finally{globalThis.fetch=original;}
});
