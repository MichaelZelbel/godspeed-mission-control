import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';
import {modelProvider,STALL_WATCH} from '../core/runtime.mjs';import {withBackup} from '../core/backup-ai.mjs';

// #770: a provider that took the request and never answered left a chat spinning for ten minutes,
// while an HTTP 500 got the outage reply at once.
const FAST={afterMs:100,timeoutMs:150,everyMs:200};
// A provider on this computer is probed for its model list, a remote one with the connection check.
const isProbe=(req,body)=>req.method==='GET'?req.url.endsWith('/v1/models'):JSON.parse(body).max_tokens===8;
async function fakeAI(t,{mode='working',slowMs=700,reply='{"reply":"Here is your answer."}'}={}){
  const state={mode,slowMs,reply,chats:0,probes:0};
  const server=http.createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    const probe=isProbe(req,body);if(probe)state.probes++;else state.chats++;
    if(state.mode==='stalled')return;
    const answer=(status,content)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(status===200?{choices:[{message:{content}}]}:{error:{message:'Fictional outage'}}));};
    if(state.mode==='500')return answer(500);
    if(state.mode==='slow'&&!probe)return setTimeout(()=>answer(200,state.reply),state.slowMs);
    answer(200,probe?'OK':state.reply);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
  state.url='http://127.0.0.1:'+server.address().port+'/v1/chat/completions';
  return state;
}
const provider=(ai,options={})=>modelProvider({url:ai.url,key:'fictional-secret-key',model:'fictional-model',retryWaits:[],stallWatch:FAST,...options});
const pause=ms=>new Promise(r=>setTimeout(r,ms));

test('a call to a provider that stops answering ends as stalled, naming only its host',async t=>{
  const ai=await fakeAI(t,{mode:'stalled'}),started=Date.now();
  const error=await provider(ai)({kind:'conversation-chat',contract:'Answer.'}).then(()=>null,e=>e);
  assert.match(error?.message,/^The model provider at 127\.0\.0\.1:\d+ stopped answering\./);
  assert.ok(Date.now()-started<1000,'ended after one unanswered probe');
  assert.doesNotMatch(error.message,/fictional-secret-key|\/v1\//);
  assert.equal(error.code,'AI_STALLED');
});
test('a slow provider that answers its probes is not cut off',async t=>{
  const ai=await fakeAI(t,{mode:'slow',slowMs:700});
  assert.equal(await provider(ai)({kind:'conversation-chat',contract:'Answer.'}),'{"reply":"Here is your answer."}');
  assert.ok(ai.probes>=2,'probed '+ai.probes+' times while it worked');
});
test('an HTTP error is said at once, and an answer within the first wait sends no probe',async t=>{
  const ai=await fakeAI(t,{mode:'500'});
  await assert.rejects(provider(ai)({kind:'conversation-chat'}),/Model provider failed with HTTP 500: Fictional outage/);
  ai.mode='working';assert.equal(await provider(ai)({kind:'conversation-chat'}),'{"reply":"Here is your answer."}');
  await pause(300);assert.equal(ai.probes,0);
});
test('Stop keeps its own error and ends the watch',async t=>{
  const ai=await fakeAI(t,{mode:'stalled'}),controller=new AbortController();
  const call=provider(ai,{stallWatch:{afterMs:100,timeoutMs:1000,everyMs:200}})({kind:'conversation-chat',signal:controller.signal});
  await pause(150);controller.abort(Error('Reply stopped'));
  await assert.rejects(call,/^Error: Reply stopped$/);
  const probes=ai.probes;await pause(300);assert.equal(ai.probes,probes,'no probe after Stop');
});
test('routines keep their own budget and are not watched',async t=>{
  const ai=await fakeAI(t,{mode:'stalled'}),controller=new AbortController();
  const call=provider(ai)({kind:'coaching',timeout_ms:300000,signal:controller.signal});
  await pause(400);assert.equal(ai.probes,0);controller.abort(Error('Reply stopped'));await assert.rejects(call,/Reply stopped/);
});
test('an AI on this computer that answers one chat at a time is probed for its model list, so its slow answer gets through',async t=>{
  let line=Promise.resolve(),probes=0;
  const server=http.createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    const reply=content=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(content));};
    if(req.method==='GET'){probes++;return reply({data:[{id:'fictional-model'}]});}
    line=line.then(()=>pause(700).then(()=>reply({choices:[{message:{content:'The answer.'}}]})));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
  const local=modelProvider({url:'http://localhost:'+server.address().port+'/v1/chat/completions',key:'fictional-secret-key',model:'fictional-model',retryWaits:[],stallWatch:FAST});
  assert.equal(await local({kind:'conversation-chat'}),'The answer.');
  assert.ok(probes>=2,'probed '+probes+' times while it worked');
});
test('a stalled send is not handed to the backup AI, so it is said within one watch',async t=>{
  const ai=await fakeAI(t,{mode:'stalled'}),backup=await fakeAI(t,{mode:'stalled'}),started=Date.now();
  const error=await withBackup(provider(ai),()=>provider(backup))({kind:'conversation-chat'}).then(()=>null,e=>e);
  assert.equal(error?.code,'AI_STALLED');assert.match(error.message,new RegExp(new URL(ai.url).host));
  assert.equal(backup.chats,0,'the backup was not asked');assert.ok(Date.now()-started<1000,'ended in '+(Date.now()-started)+' ms');
});
test('the default watch says a stall within a minute and lets a 90 second answer through',()=>{
  assert.ok(STALL_WATCH.afterMs+STALL_WATCH.timeoutMs<60000);
  const secondProbe=STALL_WATCH.afterMs+STALL_WATCH.everyMs;
  assert.ok(secondProbe<90000&&secondProbe+STALL_WATCH.everyMs>90000,'two answered probes before a 90 second answer, no third');
});

