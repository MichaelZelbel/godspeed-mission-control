// #807: when the AI answers JSON that is not the shape the feature asked for, such as {"foo":1},
// Create collection with AI returned it as the collection's schema and Weekly Review saved a review
// with nothing in it. Both now save nothing and say in plain words (#792's sentence) that the AI's
// answer could not be used. The AI is a stand-in on 127.0.0.1, connected the way Settings connects one.
import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';
const UNREADABLE='Your AI answered, but its answer could not be used. Try again, or choose another model in Settings, Your AI.';

async function notebookWithStandIn(t){
  const names=['GODSPEED_ORIGINAL_RUNTIME','GODSPEED_ASSISTANT_CONFIG','GODSPEED_MODEL_URL','GODSPEED_MODEL_KEY','GODSPEED_MODEL'],saved=Object.fromEntries(names.map(n=>[n,process.env[n]]));
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-wrong-shape-'));
  for(const n of names)delete process.env[n];process.env.GODSPEED_ASSISTANT_CONFIG=path.join(root,'no-assistant.json');
  const standIn={reply:'Connected.'};
  const endpoint=http.createServer((req,res)=>{req.resume();req.on('end',()=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{content:standIn.reply}}]}));});});
  await new Promise(resolve=>endpoint.listen(0,'127.0.0.1',resolve));
  const {createService}=await import('../server/main.mjs');const service=await createService({root:path.join(root,'workspace'),port:0});
  t.after(async()=>{await service.close();endpoint.closeAllConnections?.();await new Promise(resolve=>endpoint.close(resolve));for(const n of names)if(saved[n]===undefined)delete process.env[n];else process.env[n]=saved[n];fs.rmSync(root,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+service.address.port;
  const connected=await fetch(base+'/api/provider',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url:'http://127.0.0.1:'+endpoint.address().port+'/v1',key:'sk-fictional-807',model:'fictional-model',routines:false})});
  assert.equal(connected.status,200,await connected.clone().text());
  const post=async(name,body)=>{const response=await fetch(base+'/api/functions/'+name,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
  return {standIn,post,service};
}

test('an AI answering {"foo":1} gets the plain sentence from Create collection with AI and Weekly Review, and nothing is saved',async t=>{
  const {standIn,post,service}=await notebookWithStandIn(t);
  service.store.save('notes',{title:'Lunch with Ada',content:'Ada said she moved to Lisbon in May.'});
  standIn.reply='{"foo":1}';
  const collectionsBefore=service.query.rows('collections').length;
  for(const [name,body] of [['generate_collection_schema',{prompt:'A collection for the books I read'}],['weekly-review',{}]]){
    const answer=await post(name,body);
    assert.notEqual(answer.status,200,name+' '+JSON.stringify(answer.body));
    assert.equal(answer.body.error,UNREADABLE,name);
    assert.doesNotMatch(JSON.stringify(answer.body),/foo/,name);
  }
  assert.equal(service.query.rows('weekly_reviews').length,0,'no review is saved');
  assert.equal(service.query.rows('collections').length,collectionsBefore,'no collection is made');
  // Near misses: a review with only empty lists, and a schema without fields.
  standIn.reply='{"themes":[],"open_loops":[],"connections":[],"gaps":[],"people_summary":[]}';
  assert.equal((await post('weekly-review',{})).body.error,UNREADABLE);
  standIn.reply='{"collection":{"name":"Books"},"field_schema":[]}';
  assert.equal((await post('generate_collection_schema',{prompt:'A collection for the books I read'})).body.error,UNREADABLE);
  assert.equal(service.query.rows('weekly_reviews').length,0,'still no review is saved');
});

test('answers of the right shape still work',async t=>{
  const {standIn,post,service}=await notebookWithStandIn(t);
  service.store.save('notes',{title:'Lunch with Ada',content:'Ada said she moved to Lisbon in May.'});
  standIn.reply=JSON.stringify({collection:{name:'Books',icon:'📚',description:'Books I read',visibility:'personal'},field_schema:[{key:'title',label:'Title',type:'text',primary:true}],agent_instructions:'Track books.'});
  const schema=await post('generate_collection_schema',{prompt:'A collection for the books I read'});
  assert.equal(schema.status,200,JSON.stringify(schema.body));assert.equal(schema.body.data.collection.name,'Books');
  standIn.reply=JSON.stringify({week_summary:'Lunch with Ada.',themes:[],open_loops:[],connections:[],gaps:[],people_summary:[]});
  const review=await post('weekly-review',{});
  assert.equal(review.status,200,JSON.stringify(review.body));assert.equal(service.query.rows('weekly_reviews').length,1);
});
