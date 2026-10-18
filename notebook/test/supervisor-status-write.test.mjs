import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {EventEmitter} from 'node:events';
import {Supervisor} from '../core/supervisor.mjs';

// The supervisor writes an advisory status file, and the notebook is a
// non-detached child, so a failed status write must never end the supervisor
// and take the notebook down with it. Until 7 October 2026 a read-only status
// file did exactly that on Windows.
test('a failed status-file write does not kill the supervisor or its notebook child',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-supstatus-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 // Make the status path unwritable: a directory where the file must go.
 fs.mkdirSync(path.join(root,'.godspeed','supervisor.json'),{recursive:true});
 const child=Object.assign(new EventEmitter(),{pid:4242,exitCode:null,kill(){this.killed=true;}});
 let exited=null;
 const supervisor=new Supervisor({root,server:'fake-server.mjs',spawnProcess:()=>child,exit:code=>{exited=code;},setTimer:()=>{},fetchImpl:async()=>{throw Error('unused');}});
 assert.doesNotThrow(()=>supervisor.start());
 assert.equal(exited,null,'the supervisor did not exit');
 assert.equal(child.killed,undefined,'the notebook child was not killed');
 assert.equal(supervisor.child,child,'the notebook was still started');
 // status() itself is safe to call directly too.
 assert.doesNotThrow(()=>supervisor.status({state:'healthy'}));
 clearInterval(supervisor.timer);
});
