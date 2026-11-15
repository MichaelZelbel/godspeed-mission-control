import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {Store} from '../core/records/store.mjs';
import {FileSync} from '../core/sync/git.mjs';
import {windowsInvalid} from '../core/file-policy.mjs';
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();

test('names Windows cannot hold are recognised',()=>{
  for(const name of ['notebook/Plan: draft.md','notebook/aux.md','notebook/AUX','notebook/com1.txt','skills/a?b/x.md','notebook/trailing. ','notebook/dot.','rules/what"quote.md','notebook/tab\there.md'])assert.ok(windowsInvalid(name),name);
  for(const name of ['notebook/Plan - draft.md','notebook/auxiliary.md','notebook/console.md','skills/a/b.md','notebook/Ärztebrief.md','notebook/com10.txt'])assert.ok(!windowsInvalid(name),name);
});

// A page made on a Mac or on Linux may be named what Windows cannot hold
// ("Plan: draft", "aux"). Git on Windows cannot check such a file out, so
// from the moment one was in the repository every merge on a Windows machine
// failed, and its sync stopped for good (7 October 2026). Such a name stays
// on the machine that has it; a commit from an older version that carries
// one is taken without it, and the rest still syncs.
test('a name Windows cannot hold does not stop the other machines\' sync',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-win-names-')),remote=path.join(root,'remote.git');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(remote);git(remote,'init','--bare','--initial-branch=main');
  const machine=name=>{const dir=path.join(root,name);git(root,'clone','-q','-c','core.autocrlf=false',remote,dir);git(dir,'config','user.name',name);git(dir,'config','user.email',name+'@localhost');const store=new Store(dir,{device:name}),sync=new FileSync(store);sync.initialize('https://github.com/synthetic/private.git');return {dir,store,sync};};
  const desktop=machine('desktop');desktop.store.save('notes',{title:'Start',content:'x\n'});
  assert.equal(desktop.sync.reconcile().state,'synced');
  // An older version on another machine committed a good note and two names
  // Windows cannot hold (made here with Git's plumbing, as no Windows file can).
  const old=path.join(root,'old');git(root,'clone','-q','-c','core.autocrlf=false',remote,old);git(old,'config','user.name','old');git(old,'config','user.email','old@localhost');
  new Store(old,{device:'old'}).save('notes',{title:'Good note',content:'From the other machine\n'});git(old,'add','notebook');
  for(const name of ['notebook/Plan: draft.md','notebook/aux.md']){const oid=execFileSync('git',['hash-object','-w','--stdin'],{cwd:old,input:'# '+name+'\n',encoding:'utf8'}).trim();git(old,'-c','core.protectNTFS=false','update-index','--add','--cacheinfo','100644,'+oid+','+name);}
  git(old,'-c','core.protectNTFS=false','commit','-qm','From an older version');git(old,'-c','core.protectNTFS=false','push','-q','origin','HEAD:main');
  const status=desktop.sync.reconcile();
  assert.equal(status.state,'synced',JSON.stringify(status));
  assert.ok(desktop.store.list('notes').some(n=>n.title==='Good note'),'the rest arrived');
  assert.deepEqual(git(desktop.dir,'ls-tree','-r','--name-only','origin/main').split('\n').filter(windowsInvalid),[],'the shared branch no longer carries them');
  const laptop=machine('laptop');
  assert.equal(laptop.sync.reconcile().state,'synced');
  assert.ok(laptop.store.list('notes').some(n=>n.title==='Good note'));
});
