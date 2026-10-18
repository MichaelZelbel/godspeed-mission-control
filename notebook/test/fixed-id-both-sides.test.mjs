import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {Store} from '../core/records/store.mjs';
import {FileSync} from '../core/sync/git.mjs';
import {conflictView,resolveSavedConflict} from '../core/conflicts.mjs';
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();

function machines(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-fixed-id-')),remote=path.join(root,'remote.git');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(remote);git(remote,'init','--bare','--initial-branch=main');
  machines.root=root;machines.remote=remote;
  return name=>{const dir=path.join(root,name);git(root,'clone','-q','-c','core.autocrlf=false',remote,dir);git(dir,'config','user.name',name);git(dir,'config','user.email',name+'@localhost');
    const store=new Store(dir,{device:name}),sync=new FileSync(store);sync.initialize('https://github.com/synthetic/private.git');return {dir,store,sync};};
}
const reviews=dir=>{const folder=path.join(dir,'conflicts');return fs.existsSync(folder)?fs.readdirSync(folder).map(n=>JSON.parse(fs.readFileSync(path.join(folder,n),'utf8'))):[];};

// Some records have one fixed id on every machine: the installation's
// settings (who runs the routines, the time zone), the processing settings.
// Two machines that each wrote one before they first met hold two records
// with that id and different identities. The merge took one of them and the
// other machine's settings were gone without a word (7 October 2026). They
// are one record created on both sides: this machine's stays, and the other
// is kept for review.
test('a fixed-id record written on both machines before they met is kept for review, never replaced unseen',t=>{
  const machine=machines(t),desktop=machine('desktop');
  desktop.store.save('notes',{title:'Start',content:'x\n'});
  assert.equal(desktop.sync.reconcile().state,'synced');
  const laptop=machine('laptop');assert.equal(laptop.sync.reconcile().state,'synced');
  desktop.store.save('settings',{id:'installation',owner:'desktop',timezone:'Europe/Berlin'});
  laptop.store.save('settings',{id:'installation',owner:'laptop',timezone:'America/New_York'});
  assert.notEqual(desktop.store.get('settings','installation').uid,laptop.store.get('settings','installation').uid);
  assert.equal(desktop.sync.reconcile().state,'synced');
  const status=laptop.sync.reconcile();
  const mine=laptop.store.get('settings','installation');
  assert.equal(mine.owner,'laptop','this machine keeps its own settings: '+JSON.stringify(status));
  assert.equal(mine.timezone,'America/New_York');
  const kept=reviews(laptop.dir).filter(r=>/settings\/installation/.test(r.path));
  assert.equal(kept.length,1,'the other machine settings are kept for review: '+JSON.stringify(status));
  assert.match(kept[0].remote,/"owner": "desktop"/);
  assert.deepEqual(laptop.store.problems,[]);
  // Choosing the other machine's settings takes their values, one record still.
  const view=conflictView(laptop.store,kept[0].id);
  resolveSavedConflict(laptop.store,{id:kept[0].id,choice:'remote',expected_hash:view.current_hash});
  const chosen=laptop.store.get('settings','installation');
  assert.equal(chosen.owner,'desktop');assert.equal(chosen.uid,mine.uid);
  assert.equal(laptop.store.list('settings').filter(s=>s.id==='installation').length,1);
});

// A second computer set up on its own (a plain folder) joins a notebook that
// already exists: the notebook keeps its settings, as it keeps its files, and
// the newcomer's are kept for review.
test("on a first join the notebook keeps its fixed-id record and the newcomer's waits for review",t=>{
  const machine=machines(t),desktop=machine('desktop');
  desktop.store.save('settings',{id:'installation',owner:'desktop',timezone:'Europe/Berlin'});
  assert.equal(desktop.sync.reconcile().state,'synced');
  const dir=path.join(machines.root,'laptop');fs.mkdirSync(dir);
  const store=new Store(dir,{device:'laptop'}),sync=new FileSync(store);
  store.save('settings',{id:'installation',owner:'laptop',timezone:'America/New_York'});
  sync.initialize('https://github.com/synthetic/private.git');git(dir,'config','user.name','laptop');git(dir,'config','user.email','laptop@localhost');git(dir,'remote','set-url','origin',machines.remote);
  const status=sync.reconcile();
  assert.equal(store.get('settings','installation').owner,'desktop',JSON.stringify(status));
  const kept=reviews(dir).filter(r=>/settings\/installation/.test(r.path));
  assert.equal(kept.length,1,JSON.stringify(status));
  assert.match(kept[0].local,/"owner": "laptop"/);
  assert.deepEqual(store.problems,[]);
});
