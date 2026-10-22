import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {findDeviceCode,PlanSignIn} from '../core/plan-signin.mjs';
import {connectPlanMain,connectRoutineAI,routineAIStatus} from '../core/routine-ai.mjs';
import {connectBackupAI,connectHermesBackup,fallbackChain,readBackupEndpoint} from '../core/backup-ai.mjs';

// A ChatGPT plan signed in from Settings, one sign-in for the main AI and the backup alike
// (follow-up to discussion #20): the backup offers exactly the main AI's ways to connect.
const temporary=t=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-plan-signin-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;};
const HERMES_PRINTS='Signing in to OpenAI Codex...\r\n(Hermes creates its own session — won\'t affect Codex CLI or VS Code)\r\n\r\nTo continue, follow these steps:\r\n\r\n  1. Open this URL in your browser:\r\n     \x1b[94mhttps://auth.openai.com/codex/device\x1b[0m\r\n\r\n  2. Enter this code:\r\n     \x1b[94mABCD-12345\x1b[0m\r\n\r\nWaiting for sign-in... (press Ctrl+C to cancel)\r\n';

test('the address and code are read the way Hermes prints them, and nothing before both are there',()=>{
 assert.deepEqual(findDeviceCode(HERMES_PRINTS),{url:'https://auth.openai.com/codex/device',code:'ABCD-12345'});
 assert.equal(findDeviceCode('Signing in to OpenAI Codex...\r\n  1. Open this URL in your browser:\r\n     https://auth.openai.com/codex/device\r\n'),null);
 assert.deepEqual(findDeviceCode('! First copy your one-time code: 1A2B-3C4D\nOpen this URL to continue in your web browser: https://github.com/login/device'),{url:'https://github.com/login/device',code:'1A2B-3C4D'});
});

