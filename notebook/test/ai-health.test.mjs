// #590: the chats, their pickers and the Dashboard card read one AI state. A refused key (401, 403)
// is told apart from an outage (a timeout, a provider error, no route, no answer), and a provider
// that stops answering counts as an outage within a few seconds.
import test from 'node:test';import assert from 'node:assert/strict';
import {aiFailure,trackAIHealth} from '../core/ai-health.mjs';
import {modelProvider} from '../core/runtime.mjs';

test('a refused key and an outage are told apart',()=>{
 for(const message of ['Model provider failed with HTTP 401: Invalid key','Model provider failed with HTTP 403: Forbidden','The connected AI account needs sign-in. Check the account in Settings before retrying.'])assert.equal(aiFailure(Error(message)),'refused',message);
 for(const message of ['Model provider failed with HTTP 500: oops','Model provider failed with HTTP 503','The AI at example.test could not be reached. Check that this computer is online.','fetch failed','The AI did not finish within ten minutes. Try a shorter message or a lower effort.','The AI did not answer the connection check within 3 seconds.','Model provider returned no text'])assert.equal(aiFailure(Error(message)),'unreachable',message);
 assert.equal(aiFailure(Error('Use a document-capable model endpoint for PDF analysis')),null,'a request the AI cannot take says nothing about the AI');
});

test('the newest result wins, whether a check or a chat request',async()=>{
 let fail=null;
 const inner=Object.assign(async()=>{if(fail)throw Error(fail);return 'ok';},{check:async()=>{if(fail)throw Error(fail);},options:async()=>({current:'m',models:[]})});
 const provider=trackAIHealth(inner);
 assert.equal(provider.health(),'unknown');assert.deepEqual(await provider.options(),{current:'m',models:[]});
 await provider.check();assert.equal(provider.health(),'ready');
 fail='Model provider failed with HTTP 401: Invalid key';await assert.rejects(provider({kind:'conversation-chat'}));assert.equal(provider.health(),'refused');
 fail='Model provider failed with HTTP 500';await assert.rejects(provider.check());assert.equal(provider.health(),'unreachable');
 fail='Model provider failed with HTTP 403';await assert.rejects(provider.check());assert.equal(provider.health(),'refused');
 fail=null;assert.equal(await provider({kind:'conversation-chat'}),'ok');assert.equal(provider.health(),'ready');
});

test('an older check that settles late does not overrule a newer chat result',async()=>{
 let release;const inner=Object.assign(async()=>{throw Error('Model provider failed with HTTP 403');},{check:()=>new Promise(resolve=>{release=resolve;})});
 const provider=trackAIHealth(inner,{waitMs:60000});
 const check=provider.check();await new Promise(r=>setImmediate(r));
 await assert.rejects(provider({kind:'conversation-chat'}));assert.equal(provider.health(),'refused');
 release();await check;assert.equal(provider.health(),'refused');
});

test('a stopped chat request says nothing about the AI',async()=>{
 const inner=async({signal})=>{throw signal.reason;},provider=trackAIHealth(inner,{initial:'ready'}),stop=new AbortController();stop.abort(Error('Reply stopped.'));
 await assert.rejects(provider({signal:stop.signal}));assert.equal(provider.health(),'ready');
});

test('a provider that stops answering is an outage within the wait, and answering again is seen at the next check',async()=>{
 let checks=0,release;
 const inner=Object.assign(async()=>'ok',{check:()=>{checks++;return checks===1?new Promise(resolve=>{release=resolve;}):Promise.resolve();}});
 const provider=trackAIHealth(inner,{waitMs:50,firstWaitMs:50,initial:'ready'}),started=Date.now();
 await assert.rejects(provider.check(),/did not answer the connection check/);
 assert.ok(Date.now()-started<1000);assert.equal(provider.health(),'unreachable');assert.equal(checks,1);
 // The next check does not wait for the stalled request: the provider answers it at once.
 await provider.check();assert.equal(checks,2);assert.equal(provider.health(),'ready');
 // The stalled request answering late is older news and changes nothing.
 release();await new Promise(r=>setImmediate(r));assert.equal(provider.health(),'ready');
});

