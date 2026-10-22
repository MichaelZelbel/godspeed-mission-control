import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {hermesSettingsFor,setEnvValue,connectRoutineAI,routineAIStatus,checkRoutineAI} from '../core/routine-ai.mjs';
import {homeHasModel} from '../core/native-agent.mjs';

// What the person connects in Settings powers the routines too (18 October 2026): every installer
// told them to connect their AI there, and the six routines, which run in Hermes, never got it.
const temporary=t=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-routine-ai-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;};
const home=t=>{const root=temporary(t),h=path.join(root,'hermes'),state=path.join(root,'state');fs.mkdirSync(h,{recursive:true});fs.mkdirSync(state,{recursive:true});return {home:h,state};};

test('an endpoint becomes the Hermes provider that reads it: OpenRouter, OpenAI, or any other address',()=>{
 assert.deepEqual(hermesSettingsFor({url:'https://openrouter.ai/api/v1/chat/completions',key:'sk-or-fictional',model:'fictional/model'}),{provider:'openrouter',base_url:'https://openrouter.ai/api/v1',model:'fictional/model',env:{OPENROUTER_API_KEY:'sk-or-fictional'}});
 assert.deepEqual(hermesSettingsFor({url:'https://api.openai.com/v1/chat/completions',key:'sk-fictional',model:'gpt-fictional'}),{provider:'openai-api',base_url:'https://api.openai.com/v1',model:'gpt-fictional',env:{OPENAI_API_KEY:'sk-fictional'}});
 assert.deepEqual(hermesSettingsFor({url:'https://llm.example.org/v1/',key:'k1',model:'m'}),{provider:'custom',base_url:'https://llm.example.org/v1',model:'m',api_key:'k1'});
 assert.throws(()=>hermesSettingsFor({url:'https://openrouter.ai/api/v1',key:'has a space',model:'m'}),/space or a quotation mark/);
 assert.throws(()=>hermesSettingsFor({url:'not an address',key:'k',model:'m'}),/starting with https/);
 assert.throws(()=>hermesSettingsFor({url:'https://openrouter.ai/api/v1',key:'k',model:' '}),/Name the model/);
});

test('one line of Hermes\' .env changes, and every other line stays',()=>{
 assert.equal(setEnvValue('A=1\nOPENROUTER_API_KEY=old\nB=2\n','OPENROUTER_API_KEY','new'),'A=1\nOPENROUTER_API_KEY=new\nB=2\n');
 assert.equal(setEnvValue('A=1\n\n','OPENROUTER_API_KEY','new'),'A=1\nOPENROUTER_API_KEY=new\n');
 assert.equal(setEnvValue('','K','v'),'K=v\n');
 assert.equal(setEnvValue('export K=a\nK=b\n','K','c'),'K=c\n','a key named twice keeps one line');
});

test('connecting writes the model into Hermes\' own home, keeps the rest of it, and Settings reads it back',t=>{
 const {home:h,state}=home(t);
 fs.writeFileSync(path.join(h,'config.yaml'),'# owner notes\nmemory:\n  memory_enabled: false\ntimezone: "Europe/Berlin"\n');
 fs.writeFileSync(path.join(h,'.env'),'TELEGRAM_BOT_TOKEN=fictional\n');
 const before=routineAIStatus({home:h,state});
 assert.equal(before.source,'none','no AI yet: the routines cannot run');
 const status=connectRoutineAI({home:h,state,config:{url:'https://openrouter.ai/api/v1/chat/completions',key:'sk-or-fictional',model:'fictional/model'}});
 const config=fs.readFileSync(path.join(h,'config.yaml'),'utf8'),env=fs.readFileSync(path.join(h,'.env'),'utf8');
 assert.match(config,/^model:\n  provider: "openrouter"\n  default: "fictional\/model"\n  base_url: "https:\/\/openrouter.ai\/api\/v1"\n  api_key: ""$/m);
 for(const kept of ['# owner notes','memory_enabled: false','timezone: "Europe/Berlin"'])assert.ok(config.includes(kept),kept);
 assert.equal(env,'TELEGRAM_BOT_TOKEN=fictional\nOPENROUTER_API_KEY=sk-or-fictional\n');
 assert.deepEqual({provider:status.provider,model:status.model,source:status.source,key:status.key},{provider:'openrouter',model:'fictional/model',source:'settings',key:true});
 assert.ok(homeHasModel(h),'the chat now answers with the same model');
 if(process.platform!=='win32')assert.equal(fs.statSync(path.join(h,'.env')).mode&0o777,0o600);
 // Another address: its key goes into config.yaml, the OpenRouter key stays where it was.
 connectRoutineAI({home:h,state,config:{url:'https://llm.example.org/v1/chat/completions',key:'k-custom',model:'m'}});
 const custom=fs.readFileSync(path.join(h,'config.yaml'),'utf8');
 assert.match(custom,/provider: "custom"/);assert.match(custom,/api_key: "k-custom"/);assert.match(custom,/base_url: "https:\/\/llm.example.org\/v1"/);
 assert.equal(routineAIStatus({home:h,state}).key,true);
});