// A stand-in for `hermes auth list` (signed in or not) and `hermes auth add` (prints, then ends).
function fakeHermes({signedIn=false}={}){
 const state={signedIn,children:[],stopped:[]};
 const run=async(executable,args)=>{state.lastEnv=undefined;return {code:0,stdout:state.signedIn?'openai-codex (1 credentials):\n  #1 oauth\n':'No credentials\n',stderr:''};};
 const spawnProcess=(executable,args,options)=>{const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();Object.assign(child,{executable,args,options});state.children.push(child);return child;};
 return {state,run,spawnProcess,stopChild:child=>{state.stopped.push(child);setImmediate(()=>child.emit('close',null));}};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(check){for(let i=0;i<200&&!check();i++)await new Promise(r=>setTimeout(r,5));assert.ok(check());}

test('signing in: the code reaches Settings, and once it went through the first model that answered is saved',async t=>{
 const hermes=fakeHermes(),saved=[];
 const signIn=new PlanSignIn({executable:'/fictional/hermes',home:'/fictional/home',cwd:temporary(t),...hermes,onSignedIn:async as=>{saved.push(as);return {model:'gpt-fictional'};}});
 assert.deepEqual(await signIn.start('backup'),{state:'starting',as:'backup'});
 const [child]=hermes.state.children;
 assert.deepEqual(child.args,['auth','add','openai-codex','--type','oauth','--no-browser']);
 assert.equal(child.options.env.HERMES_HOME,'/fictional/home');assert.equal(child.options.env.PYTHONUNBUFFERED,'1');
 child.stdout.write(HERMES_PRINTS);await tick();
 assert.deepEqual(signIn.view(),{state:'waiting',as:'backup',url:'https://auth.openai.com/codex/device',code:'ABCD-12345'});
 await assert.rejects(signIn.start('main'),/sign-in for your backup AI is under way/);
 assert.deepEqual(await signIn.start('backup'),signIn.view(),'pressed twice: one sign-in');assert.equal(hermes.state.children.length,1);
 hermes.state.signedIn=true;child.emit('close',0);
 await until(()=>signIn.view().state==='connected');
 assert.deepEqual(signIn.view(),{state:'connected',as:'backup',model:'gpt-fictional'});assert.deepEqual(saved,['backup']);
 assert.ok(!JSON.stringify(signIn.view()).includes('Waiting for sign-in'),'never the program\'s own words');
});

test('a plan Hermes holds already needs no code; a sign-in that did not go through or never gave a code says so',async t=>{
 const ready=fakeHermes({signedIn:true}),cwd=temporary(t);
 const quick=new PlanSignIn({executable:'h',home:'/h',cwd,...ready,onSignedIn:async()=>({model:'gpt-a'})});
 await quick.start('main');await until(()=>quick.view().state==='connected');assert.equal(ready.state.children.length,0);
 const expired=fakeHermes(),late=new PlanSignIn({executable:'h',home:'/h',cwd,...expired,onSignedIn:async()=>({model:'never'})});
 await late.start('main');expired.state.children[0].stdout.write(HERMES_PRINTS);await tick();expired.state.children[0].emit('close',1);
 await until(()=>late.view().state==='failed');assert.match(late.view().error,/The code ran out, or the sign-in did not go through\. Nothing is broken/);
 const silent=fakeHermes(),mute=new PlanSignIn({executable:'h',home:'/h',cwd,...silent,codeWaitMs:20,onSignedIn:async()=>({model:'never'})});
 await mute.start('backup');await until(()=>mute.view().state==='failed');
 assert.match(mute.view().error,/gave no sign-in code/);assert.equal(silent.state.stopped.length,1,'the waiting program is stopped');
 const unanswered=fakeHermes({signedIn:true}),none=new PlanSignIn({executable:'h',home:'/h',cwd,...unanswered,onSignedIn:async()=>{throw Error('The selected Godspeed model could not answer. Check its connection and usage allowance.');}});
 await none.start('backup');await until(()=>none.view().state==='failed');assert.match(none.view().error,/could not answer/);
 await assert.rejects(none.start('neither'),/main AI or your backup/);
 const open=fakeHermes(),cancelled=new PlanSignIn({executable:'h',home:'/h',cwd,...open,onSignedIn:async()=>({model:'x'})});
 await cancelled.start('main');assert.deepEqual(cancelled.cancel(),{state:'idle'});assert.equal(open.state.stopped.length,1);
});

test('a plan as the main AI replaces the address and key of the main AI before it, and Settings reads it back',t=>{
 const root=temporary(t),home=path.join(root,'hermes'),state=path.join(root,'.godspeed');fs.mkdirSync(home,{recursive:true});fs.mkdirSync(state,{recursive:true});
 fs.writeFileSync(path.join(home,'config.yaml'),'# mine\ntimezone: "Europe/Berlin"\n');
 connectRoutineAI({home,state,config:{url:'https://llm.example.org/v1',key:'k-old',model:'old'}});
 const status=connectPlanMain({home,state,model:'gpt-fictional'});
 const config=fs.readFileSync(path.join(home,'config.yaml'),'utf8');
 assert.match(config,/^model:\n  provider: "openai-codex"\n  default: "gpt-fictional"\n/m);
 assert.doesNotMatch(config,/base_url|api_key|k-old/);assert.match(config,/# mine/);assert.match(config,/timezone: "Europe\/Berlin"/);
 assert.deepEqual([status.provider,status.model,status.source,status.key],['openai-codex','gpt-fictional','settings',null]);
 assert.throws(()=>connectPlanMain({home,state,model:' '}),/Name the model/);
 // As the backup, a plan is reached through Hermes: an address saved for an earlier backup goes.
 connectBackupAI({home,state,config:{url:'https://openrouter.ai/api/v1',key:'sk-or-old-backup',model:'x/y'}});
 connectHermesBackup({home,state,entry:{provider:'openai-codex',model:'gpt-fictional'},via:'settings'});
 assert.equal(readBackupEndpoint(state),null);
 assert.deepEqual(fallbackChain(fs.readFileSync(path.join(home,'config.yaml'),'utf8')),[{provider:'openai-codex',model:'gpt-fictional',key:false}]);
});

// Settings, through the server, with a stand-in Hermes (a shell program, so on Mac and Linux only):
// the plan cannot be both the main AI and the backup, and a sign-in saves the model that answered.
test('the sign-in through the notebook server, for the main AI and the backup',{skip:process.platform==='win32'&&'a shell stand-in for Hermes'},async t=>{
 const root=temporary(t),home=path.join(root,'.hermes-home'),bin=path.join(root,'.hermes-bin');fs.mkdirSync(home);fs.mkdirSync(bin);
 // hermes: `auth list` says signed in to the plan; python3: the helper's plan route answers with a model.
 fs.writeFileSync(path.join(bin,'hermes'),'#!/bin/sh\nif [ "$1 $2" = "auth list" ]; then echo "openai-codex (1 credentials):"; exit 0; fi\nexit 0\n',{mode:0o755});
 fs.writeFileSync(path.join(bin,'python3'),'#!/bin/sh\ncat >/dev/null\necho \'{"text":"Connected","provider":"openai-codex","model":"gpt-fictional"}\'\n',{mode:0o755});
 fs.writeFileSync(path.join(home,'config.yaml'),'model:\n  provider: openrouter\n  default: x/y\n');
 fs.mkdirSync(path.join(root,'.godspeed'),{recursive:true});fs.writeFileSync(path.join(root,'.godspeed','assistant.json'),JSON.stringify({verified:true,executable:path.join(bin,'hermes'),home,sourceRoot:bin}));
 const saved=process.env.GODSPEED_ORIGINAL_RUNTIME;process.env.GODSPEED_ORIGINAL_RUNTIME='on';t.after(()=>{if(saved===undefined)delete process.env.GODSPEED_ORIGINAL_RUNTIME;else process.env.GODSPEED_ORIGINAL_RUNTIME=saved;});
 const {createService}=await import('../server/main.mjs');
 const service=await createService({root,port:0,device:'pc'}),base='http://127.0.0.1:'+service.address.port;
 const call=async(route,body)=>{const r=await fetch(base+'/api/'+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
 const settle=async()=>{for(let i=0;i<200;i++){const {data}=await call('ai-signin');if(!['starting','waiting','connecting'].includes(data.state))return data;await new Promise(r=>setTimeout(r,25));}throw Error('still signing in');};
 try{
  assert.deepEqual((await call('ai-signin')).data,{available:true,state:'idle'});
  await call('ai-signin/start',{as:'backup'});
  assert.deepEqual(await settle(),{available:true,state:'connected',as:'backup',model:'gpt-fictional'});
  assert.deepEqual(fallbackChain(fs.readFileSync(path.join(home,'config.yaml'),'utf8')),[{provider:'openai-codex',model:'gpt-fictional',key:false}]);
  assert.equal((await call('backup-ai')).data.backup.via,'settings');
  // The plan is the backup now, so it cannot also be the main AI.
  const both=await call('ai-signin/start',{as:'main'});assert.equal(both.status,400);assert.match(both.data.error,/Your backup AI is your ChatGPT plan/);
  await call('backup-ai/remove',{});
  await call('ai-signin/start',{as:'main'});
  assert.equal((await settle()).state,'connected');
  assert.deepEqual([(await call('routine-ai')).data.provider,(await call('routine-ai')).data.model],['openai-codex','gpt-fictional']);
  const again=await call('ai-signin/start',{as:'backup'});assert.equal(again.status,400);assert.match(again.data.error,/That is the service your main AI uses already/);
 }finally{await service.close();}
});
