import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Store } from '../core/records/store.mjs';
import { FileSync } from '../core/sync/git.mjs';
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();

function workspace(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-private-merge-')),remote=path.join(root,'remote.git');
  fs.mkdirSync(remote);git(remote,'init','--bare','--initial-branch=main');
  const dir=path.join(root,'device');fs.mkdirSync(dir);
  const store=new Store(dir,{device:'desktop'});
  const sync=new FileSync(store);sync.initialize('https://github.com/example-owner/example-private');
  git(dir,'config','user.name','Private Merge Test');git(dir,'config','user.email','test@localhost');
  git(dir,'remote','set-url','origin',remote);
  return {store,sync,dir,remote,root};
}
const conflicts=dir=>{const folder=path.join(dir,'conflicts');return fs.existsSync(folder)?fs.readdirSync(folder).filter(n=>n.endsWith('.json')):[];};

// Michael's server synced the assistant's history archive before that archive
// became device-private. The remote still carried it, this machine had stopped
// tracking it, and the merge called that a concurrent edit: it saved a conflict
// about a file that by policy never leaves the machine, and a saved conflict
// stops every later synchronization. His test server could not sync for a day
// and a half over 25 of them, and clearing them by hand only bought one more
// cycle, because the next merge wrote them again.
test('a file that no longer leaves this machine cannot stop synchronization',async()=>{
  const {store,sync,dir,remote,root}=workspace();
  const profile='00000000-0000-4000-8000-00000000cafe';
  const privateFile=['assistant-state','history',profile,'0123456789abcdef','snapshot.json'].join('/');
  const body=state=>JSON.stringify({format:1,profile,database:'main',tables:[],state});

  // The installation as it was before the archive became private: the archive
  // is committed and uploaded.
  fs.mkdirSync(path.join(dir,path.dirname(privateFile)),{recursive:true});
  fs.writeFileSync(path.join(dir,privateFile),body('uploaded before the policy changed'));
  store.save('notes',{title:'Real note',content:'Knowledge that does belong in the repository'});
  git(dir,'add','--force','--',privateFile,'records');
  git(dir,'commit','-m','Older version that synced the assistant archive');
  git(dir,'push','origin','HEAD:refs/heads/main');

  // Another machine, still on the older version, changes that same file.
  const other=path.join(root,'other');
  git(root,'clone','--branch','main',remote,other);
  git(other,'config','user.name','Other Machine');git(other,'config','user.email','other@localhost');
  fs.writeFileSync(path.join(other,privateFile),body('changed on the other machine'));
  git(other,'add','--force','--',privateFile);
  git(other,'commit','-m','The other machine changed the archive');
  git(other,'push','origin','HEAD:refs/heads/main');

  // This machine, now on the version where the archive is private: it writes
  // its own archive and has a real edit to upload.
  fs.writeFileSync(path.join(dir,privateFile),body('what this machine holds now'));
  store.save('notes',{title:'Later note',content:'Written after the upgrade and waiting to upload'});

  const result=sync.reconcile();
  assert.equal(result.state,'synced','synchronization must complete: '+JSON.stringify(result));
  assert.deepEqual(conflicts(dir),[],'a file that never leaves this machine must not be saved as a conflict');
  // This machine keeps its own copy, and the repository stops carrying it.
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir,privateFile),'utf8')).state,'what this machine holds now');
  const tracked=git(dir,'ls-files').split('\n').filter(Boolean);
  assert.deepEqual(tracked.filter(name=>name.startsWith('assistant-state/history/')),[],'the archive must be out of the repository');
  // And the real edit still reaches the remote.
  const uploaded=git(dir,'ls-tree','-r','--name-only','origin/main').split('\n').filter(Boolean);
  assert.ok(uploaded.some(name=>name.startsWith('records/notes/')),'notes must still be uploaded: '+uploaded.join(' '));
  assert.deepEqual(uploaded.filter(name=>name.startsWith('assistant-state/history/')),[],'the archive must be gone from the remote too');
});
