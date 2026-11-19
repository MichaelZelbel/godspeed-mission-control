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
    if(state.mode==='stalled'||(state.mode==='probe-only'&&!probe))return;
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
  assert.equal(ai.chats,1,'sent once');
});
// #782: a send made while the AI was stalled kept spinning toward ten minutes once the AI came back,
// because the request it made was swallowed and its probes now answered.
const RECOVERY={afterMs:200,timeoutMs:150,everyMs:400};
const whenChatArrives=async(ai,chats)=>{while(ai.chats<=chats)await pause(10);};
test('a send made while the AI was stalled is sent once more when the AI answers again, and gets the answer',async t=>{
  const ai=await fakeAI(t,{mode:'stalled'}),call=provider(ai,{stallWatch:RECOVERY});
  assert.equal((await call({kind:'conversation-chat'}).then(()=>null,e=>e))?.code,'AI_STALLED');
  const chats=ai.chats,send=call({kind:'conversation-chat'});
  await whenChatArrives(ai,chats);ai.mode='working';const recovered=Date.now();
  assert.equal(await send,'{"reply":"Here is your answer."}');
  assert.ok(Date.now()-recovered<1000,'ended '+(Date.now()-recovered)+' ms after the AI came back');
  assert.equal(ai.chats-chats,2,'the swallowed request and one fresh copy');
});
test('a connection check that times out while another program holds an AI on this computer leaves the next send sent once',{timeout:40000},async t=>{
  // A local model server that answers its model list at once and one chat at a time.
  let line=Promise.resolve(),chats=0;
  const server=http.createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    const reply=content=>{if(res.destroyed)return;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(content));};
    if(req.method==='GET')return reply({data:[{id:'fictional-model'}]});
    const {max_tokens}=JSON.parse(body),holdMs=max_tokens===100?16000:700;if(max_tokens!==100&&max_tokens!==8)chats++;
    line=line.then(()=>pause(holdMs).then(()=>reply({choices:[{message:{content:'The answer.'}}]})));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
  const url='http://127.0.0.1:'+server.address().port+'/v1/chat/completions';
  const other=fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({max_tokens:100,messages:[]})}).then(r=>r.text(),()=>{});
  await pause(100);
  const call=modelProvider({url,key:'fictional-secret-key',model:'fictional-model',retryWaits:[],stallWatch:FAST});
  await assert.rejects(call.check(),/did not finish/);
  const before=chats;
  assert.equal(await call({kind:'conversation-chat'}),'The answer.');
  assert.equal(chats-before,1,'sent once');
  await other;
});
test('a connection check that got no answer from a stalled AI on this computer makes the next send be sent once more when the AI answers again',{timeout:40000},async t=>{
  const ai=await fakeAI(t,{mode:'stalled'}),call=provider(ai,{stallWatch:RECOVERY});
  await assert.rejects(call.check(),/did not finish/);
  const chats=ai.chats,send=call({kind:'conversation-chat'});
  await whenChatArrives(ai,chats);ai.mode='working';
  assert.equal(await send,'{"reply":"Here is your answer."}');
  assert.equal(ai.chats-chats,2,'the swallowed request and one fresh copy');
});
test('a connection check that got no answer from a remote AI makes the next send be sent once more when the AI answers again',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  let mode='stalled',calls=0;
  globalThis.fetch=async(url,init)=>{
    calls++;
    if(mode==='working')return new Response(JSON.stringify({choices:[{message:{content:'The answer.'}}]}),{status:200,headers:{'Content-Type':'application/json'}});
    // A connection check is given 15 seconds; this one is ended by its timeout at once.
    if(calls===1)throw new DOMException('The operation was aborted due to timeout','TimeoutError');
    return new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true}));
  };
  const call=modelProvider({url:'https://ai.example.test/v1/chat/completions',key:'fictional-secret-key',model:'fictional-model',retryWaits:[],stallWatch:RECOVERY});
  await assert.rejects(call.check(),/did not finish/);
  const send=call({kind:'conversation-chat'});
  while(calls<2)await pause(10);
  mode='working';
  assert.equal(await send,'The answer.');
  assert.equal(calls,4,'the check, the swallowed request, the answered probe and one fresh copy');
});
test('a slow send to an AI that missed a check but answered since is sent once',async t=>{
  const ai=await fakeAI(t,{mode:'stalled'}),call=provider(ai);
  await call({kind:'conversation-chat'}).catch(()=>{});
  ai.mode='working';await call({kind:'conversation-chat'});
  ai.mode='slow';const chats=ai.chats;
  assert.equal(await call({kind:'conversation-chat'}),'{"reply":"Here is your answer."}');
  assert.ok(ai.probes>=3,'probed while it worked');assert.equal(ai.chats-chats,1,'sent once');
});
test('a fresh copy that gets no answer either ends with the outage reply',async t=>{
  const ai=await fakeAI(t,{mode:'stalled'}),call=provider(ai,{stallWatch:RECOVERY});
  await call({kind:'conversation-chat'}).catch(()=>{});
  const chats=ai.chats,send=call({kind:'conversation-chat'}).then(()=>null,e=>e);
  await whenChatArrives(ai,chats);
  // The probe answers, then the fresh copy and its probe are swallowed again.
  ai.mode='probe-only';
  await whenChatArrives(ai,chats+1);ai.mode='stalled';
  assert.equal((await send)?.code,'AI_STALLED');assert.equal(ai.chats-chats,2);
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
test('a stalled send gets the reply an HTTP 500 gets on the chat page, note panel and collection panel, and the next send after recovery is answered',async t=>{
  const ai=await fakeAI(t,{mode:'500'}),{service,send}=await serviceWith(t,provider(ai,{stallWatch:{afterMs:200,timeoutMs:300,everyMs:400}}));
  const outage=(await send('conversation-chat')).error;assert.ok(outage,'an HTTP 500 is an error reply');
  const note=service.store.save('notes',{title:'Shopping',content:'A list'}),collection=service.store.save('collections',{name:'Films',field_schema:[{key:'title',label:'Title',type:'text',primary:true}]});
  ai.mode='stalled';
  for(const [chat,extra] of [['conversation-chat',{}],['note-chat',{note_id:note.id}],['collection-chat',{collection_id:collection.id}]]){
    const chats=ai.chats,result=await send(chat,extra);
    assert.equal(result.error,outage,chat);if(chat==='conversation-chat')assert.equal(ai.chats-chats,1,'a stalled meaning expansion is not followed by a chat call that would stall too');assert.ok(result.elapsed<1500,chat+' ended in '+result.elapsed+' ms');
  }
  ai.mode='working';
  const answered=await send('conversation-chat');assert.equal(answered.error,null);assert.equal(answered.data.reply,'Here is your answer.');
});
test('a send made during a stall is answered once the AI is back, on the chat page, note panel and collection panel',async t=>{
  const ai=await fakeAI(t,{mode:'500'}),{service,send}=await serviceWith(t,provider(ai,{stallWatch:RECOVERY}));
  const note=service.store.save('notes',{title:'Shopping',content:'A list'}),collection=service.store.save('collections',{name:'Films',field_schema:[{key:'title',label:'Title',type:'text',primary:true}]});
  for(const [chat,extra] of [['conversation-chat',{}],['note-chat',{note_id:note.id}],['collection-chat',{collection_id:collection.id}]]){
    ai.mode='stalled';assert.ok((await send(chat,extra)).error,chat+' gets the outage reply while stalled');
    const chats=ai.chats,sending=send(chat,extra);
    await whenChatArrives(ai,chats);ai.mode='working';const recovered=Date.now();
    const result=await sending,afterRecovery=Date.now()-recovered;
    assert.equal(result.error,null,chat);assert.equal(result.data.reply,'Here is your answer.',chat);assert.ok(afterRecovery<1500,chat+' ended '+afterRecovery+' ms after the AI came back');
  }
});
test('a closed port keeps its own reply',async t=>{
  const closed=http.createServer();await new Promise(r=>closed.listen(0,'127.0.0.1',r));const port=closed.address().port;await new Promise(r=>closed.close(r));
  const {send}=await serviceWith(t,modelProvider({url:'http://127.0.0.1:'+port+'/v1',key:'fictional-secret-key',model:'fictional-model',retryWaits:[],stallWatch:FAST}));
  const result=await send('conversation-chat');
  assert.match(result.error,/could not be reached/);assert.doesNotMatch(result.error,/stopped answering/);
});
test('a provider saved in Settings says a stall within a minute, also on this computer',{timeout:70000},async t=>{
  const ai=await fakeAI(t,{mode:'500'}),{send}=await serviceWith(t,modelProvider({url:ai.url,key:'fictional-secret-key',model:'fictional-model',retryWaits:[]}));
  const outage=(await send('conversation-chat')).error;
  ai.mode='stalled';const result=await send('conversation-chat');
  assert.equal(result.error,outage);assert.ok(result.elapsed<60000,'ended in '+result.elapsed+' ms');
});