async function serviceWith(t,aiProvider){
  const names=['GODSPEED_ORIGINAL_RUNTIME','GODSPEED_ASSISTANT_CONFIG','GODSPEED_MODEL_URL','GODSPEED_MODEL_KEY','GODSPEED_MODEL'],saved=Object.fromEntries(names.map(n=>[n,process.env[n]]));
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-stalled-provider-'));
  for(const n of names)delete process.env[n];process.env.GODSPEED_ASSISTANT_CONFIG=path.join(root,'no-assistant.json');
  const {createService}=await import('../server/main.mjs');const service=await createService({root:path.join(root,'workspace'),port:0,provider:aiProvider});
  t.after(async()=>{await service.close();for(const n of names)if(saved[n]===undefined)delete process.env[n];else process.env[n]=saved[n];fs.rmSync(root,{recursive:true,force:true});});
  const send=async(chat,extra={})=>{const started=Date.now(),response=await fetch('http://127.0.0.1:'+service.address.port+'/api/functions/'+chat,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'What should I do today?',...extra})});return {...await response.json(),elapsed:Date.now()-started};};
  return {service,send};
}
// #808: a stall was told as an outage, "Your AI could not be reached". It is told as an AI not answering.
const STALLED='Your AI is not answering. Try again in a moment, or check it in Settings, Your AI.';
test('a stalled send says the AI is not answering on the chat page, note panel and collection panel, and the next send after recovery is answered',async t=>{
  const ai=await fakeAI(t,{mode:'500'}),{service,send}=await serviceWith(t,provider(ai,{stallWatch:{afterMs:200,timeoutMs:300,everyMs:400}}));
  assert.match((await send('conversation-chat')).error,/^Your AI could not be reached/,'an HTTP 500 is an outage');
  const note=service.store.save('notes',{title:'Shopping',content:'A list'}),collection=service.store.save('collections',{name:'Films',field_schema:[{key:'title',label:'Title',type:'text',primary:true}]});
  ai.mode='stalled';
  for(const [chat,extra] of [['conversation-chat',{}],['note-chat',{note_id:note.id}],['collection-chat',{collection_id:collection.id}]]){
    const chats=ai.chats,result=await send(chat,extra);
    assert.equal(result.error,STALLED,chat);if(chat==='conversation-chat')assert.equal(ai.chats-chats,1,'a stalled meaning expansion is not followed by a chat call that would stall too');assert.ok(result.elapsed<1500,chat+' ended in '+result.elapsed+' ms');
  }
  ai.mode='working';
  const answered=await send('conversation-chat');assert.equal(answered.error,null);assert.equal(answered.data.reply,'Here is your answer.');
});
test('a closed port keeps its own reply',async t=>{
  const closed=http.createServer();await new Promise(r=>closed.listen(0,'127.0.0.1',r));const port=closed.address().port;await new Promise(r=>closed.close(r));
  const {send}=await serviceWith(t,modelProvider({url:'http://127.0.0.1:'+port+'/v1',key:'fictional-secret-key',model:'fictional-model',retryWaits:[],stallWatch:FAST}));
  const result=await send('conversation-chat');
  assert.match(result.error,/could not be reached/);assert.doesNotMatch(result.error,/stopped answering/);
});
test('a provider saved in Settings says a stall within a minute, also on this computer',{timeout:70000},async t=>{
  const ai=await fakeAI(t,{mode:'stalled'}),{send}=await serviceWith(t,modelProvider({url:ai.url,key:'fictional-secret-key',model:'fictional-model',retryWaits:[]}));
  const result=await send('conversation-chat');
  assert.equal(result.error,STALLED);assert.ok(result.elapsed<60000,'ended in '+result.elapsed+' ms');
});
