import assert from 'node:assert/strict';
import fs from 'node:fs';
import {after, before, test} from 'node:test';
import {spawn} from 'node:child_process';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const verifierScript=fileURLToPath(new URL('../scripts/brief-verifier-ai.mjs',import.meta.url));
const savedBriefPlan=fileURLToPath(new URL('../scripts/brief-verifier-plans/ai.json',import.meta.url));
const planFolder=fileURLToPath(new URL('../scripts/brief-verifier-plans/',import.meta.url));

const freePort=()=>new Promise((resolve,reject)=>{
 import('node:net').then(({createServer})=>{const server=createServer();server.listen(0,'127.0.0.1',()=>{const address=server.address();server.close(()=>resolve(address.port));});server.on('error',reject);});
});

const scenarioPlans=['h04-chat-first.json','h05-filtered-surfaces.json','h06-challenge.json','h18-no-challenge.json'];
const scenarioGoals=scenarioPlans.map(plan=>{
 const steps=JSON.parse(fs.readFileSync(path.join(planFolder,plan),'utf8'));
 return steps.find(step=>step.path==='/api/setup').body.goal;
});
const scenarioGoalSet=new Set(scenarioGoals);
const responseShape=({match})=>{
 const goal=match.kind==='morning-brief'
  ? match.context?.goals?.[0]?.title
  : match.context?.sources?.goals?.[0]?.title;
 assert.ok(scenarioGoalSet.has(goal),`response must belong to a public scenario: ${goal ?? 'missing goal'}`);
 return {goal,matcher:`${match.kind}:${match.phase ?? match.check}`};
};
const validateSavedBriefResponses=responses=>{
 const shapesByGoal=responses.map(responseShape).reduce((groups,shape)=>{
  (groups[shape.goal]??=[]).push(shape);
  return groups;
 },{});
 const repeatedScenarioShapes=['morning-brief:write','morning-brief:one-rewrite','brief-verification:source-facts','brief-verification:source-facts','brief-verification:plain-words-and-delivery','brief-verification:plain-words-and-delivery'].sort();
 assert.deepEqual(Object.keys(shapesByGoal).sort(),scenarioGoals.slice().sort());
 for(const [index,goal] of scenarioGoals.entries()){
  const expected=index===3 ? ['morning-brief:write','brief-verification:source-facts','brief-verification:plain-words-and-delivery'].sort() : repeatedScenarioShapes;
  assert.deepEqual(shapesByGoal[goal].map(({matcher})=>matcher).sort(),expected,goal);
 }
};
const withVerifier=async(plan,log,run)=>{
 const isolatedPort=await freePort();
 const isolated=spawn(process.execPath,[verifierScript,String(isolatedPort),plan,log],{stdio:['ignore','ignore','pipe']});
 await new Promise((resolve,reject)=>{isolated.stderr.once('data',resolve);isolated.once('error',reject);isolated.once('exit',code=>reject(Error(`stand-in exited ${code}`)));});
 try{return await run({isolated,isolatedPort});}
 finally{
  isolated.kill();
  if(isolated.exitCode===null)await new Promise(resolve=>isolated.once('exit',resolve));
 }
};

let child,folder,port;
before(async()=>{
 folder=await mkdtemp(path.join(tmpdir(),'brief-verifier-ai-'));
 fs.writeFileSync(path.join(folder,'plan.json'),JSON.stringify({
  responses:[
   {name:'first draft',match:{kind:'morning-brief',phase:'write'},reply:'first prepared draft'},
   {name:'rewritten draft',match:{kind:'morning-brief',phase:'one-rewrite'},reply:'second prepared draft',times:2},
   {name:'source refusal',match:{kind:'brief-verification',check:'source-facts'},reply:{passed:false,reason:'prepared refusal',rejection_scope:'source',rejected_source_ids:['lead-1']}},
   {name:'H-04 scenario draft',match:{kind:'scenario-brief',phase:'write',context:{goals:[{title:'the saved H-04 goal'}]}},reply:'H-04 prepared draft'},
   {name:'H-18 scenario draft',match:{kind:'scenario-brief',phase:'write',context:{goals:[{title:'the saved H-18 goal'}]}},reply:'H-18 prepared draft'},
  ],
 }));
 port=await freePort();
 child=spawn(process.execPath,[verifierScript,String(port),path.join(folder,'plan.json'),path.join(folder,'requests.jsonl')],{stdio:['ignore','ignore','pipe']});
 await new Promise((resolve,reject)=>{child.stderr.once('data',resolve);child.once('error',reject);child.once('exit',code=>reject(Error(`stand-in exited ${code}`)));});
});
after(()=>child?.kill());