test('a timer that fires a millisecond before the clock says the wait is over still lets the next check ask again (#785)',async()=>{
 // Timers have a granularity: the 50 ms timer can fire when Date.now() has moved only 49 ms. The
 // clock here is held at exactly that: it moves 49 ms once the stalled request has started.
 const realNow=Date.now,base=realNow();let now=base,checks=0;
 Date.now=()=>now;
 try{
  const inner=Object.assign(async()=>'ok',{check:()=>{checks++;if(checks===1){now=base+49;return new Promise(()=>{});}return Promise.resolve();}});
  const provider=trackAIHealth(inner,{waitMs:50,firstWaitMs:50,initial:'ready'});
  await assert.rejects(provider.check(),/did not answer the connection check/);assert.equal(provider.health(),'unreachable');
  await provider.check();assert.equal(checks,2,'the next check asks the provider again');assert.equal(provider.health(),'ready');
 }finally{Date.now=realNow;}
});

test('checks that overlap within the wait share one request',async()=>{
 let checks=0,release;
 const inner=Object.assign(async()=>'ok',{check:()=>{checks++;return new Promise(resolve=>{release=resolve;});}});
 const provider=trackAIHealth(inner,{waitMs:5000});
 const one=provider.check(),two=provider.check();await new Promise(r=>setImmediate(r));
 release();await Promise.all([one,two]);assert.equal(checks,1);assert.equal(provider.health(),'ready');
});

test('a provider that is slow but answers gets a second more than its last answer took',async()=>{
 let checks=0;
 const inner=Object.assign(async()=>'ok',{check:()=>{checks++;return new Promise(resolve=>setTimeout(resolve,checks===1?120:80));}});
 const provider=trackAIHealth(inner,{waitMs:50,firstWaitMs:50});
 await assert.rejects(provider.check(),/did not answer/);await new Promise(r=>setTimeout(r,100));assert.equal(provider.health(),'ready','the slow answer arrived');
 await provider.check();assert.equal(provider.health(),'ready','the next check waits long enough');
});

test('a working AI that is slow to answer its first check reads as ready, not unreachable (#788)',async()=>{
 const inner=Object.assign(async()=>'ok',{check:()=>new Promise(resolve=>setTimeout(resolve,150))});
 const provider=trackAIHealth(inner,{waitMs:50,firstWaitMs:400,initial:'ready'});
 await provider.check();assert.equal(provider.health(),'ready');
 await provider.check();assert.equal(provider.health(),'ready','the next check waits as long as the last answer took');
});

test('a check started before an older check\'s slow answer lands waits as long as that answer took (#788)',async()=>{
 const inner=Object.assign(async()=>'ok',{check:()=>new Promise(resolve=>setTimeout(resolve,300))});
 const provider=trackAIHealth(inner,{waitMs:100,firstWaitMs:100});
 await assert.rejects(provider.check(),/did not answer/);
 // The server checks again five seconds after the last check began: here, before the first answer lands.
 await new Promise(r=>setTimeout(r,150));
 const second=provider.check();
 await new Promise(r=>setTimeout(r,100));assert.equal(provider.health(),'ready','the first answer arrived');
 await second;assert.equal(provider.health(),'ready','the second check did not time out on the shorter wait');
});

test('an AI that never answers its check reads as unreachable within the first wait',async()=>{
 const inner=Object.assign(async()=>'ok',{check:()=>new Promise(()=>{})});
 const provider=trackAIHealth(inner,{waitMs:50,firstWaitMs:200,initial:'ready'}),started=Date.now();
 await assert.rejects(provider.check(),/did not answer the connection check/);
 assert.ok(Date.now()-started<1000);assert.equal(provider.health(),'unreachable');
 await assert.rejects(provider.check(),/did not answer the connection check/);assert.equal(provider.health(),'unreachable');
});

test('a real model provider: 401 and 403 are refusals, 500 and a closed port are outages, and no key is kept',async()=>{
 const original=globalThis.fetch;let answer;
 globalThis.fetch=async()=>{if(answer==='down')throw new TypeError('fetch failed');return new Response(JSON.stringify(answer===200?{choices:[{message:{content:'OK'}}]}:{error:{message:'private detail fictional-key'}}),{status:answer,headers:{'Content-Type':'application/json'}});};
 try{
  const provider=trackAIHealth(modelProvider({url:'http://localhost/fixture',key:'fictional-key',model:'fictional-model',retryWaits:[]}));
  for(const [status,expected] of [[200,'ready'],[401,'refused'],[200,'ready'],[403,'refused'],[500,'unreachable'],['down','unreachable'],[200,'ready']]){
   answer=status;await provider.check().catch(()=>{});assert.equal(provider.health(),expected,String(status));assert.doesNotMatch(String(provider.health()),/fictional-key|private/);
  }
 }finally{globalThis.fetch=original;}
});
