import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';
import {createService} from '../server/main.mjs';
import {GitHubSignIn,connectRecordSync,credentialRefusal} from '../core/sync/github-sign-in.mjs';

for(const key of Object.keys(process.env))if(/^(GODSPEED_|HERMES_)/.test(key))delete process.env[key];

// Issue #572: Sync now on a notebook that never connected sync ran git and showed its error
// ("git ls-files -z"), and the issue asked that a GitHub sign-in Settings starts never be
// left running.
test('Sync now on a notebook that never connected sync says so and runs no git',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-sync-not-connected-'));process.env.GODSPEED_ASSISTANT_CONFIG=path.join(root,'no-assistant.json');
  const service=await createService({root,port:0});
  t.after(async()=>{await service.close();fs.rmSync(root,{recursive:true,force:true});delete process.env.GODSPEED_ASSISTANT_CONFIG;});
  const r=await fetch('http://127.0.0.1:'+service.address.port+'/api/sync/run',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  assert.equal(r.status,200);
  const body=await r.json();
  assert.equal(body.status.state,'not_connected');
  assert.match(body.status.error,/not connected/);
  assert.match(body.status.detail,/Settings/);assert.match(body.status.detail,/Connect record sync/);
  assert.doesNotMatch(JSON.stringify(body),/\bgit\b|ls-files|Command failed/i);
  // The runner writes this once a worker has finished; no worker ran.
  assert.equal(fs.existsSync(path.join(service.store.state,'sync-status.json')),false);
});

test('Sync now on a notebook that connected sync still runs the sync',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-sync-connected-'));process.env.GODSPEED_ASSISTANT_CONFIG=path.join(root,'no-assistant.json');
  const service=await createService({root,port:0});
  t.after(async()=>{await service.close();fs.rmSync(root,{recursive:true,force:true});delete process.env.GODSPEED_ASSISTANT_CONFIG;});
  fs.writeFileSync(path.join(service.store.state,'sync-config.json'),JSON.stringify({enabled:true}));
  const r=await fetch('http://127.0.0.1:'+service.address.port+'/api/sync/run',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  assert.equal(r.status,200);
  const body=await r.json();
  assert.notEqual(body.status.state,'not_connected');
  assert.doesNotMatch(JSON.stringify(body),/Sync is not connected/);
});

test("Settings' Sync now shows that answer",()=>{
  const control=fs.readFileSync(new URL('../ui/src/local/Control.tsx',import.meta.url),'utf8');
  const button=control.slice(control.indexOf("call('sync/run'"),control.indexOf('>Sync now</button>')+200);
  assert.ok(control.includes("call('sync/run'"),'Sync now reads what the route answers');
  assert.match(button,/syncNow\?\.state==='not_connected'&&<p role="status">\{syncNow\.error\} \{syncNow\.detail\}<\/p>/);
});

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const alive=pid=>{try{process.kill(pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}};
async function until(check,ms=2000){const end=Date.now()+ms;while(Date.now()<end){if(check())return true;await pause(25);}return check();}
// A stand-in for `gh auth login --web`: prints its one-time code and waits, as gh does without a terminal.
function signInWith(t,options={}){
  const pids=[];
  const run=(command,args,opts)=>{const child=spawn(process.execPath,['-e',"process.stderr.write('! First copy your one-time code: AB12-CD34\\nOpen https://github.com/login/device\\n');setInterval(()=>{},1000)"],opts);pids.push(child.pid);return child;};
  const signIn=new GitHubSignIn({platform:'linux',env:{PATH:process.env.PATH},run,probe:command=>command==='gh'?{status:0,stdout:'',stderr:''}:{status:null,stdout:'',stderr:''},open:()=>{},...options});
  t.after(()=>{for(const pid of pids)if(alive(pid))process.kill(pid);});
  return {signIn,pids};
}
async function connect(signIn){
  const answer=await connectRecordSync({url:'https://github.com/a/b',configure:async()=>{throw new Error(credentialRefusal);},signIn});
  assert.equal(answer.signIn.state,'signing_in');
  assert.ok(await until(()=>signIn.status().code==='AB12-CD34'),'the one-time code shows');
}

test('a GitHub sign-in the Connect route starts ends at its named time limit, leaving no process',async t=>{
  const {signIn,pids}=signInWith(t,{limitMs:300});
  await connect(signIn);
  assert.equal(pids.length,1);assert.equal(alive(pids[0]),true,'gh waits while the person types the code');
  assert.ok(await until(()=>!alive(pids[0])),'the sign-in program is gone after the limit');
  assert.equal(signIn.status().state,'failed');assert.match(signIn.status().message,/not finished within 15 minutes/);
});

test('a GitHub sign-in still waiting when the notebook closes ends with it',async t=>{
  const {signIn,pids}=signInWith(t);
  await connect(signIn);
  assert.equal(alive(pids[0]),true);
  signIn.close();
  assert.ok(await until(()=>!alive(pids[0])),'the sign-in program is gone after close');
});