const ask=async input=>{
 const response=await fetch(`http://127.0.0.1:${port}/v1/chat/completions`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:JSON.stringify(input)}]})});
 assert.equal(response.status,200);
 return (await response.json()).choices[0].message.content;
};

test('matches verifier-owned replies to phases and limits how often each may be used',async()=>{
 assert.equal(await ask({kind:'morning-brief',phase:'write'}),'first prepared draft');
 assert.equal(await ask({kind:'morning-brief',phase:'one-rewrite'}),'second prepared draft');
 assert.equal(await ask({kind:'morning-brief',phase:'one-rewrite'}),'second prepared draft');
 const response=await fetch(`http://127.0.0.1:${port}/v1/chat/completions`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:JSON.stringify({kind:'morning-brief',phase:'one-rewrite'})}]})});
 assert.equal(response.status,500);
});

test('serves structured verification replies and records request kinds',async()=>{
 assert.deepEqual(JSON.parse(await ask({kind:'brief-verification',check:'source-facts'})),{
  passed:false,reason:'prepared refusal',rejection_scope:'source',rejected_source_ids:['lead-1'],
 });
 const records=fs.readFileSync(path.join(folder,'requests.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 assert.deepEqual(records.filter(record=>record.matched).map(record=>record.matched),['first draft','rewritten draft','rewritten draft','source refusal']);
});

test('selects a reply by nested scenario identity instead of response order',async()=>{
 assert.equal(await ask({kind:'scenario-brief',phase:'write',context:{goals:[{title:'the saved H-18 goal',status:'adopted'}]}}),'H-18 prepared draft');
 const response=await fetch(`http://127.0.0.1:${port}/v1/chat/completions`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:JSON.stringify({kind:'scenario-brief',phase:'write',context:{goals:[{title:'an unknown goal'}]}})}]})});
 assert.equal(response.status,500);
 assert.match((await response.json()).error.message,/no matching reply/);
});

test('the saved-brief plan attributes every scenario request to its own replies',async()=>{
 const log=path.join(folder,'saved-brief-requests.jsonl');
 const responses=JSON.parse(fs.readFileSync(savedBriefPlan,'utf8')).responses.filter(({match})=>['morning-brief','brief-verification'].includes(match.kind));
 await withVerifier(savedBriefPlan,log,async({isolatedPort})=>{
  validateSavedBriefResponses(responses);
  const request=async input=>fetch(`http://127.0.0.1:${isolatedPort}/v1/chat/completions`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:JSON.stringify(input)}]})});
  for(const {name,match} of responses){
   const response=await request(match);
   assert.equal(response.status,200,name);
  }
  const wrong=await request({kind:'morning-brief',phase:'write',context:{goals:[{title:'an unknown goal'}]}});
  assert.equal(wrong.status,500);
  const matched=fs.readFileSync(log,'utf8').trim().split('\n').map(JSON.parse).filter(record=>record.matched).map(record=>record.matched);
  assert.deepEqual(matched,responses.map(({name})=>name));
 });
});

test('a malformed saved-brief plan rejects and releases its verifier child',async()=>{
 const malformed=path.join(folder,'malformed-saved-brief.json');
 const plan=JSON.parse(fs.readFileSync(savedBriefPlan,'utf8'));
 plan.responses=plan.responses.filter(({name})=>name!=='H-05 final source check');
 fs.writeFileSync(malformed,JSON.stringify(plan));
 let owned,endpoint;
 await assert.rejects(withVerifier(malformed,path.join(folder,'malformed-requests.jsonl'),async({isolated,isolatedPort})=>{
  owned=isolated;endpoint=`http://127.0.0.1:${isolatedPort}/v1/chat/completions`;
  validateSavedBriefResponses(plan.responses.filter(({match})=>['morning-brief','brief-verification'].includes(match.kind)));
 }),/the saved H-05 goal/);
 assert.equal(owned.signalCode,'SIGTERM');
 await assert.rejects(fetch(endpoint),/fetch failed/);
});
