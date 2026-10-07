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
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-gitlink-')),remote=path.join(root,'remote.git');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(remote);git(remote,'init','--bare','--initial-branch=main');
  const machine=name=>{const dir=path.join(root,name);git(root,'clone','-q','-c','core.autocrlf=false',remote,dir);git(dir,'config','user.name',name);git(dir,'config','user.email',name+'@localhost');
    const store=new Store(dir,{device:name}),sync=new FileSync(store);sync.initialize('https://github.com/synthetic/private.git');return {dir,store,sync,name};};
  return {root,remote,machine};
}
const special=(cwd,ref)=>git(cwd,'ls-tree','-r',ref).split('\n').filter(line=>/^(160000|120000) /.test(line));

// A skill installed the usual way, an upstream repository cloned into
// skills/, was committed as a gitlink: an empty folder on every other
// machine. There the merge read that folder as a file, and sync stopped for
// good with EISDIR (7 October 2026). A checkout of another repository, or a
// link, inside a synced folder stays on its machine.
test('a repository cloned into skills/ stays on its machine and sync goes on',t=>{
  const {root,machine}=machines(t);
  const desktop=machine('desktop');desktop.store.save('notes',{title:'From the desktop',content:'a\n'});
  assert.equal(desktop.sync.reconcile().state,'synced');
  const upstream=path.join(root,'upstream');fs.mkdirSync(upstream);git(upstream,'init','-q','-b','main');git(upstream,'config','user.name','U');git(upstream,'config','user.email','u@l');
  fs.writeFileSync(path.join(upstream,'SKILL.md'),'# A skill\n');git(upstream,'add','-A');git(upstream,'commit','-qm','skill');
  git(desktop.dir,'clone','-q',upstream,path.join('skills','some-skill'));
  fs.writeFileSync(path.join(desktop.dir,'skills','own.md'),'# My own skill\n');
  const status=desktop.sync.reconcile();
  assert.equal(status.state,'synced',JSON.stringify(status));
  assert.deepEqual(special(desktop.dir,'origin/main'),[],'no gitlink reached the other machines');
  assert.match(git(desktop.dir,'ls-tree','-r','--name-only','origin/main'),/skills\/own\.md/,'the folder\'s own files still sync');
  const laptop=machine('laptop');
  assert.equal(laptop.sync.reconcile().state,'synced');
  assert.equal(fs.readFileSync(path.join(laptop.dir,'skills','own.md'),'utf8'),'# My own skill\n');
});

// A machine on an older version committed a gitlink and a link. The other
// machines take everything else, stop carrying the two, and keep syncing.
test('a gitlink or a link another machine committed does not stop sync, and the machines converge',t=>{
  const {root,machine}=machines(t);
  const desktop=machine('desktop');desktop.store.save('notes',{title:'From the desktop',content:'a\n'});
  assert.equal(desktop.sync.reconcile().state,'synced');
  const laptop=machine('laptop');assert.equal(laptop.sync.reconcile().state,'synced');
  // What an older version pushed: plumbing, so the test needs no symlink rights on Windows.
  const old=path.join(root,'old');git(root,'clone','-q','-c','core.autocrlf=false',path.join(root,'remote.git'),old);git(old,'config','user.name','old');git(old,'config','user.email','old@localhost');
  const target=execFileSync('git',['hash-object','-w','--stdin'],{cwd:old,input:'../elsewhere',encoding:'utf8'}).trim();
  git(old,'update-index','--add','--cacheinfo','160000,'+git(old,'rev-parse','HEAD')+',skills/cloned');
  git(old,'update-index','--add','--cacheinfo','120000,'+target+',skills/link');
  fs.mkdirSync(path.join(old,'skills'),{recursive:true});fs.writeFileSync(path.join(old,'skills','plain.md'),'# Plain\n');git(old,'add','skills/plain.md');
  git(old,'commit','-qm','An older version committed a gitlink and a link');git(old,'push','-q','origin','HEAD:main');
  laptop.store.save('notes',{title:'From the laptop',content:'b\n'});
  for(let i=0;i<2;i++){const status=laptop.sync.reconcile();assert.equal(status.state,'synced','laptop round '+i+': '+JSON.stringify(status));}
  for(let i=0;i<2;i++){const status=desktop.sync.reconcile();assert.equal(status.state,'synced','desktop round '+i+': '+JSON.stringify(status));}
  assert.equal(laptop.sync.reconcile().state,'synced');
  assert.deepEqual(laptop.store.list('notes').map(n=>n.title).sort(),['From the desktop','From the laptop']);
  assert.deepEqual(desktop.store.list('notes').map(n=>n.title).sort(),['From the desktop','From the laptop']);
  assert.equal(fs.readFileSync(path.join(desktop.dir,'skills','plain.md'),'utf8'),'# Plain\n');
  assert.ok(!fs.existsSync(path.join(desktop.dir,'skills','link')),'a link is not written as a file');
  assert.deepEqual(special(desktop.dir,'origin/main'),[],'the machines stopped carrying them');
});
