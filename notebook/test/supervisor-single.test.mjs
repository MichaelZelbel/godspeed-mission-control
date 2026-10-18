import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {Supervisor} from '../core/supervisor.mjs';

// One supervisor per workspace. A second one (a login shortcut and a task
// both starting it, a double click) launched a second notebook, which could
// not take the port, and relaunched it for ever, rewriting the first one's
// status as it went (7 October 2026). A second supervisor steps aside while
// the first is alive and its notebook answers for this workspace.
function fixture(t,{lockPid,healthy}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-supervisor-one-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'.godspeed'),{recursive:true});
  if(lockPid)fs.writeFileSync(path.join(root,'.godspeed','supervisor.lock'),JSON.stringify({pid:lockPid,at:new Date().toISOString()}));
  const spawned=[];let exited=null,timers=[];
  const supervisor=new Supervisor({root,server:'server.mjs',spawnProcess:()=>{const child=new EventEmitter();child.pid=4242;spawned.push(child);return child;},exit:code=>{exited=code;},setTimer:()=>{},every:3600000,
    fetchImpl:async()=>{if(!healthy)throw Object.assign(new Error('fetch failed'),{cause:{code:'ECONNREFUSED'}});return {ok:true,json:async()=>({ok:true,instance:supervisor.instance})};}});
  t.after(()=>clearInterval(supervisor.timer));
  return {supervisor,spawned,exited:()=>exited,root};
}

test('a second supervisor steps aside while the first one and its notebook are up',async t=>{
  const {supervisor,spawned,exited}=fixture(t,{lockPid:process.ppid,healthy:true});
  supervisor.start();await new Promise(resolve=>setTimeout(resolve,50));
  assert.equal(spawned.length,0,'no second notebook');
  assert.equal(exited(),0);
});

test('a supervisor takes over from one that is gone',t=>{
  const {supervisor,spawned,root}=fixture(t,{lockPid:2147483640,healthy:false});
  supervisor.start();
  assert.equal(spawned.length,1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'.godspeed','supervisor.lock'),'utf8')).pid,process.pid);
});

test('a supervisor takes over when the other one\'s notebook does not answer',async t=>{
  const {supervisor,spawned}=fixture(t,{lockPid:process.ppid,healthy:false});
  supervisor.start();await new Promise(resolve=>setTimeout(resolve,50));
  assert.equal(spawned.length,1);
});
