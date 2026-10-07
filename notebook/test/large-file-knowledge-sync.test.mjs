// SY10: in plain knowledge mode one file too large to upload must not block
// every push for good. It is kept local (excluded via .git/info/exclude), like
// folder mode already does, so the rest of the notebook keeps syncing.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {Store,atomic} from '../core/records/store.mjs';
import {FileSync} from '../core/sync/git.mjs';
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();

test('a file too large for the remote stays local and does not block the rest of the notebook',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-large-knowledge-')),remote=path.join(root,'remote.git');
  fs.mkdirSync(remote);git(remote,'init','--bare','--initial-branch=main');
  // Simulate GitHub's hard size limit with a pre-receive hook that refuses any
  // blob over 1 MB.
  fs.writeFileSync(path.join(remote,'hooks','pre-receive'),'#!/bin/sh\nwhile read old new ref; do\n  range="$new"; [ "$old" != "0000000000000000000000000000000000000000" ] && range="$old..$new"\n  for o in $(git rev-list --objects $range | cut -d" " -f1); do\n    if [ "$(git cat-file -t $o)" = blob ] && [ "$(git cat-file -s $o)" -gt 1048576 ]; then echo "remote: error: File exceeds the size limit" >&2; exit 1; fi\n  done\ndone\nexit 0\n',{mode:0o755});
  const dir=path.join(root,'desktop');git(root,'clone','-q','-c','core.autocrlf=false',remote,dir);git(dir,'config','user.name','Test');git(dir,'config','user.email','t@localhost');
  const store=new Store(dir,{device:'desktop'}),sync=new FileSync(store,{largeFile:1024*1024});
  sync.initialize('https://github.com/synthetic/private.git');
  store.save('notes',{title:'First',content:'a\n'});
  assert.equal(sync.reconcile().state,'synced');
  // An oversized export lands in work/.
  fs.mkdirSync(path.join(dir,'work'),{recursive:true});fs.writeFileSync(path.join(dir,'work','export.csv'),Buffer.alloc(2*1024*1024,65));
  store.save('notes',{title:'Second',content:'b\n'});
  assert.equal(sync.reconcile().state,'synced','the oversized file must not block the push');
  assert.doesNotMatch(git(dir,'ls-files'),/export\.csv/,'the oversized file is not tracked');
  assert.ok(fs.existsSync(path.join(dir,'work','export.csv')),'the oversized file stays on this machine');
  const onRemote=git(dir,'ls-tree','-r','--name-only','origin/main');
  assert.match(onRemote,/First\.md/);assert.match(onRemote,/Second\.md/,'the note saved alongside the oversized file still reached the remote');
});
