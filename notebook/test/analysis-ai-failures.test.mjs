// #774: Suggest and My Profile's "Suggest entries from my notes" (generate-profile-suggestions) and
// Create collection with AI (generate_collection_schema) showed the provider's own words for a
// refused key ("Model provider failed with HTTP 401..."). They say what the chats say: a refused key
// names Settings, Your AI; an outage gets the chats' outage wording. No status number, no provider
// wording, never the key. The AI is a stand-in on 127.0.0.1, connected the way Settings connects one.
import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';
// The chats' own sentences (server/main.mjs), written out so a change to either is seen here.
const AI_REFUSED='Your AI key or sign-in was refused. Check it in Settings, Your AI, then try again.';
const AI_UNREACHABLE='Your AI could not be reached. Check its connection in Settings, Your AI, then try again.';

const KEY='sk-fictional-refused-key-774';
const ACTIONS=['generate-profile-suggestions','generate_collection_schema'];
const INPUT={'generate-profile-suggestions':{},'generate_collection_schema':{prompt:'A collection for the books I read'}};

async function notebookWithStandIn(t){
  const names=['GODSPEED_ORIGINAL_RUNTIME','GODSPEED_ASSISTANT_CONFIG','GODSPEED_MODEL_URL','GODSPEED_MODEL_KEY','GODSPEED_MODEL'],saved=Object.fromEntries(names.map(n=>[n,process.env[n]]));
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-analysis-ai-'));
  for(const n of names)delete process.env[n];process.env.GODSPEED_ASSISTANT_CONFIG=path.join(root,'no-assistant.json');
  // The stand-in answers OK until told otherwise; then the status it is given, with provider wording.
  const standIn={status:200};
  const endpoint=http.createServer((req,res)=>{req.resume();req.on('end',()=>{
    res.setHeader('content-type','application/json');
    if(standIn.status===200)return res.end(JSON.stringify({choices:[{message:{content:'Connected'}}]}));
    res.statusCode=standIn.status;res.end(JSON.stringify({error:{message:standIn.status>=500?'Internal server error (provider wording)':'Incorrect API key provided: '+KEY+' (provider wording)'}}));
  });});
  await new Promise(resolve=>endpoint.listen(0,'127.0.0.1',resolve));
  const address='http://127.0.0.1:'+endpoint.address().port+'/v1';
  const {createService}=await import('../server/main.mjs');const service=await createService({root:path.join(root,'workspace'),port:0});
  let endpointOpen=true;
  const closeEndpoint=()=>endpointOpen?new Promise(resolve=>{endpointOpen=false;endpoint.closeAllConnections?.();endpoint.close(resolve);}):undefined;
  t.after(async()=>{await service.close();await closeEndpoint();for(const n of names)if(saved[n]===undefined)delete process.env[n];else process.env[n]=saved[n];fs.rmSync(root,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+service.address.port;
  const connected=await fetch(base+'/api/provider',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url:address,key:KEY,model:'fictional-model',routines:false})});
  assert.equal(connected.status,200,await connected.clone().text());
  const run=async name=>{const response=await fetch(base+'/api/functions/'+name,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(INPUT[name])});return {status:response.status,body:await response.json()};};
  return {standIn,run,closeEndpoint};
}

function assertPlain(answer,expected){
  assert.notEqual(answer.status,200);
  assert.equal(answer.body.error,expected);
  const all=JSON.stringify(answer.body);
  assert.doesNotMatch(all,/HTTP|\b[45]\d\d\b|Model provider|Incorrect API key|Internal server error|provider wording/);
  assert.ok(!all.includes(KEY),'the key never appears');
}

for(const status of [401,403])test('a key the provider refuses with HTTP '+status+' is said plainly by each analysis action, naming Settings, Your AI',async t=>{
  const {standIn,run}=await notebookWithStandIn(t);
  standIn.status=status;
  for(const name of ACTIONS){const answer=await run(name);assertPlain(answer,AI_REFUSED);assert.match(answer.body.error,/refused.*Settings, Your AI/,name);}
});

test('an AI answering HTTP 500 gets the chats\' outage wording from each analysis action',async t=>{
  const {standIn,run}=await notebookWithStandIn(t);
  standIn.status=500;
  for(const name of ACTIONS)assertPlain(await run(name),AI_UNREACHABLE);
});

test('an AI whose port is closed gets the chats\' outage wording from each analysis action',async t=>{
  const {run,closeEndpoint}=await notebookWithStandIn(t);
  await closeEndpoint();
  for(const name of ACTIONS){const answer=await run(name);assertPlain(answer,AI_UNREACHABLE);assert.doesNotMatch(answer.body.error,/127\.0\.0\.1/);}
});
