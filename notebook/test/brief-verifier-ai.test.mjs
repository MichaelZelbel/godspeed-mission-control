import assert from 'node:assert/strict';
import fs from 'node:fs';
import {after, before, test} from 'node:test';
import {spawn} from 'node:child_process';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

let child,folder,port;
before(async()=>{
 folder=await mkdtemp(path.join(tmpdir(),'brief-verifier-ai-'));
 fs.writeFileSync(path.join(folder,'plan.json'),JSON.stringify({
  'morning-brief':['first prepared draft','second prepared draft'],
  'brief-verification':{passed:false,reason:'prepared refusal',rejection_scope:'source',rejected_source_ids:['lead-1']},
 }));
 const listener=await new Promise((resolve,reject)=>{
  const net=import('node:net');
  net.then(({createServer})=>{const server=createServer();server.listen(0,'127.0.0.1',()=>{const address=server.address();server.close(()=>resolve(address.port));});server.on('error',reject);});
 });
 port=listener;
 child=spawn(process.execPath,['notebook/scripts/brief-verifier-ai.mjs',String(port),path.join(folder,'plan.json'),path.join(folder,'requests.jsonl')],{stdio:['ignore','ignore','pipe']});
 await new Promise((resolve,reject)=>{child.stderr.once('data',resolve);child.once('error',reject);child.once('exit',code=>reject(Error(`stand-in exited ${code}`)));});
});
after(()=>child?.kill());

const ask=async kind=>{
 const response=await fetch(`http://127.0.0.1:${port}/v1/chat/completions`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:JSON.stringify({kind})}]})});
 assert.equal(response.status,200);
 return (await response.json()).choices[0].message.content;
};

test('serves verifier-owned drafts in order and repeats the final reply',async()=>{
 assert.equal(await ask('morning-brief'),'first prepared draft');
 assert.equal(await ask('morning-brief'),'second prepared draft');
 assert.equal(await ask('morning-brief'),'second prepared draft');
});

test('serves structured verification replies and records request kinds',async()=>{
 assert.deepEqual(JSON.parse(await ask('brief-verification')),{
  passed:false,reason:'prepared refusal',rejection_scope:'source',rejected_source_ids:['lead-1'],
 });
 const records=fs.readFileSync(path.join(folder,'requests.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 assert.deepEqual(records.map(record=>record.kind),['morning-brief','morning-brief','morning-brief','brief-verification']);
});
