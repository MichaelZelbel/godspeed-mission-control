import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';import {EventEmitter} from 'node:events';import {PassThrough} from 'node:stream';
import {providerTimeBudget,providerTimeoutMessage,jobExecutor,modelProvider,hermesProvider,hermesFailureMessage} from '../core/runtime.mjs';import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';
import {withBackup} from '../core/backup-ai.mjs';
test('interactive and background calls remain bounded, with no arbitrary timeout extension',()=>{
 assert.equal(providerTimeBudget({}),600000);assert.equal(providerTimeBudget({timeout_ms:300000}),300000);
 for(const timeout_ms of [0,-1,Infinity,'300000',3600000])assert.throws(()=>providerTimeBudget({timeout_ms}),/supported/);
 assert.match(providerTimeoutMessage(300000),/attempt failed/);assert.match(providerTimeoutMessage(600000),/ten minutes/);
});

test('the short suggestion budget is accepted only for drafting and aborts native requests',async()=>{
 assert.equal(providerTimeBudget({kind:'draft-event',timeout_ms:20000}),20000);
 assert.throws(()=>providerTimeBudget({kind:'conversation-chat',timeout_ms:20000}),/supported/);
 assert.match(providerTimeoutMessage(20000),/20 seconds.*try again/i);
 let observed;
 const original=globalThis.fetch;globalThis.fetch=async(url,options)=>{observed=options.signal;return await new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});});};
 try{const controller=new AbortController(),call=modelProvider({url:'http://localhost/fixture',key:'fictional',model:'fictional'})({kind:'draft-event',timeout_ms:20000,signal:controller.signal});controller.abort();await assert.rejects(call);assert.equal(observed.aborted,true);}finally{globalThis.fetch=original;}
});
test('the configured model remains visible through the provider wrapper used by the server',async()=>{
 const provider=withBackup(modelProvider({url:'http://localhost/fixture',key:'fictional',model:'configured-super-readable-model'}),()=>null);
 assert.deepEqual(await provider.options(),{current:'configured-super-readable-model',models:[{id:'configured-super-readable-model',efforts:[]}]});
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
test('Hermes one-turn routine requests explicitly select no tools',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-hermes-one-turn-'));let captured;
 const provider=hermesProvider({home,cwd:home,spawnProcess:(executable,args)=>{captured={executable,args};const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin.on('data',()=>queueMicrotask(()=>{child.stdout.end('Connected.\n');child.stderr.end();child.emit('close',0);}));return child;}});
 assert.equal(await provider({kind:'connection-test'}),'Connected.');
 assert.equal(captured.executable,'hermes');assert.deepEqual(captured.args,['chat','--query-file','-','--quiet','--oneshot','--max-turns','1','--toolsets','no_mcp','--in',home,'--source','tool']);
 assert.equal(captured.args.filter(a=>a==='--toolsets').length,1);
});
test('a Hermes that refuses the toolset name none, as 0.22 and 0.23.1 do, still answers',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-hermes-refuses-none-'));
 const provider=hermesProvider({home,cwd:home,spawnProcess:(executable,args)=>{const toolsets=args[args.indexOf('--toolsets')+1];const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin.on('data',()=>queueMicrotask(()=>{if(toolsets==='none'){child.stdout.end("Hermes couldn't start the model connection: invalid_params (toolsets: unknown or invalid toolset name: 'none'). Your message was not sent.\n");child.stderr.end();child.emit('close',1);}else{child.stdout.end('Connected.\n');child.stderr.end();child.emit('close',0);}}));return child;}});
 assert.equal(await provider({kind:'connection-test'}),'Connected.');
});
test('endpoint control budget is not sent as source text and cancellation remains effective',async()=>{
 let received;const server=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;received=JSON.parse(raw);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:'Fictional bounded reply'}}]}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const provider=modelProvider({url:'http://127.0.0.1:'+server.address().port,key:'fictional-key',model:'fictional-model'});
 try{assert.equal(await provider({kind:'test',timeout_ms:300000,contract:'Only fictional evidence'}),'Fictional bounded reply');assert.ok(!JSON.stringify(received).includes('timeout_ms'));const controller=new AbortController();controller.abort();await assert.rejects(provider({kind:'test',signal:controller.signal}));}finally{await new Promise(r=>server.close(r));}
});

test('the native model input context rejection is reported as a context limit',()=>{assert.match(hermesFailureMessage('APIError: model input exceeds the context window for this model'),/context limit/);});

// One "HTTP 502: Provider returned error" failed connecting a free model in Settings (18 October 2026).
test('a passing 502, 503, 504 or 429 from the provider is tried again, and other errors are said at once',async()=>{
 const answers=[];let calls=0;
 const server=http.createServer(async(req,res)=>{for await(const chunk of req);calls++;const [status,body]=answers.shift()||[200,{choices:[{message:{content:'Connected.'}}]}];res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const provider=modelProvider({url:'http://127.0.0.1:'+server.address().port,key:'fictional-key',model:'fictional-model',retryWaits:[10,10]});
 try{
  answers.push([502,{error:{message:'Provider returned error'}}],[429,{error:{message:'Rate limited'}}]);
  assert.equal(await provider({kind:'connection-test'}),'Connected.');assert.equal(calls,3,'two passing errors, then the answer');
  calls=0;answers.push([503,{}],[503,{}],[503,{error:{message:'Still down'}}]);
  await assert.rejects(provider({kind:'connection-test'}),/Model provider failed with HTTP 503: Still down/);assert.equal(calls,3,'tried three times in all');
  calls=0;answers.push([401,{error:{message:'Invalid key'}}]);
  assert.deepEqual(await provider.options(),{current:'fictional-model',models:[{id:'fictional-model',efforts:[]}]});
  await assert.rejects(provider({kind:'connection-test'}),/HTTP 401: Invalid key/);assert.equal(calls,1,'a wrong key is said at once');
  await assert.rejects(provider.options(),/refused its key/);
  answers.push([200,{choices:[{message:{content:'Connected again.'}}]}]);
  assert.equal(await provider({kind:'connection-test'}),'Connected again.');
  assert.deepEqual(await provider.options(),{current:'fictional-model',models:[{id:'fictional-model',efforts:[]}]});
 }finally{await new Promise(r=>server.close(r));}
});

// Only a connection that failed is called unreachable (#506): a header Node refused on this computer
// and a stopped request keep their own errors.
test('a stopped request keeps its own error and a local fetch error is not called unreachable',async()=>{
 const original=globalThis.fetch,ask=modelProvider({url:'http://localhost/fixture',key:'fictional',model:'fictional',retryWaits:[]});
 try{
  globalThis.fetch=async()=>{throw new TypeError('Cannot convert argument to a ByteString');};
  await assert.rejects(ask({kind:'chat'}),{name:'TypeError',message:'Cannot convert argument to a ByteString'});
  globalThis.fetch=async(url,options)=>{throw options.signal.reason;};
  const controller=new AbortController();controller.abort();
  await assert.rejects(ask({kind:'chat',signal:controller.signal}),{name:'AbortError'});
  globalThis.fetch=async()=>{throw new TypeError('fetch failed');};
  await assert.rejects(ask({kind:'chat'}),{message:/^The AI at localhost could not be reached\./});
 }finally{globalThis.fetch=original;}
});
