import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';
import {providerTimeBudget,providerTimeoutMessage,jobExecutor,modelProvider,hermesProvider,hermesFailureMessage} from '../core/runtime.mjs';import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';
test('interactive and background calls remain bounded, with no arbitrary timeout extension',()=>{
 assert.equal(providerTimeBudget({}),120000);assert.equal(providerTimeBudget({timeout_ms:300000}),300000);
 for(const timeout_ms of [0,-1,Infinity,'300000',3600000])assert.throws(()=>providerTimeBudget({timeout_ms}),/supported/);
 assert.match(providerTimeoutMessage(300000),/attempt failed/);assert.match(providerTimeoutMessage(120000),/two minutes/);
});
test('scheduled coaching uses its background budget and preserves the chosen model effort',async()=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-background-budget-'))),query=new QueryService(store),calls=[],provider=async input=>{calls.push(input);return 'Which fictional habit feels easiest?';};
 provider.options=async()=>({current:'fictional-model',models:[{id:'fictional-model',efforts:['low','medium']}]});
 const result=await jobExecutor(provider,query)({id:'fictional-coaching',kind:'coaching'},{store,settings:{timezone:'UTC',scheduled_effort:'medium'}});
 assert.equal(result.verified,true);assert.equal(calls[0].timeout_ms,300000);assert.equal(calls[0].effort,'medium');assert.equal(query.rows('coach_talks').length,1);assert.equal(store.list('coach_talks').length,0);
});
test('unsupported Hermes budget rejects before creating attachment files or starting a process',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-rejected-budget-'));
 await assert.rejects(hermesProvider({home,cwd:home})({timeout_ms:3600000,attachments:[{mime:'image/png',data:'AA=='}]}),/supported/);
 assert.deepEqual(fs.readdirSync(home),[]);
});
test('endpoint control budget is not sent as source text and cancellation remains effective',async()=>{
 let received;const server=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;received=JSON.parse(raw);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:'Fictional bounded reply'}}]}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const provider=modelProvider({url:'http://127.0.0.1:'+server.address().port,key:'fictional-key',model:'fictional-model'});
 try{assert.equal(await provider({kind:'test',timeout_ms:300000,contract:'Only fictional evidence'}),'Fictional bounded reply');assert.ok(!JSON.stringify(received).includes('timeout_ms'));const controller=new AbortController();controller.abort();await assert.rejects(provider({kind:'test',signal:controller.signal}));}finally{await new Promise(r=>server.close(r));}
});

test('the native model input context rejection is reported as a context limit',()=>{assert.match(hermesFailureMessage('APIError: model input exceeds the context window for this model'),/context limit/);});
