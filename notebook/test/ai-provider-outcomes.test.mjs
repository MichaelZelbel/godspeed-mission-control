// #861: one module (core/ai-outcome.mjs) turns every AI provider outcome into the one sentence a
// person reads, and every notebook route that calls the AI answers with it. Here the notebook runs
// against a stand-in AI on 127.0.0.1 and every route in AI_ROUTES is driven through every cause:
// refused key, out of credit, busy or limited, unavailable, stalled, unusable answer. For each, the
// answer a person sees must name the right cause and carry none of the provider's words: no "HTTP",
// no status number, no "Model provider failed", no stack trace, never the key. The three cases of
// #833 and the 402 case are among the legs. A damaged provider file gives one plain log line per
// request, not a stack trace.
import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';
import {aiRoutes,answerCause,diagnosticCause,plainAIError,connectionTestError} from '../core/ai-outcome.mjs';
import {AI_REFUSED,AI_UNREACHABLE,AI_STALLED,AI_NO_CREDIT,AI_BUSY,AI_UNREADABLE,
  KEY_REFUSED,CONNECT_UNREACHABLE,AI_SERVICE_FAILED,AI_REQUEST_LIMITED,AI_REQUEST_REJECTED,CONNECT_NO_CREDIT} from '../core/no-ai.mjs';
import {RETRY_WAITS,STALL_WATCH} from '../core/runtime.mjs';
import {mediaObjectName} from '../core/media-names.mjs';
import {hash} from '../core/records/store.mjs';

const KEY='sk-fictional-861-secret';
// Anything the provider said must stay behind: its wording, its status numbers, the key, a stack.
const RAW=/HTTP|\b[1-5]\d\d\b|Model provider|provider wording|Incorrect API key|invalid_api_key|SyntaxError|\bat .*\.mjs|127\.0\.0\.1|localhost/;

// The stand-in AI. Every error body carries its provider wording and the key, so a leg that lets
// either through is caught. "network" cuts the connection, "hang" takes it and never answers.
function standIn(t){
  const state={mode:'ok'};
  const ERROR_BODIES={
    refused401:[401,{error:{message:'Incorrect API key provided: '+KEY+' (provider wording)'}}],
    refused403:[403,{error:{message:'Forbidden, provider wording '+KEY}}],
    refusedCode:[400,{error:{code:'invalid_api_key',message:'Incorrect API key provided: '+KEY}}],
    noCredit:[402,{error:{message:'Insufficient credits, provider wording '+KEY}}],
    busy:[429,{error:{message:'Rate limit exceeded, provider wording'}}],
    unavailable500:[500,{error:{message:'Internal server error mentioning invalid_api_key and '+KEY}}],
    // An outage whose body names a refused key is still an outage, whatever the body says: during
    // one, a person with a working key must not be told to replace it (#861 review C1).
    unavailable500key:[500,{error:{code:'invalid_api_key',message:'Incorrect API key provided: '+KEY}}],
    unavailable502key:[502,{error:{code:'invalid_api_key',message:'Incorrect API key provided: '+KEY}}],
    // A plain 4xx with no provider code, the wrong model name Settings' own comment calls the most
    // common mistake: the routes say an outage, and the connection tests say what to check (#861 review R6).
    badModel:[400,{error:{message:'The model fictional-model does not exist, provider wording '+KEY}}],
  };
  const server=http.createServer((req,res)=>{
    req.on('error',()=>{});
    if(state.mode==='network'){res.socket?.destroy();return;}
    if(state.mode==='hang')return;
    req.resume();req.on('end',()=>{
      if(state.mode==='ok'){res.setHeader('content-type','application/json');return res.end(JSON.stringify({choices:[{message:{content:'{"title":"Connected"}'}}]}));}
      if(state.mode==='noText'){res.setHeader('content-type','application/json');return res.end(JSON.stringify({choices:[]}));}
      if(state.mode==='notJsonBody'){res.setHeader('content-type','text/html');return res.end('<html>provider wording '+KEY+'</html>');}
      if(state.mode==='replyNotJson'){res.setHeader('content-type','application/json');return res.end(JSON.stringify({choices:[{message:{content:'Connected.'}}]}));}
      const [status,body]=ERROR_BODIES[state.mode];
      res.statusCode=status;res.setHeader('content-type','application/json');res.end(JSON.stringify(body));
    });
  });
  server.on('connection',socket=>{socket.on('error',()=>{});});
  const close=()=>{server.closeAllConnections?.();return new Promise(resolve=>server.close(resolve));};
  const set=mode=>{if(state.mode==='hang'&&mode!=='hang')server.closeAllConnections?.();state.mode=mode;};
  return {state,set,close,port:0,server,url:'',address:()=>''};
}

