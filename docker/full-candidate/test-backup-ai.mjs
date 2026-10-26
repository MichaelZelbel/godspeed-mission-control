// A backup AI against the real Hermes (22 October 2026, discussion #20). Runs inside the fresh test
// container (test.sh), or by hand anywhere a Hermes is installed, with GODSPEED_WORKSPACE naming a
// mission control whose .godspeed/assistant.json names that Hermes and HERMES_HOME its home. The only
// model endpoints are two local fakes: the main one refuses its key, as an expired sign-in does, and
// the backup answers. No production credential or subscription is involved. It proves that what the
// notebook writes is what Hermes reads, that godspeed-model, Hermes' own chat (which the routines
// use) and the Settings check all go main first and backup second, and that without a backup the
// failure is today's.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

const kit=fileURLToPath(new URL('../../',import.meta.url));
const {setHermesBackup,clearHermesBackup,backupEntryFor}=await import(path.join(kit,'notebook/core/backup-ai.mjs').replace(/^(?=[A-Za-z]:)/,'file:///'));
const {addonModel,hermesHelper}=await import(path.join(kit,'notebook/core/addon-model.mjs').replace(/^(?=[A-Za-z]:)/,'file:///'));
const {checkRoutineAI}=await import(path.join(kit,'notebook/core/routine-ai.mjs').replace(/^(?=[A-Za-z]:)/,'file:///'));