test('a sign-in Hermes has of its own (the Windows app, hermes model) is named as its own, and a one-line model becomes a section',t=>{
 const {home:h,state}=home(t);
 fs.writeFileSync(path.join(h,'config.yaml'),'model:\n  provider: openai-codex\n  default: gpt-fictional\n');
 const own=routineAIStatus({home:h,state});
 assert.deepEqual({provider:own.provider,model:own.model,source:own.source,key:own.key},{provider:'openai-codex',model:'gpt-fictional',source:'hermes',key:null});
 fs.writeFileSync(path.join(h,'config.yaml'),'model: some/model\nagent: {}\n');
 connectRoutineAI({home:h,state,config:{url:'https://openrouter.ai/api/v1',key:'sk-or-fictional',model:'fictional/model'}});
 const config=fs.readFileSync(path.join(h,'config.yaml'),'utf8');
 assert.doesNotMatch(config,/model: some\/model/);assert.match(config,/^  default: "fictional\/model"$/m);assert.match(config,/^agent: \{\}$/m);
 // A key that went missing is said.
 fs.writeFileSync(path.join(h,'.env'),'');
 assert.equal(routineAIStatus({home:h,state}).key,false);
});

const fakeHermes=(stdout,code=0,stderr='')=>{const calls=[];const spawnProcess=(command,args)=>{calls.push(args);const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();
 setImmediate(()=>{child.stdout.end(stdout);child.stderr.end(stderr);setTimeout(()=>child.emit('close',code),10);});return child;};return {spawnProcess,calls};};
test('the check asks Hermes once, the way a routine does, and keeps what it saw',async t=>{
 const {home:h,state}=home(t);
 connectRoutineAI({home:h,state,config:{url:'https://openrouter.ai/api/v1',key:'sk-or-fictional',model:'fictional/model'}});
 const good=fakeHermes('Connected.\n');
 const ok=await checkRoutineAI({executable:'hermes',home:h,cwd:h,state,spawnProcess:good.spawnProcess,now:()=>new Date('2026-10-18T10:00:00Z')});
 assert.deepEqual(ok.check,{at:'2026-10-18T10:00:00.000Z',ok:true,reply:'Connected.'});
 assert.ok(good.calls[0].includes('--oneshot')&&good.calls[0].includes('--toolsets'),'one short request, no tools');
 assert.ok(!good.calls[0].includes('--model'),'the model comes from Hermes\' own home, as for the routines');
 assert.deepEqual(routineAIStatus({home:h,state}).check,ok.check,'kept for Settings');
 const bad=fakeHermes('',1,'AuthenticationError: invalid_api_key');
 const failed=await checkRoutineAI({executable:'hermes',home:h,cwd:h,state,spawnProcess:bad.spawnProcess});
 assert.equal(failed.check.ok,false);assert.match(failed.check.error,/needs sign-in/);
 // Connecting again clears the old check: it was about another setting.
 connectRoutineAI({home:h,state,config:{url:'https://openrouter.ai/api/v1',key:'sk-or-other',model:'fictional/model'}});
 assert.equal(routineAIStatus({home:h,state}).check,null);
});

