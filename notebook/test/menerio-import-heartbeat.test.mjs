import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {Store} from '../core/records/store.mjs';
import {MenerioImport} from '../server/menerio-import.mjs';

// The supervisor restarts a notebook whose heartbeat has not moved for
// eleven minutes. While a Menerio import runs the scheduler is paused, so
// nothing moved it, and an import of a large account was killed half way
// after about twelve minutes, on every attempt (7 October 2026). The running
// import now keeps the heartbeat moving, for as long as its own limit.
test('a running Menerio import keeps the heartbeat moving until it ends',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-import-beat-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store=new Store(root),beats=[];
  // A copy that sends no message for a long stretch, then ends.
  class SlowWorker extends EventEmitter{constructor(){super();setTimeout(()=>this.emit('exit',0),200);}terminate(){this.emit('exit',1);return Promise.resolve();}}
  const job=new MenerioImport(store,path.join(root,'media'),()=>{},{beat:()=>beats.push(Date.now()),beatEvery:20,Worker:SlowWorker});
  job.save({id:'job-1',state:'ready',startedAt:new Date().toISOString(),summary:{}});
  await job.start({action:'apply',id:'job-1'});
  await new Promise(resolve=>setTimeout(resolve,320));
  assert.ok(beats.length>=5,'the heartbeat moved '+beats.length+' times');
  const after=beats.length;await new Promise(resolve=>setTimeout(resolve,100));
  assert.ok(beats.length<=after+1,'it stops when the import has ended');
});
