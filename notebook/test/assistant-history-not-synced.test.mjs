import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Store } from '../core/records/store.mjs';
import { FileSync } from '../core/sync/git.mjs';
import { durable, shared } from '../core/file-policy.mjs';
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();

function workspace(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-history-sync-')),remote=path.join(root,'remote.git');
  fs.mkdirSync(remote);git(remote,'init','--bare','--initial-branch=main');
  const dir=path.join(root,'device');fs.mkdirSync(dir);
  const store=new Store(dir,{device:'desktop'});
  const sync=new FileSync(store);sync.initialize('https://github.com/example-owner/example-private');
  git(dir,'config','user.name','History Test');git(dir,'config','user.email','test@localhost');
  git(dir,'remote','set-url','origin',remote);
  return {store,sync,dir};
}

// The assistant keeps every previous version of its state under
// assistant-state/history. On a working server that archive reached gigabytes,
// and because the sync commit holds the workspace lock while Git hashes it,
// every dashboard write waited behind it and then failed.
test('the assistant state archive is never staged for the knowledge repository',()=>{
  const {store,sync,dir}=workspace();
  const profile='00000000-0000-4000-8000-00000000abcd';
  const current=path.join('assistant-state',profile,'0123456789abcdef.json');
  const archived=path.join('assistant-state','history',profile,'0123456789abcdef','deadbeef.json');
  for(const relative of [current,archived]){
    fs.mkdirSync(path.join(dir,path.dirname(relative)),{recursive:true});
    fs.writeFileSync(path.join(dir,relative),JSON.stringify({format:1,profile,database:'main',tables:[]}));
  }
  store.save('notes',{title:'Real note','content':'Knowledge that does belong in the repository'});
  sync.commitLocal();
  const tracked=git(dir,'ls-files').split('\n').filter(Boolean);
  assert.ok(tracked.some(name=>name.startsWith('records/notes/')),'notes must still be synced: '+tracked.join(' '));
  assert.ok(tracked.includes(current.replaceAll(path.sep,'/')),'the current assistant snapshot must still be synced');
  assert.deepEqual(tracked.filter(name=>name.startsWith('assistant-state/history/')),[],'the history archive must not be synced');
  // The archive is still written and still backed up on this machine; what it
  // stops being is something that leaves the machine.
  assert.equal(durable('assistant-state/history/'+profile+'/x/y.json'),true,'the assistant must still be able to write its archive');
  assert.equal(shared('assistant-state/history/'+profile+'/x/y.json'),false,'the archive must not leave this machine');
  assert.equal(shared(current.replaceAll(path.sep,'/')),true,'the current snapshot stays shared state');
});

// Michael's server had already committed the archive before it became private.
// Those paths stay in the index and keep Git hashing them, so the next commit
// has to untrack them for the fix to reach an installation that already runs.
test('an installation that already synced the archive untracks it on the next commit',()=>{
  const {store,sync,dir}=workspace();
  const profile='00000000-0000-4000-8000-00000000beef';
  const archived=path.join('assistant-state','history',profile,'0123456789abcdef','cafe.json');
  fs.mkdirSync(path.join(dir,path.dirname(archived)),{recursive:true});
  fs.writeFileSync(path.join(dir,archived),JSON.stringify({format:1,profile,database:'main',tables:[]}));
  // Staged the way the older version did, before the archive was private.
  git(dir,'add','--force','--',archived.replaceAll(path.sep,'/'));
  git(dir,'commit','-m','Older version that synced the assistant archive');
  assert.ok(git(dir,'ls-files').includes('assistant-state/history/'),'precondition: the archive is tracked');
  store.save('notes',{title:'Later note',content:'Written after the upgrade'});
  sync.commitLocal();
  assert.deepEqual(git(dir,'ls-files').split('\n').filter(n=>n.startsWith('assistant-state/history/')),[],'the archive must be untracked');
  assert.ok(fs.existsSync(path.join(dir,archived)),'the archive file itself must stay on disk');
});
