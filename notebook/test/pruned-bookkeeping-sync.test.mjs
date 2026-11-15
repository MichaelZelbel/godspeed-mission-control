import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {Store} from '../core/records/store.mjs';
import {FileSync} from '../core/sync/git.mjs';
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();

function machines(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-prune-sync-')),remote=path.join(root,'remote.git');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(remote);git(remote,'init','--bare','--initial-branch=main');
  return name=>{const dir=path.join(root,name);git(root,'clone','-q','-c','core.autocrlf=false',remote,dir);git(dir,'config','user.name',name);git(dir,'config','user.email',name+'@localhost');
    const store=new Store(dir,{device:name}),sync=new FileSync(store);sync.initialize('https://github.com/synthetic/private.git');return {dir,store,sync};};
}

// The scheduler prunes old run receipts and the earlier versions of jobs:
// bookkeeping nothing reads, removed as files. Sync then took each removal
// for a page deleted by hand and wrote it back as a tombstone, which the
// next prune removed again, every round, for good; and the other machine
// was asked to review the removal of each (7 October 2026). Bookkeeping's
// removal travels as a removal.
test('pruned receipts and history leave as removals, once, and need no review elsewhere',t=>{
  const machine=machines(t),desktop=machine('desktop');
  desktop.store.save('notes',{title:'A note',content:'kept\n'});
  const receipts=Array.from({length:40},(_,i)=>desktop.store.prepare('job_receipts',{id:'brief-'+i,job_id:'brief',state:'verified',finished_at:'2026-09-01T00:00:00Z'}));
  const history=Array.from({length:40},(_,i)=>desktop.store.prepare('record_history',{id:'history-'+i,source_type:'jobs',recorded_at:'2026-09-01T00:00:00Z',snapshot:{}}));
  desktop.store.commit([...receipts,...history]);
  assert.equal(desktop.sync.reconcile().state,'synced');
  const laptop=machine('laptop');assert.equal(laptop.sync.reconcile().state,'synced');
  assert.equal(laptop.store.list('job_receipts').length,40);
  // What the scheduler's prune does.
  desktop.store.commit([],{removeKeys:[...receipts.map(r=>'job_receipts/'+r.id),...history.map(h=>'record_history/'+h.id)]});
  assert.equal(desktop.sync.reconcile().state,'synced');
  assert.equal(desktop.store.list('job_receipts',{removed:true}).length,0,'no tombstone came back');
  const head=git(desktop.dir,'rev-parse','HEAD');
  assert.equal(desktop.sync.reconcile().state,'synced');
  assert.equal(git(desktop.dir,'rev-parse','HEAD'),head,'nothing new to commit on the next round');
  const arrived=laptop.sync.reconcile();
  assert.equal(arrived.state,'synced',JSON.stringify(arrived));
  assert.equal(laptop.store.list('job_receipts',{removed:true}).length,0);
  assert.equal(laptop.store.list('record_history',{removed:true}).length,0);
  assert.deepEqual(fs.existsSync(path.join(laptop.dir,'conflicts'))?fs.readdirSync(path.join(laptop.dir,'conflicts')):[],[]);
  assert.equal(laptop.store.list('notes').length,1);
});

// A record that is not bookkeeping and was deleted by hand is still kept as
// a tombstone, as before.
test('a note deleted by hand still leaves as a tombstone',t=>{
  const machine=machines(t),desktop=machine('desktop');
  const note=desktop.store.save('notes',{title:'Gone by hand',content:'x\n'});
  assert.equal(desktop.sync.reconcile().state,'synced');
  fs.rmSync(desktop.store.file(desktop.store.get('notes',note.id)));
  assert.equal(desktop.sync.reconcile().state,'synced');
  assert.ok(desktop.store.get('notes',note.id)?.removed_at);
});
