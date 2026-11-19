// #792: when the AI answers but its answer is not in the shape an action needs, Suggest said "The
// assistant returned an invalid proposal list", Create collection with AI "Return one complete JSON
// object", and the analysis actions "The request or a saved file was not valid JSON.". Each says in
// plain words now that the AI's answer could not be used, and that trying again or choosing another
// model may help. A request or saved file of the notebook's own that is not valid keeps its own
// message. The AI is a stand-in on 127.0.0.1 that answers "Connected.", connected the way Settings
// connects one (its connection test passes).
import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';
// The sentence, written out so a change to it is seen here.
const UNREADABLE='Your AI answered, but its answer could not be used. Try again, or choose another model in Settings, Your AI.';
const INTERNAL=/JSON|proposal list|Unexpected token|invalid|assistant returned|Connected\./i;

async function notebookWithStandIn(t){
  const names=['GODSPEED_ORIGINAL_RUNTIME','GODSPEED_ASSISTANT_CONFIG','GODSPEED_MODEL_URL','GODSPEED_MODEL_KEY','GODSPEED_MODEL'],saved=Object.fromEntries(names.map(n=>[n,process.env[n]]));
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-unreadable-'));
  for(const n of names)delete process.env[n];process.env.GODSPEED_ASSISTANT_CONFIG=path.join(root,'no-assistant.json');
  // What the stand-in says to every request: "Connected." unless told otherwise.
  const standIn={reply:'Connected.'};
  const endpoint=http.createServer((req,res)=>{req.resume();req.on('end',()=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{content:standIn.reply}}]}));});});
  await new Promise(resolve=>endpoint.listen(0,'127.0.0.1',resolve));
  const {createService}=await import('../server/main.mjs');const service=await createService({root:path.join(root,'workspace'),port:0});
  t.after(async()=>{await service.close();endpoint.closeAllConnections?.();await new Promise(resolve=>endpoint.close(resolve));for(const n of names)if(saved[n]===undefined)delete process.env[n];else process.env[n]=saved[n];fs.rmSync(root,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+service.address.port;
  const connected=await fetch(base+'/api/provider',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url:'http://127.0.0.1:'+endpoint.address().port+'/v1',key:'sk-fictional-792',model:'fictional-model',routines:false})});
  assert.equal(connected.status,200,await connected.clone().text());
  const post=async(name,body)=>{const response=await fetch(base+'/api/functions/'+name,{method:'POST',headers:{'content-type':'application/json'},body:typeof body==='string'?body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
  return {standIn,post,service};
}

function assertUnreadable(answer,name){
  assert.notEqual(answer.status,200,name);
  assert.equal(answer.body.error,UNREADABLE,name);
  assert.doesNotMatch(JSON.stringify(answer.body),INTERNAL,name);
}

test('an AI answering "Connected." gets the plain unreadable-answer sentence from Suggest, Create collection with AI and the analysis actions',async t=>{
  const {post,service}=await notebookWithStandIn(t);
  const note=service.store.save('notes',{title:'Lunch with Ada',content:'Ada said she moved to Lisbon in May.'});
  assertUnreadable(await post('generate-profile-suggestions',{}),'Suggest');
  assertUnreadable(await post('generate_collection_schema',{prompt:'A collection for the books I read'}),'Create collection with AI');
  assertUnreadable(await post('process-note',{note_id:note.id}),'process-note');
  assertUnreadable(await post('classify-profile-fact',{text:'My favourite colour is green'}),'classify-profile-fact');
});

test('a reply that reads as JSON but is not the shape asked for gets the same sentence',async t=>{
  const {standIn,post,service}=await notebookWithStandIn(t);
  const note=service.store.save('notes',{title:'Lunch with Ada',content:'Ada said she moved to Lisbon in May.'});
  standIn.reply='{"suggestions":"none"}';
  assertUnreadable(await post('generate-profile-suggestions',{}),'Suggest');
  assertUnreadable(await post('process-note',{note_id:note.id}),'process-note');
  standIn.reply='["a list, not an object"]';
  assertUnreadable(await post('generate_collection_schema',{prompt:'A collection for the books I read'}),'Create collection with AI');
});

test('a request that is not valid JSON keeps the notebook\'s own message and is not called the AI\'s',async t=>{
  const {post}=await notebookWithStandIn(t);
  for(const name of ['generate-profile-suggestions','generate_collection_schema','process-note']){
    const answer=await post(name,'{broken');
    assert.notEqual(answer.status,200,name);
    assert.notEqual(answer.body.error,UNREADABLE,name);
    assert.equal(answer.body.error,'The request or a saved file was not valid JSON.',name);
  }
});
