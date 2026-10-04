import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {createRequire} from 'node:module';
import http from 'node:http';import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),waker=require('../reusable-recipes/browser-post/poster/wake.js');
test('portable posting requires selected configuration and retains the full method, platform playbooks and licensed helpers',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-portable-poster-'));
 const missing=waker.loadConfig({GODSPEED_WORKSPACE:root});assert.equal(missing.posterUrl,'');assert.ok(waker.validateConfig(missing).length);
 const config=path.join(root,'.godspeed/connectors/browser-post/poster.env');fs.mkdirSync(path.dirname(config),{recursive:true});
 fs.writeFileSync(config,'PLANINO_POSTER_URL=http://127.0.0.1:1/browser-poster\nPLANINO_POSTER_TOKEN=pln_poster_'+ 'a'.repeat(43)+'\n');
 const selected=waker.loadConfig({GODSPEED_WORKSPACE:root});assert.deepEqual(waker.validateConfig(selected),[]);assert.ok(selected.lockFile.startsWith(path.join(root,'.godspeed')));
 assert.ok(waker.validateConfig({...selected,runTimeoutSec:601}).length);assert.ok(waker.validateConfig({...selected,posterUrl:'http://remote.example/api'}).length);
 const skill=fs.readFileSync(new URL('../reusable-recipes/browser-post/SKILL.md',import.meta.url),'utf8');assert.ok(skill.includes('Only the frozen payload, exactly.'));assert.ok(skill.includes('Already live?'));assert.ok(skill.includes('forty')||skill.includes('40 tool calls'));
 assert.equal(skill,fs.readFileSync(new URL('../reusable-recipes/browser-post/poster/skill/SKILL.md',import.meta.url),'utf8'));
 for(const file of ['poster/playbooks/substack.md','poster/playbooks/snapchat.md','poster/runners/hermes.sh','poster/runners/claude.sh','LICENSE'])assert.ok(fs.readFileSync(new URL('../reusable-recipes/browser-post/'+file,import.meta.url)).length>100);
});
test('a still-running posting helper keeps its lock even after the cap; a missing runner and unsafe job ID settle visibly',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-portable-poster-lock-')),lock=path.join(root,'lock');
 assert.equal(waker.acquireLock(lock,600),true);fs.utimesSync(lock,new Date(0),new Date(0));assert.equal(waker.acquireLock(lock,600),false);waker.releaseLock(lock);
 const cfg={runner:path.join(root,'not-installed-executable'),runTimeoutSec:1,extraEnv:{},bridgeUrl:'http://127.0.0.1:1'};
 assert.equal((await waker.runRunner(cfg,{id:'fictional-job'},()=>{})).code,-1);
 assert.equal((await waker.runRunner(cfg,{id:'fictional-job & echo unsafe'},()=>{})).code,-1);
});

test('the actual portable one-shot helper checks a fictional API and runs one selected fixture without claiming or posting',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-portable-poster-cli-')),calls=[],marker=path.join(root,'runner-result.json'),runner=path.join(root,'runner.cjs');
 fs.writeFileSync(runner,'require("fs").writeFileSync('+JSON.stringify(marker)+',JSON.stringify({job:process.env.JOB_ID,argument:process.argv[2],workspace:process.env.GODSPEED_WORKSPACE}));');
 const server=http.createServer((req,res)=>{calls.push(req.url);res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(req.url.endsWith('/peek')?{queued:1,oldest:{id:'fictional-job',platform:'substack'}}:req.url.endsWith('/checkin')?{poster:{name:'Fictional posting fixture'}}:{ok:true}));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 const folder=path.join(root,'.godspeed/connectors/browser-post');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'poster.env'),'PLANINO_POSTER_URL='+base+'/poster\nPLANINO_POSTER_TOKEN=pln_poster_'+'a'.repeat(43)+'\nBRIDGE_URL='+base+'\nRUNNER='+runner+'\nRUN_TIMEOUT_SEC=3\n');
 try{
  const child=spawn(process.execPath,[fileURLToPath(new URL('../reusable-recipes/browser-post/poster/wake.js',import.meta.url)),'--once'],{env:{...process.env,GODSPEED_WORKSPACE:root},windowsHide:true,stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>output+=data);
  const code=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(Error('The fictional one-shot did not finish'));},10000);child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',code=>{clearTimeout(timer);resolve(code);});});
  assert.equal(code,0,output);assert.deepEqual(JSON.parse(fs.readFileSync(marker,'utf8')),{job:'fictional-job',argument:'fictional-job',workspace:root});
  assert.equal(calls.filter(url=>url.endsWith('/peek')).length,1);assert.ok(calls.includes('/health'));assert.ok(calls.includes('/poster/checkin'));assert.equal(calls.some(url=>url.endsWith('/claim')||url.endsWith('/report')),false);
  assert.equal(fs.existsSync(path.join(folder,'waker.lock')),false);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
