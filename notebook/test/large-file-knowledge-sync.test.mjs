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

// Pictures the notebook carries (media-store.mjs) are named *.png and the like,
// which the ignore policy leaves out; they still reach the other machine.
test('the notebook\'s carried pictures travel to a second machine, and the ignore policy stays as it is',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-carried-knowledge-')),remote=path.join(root,'remote.git');
  fs.mkdirSync(remote);git(remote,'init','--bare','--initial-branch=main');
  const machine=name=>{const dir=path.join(root,name);git(root,'clone','-q','-c','core.autocrlf=false',remote,dir);git(dir,'config','user.name','Test');git(dir,'config','user.email','t@localhost');
    const store=new Store(dir,{device:name}),sync=new FileSync(store,{largeFile:1024*1024});sync.initialize('https://github.com/synthetic/private.git');return {dir,store,sync};};
  const a=machine('desktop');a.store.save('notes',{title:'With a picture',content:'see below\n'});assert.equal(a.sync.reconcile().state,'synced');
  // The second machine already holds the notebook, so the picture arrives through a merge.
  const b=machine('laptop');assert.equal(b.sync.reconcile().state,'synced');
  const media=path.join(a.dir,'notebook','_media'),picture=Buffer.from([137,80,78,71,0,1,2,3]),name='c'.repeat(64)+'.png',mapping='d'.repeat(64)+'.mapping.json',big='e'.repeat(64)+'.pdf';
  fs.mkdirSync(media,{recursive:true});fs.writeFileSync(path.join(media,name),picture);fs.writeFileSync(path.join(media,mapping),'{"path":"p.png"}\n');fs.writeFileSync(path.join(media,big),Buffer.alloc(2*1024*1024,1));
  const ignore=path.join(a.dir,'.gitignore'),policy=fs.readFileSync(ignore,'utf8');
  assert.equal(a.sync.reconcile().state,'synced');
  assert.equal(fs.readFileSync(ignore,'utf8'),policy,'the committed ignore file is unchanged');
  const onRemote=git(a.dir,'ls-tree','-r','--name-only','origin/main');
  assert.match(onRemote,new RegExp('notebook/_media/'+name));assert.match(onRemote,new RegExp('notebook/_media/'+mapping));
  assert.doesNotMatch(onRemote,new RegExp(big),'a file too large for the remote stays here');
  assert.equal(b.sync.reconcile().state,'synced');
  assert.deepEqual(fs.readFileSync(path.join(b.dir,'notebook','_media',name)),picture);
  assert.equal(fs.readFileSync(path.join(b.dir,'notebook','_media',mapping),'utf8'),'{"path":"p.png"}\n');
  assert.deepEqual(b.store.problems,[]);assert.deepEqual([...b.store.records.values()].filter(r=>r.type==='notes').map(r=>r.title),['With a picture']);
});