async function notebook(t,env={}){
  const names=['GODSPEED_ORIGINAL_RUNTIME','GODSPEED_ASSISTANT_CONFIG','GODSPEED_MODEL_URL','GODSPEED_MODEL_KEY','GODSPEED_MODEL'],saved=Object.fromEntries(names.map(n=>[n,process.env[n]]));
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-ai-outcomes-'));
  for(const n of names)delete process.env[n];process.env.GODSPEED_ASSISTANT_CONFIG=path.join(root,'no-assistant.json');Object.assign(process.env,env);
  // The retries and the stall watch are shortened here, in this file's own process, so a retried 5xx
  // fails at once and a provider that never answers stalls within a second instead of twenty.
  const waits=[...RETRY_WAITS],watch={...STALL_WATCH};
  RETRY_WAITS[0]=RETRY_WAITS[1]=0;Object.assign(STALL_WATCH,{afterMs:50,timeoutMs:300,everyMs:60000});
  const {createService}=await import('../server/main.mjs');const service=await createService({root:path.join(root,'workspace'),port:0});
  const ai=standIn(t);await new Promise(resolve=>ai.server.listen(0,'127.0.0.1',resolve));
  ai.url='http://127.0.0.1:'+ai.server.address().port+'/v1/chat/completions';
  ai.localUrl='http://localhost:'+ai.server.address().port+'/v1/chat/completions';
  t.after(async()=>{await service.close();await ai.close();RETRY_WAITS[0]=waits[0];RETRY_WAITS[1]=waits[1];Object.assign(STALL_WATCH,watch);for(const n of names)if(saved[n]===undefined)delete process.env[n];else process.env[n]=saved[n];fs.rmSync(root,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+service.address.port;
  const post=async(route,body)=>{const r=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,text:await r.text()};};
  const connect=async()=>assert.equal((await post('/api/provider',{url:ai.url,key:KEY,model:'fictional-model',routines:false})).status,200);
  await connect();
  return {service,ai,base,post,connect,providerFile:path.join(root,'workspace','.godspeed','provider.json')};
}

// One seed of everything the routes read: a note, a moment, a person and a group with them, and an
// uploaded picture and PDF without extracted text, the way pdf-upload.test.mjs uploads one.
async function seeded(t){
  const nb=await notebook(t),{service}=nb,store=service.store;
  const note=store.save('notes',{title:'Lunch with Ada',content:'Ada said she moved to Lisbon in May.'});
  const moment=store.save('moments',{title:'Lunch with Ada',description:'We talked about the garden.',happened_at:'2026-11-01'});
  const person=store.save('contacts',{name:'Fictional Ada'});
  const group=store.save('contact_groups',{name:'Book club'});
  store.save('contact_group_memberships',{group_id:group.id,contact_id:person.id});
  const upload=async(name,data,type,extra={})=>{const form=new FormData();form.set('file',new Blob([data],{type}),name);form.set('path','owner/'+name);for(const [k,v] of Object.entries(extra))form.set(k,v);
    const r=await fetch(nb.base+'/api/media/upload',{method:'POST',body:form});assert.equal(r.status,200,await r.text());return 'owner/'+name;};
  const picture=await upload('picture.png',Buffer.from('89504e470d0a1a0a','hex'),'image/png');
  const pdf=await upload('agreement.pdf',Buffer.from('%PDF-1.4 fictional agreement'),'application/pdf');
  store.save('note_attachments',{note_id:note.id,storage_path:picture,filename:'picture.png',file_type:'image/png'});
  const run=(route,body)=>nb.post(route,body);
  return {...nb,note,moment,person,group,picture,pdf,run};
}

// What each leg asks, keyed by route. A route listed in AI_ROUTES without an entry here fails the
// first test, so a new AI route is included or the test fails.
function fixturesFor(seeded){
  const {note,moment,group,run}=seeded,uuid=()=>globalThis.crypto.randomUUID();
  return {
    '/api/functions/conversation-chat':()=>[{request_id:uuid(),message:'Hello'},{mode:'summarize',messages:[{role:'user',content:'Hello'}]}],
    '/api/functions/note-chat':()=>[{note_id:note.id,message:'Hello'}],
    '/api/functions/collection-chat':()=>[{message:'Hello'}],
    '/api/functions/draft-event':()=>[{message:'Lunch with Ada yesterday'}],
    '/api/functions/process-note':()=>[{note_id:note.id,reason:'manual'}],
    '/api/functions/generate-profile-suggestions':()=>[{}],
    '/api/functions/enrich-people':()=>[{}],
    '/api/functions/extract-moment-profile':()=>[{moment_id:moment.id}],
    '/api/functions/analyze-media':()=>[{storage_path:seeded.picture,media_type:'image',original_filename:'picture.png'}],
    '/api/functions/analyze-pdf':()=>[{storage_path:seeded.pdf,media_type:'pdf',original_filename:'agreement.pdf'}],
    '/api/functions/classify-profile-fact':()=>[{text:'My favourite colour is green'}],
    '/api/functions/generate_collection_schema':()=>[{prompt:'A collection for the books I read'}],
    '/api/functions/weekly-review':()=>[{}],
    '/api/functions/generate-group-briefing':()=>[{group_id:group.id}],
    '/api/functions/suggest-group-members':()=>[{group_id:group.id}],
    '/api/functions/suggest-group-next-step':()=>[{group_id:group.id}],
    '/api/functions/backfill-metadata':()=>[{}],
    '/api/functions/backfill-profile-extraction':()=>[{}],
    '/api/functions/backfill-moment-profile-extraction':()=>[{}],
    '/api/functions/backfill-media-analysis':()=>[{}],
    '/api/browser-chat':()=>[{message:'Hello'}],
    '/api/provider':()=>[{url:seeded.ai.localUrl,key:KEY,model:'fictional-model',routines:false}],
    '/api/backup-ai':()=>[{url:seeded.ai.localUrl,key:KEY,model:'fictional-model'}],
  };
}

// The cause of each mode, the sentence a route answers with, and the sentence Settings' connection
// tests answer with (core/ai-outcome.mjs). replyNotJson succeeds on the connection tests: they never
// read what the model said, only that it answered. A suggestion whose AI never answers says the
// module's stalled sentence like every other route: its form's 20-second budget is the shared one
// (DRAFT_BUDGET_MS), and the timeout travels through the module as a stalled outcome (#861 review D3).
const MODE_CAUSE={refused401:'refused',refused403:'refused',refusedCode:'refused',noCredit:'no-credit',busy:'busy',unavailable500:'unavailable',unavailable500key:'unavailable',unavailable502key:'unavailable',badModel:'unavailable',network:'unavailable',noText:'unusable',notJsonBody:'unusable',replyNotJson:'unusable',hang:'stalled'};
const ROUTE_SAID={refused:AI_REFUSED,'no-credit':AI_NO_CREDIT,busy:AI_BUSY,unavailable:AI_UNREACHABLE,stalled:AI_STALLED,unusable:AI_UNREADABLE};
const SETTINGS_SAID={refused:KEY_REFUSED,'no-credit':CONNECT_NO_CREDIT,busy:AI_REQUEST_LIMITED,stalled:AI_STALLED,unusable:AI_UNREADABLE};
const settingsSaid=(cause,mode)=>cause==='unavailable'?(mode==='network'?CONNECT_UNREACHABLE:mode==='badModel'?AI_REQUEST_REJECTED:AI_SERVICE_FAILED):SETTINGS_SAID[cause];
const saidFor=(route,mode)=>{
  const cause=MODE_CAUSE[mode];
  if(route==='/api/provider'||route==='/api/backup-ai')return mode==='replyNotJson'?null:settingsSaid(cause,mode);
  return ROUTE_SAID[cause];
};

// The error the person is shown: the route's error line, or, for the backfills (which answer 200 and
// carry on past a failed item), the error kept on the item that failed.
const shown=(route,answer)=>{
  const body=JSON.parse(answer.text);
  if(route.startsWith('/api/functions/backfill')){const payload=body.data??body;return payload.errors.map(e=>e.error);}
  return [body.error];
};

test('every AI route is driven through every outcome, and says its one plain sentence',async t=>{
  const seededN=await seeded(t),fixtures=fixturesFor(seededN),run=seededN.run,AI_ROUTES=aiRoutes();
  assert.deepEqual(Object.keys(fixtures).sort(),[...AI_ROUTES].sort(),'the routes the test drives are exactly the ones the module lists');
  const connectionRoutes=['/api/backup-ai','/api/provider'];
  for(const mode of Object.keys(MODE_CAUSE)){
    seededN.ai.set(mode);
    // The backup's leg goes first: a connected main AI must not be the backup's own service, so the
    // backup connects against the localhost name of the same stand-in while the main is saved under
    // 127.0.0.1; the provider's own leg may then reconnect it.
    for(const route of [...AI_ROUTES.filter(r=>!connectionRoutes.includes(r)),...connectionRoutes]){
      for(const body of fixtures[route]()){
        const answer=await run(route,body),expected=saidFor(route,mode);
        if(expected===null){ // the connection test only wants an answer: it passed
          assert.equal(answer.status,200,route+' '+mode+': '+answer.text);
          assert.equal(JSON.parse(answer.text).connected,true,route+' '+mode);
          if(route==='/api/backup-ai')await seededN.post('/api/backup-ai/remove',{});
          // The provider is saved again under 127.0.0.1, so the next mode's backup leg is not told
          // it is the main AI's own service.
          if(route==='/api/provider')await seededN.connect();
          continue;
        }
        // The backfills carry on past a failed item and answer 200 with the failure on the item.
        if(!route.startsWith('/api/functions/backfill'))assert.notEqual(answer.status,200,route+' '+mode+': '+answer.text);
        const saidList=shown(route,answer);
        if(route.startsWith('/api/functions/backfill'))assert.ok(saidList.length>=1,route+' '+mode+': '+answer.text);
        for(const said of saidList)assert.equal(said,expected,route+' '+mode);
        assert.doesNotMatch(answer.text,RAW,route+' '+mode);
        assert.equal(answer.text.includes(KEY),false,route+' '+mode);
      }
    }
    // An answer the AI gave but that could not be used says the AI answered: after the replyNotJson
    // legs on the chats, the availability a person reads still says ready, connected and usable
    // (#861 review R5). An AI that refused, was busy or failed does not (the modes above).
    if(mode==='replyNotJson'){
      const status=JSON.parse(await (await fetch(seededN.base+'/api/status')).text());
      assert.equal(status.aiConfigured,true,mode);
      assert.equal(status.runtimeConfigured,true,mode);
      assert.equal(status.aiAvailability,'ready',mode);
    }
    // The stub's hanging sockets from this mode's legs are closed before the next mode asks.
    seededN.ai.server.closeAllConnections?.();
  }
  await seededN.ai.close();
});

test('an AI failure through the MCP door is told in plain words too, never the provider\'s',async t=>{
  const nb=await seeded(t);
  nb.ai.set('refused401');
  const response=await fetch(nb.base+'/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'create_moment_with_ai',arguments:{description:'Lunch with Ada yesterday'}}})});
  const result=(await response.json()).result;
  assert.equal(result.isError,true);
  assert.equal(result.content[0].text,AI_REFUSED);
  assert.equal(result.content[0].text.includes(KEY),false);
  assert.doesNotMatch(result.content[0].text,RAW);
});

test('a damaged provider file gives one plain log line per request, not a stack trace, and reconnecting recovers it',async t=>{
  const nb=await notebook(t);
  fs.mkdirSync(path.dirname(nb.providerFile),{recursive:true});fs.writeFileSync(nb.providerFile,'{broken '+KEY);
  const logged=t.mock.method(console,'error',()=>{});
  for(const _ of [1,2]){
    const read=await fetch(nb.base+'/api/provider');
    assert.equal(read.status,400);
    assert.equal(JSON.parse(await read.text()).error,'The saved AI connection could not be read. Connect your AI again in Settings, Your AI.');
  }
  // The log line's instruction works: connecting again in Settings tests the new AI and writes the
  // file whole, over the damaged one (#861 review D4).
  const reconnect=await nb.post('/api/provider',{url:nb.ai.url,key:KEY,model:'fictional-model',routines:false});
  assert.equal(reconnect.status,200,reconnect.text);
  assert.equal(JSON.parse(reconnect.text).connected,true);
  const read=await fetch(nb.base+'/api/provider');
  assert.equal(read.status,200);
  assert.equal(JSON.parse(await read.text()).configured,true);
  assert.equal(fs.readFileSync(nb.providerFile,'utf8').includes(KEY),true,'the file is whole again');
  // One plain line per read of the damaged file: two GET requests and the reconnect's read.
  assert.equal(logged.mock.callCount(),3,'one line per request');
  for(const call of logged.mock.calls){
    assert.equal(call.arguments.length,1,'one argument, not an error object');
    const line=String(call.arguments[0]);
    assert.equal(line.includes('\n'),false,'one line, no stack');
    assert.doesNotMatch(line,/SyntaxError/);assert.equal(line.includes(KEY),false);
  }
});

test('the cause of an HTTP answer is read from its status first, its structured fields second',()=>{
  const body=message=>({error:{message}});
  assert.equal(answerCause(401,null),'refused');assert.equal(answerCause(403,body('Forbidden')),'refused');
  assert.equal(answerCause(402,body('Insufficient credits')),'no-credit');
  assert.equal(answerCause(429,body('Rate limit exceeded')),'busy');
  assert.equal(answerCause(429,{error:{code:'insufficient_quota',message:'quota'}}),'no-credit');
  // A 5xx is an outage whatever its body says: a body that mentions a refused key, or carries the
  // provider's own refused-key code, is not a refusal (#833, #861 review C1).
  assert.equal(answerCause(500,body('invalid_api_key was named')),'unavailable');
  assert.equal(answerCause(500,{error:{code:'invalid_api_key',message:'Incorrect API key provided'}}),'unavailable');
  assert.equal(answerCause(502,{error:{code:'invalid_api_key'}}),'unavailable');
  assert.equal(answerCause(503,null),'unavailable');
  assert.equal(answerCause(400,{error:{code:'invalid_api_key',message:'Incorrect API key provided'}}),'refused');
  assert.equal(answerCause(400,{error:{type:'authentication_error'}}),'refused');
  assert.equal(answerCause(400,{error:{code:'insufficient_quota'}}),'no-credit');
  assert.equal(answerCause(408,body('timed out')),'unavailable');
  assert.equal(answerCause(400,body('The model does not exist')),'unavailable');
});

test('the cause of what the AI program printed is read from its status line and its own codes',()=>{
  assert.equal(diagnosticCause('Error: 402 HTTP 402 Payment Required (provider wording '+KEY+')'),'no-credit');
  assert.equal(diagnosticCause('HTTP 401 Unauthorized, incorrect api key used'),'refused');
  assert.equal(diagnosticCause('HTTP 429 rate_limit_exceeded'),'busy');
  assert.equal(diagnosticCause('HTTP 429 insufficient_quota'),'no-credit');
  assert.equal(diagnosticCause('HTTP 500 Internal server error mentioning invalid_api_key '+KEY),'unavailable');
  assert.equal(diagnosticCause('usage limit reached, try later'),'busy');
  assert.equal(diagnosticCause('insufficient credits left on the account'),'no-credit');
  assert.equal(diagnosticCause('AuthenticationError: token expired'),'refused');
  assert.equal(diagnosticCause('Context length exceeded: 413,274 tokens. Cannot compress further.'),null,'a context limit is its own kind of problem');
  assert.equal(diagnosticCause('the process failed for no named reason'),'unavailable');
});

test('a route that wrapped the provider\'s raw words in its own text is still worded by the module',()=>{
  // The route-exhaustive guarantee cannot reach a branch that builds its own error text around the
  // provider's words, so the shared handling reads the raw words themselves and says the cause
  // (#861 review C2): the wrapped wording, the status number and the key never reach the person.
  const wrapped=plainAIError(new Error('raw provider said: Model provider failed with HTTP 401: Incorrect API key provided: '+KEY));
  assert.equal(wrapped.message,AI_REFUSED);assert.equal(wrapped.message.includes(KEY),false);
  const outage=plainAIError(new Error('provider wording: HTTP 502 Bad Gateway'));assert.equal(outage.message,AI_UNREACHABLE);
  // The notebook's own kinds of problem are left as they are: a context limit is not an AI failure,
  // and a refusal that is already plain stays plain.
  const context=plainAIError(new Error('Context length exceeded: 413,274 tokens. Cannot compress further.'));
  assert.equal(context.message,'Context length exceeded: 413,274 tokens. Cannot compress further.');
  const alreadyPlain=plainAIError(Object.assign(new Error(AI_REFUSED),{aiCause:'refused'}));
  assert.equal(alreadyPlain.message,AI_REFUSED);
  // Settings' connection tests pick their own sentence from the cause and the status the boundary
  // attached (#861 review R6): a plain 4xx, the wrong model name, says what to check.
  const settings=connectionTestError(Object.assign(new Error('Model provider failed with HTTP 400: The model fictional-model does not exist'),{aiStatus:400}));
  assert.equal(settings.message,AI_REQUEST_REJECTED);
});
