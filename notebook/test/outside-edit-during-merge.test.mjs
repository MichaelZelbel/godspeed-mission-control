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
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-outside-edit-')),remote=path.join(root,'remote.git');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(remote);git(remote,'init','--bare','--initial-branch=main');
  return name=>{const dir=path.join(root,name);git(root,'clone','-q','-c','core.autocrlf=false',remote,dir);git(dir,'config','user.name',name);git(dir,'config','user.email',name+'@localhost');
    const store=new Store(dir,{device:name}),sync=new FileSync(store);sync.initialize('https://github.com/synthetic/private.git');return {dir,store,sync};};
}

// Obsidian takes no lock. A note it saved while sync was merging the other
// machine's edits was overwritten by the merged version, and the edit was
// gone with no conflict (7 October 2026). Like any other document, the
// record keeps the write made meanwhile, and the merged version is kept for
// review.
test('a note edited in Obsidian during a merge keeps that edit and the merged version waits for review',t=>{
  const machine=machines(t),desktop=machine('desktop');
  const shared=desktop.store.save('notes',{title:'Shared',content:'Original text\n'}),own=desktop.store.save('notes',{title:'Own',content:'Desktop only\n'});
  assert.equal(desktop.sync.reconcile().state,'synced');
  const laptop=machine('laptop');assert.equal(laptop.sync.reconcile().state,'synced');
  laptop.store.save('notes',{...laptop.store.get('notes',shared.id),content:'Changed on the laptop\n'},laptop.store.get('notes',shared.id)._hash);
  assert.equal(laptop.sync.reconcile().state,'synced');
  desktop.store.save('notes',{...desktop.store.get('notes',own.id),content:'Desktop changed this one\n'},desktop.store.get('notes',own.id)._hash);
  // Obsidian saves the shared note while the merge runs.
  const file=desktop.store.file(desktop.store.get('notes',shared.id)),real=desktop.sync.git.bind(desktop.sync);let edited=false;
  desktop.sync.git=(args,...rest)=>{const out=real(args,...rest);if(args[0]==='commit'&&args[1]==='--no-edit'&&!edited){edited=true;fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('Original text','Edited in Obsidian meanwhile'));}return out;};
  desktop.sync.reconcile();
  assert.ok(edited,'the edit happened during the merge');
  assert.match(fs.readFileSync(file,'utf8'),/Edited in Obsidian meanwhile/,'the Obsidian edit is kept');
  const reviews=fs.readdirSync(path.join(desktop.dir,'conflicts')).map(n=>JSON.parse(fs.readFileSync(path.join(desktop.dir,'conflicts',n),'utf8')));
  assert.equal(reviews.length,1);
  assert.match(reviews[0].remote,/Changed on the laptop/);
  assert.match(reviews[0].local,/Edited in Obsidian meanwhile/);
  assert.equal(desktop.store.get('notes',own.id).content,'Desktop changed this one\n');
});
