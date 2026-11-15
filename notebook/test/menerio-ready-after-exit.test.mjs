import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {Store} from '../core/records/store.mjs';
import {MenerioImport} from '../server/menerio-import.mjs';

// A copy's end (ready, complete, failed) used to be saved when its worker said so, while the
// worker was still set. A person who pressed Import the moment a preview showed as ready got
// 409 "A copy is already running" for a preview that was ready. It is now saved when the worker
// has exited.
const fixture=t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-import-exit-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store=new Store(root),bundle=path.join(root,'bundle.json');fs.writeFileSync(bundle,'{}');
  return {root,store,bundle};
};
// A worker that sends `messages`, then exits after `exitAfter` ms.
const workerThat=(messages,exitAfter=60)=>class extends EventEmitter{
  constructor(){super();setTimeout(()=>{for(const m of messages)this.emit('message',m);},5);setTimeout(()=>this.emit('exit',0),exitAfter);}
  terminate(){this.emit('exit',1);return Promise.resolve();}
};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('a preview is ready only when its worker has exited, and Import then is accepted',async t=>{
  const {root,store,bundle}=fixture(t);
  const Worker=workerThat([{progress:'Reading.'},{ready:true,summary:{trashedNotes:1},copyDate:'2026-11-01'}]);
  const job=new MenerioImport(store,path.join(root,'media'),()=>{},{Worker});
  fs.writeFileSync(path.join(job.root,'config.json'),JSON.stringify({bundle}));
  const started=await job.start({action:'preview',source:'prepared'});
  await wait(30);
  assert.equal(job.status().job.state,'preparing','the worker has said it is ready but has not exited');
  await assert.rejects(job.start({action:'apply',id:started.id}),{status:409});
  await wait(100);
  const ready=job.status().job;
  assert.equal(ready.state,'ready');assert.equal(ready.summary.trashedNotes,1);assert.equal(ready.copyDate,'2026-11-01');
  const applying=await job.start({action:'apply',id:started.id});
  assert.equal(applying.state,'importing','Import right after ready is accepted');
  await wait(120);
});

test('an import is complete only when its worker has exited, and onComplete runs once',async t=>{
  const {root,store}=fixture(t);let completed=0;
  const Worker=workerThat([{complete:true,summary:{backupSaved:true}}]);
  const job=new MenerioImport(store,path.join(root,'media'),()=>{completed++;},{Worker});
  job.save({id:'job-1',state:'ready',startedAt:new Date().toISOString(),summary:{}});
  await job.start({action:'apply',id:'job-1'});
  await wait(30);
  assert.equal(job.status().job.state,'importing');
  await wait(100);
  assert.equal(job.status().job.state,'complete');assert.equal(job.status().job.summary.backupSaved,true);assert.equal(completed,1);
});

test('a worker that exits without a result, or says it failed, leaves the copy failed',async t=>{
  const {root,store}=fixture(t);
  const silent=new MenerioImport(store,path.join(root,'media'),()=>{},{Worker:workerThat([])});
  silent.save({id:'a',state:'ready',startedAt:new Date().toISOString(),summary:{}});
  await silent.start({action:'apply',id:'a'});await wait(120);
  assert.equal(silent.status().job.state,'failed');assert.match(silent.status().job.error,/stopped unexpectedly/);
  const bad=new MenerioImport(store,path.join(root,'media'),()=>{},{Worker:workerThat([{failed:true,error:'No good.'}])});
  bad.save({id:'b',state:'ready',startedAt:new Date().toISOString(),summary:{}});
  await bad.start({action:'apply',id:'b'});await wait(120);
  assert.equal(bad.status().job.state,'failed');assert.equal(bad.status().job.error,'No good.');
});
