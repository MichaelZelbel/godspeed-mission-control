// #811: Weekly Review and the group AI actions (a group's briefing, suggested members, next step)
// showed the provider's own words for a refused key ("Model provider failed with HTTP 401...") and
// for an outage. They say what Suggest and the chats say (#774): a refused key names Settings, Your
// AI; an outage gets the chats' outage wording. No status number, no provider wording, never the key.
// The AI is a stand-in on 127.0.0.1, connected the way Settings connects one.
import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';
// The chats' own sentences (server/main.mjs), written out so a change to either is seen here.
const AI_REFUSED='Your AI key or sign-in was refused. Check it in Settings, Your AI, then try again.';
const AI_UNREACHABLE='Your AI could not be reached. Check its connection in Settings, Your AI, then try again.';
const RAW=/HTTP|\b[45]\d\d\b|Model provider|Incorrect API key|Internal server error|provider wording|127\.0\.0\.1/;

const KEY='sk-fictional-refused-key-811';
const ACTIONS=['weekly-review','generate-group-briefing','suggest-group-members','suggest-group-next-step'];

async function notebookWithStandIn(t){
  const names=['GODSPEED_ORIGINAL_RUNTIME','GODSPEED_ASSISTANT_CONFIG','GODSPEED_MODEL_URL','GODSPEED_MODEL_KEY','GODSPEED_MODEL'],saved=Object.fromEntries(names.map(n=>[n,process.env[n]]));
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-review-group-ai-'));
  for(const n of names)delete process.env[n];process.env.GODSPEED_ASSISTANT_CONFIG=path.join(root,'no-assistant.json');
  const standIn={status:200,requests:0};
  const endpoint=http.createServer((req,res)=>{req.resume();req.on('end',()=>{standIn.requests++;
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
  const post=async(route,body)=>{const r=await fetch(base+route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,text:await r.text()};};
  const insert=async(table,values)=>{const r=await post('/api/query',{table,operation:'insert',values,selection:'*',single:true});assert.equal(r.status,200,r.text);return JSON.parse(r.text).data;};
  // A note this week (Weekly Review asks no AI without one) and a group with a member.
  await insert('notes',{title:'Garden plans',content:'Planned the garden beds with Ada.'});
  const ada=await insert('contacts',{name:'Ada Example'});
  const group=await insert('contact_groups',{name:'Garden club'});
  const membership=await insert('contact_group_memberships',{group_id:group.id,contact_id:ada.id});
  const connected=await post('/api/provider',{url:address,key:KEY,model:'fictional-model',routines:false});
  assert.equal(connected.status,200,connected.text);
  const input={'weekly-review':{days:7},'generate-group-briefing':{group_id:group.id},'suggest-group-members':{group_id:group.id},'suggest-group-next-step':{membership_id:membership.id}};
  const run=async name=>{const r=await post('/api/functions/'+name,input[name]);return {status:r.status,text:r.text,error:JSON.parse(r.text).error};};
  return {standIn,run,closeEndpoint};
}

function assertPlain(answer,expected,name){
  assert.notEqual(answer.status,200,name);
  assert.equal(answer.error,expected,name);
  assert.doesNotMatch(answer.text,RAW,name);
  assert.ok(!answer.text.includes(KEY),name+': the key never appears');
}

for(const status of [401,403])test('a key the provider refuses with HTTP '+status+' is said plainly by Weekly Review and each group action',async t=>{
  const {standIn,run}=await notebookWithStandIn(t);
  standIn.status=status;
  for(const name of ACTIONS)assertPlain(await run(name),AI_REFUSED,name+' '+status);
  assert.ok(standIn.requests>=ACTIONS.length,'each action asked the stand-in');
});

test('an AI answering HTTP 500 gets the chats\' outage wording from Weekly Review and a group action',async t=>{
  const {standIn,run}=await notebookWithStandIn(t);
  standIn.status=500;
  // A 500 is retried before it fails (core/runtime.mjs), so two actions are enough for it.
  for(const name of ['weekly-review','generate-group-briefing'])assertPlain(await run(name),AI_UNREACHABLE,name);
});

test('an AI whose port is closed gets the chats\' outage wording from Weekly Review and each group action',async t=>{
  const {run,closeEndpoint}=await notebookWithStandIn(t);
  await closeEndpoint();
  for(const name of ACTIONS)assertPlain(await run(name),AI_UNREACHABLE,name);
});