// Settings, as the person uses it: the form connects an endpoint, and the routines' Hermes gets it.
test('the Settings form connects the routines\' AI through the server, and leaves an own sign-in alone when asked',async t=>{
 const http=await import('node:http');
 const root=temporary(t),hermesHome=path.join(root,'.hermes-home'),bin=path.join(root,'.hermes-bin');fs.mkdirSync(hermesHome);fs.mkdirSync(bin);
 // A stand-in Hermes: the node program under the name hermes, which runs the file named by its first word.
 let executable;
 if(process.platform==='win32'){executable=path.join(bin,'hermes.exe');try{fs.linkSync(process.execPath,executable);}catch{fs.copyFileSync(process.execPath,executable);}}
 else{executable=path.join(bin,'hermes');fs.writeFileSync(executable,'#!/bin/sh\nscript="$1"; shift\nexec "'+process.execPath+'" "$PWD/$script" "$@"\n',{mode:0o755});}
 fs.writeFileSync(path.join(root,'cron'),'process.exit(0)');
 // `hermes chat ...`: answers from the model Hermes' own config names, or fails when there is none.
 fs.writeFileSync(path.join(root,'chat'),"const fs=require('fs'),path=require('path');process.stdin.resume();process.stdin.on('end',()=>{const c=fs.readFileSync(path.join(process.env.HERMES_HOME,'config.yaml'),'utf8');if(!/provider: \"custom\"/.test(c)){console.error('AuthenticationError: no model');process.exit(1);}console.log('Connected.');});");
 fs.mkdirSync(path.join(root,'.godspeed'),{recursive:true});fs.writeFileSync(path.join(root,'.godspeed','assistant.json'),JSON.stringify({verified:true,executable,home:hermesHome}));
 const endpoint=http.createServer((req,res)=>{let body='';req.on('data',d=>body+=d).on('end',()=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{content:'Connected'}}]}));});});
 await new Promise(r=>endpoint.listen(0,'127.0.0.1',r));t.after(()=>endpoint.close());
 const saved=process.env.GODSPEED_ORIGINAL_RUNTIME;process.env.GODSPEED_ORIGINAL_RUNTIME='on';t.after(()=>{if(saved===undefined)delete process.env.GODSPEED_ORIGINAL_RUNTIME;else process.env.GODSPEED_ORIGINAL_RUNTIME=saved;});
 const {createService}=await import('../server/main.mjs');
 const service=await createService({root,port:0,device:'pc'}),base='http://127.0.0.1:'+service.address.port;
 const call=async(route,body)=>{const r=await fetch(base+'/api/'+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
 try{
  assert.equal((await call('routine-ai')).data.source,'none','before: Settings says the routines have no AI');
  const url='http://127.0.0.1:'+endpoint.address().port+'/v1';
  const connected=await call('provider',{url,key:'fictional-key',model:'fictional-model'});
  assert.equal(connected.status,200,JSON.stringify(connected.data));
  assert.equal(connected.data.routines.source,'settings');assert.equal(connected.data.routines.check.ok,true,'the routines reached the AI');
  assert.match(fs.readFileSync(path.join(hermesHome,'config.yaml'),'utf8'),/default: "fictional-model"/);
  // The notebook's own copy got the full address, as before.
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'.godspeed','provider.json'),'utf8')).url,url+'/chat/completions');
  assert.equal((await call('routine-ai/check',{})).data.check.ok,true);
  // An own sign-in stays when the box is unticked: only the notebook's copy changes.
  fs.writeFileSync(path.join(hermesHome,'config.yaml'),'model:\n  provider: openai-codex\n  default: gpt-fictional\n');
  const kept=await call('provider',{url,key:'other-key',model:'other-model',routines:false});
  assert.equal(kept.status,200);assert.equal(kept.data.routines.source,'hermes');
  assert.equal(fs.readFileSync(path.join(hermesHome,'config.yaml'),'utf8'),'model:\n  provider: openai-codex\n  default: gpt-fictional\n');
  // A key Hermes could not read is refused before anything is saved.
  const refused=await call('provider',{url,key:'two words',model:'m'});
  assert.notEqual(refused.status,200);assert.match(refused.data.error,/space or a quotation mark/);
 }finally{await service.close();}
});

// With a backup AI in Hermes' chain (core/backup-ai.mjs) a request through Hermes is answered by the
// backup whenever the main one fails, so the check asks each on its own, by name.
test('with a backup connected, the check asks the main one and the backup each on their own',async t=>{
 const {home:h,state}=home(t);
 const {connectBackupAI}=await import('../core/backup-ai.mjs');
 connectRoutineAI({home:h,state,config:{url:'https://openrouter.ai/api/v1',key:'sk-or-fictional',model:'fictional/model'}});
 connectBackupAI({home:h,state,config:{url:'https://api.openai.com/v1',key:'sk-fictional-backup',model:'gpt-backup'}});
 const asked=[];let mainUp=false;
 const ask=async({route})=>{asked.push(route);if(route==='main'&&!mainUp)throw Error('The AI account reached a usage limit. It answers again once the limit resets.');return {text:'Connected'};};
 const down=await checkRoutineAI({executable:'hermes',home:h,cwd:h,state,ask,now:()=>new Date('2026-10-22T10:00:00Z')});
 assert.deepEqual(down.check,{at:'2026-10-22T10:00:00.000Z',ok:false,error:'The AI account reached a usage limit. It answers again once the limit resets.',backup:{ok:true,model:'gpt-backup'}});
 assert.deepEqual(asked,['main','backup']);
 assert.equal(JSON.parse(fs.readFileSync(path.join(state,'backup-ai.json'),'utf8')).main_failing_since,'2026-10-22T10:00:00.000Z');
 mainUp=true;const up=await checkRoutineAI({executable:'hermes',home:h,cwd:h,state,ask});
 assert.equal(up.check.ok,true);assert.equal(up.check.backup.ok,true);
 assert.equal(JSON.parse(fs.readFileSync(path.join(state,'backup-ai.json'),'utf8')).main_failing_since,undefined);
 // The request itself goes to the helper godspeed-model uses, naming the route, with no tools.
 const runtime=path.join(path.dirname(h),'runtime');fs.mkdirSync(runtime);fs.writeFileSync(path.join(runtime,'hermes'),'');fs.writeFileSync(path.join(runtime,'python3'),'');
 const helper=fakeHermes(JSON.stringify({text:'Connected',provider:'openai-api',model:'gpt-backup',backup:true}));let sent='';
 const spawnProcess=(command,args,options)=>{const child=helper.spawnProcess(command,args,options);child.stdin.on('data',d=>sent+=d);return child;};
 const {askDirectly}=await import('../core/routine-ai.mjs');
 const result=await askDirectly({executable:path.join(runtime,'hermes'),home:h,cwd:path.dirname(h),sourceRoot:runtime,spawnProcess,route:'backup'});
 assert.equal(result.backup,true);assert.ok(helper.calls[0][0].endsWith('addon-model.py'));
 const request=JSON.parse(sent);assert.equal(request.route,'backup');assert.equal(request.max_tokens,128);assert.equal(request.tools,undefined);
});
