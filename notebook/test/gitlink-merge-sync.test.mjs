// SY4: a git-cloned folder under skills/ is committed as a gitlink (mode
// 160000). Before the fix the merge read every tracked path in the merged tree
// as a file, so the gitlink's directory crashed the reconcile with EISDIR and
// stopped sync for good on the receiving machine. Only regular blobs are read
// now, so the two machines keep converging.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {Store} from '../core/records/store.mjs';
import {FileSync} from '../core/sync/git.mjs';
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();

test('a committed gitlink under skills/ does not stop sync; the machines converge',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-gitlink-')),remote=path.join(root,'remote.git');
  fs.mkdirSync(remote);git(remote,'init','--bare','--initial-branch=main');
  const machine=name=>{const dir=path.join(root,name);git(root,'clone','-q','-c','core.autocrlf=false',remote,dir);git(dir,'config','user.name',name);git(dir,'config','user.email',name+'@localhost');
    const store=new Store(dir,{device:name}),sync=new FileSync(store);sync.initialize('https://github.com/synthetic/private.git');return {dir,store,sync,name};};
  const desktop=machine('desktop');desktop.store.save('notes',{title:'From the desktop',content:'a\n'});
  assert.equal(desktop.sync.reconcile().state,'synced');
  const laptop=machine('laptop');assert.equal(laptop.sync.reconcile().state,'synced');
  // A skill installed the usual way: an upstream repo cloned into skills/.
  const upstream=path.join(root,'upstream');fs.mkdirSync(upstream);git(upstream,'init','-q','-b','main');git(upstream,'config','user.name','U');git(upstream,'config','user.email','u@l');
  fs.writeFileSync(path.join(upstream,'SKILL.md'),'# A skill\n');git(upstream,'add','-A');git(upstream,'commit','-qm','skill');
  git(desktop.dir,'clone','-q',upstream,path.join('skills','some-skill'));
  assert.equal(desktop.sync.reconcile().state,'synced','the gitlink creator keeps syncing');
  assert.match(git(desktop.dir,'ls-tree','origin/main','skills/'),/160000 commit/,'the gitlink reached the remote');
  // The laptop goes on working and must take the desktop's changes without crashing.
  laptop.store.save('notes',{title:'From the laptop',content:'b\n'});
  for(let i=0;i<2;i++)assert.equal(laptop.sync.reconcile().state,'synced','the receiving machine must not get stuck on the gitlink');
  assert.equal(desktop.sync.reconcile().state,'synced');
  assert.deepEqual(laptop.store.list('notes').map(n=>n.title).sort(),['From the desktop','From the laptop']);
  assert.deepEqual(desktop.store.list('notes').map(n=>n.title).sort(),['From the desktop','From the laptop']);
});