const root=process.env.GODSPEED_WORKSPACE,home=process.env.HERMES_HOME,state=path.join(root,'.godspeed'),config=path.join(home,'config.yaml');
const descriptor=JSON.parse(fs.readFileSync(path.join(state,'assistant.json'),'utf8').replace(/^﻿/,''));
const kept=Object.fromEntries(['config.yaml'].map(n=>[n,fs.existsSync(path.join(home,n))?fs.readFileSync(path.join(home,n)):null]));
const keptState=Object.fromEntries(['routine-ai.json','backup-ai.json','model-requests.jsonl'].map(n=>[n,fs.existsSync(path.join(state,n))?fs.readFileSync(path.join(state,n)):null]));
// A request that asks for a stream (Hermes' chat does) gets the answer as server-sent events.
function serve(reply){
 const seen=[];const server=http.createServer(async(req,res)=>{let bytes='';req.setEncoding('utf8');for await(const chunk of req)bytes+=chunk;const body=bytes?JSON.parse(bytes):null;seen.push({path:req.url,authorization:req.headers.authorization,body});
  const [status,answer]=reply(req);res.statusCode=status;
  const content=answer?.choices?.[0]?.message?.content;
  if(status===200&&body?.stream&&typeof content==='string'){
   res.setHeader('content-type','text/event-stream');
   const chunk=(delta,finish)=>'data: '+JSON.stringify({id:'fictional',object:'chat.completion.chunk',created:1,model:answer.model,choices:[{index:0,delta,finish_reason:finish}]})+'\n\n';
   res.end(chunk({role:'assistant',content},null)+chunk({},'stop')+'data: [DONE]\n\n');return;
  }
  res.setHeader('content-type','application/json');res.end(JSON.stringify(answer));});
 return new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve({server,seen,url:'http://127.0.0.1:'+server.address().port+'/v1'})));
}
const completion=(model,content)=>({id:'fictional',object:'chat.completion',created:1,model,choices:[{index:0,message:{role:'assistant',content},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}});
const main=await serve(()=>[401,{error:{message:'Incorrect API key provided.',type:'invalid_request_error',code:'invalid_api_key'}}]);
const backup=await serve(req=>req.url.endsWith('/models')?[200,{object:'list',data:[{id:'fictional-backup-model',object:'model'}]}]:[200,completion('fictional-backup-model','From the backup.')]);
const chats=()=>backup.seen.filter(s=>s.body?.messages);
function run(command,args,input){
 return new Promise(resolve=>{const child=spawn(command,args,{cwd:root,env:{...process.env,HERMES_HOME:home},stdio:['pipe','pipe','pipe']});let out='',err='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',s=>out+=s);child.stderr.on('data',s=>err+=s);
  const timer=setTimeout(()=>child.kill(),240000);child.on('close',code=>{clearTimeout(timer);resolve({code,out,err});});child.stdin.end(input);});
}
const {python,sourceRoot}=hermesHelper(descriptor,state);
const input={system:'Reply with a short fictional sentence.',prompt:'A wholly invented request.',timeout_ms:60000,max_tokens:128};
try{
 fs.writeFileSync(config,'model:\n  provider: custom\n  default: fictional-main-model\n  base_url: '+main.url+'\n  api_key: fictional-main-key\n');
 // The backup exactly as the Settings form writes it (core/backup-ai.mjs).
 setHermesBackup(home,backupEntryFor({url:backup.url+'/chat/completions',key:'fictional-backup-key',model:'fictional-backup-model'}));
 // 1. What the notebook wrote is the chain Hermes reads.
 const chain=await run(python,['-c','import json\nfrom hermes_cli.config import load_config_readonly\nfrom hermes_cli.fallback_config import get_fallback_chain\nprint(json.dumps(get_fallback_chain(load_config_readonly())))'],'');
 assert.equal(chain.code,0,chain.err);
 assert.deepEqual(JSON.parse(chain.out.trim().split('\n').at(-1)),[{provider:'custom',model:'fictional-backup-model',base_url:backup.url,api_key:'fictional-backup-key'}]);
 console.log('Hermes reads the backup the notebook wrote as its one fallback entry.');
 // 2. godspeed-model: the main one first, the backup when it failed, and the answer says so.
 const answered=await addonModel({root,input});
 assert.deepEqual({text:answered.text,model:answered.model,backup:answered.backup},{text:'From the backup.',model:'fictional-backup-model',backup:true});
 assert.ok(main.seen.some(s=>s.body?.model==='fictional-main-model'),'the main one was asked first');
 assert.equal(chats().at(-1).authorization,'Bearer fictional-backup-key');assert.equal(chats().at(-1).body.tools,undefined);
 console.log('godspeed-model asked the main AI first and answered with the backup, and said so.');
 // 3. Hermes' own chat, the way the routines and the notebook's one-turn calls run it.
 const before=chats().length;
 const chat=await run(descriptor.executable,['chat','--query-file','-','--quiet','--oneshot','--max-turns','1','--toolsets','none','--source','tool'],'Reply with one short sentence.');
 assert.equal(chat.code,0,chat.out+chat.err);assert.match(chat.out,/From the backup\./);assert.ok(chats().length>before);
 console.log('Hermes\' own chat used the backup when the main AI refused its key.');
 // 4. The Settings check names each one on its own.
 const checked=await checkRoutineAI({executable:descriptor.executable,home,cwd:root,state,sourceRoot});
 assert.equal(checked.check.ok,false);assert.equal(checked.check.backup.ok,true);assert.match(checked.check.error,/signed in again|could not answer/);
 console.log('The Settings check says the main AI failed and the backup answered.');
 // 5. Without a backup, the failure is today's: nothing else is tried.
 assert.equal(clearHermesBackup(home),true);const asked=chats().length;
 await assert.rejects(addonModel({root,input}),/signed in again|could not answer/);
 const alone=await run(descriptor.executable,['chat','--query-file','-','--quiet','--oneshot','--max-turns','1','--toolsets','none','--source','tool'],'Reply with one short sentence.');
 assert.notEqual(alone.code,0);assert.equal(chats().length,asked,'the removed backup was not asked');
 console.log('Without a backup nothing else is asked, by godspeed-model or by Hermes.');
}finally{
 for(const [name,bytes] of Object.entries(kept)){if(bytes===null)fs.rmSync(path.join(home,name),{force:true});else fs.writeFileSync(path.join(home,name),bytes);}
 for(const [name,bytes] of Object.entries(keptState)){if(bytes===null)fs.rmSync(path.join(state,name),{force:true});else fs.writeFileSync(path.join(state,name),bytes);}
 await Promise.all([main,backup].map(s=>new Promise(resolve=>s.server.close(resolve))));
}
