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
 const isolatedPort=await freePort();
 const log=path.join(folder,'saved-brief-requests.jsonl');
 const isolated=spawn(process.execPath,[verifierScript,String(isolatedPort),savedBriefPlan,log],{stdio:['ignore','ignore','pipe']});
 await new Promise((resolve,reject)=>{isolated.stderr.once('data',resolve);isolated.once('error',reject);isolated.once('exit',code=>reject(Error(`stand-in exited ${code}`)));});
 const request=async input=>fetch(`http://127.0.0.1:${isolatedPort}/v1/chat/completions`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:JSON.stringify(input)}]})});
 const scenarios=[
  {plan:'h04-chat-first.json',requests:[
   ['morning-brief','write','H-04 refused draft one'],
   ['brief-verification','source-facts','H-04 source refusal one'],
   ['brief-verification','plain-words-and-delivery','H-04 delivery refusal one'],
   ['morning-brief','one-rewrite','H-04 refused draft two'],
   ['brief-verification','source-facts','H-04 source refusal two'],
   ['brief-verification','plain-words-and-delivery','H-04 delivery refusal two'],
  ]},
  {plan:'h05-filtered-surfaces.json',requests:[
   ['morning-brief','write','H-05 draft containing refused source'],
   ['brief-verification','source-facts','H-05 source refusal'],
   ['brief-verification','plain-words-and-delivery','H-05 first delivery check'],
   ['morning-brief','one-rewrite','H-05 filtered rewrite'],
   ['brief-verification','source-facts','H-05 final source check'],
   ['brief-verification','plain-words-and-delivery','H-05 final delivery check'],
  ]},
  {plan:'h06-challenge.json',requests:[
   ['morning-brief','write','H-06 draft containing refused source'],
   ['brief-verification','source-facts','H-06 source refusal'],
   ['brief-verification','plain-words-and-delivery','H-06 first delivery check'],
   ['morning-brief','one-rewrite','H-06 filtered rewrite'],
   ['brief-verification','source-facts','H-06 final source check'],
   ['brief-verification','plain-words-and-delivery','H-06 final delivery check'],
  ]},
  {plan:'h18-no-challenge.json',requests:[
   ['morning-brief','write','H-18 later routine draft'],
   ['brief-verification','source-facts','H-18 source check'],
   ['brief-verification','plain-words-and-delivery','H-18 delivery check'],
  ]},
 ];
 try{
  for(const scenario of scenarios){
   const steps=JSON.parse(fs.readFileSync(path.join(planFolder,scenario.plan),'utf8'));
   const title=steps.find(step=>step.path==='/api/setup').body.goal;
   for(const [kind,phaseOrCheck] of scenario.requests){
    const input=kind==='morning-brief'
     ? {kind,phase:phaseOrCheck,context:{goals:[{title}]}}
     : {kind,check:phaseOrCheck,context:{sources:{goals:[{title}]}}};
    const response=await request(input);
    assert.equal(response.status,200,`${scenario.plan}: ${kind}/${phaseOrCheck}`);
   }
  }
  const wrong=await request({kind:'morning-brief',phase:'write',context:{goals:[{title:'an unknown goal'}]}});
  assert.equal(wrong.status,500);
  const matched=fs.readFileSync(log,'utf8').trim().split('\n').map(JSON.parse).filter(record=>record.matched).map(record=>record.matched);
  assert.deepEqual(matched,scenarios.flatMap(scenario=>scenario.requests.map(([, ,name])=>name)));
 }finally{
  isolated.kill();
  await new Promise(resolve=>isolated.once('exit',resolve));
 }
});
