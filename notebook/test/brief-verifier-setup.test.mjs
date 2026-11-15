import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {test} from 'node:test';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const verifierScript=fileURLToPath(new URL('../scripts/brief-verifier-setup.mjs',import.meta.url));

test('runs verifier-owned setup only through loopback public API routes',async()=>{
 const seen=[];
 const server=http.createServer((request,response)=>{
  let body='';request.setEncoding('utf8');request.on('data',chunk=>body+=chunk);request.on('end',()=>{
   seen.push({url:request.url,body:JSON.parse(body)});
   response.writeHead(200,{'content-type':'application/json'});response.end(seen.length===1?'{"data":{"id":"prepared-1"}}':'{"ok":true}');
  });
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const folder=await mkdtemp(path.join(tmpdir(),'brief-verifier-setup-'));
 const plan=path.join(folder,'plan.json'),log=path.join(folder,'results.jsonl');
 fs.writeFileSync(plan,JSON.stringify([
  {name:'prepared note',path:'/api/query',body:{table:'notes'},capture:{note_id:'data.id'},expect:{status:200,json:{'data.id':'prepared-1'}}},
  {name:'use prepared note',path:'/api/query',body:{id:'{{note_id}}',label:'note {{note_id}}',day:'{{today}}'},expect:{body_includes:'"ok":true',body_excludes:'not present',json_excludes:{ok:'not present'}}},
 ]));
 const child=spawn(process.execPath,[verifierScript,`http://127.0.0.1:${server.address().port}`,plan,log],{stdio:['ignore','ignore','pipe']});
 let stderr='';child.stderr.setEncoding('utf8');child.stderr.on('data',chunk=>stderr+=chunk);
 const status=await new Promise((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject);});
 await new Promise(resolve=>server.close(resolve));
 assert.equal(status,0,stderr);
 assert.deepEqual(seen,[{url:'/api/query',body:{table:'notes'}},{url:'/api/query',body:{id:'prepared-1',label:'note prepared-1',day:new Date().toISOString().slice(0,10)}}]);
 const records=fs.readFileSync(log,'utf8').trim().split('\n').map(JSON.parse);
 assert.equal(records.length,2);
 assert.deepEqual(records[1].request,seen[1].body);
});

test('rejects non-loopback setup targets',()=>{
 const child=spawnSync(process.execPath,[verifierScript,'https://example.com','plan.json','result.jsonl'],{encoding:'utf8'});
 assert.notEqual(child.status,0);
 assert.match(child.stderr,/usage:/);
});
