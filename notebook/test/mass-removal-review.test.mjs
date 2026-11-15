import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {Store,atomic} from '../core/records/store.mjs';
import {FileSync} from '../core/sync/git.mjs';
import {conflictView,resolveSavedConflict} from '../core/conflicts.mjs';
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
const identity=(dir,name)=>{git(dir,'config','user.name',name);git(dir,'config','user.email',name.toLowerCase()+'@localhost');};
const reviews=dir=>{const folder=path.join(dir,'conflicts');return fs.existsSync(folder)?fs.readdirSync(folder).filter(n=>n.endsWith('.json')).map(n=>JSON.parse(fs.readFileSync(path.join(folder,n),'utf8'))):[];};

// Many records of one kind leaving at once is a mistake somewhere, and sync
// stops it. It counted only the pages a person reads: forty group
// memberships, suggestions or settings removed by an older program or by Git
// used by hand went through, or became forty separate reviews. And when it
// did stop, nothing said what to look at or how to let it through: sync
// waited for good (7 October 2026). It now counts the notebook's own records
// too (not the bookkeeping a machine prunes), and a stopped removal is one
// review: keep the records, and the next merge brings them back, or accept
// the removal.
const items=40;
function seed(store){return Array.from({length:items},(_,i)=>store.save('review_queue',{id:'suggestion-'+i,suggestion_type:'add_alias',status:'pending_review',payload:{alias:'A'+i}}));}

function knowledge(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-mass-k-')),remote=path.join(root,'remote.git');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(remote);git(remote,'init','--bare','--initial-branch=main');
  const machine=name=>{const dir=path.join(root,name);git(root,'clone','-q','-c','core.autocrlf=false',remote,dir);identity(dir,name);const store=new Store(dir,{device:name}),sync=new FileSync(store);sync.initialize('https://github.com/synthetic/private.git');return {dir,store,sync};};
  // Git used by hand, or an older version: the files go, no tombstones.
  const byHand=()=>{const dir=path.join(root,'by-hand-'+Date.now());git(root,'clone','-q','-c','core.autocrlf=false',remote,dir);identity(dir,'Owner');git(dir,'rm','-q','-r','notebook/_system/review_queue');git(dir,'commit','-qm','Removed by hand');git(dir,'push','-q','origin','HEAD:main');};
  return {machine,byHand};
}
function decide(m,choice){
  const [item]=reviews(m.dir).filter(r=>r.kind==='mass-removal'&&!r.resolved_at);assert.ok(item,'one review of the whole removal');
  assert.equal(reviews(m.dir).length,1,'one review, not one per record');
  resolveSavedConflict(m.store,{id:item.id,choice,expected_hash:conflictView(m.store,item.id).current_hash});
}

test('knowledge: a mass removal of the notebook\'s own records stops as one review, and keeping them brings them back',t=>{
  const {machine,byHand}=knowledge(t),desktop=machine('desktop');seed(desktop.store);
  assert.equal(desktop.sync.reconcile().state,'synced');
  byHand();
  assert.equal(desktop.sync.reconcile().state,'conflict');
  assert.equal(desktop.store.list('review_queue').length,items,'nothing went');
  decide(desktop,'local');
  assert.equal(desktop.sync.reconcile().state,'synced');
  assert.equal(desktop.store.list('review_queue').length,items);
  const laptop=machine('laptop');assert.equal(laptop.sync.reconcile().state,'synced');
  assert.equal(laptop.store.list('review_queue').length,items,'the other machines have them back');
});

test('knowledge: accepting a stopped mass removal lets it through',t=>{
  const {machine,byHand}=knowledge(t),desktop=machine('desktop');seed(desktop.store);
  assert.equal(desktop.sync.reconcile().state,'synced');
  byHand();
  assert.equal(desktop.sync.reconcile().state,'conflict');
  decide(desktop,'remote');
  assert.equal(desktop.sync.reconcile().state,'synced');
  assert.equal(desktop.store.list('review_queue').length,0);
});

function folder(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-mass-f-')),origin=path.join(root,'origin.git');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(origin);git(origin,'init','--bare','--initial-branch=main');
  const seedDir=path.join(root,'seed');git(root,'clone','-q',origin,seedDir);identity(seedDir,'Owner');
  for(const [file,text] of [['.gitignore','/.godspeed/\n/conflicts/\n/FULL-ALPHA.md\n/assistant-state/\n'],['.gitattributes','* text=auto eol=lf\nnotebook/** -text\n'],['AGENTS.md','Owner manual\n']])atomic(path.join(seedDir,file),text);
  git(seedDir,'add','-A');git(seedDir,'commit','-qm','Owner mission control');git(seedDir,'push','-q','origin','main');
  const envy=path.join(root,'envy');git(root,'clone','-q',origin,envy);identity(envy,'Owner');const store=new Store(envy,{device:'envy'});atomic(path.join(store.state,'sync-config.json'),JSON.stringify({enabled:true,repository:'folder',paths:['notebook']}));
  const byHand=()=>{const dir=path.join(root,'laptop-'+Date.now());git(root,'clone','-q',origin,dir);identity(dir,'Owner');git(dir,'rm','-q','-r','notebook/_system/review_queue');git(dir,'commit','-qm','Removed by hand');git(dir,'push','-q','origin','main');};
  return {envy:{dir:envy,store,sync:new FileSync(store)},byHand,origin,root};
}

test('folder: a mass removal of the notebook\'s own records is stopped, and keeping them brings them back everywhere',t=>{
  const {envy,byHand,root}=folder(t);seed(envy.store);
  assert.equal(envy.sync.reconcile().state,'synced');
  byHand();
  assert.equal(envy.sync.reconcile().state,'conflict');
  assert.equal(envy.store.list('review_queue').length,items,'nothing went');
  decide(envy,'local');
  assert.equal(envy.sync.reconcile().state,'synced');
  assert.equal(envy.store.list('review_queue').length,items);
  const check=path.join(root,'check');git(root,'clone','-q',path.join(root,'origin.git'),check);
  assert.equal(fs.readdirSync(path.join(check,'notebook','_system','review_queue')).length,items,'the shared branch has them back');
});

test('folder: accepting a stopped mass removal lets it through',t=>{
  const {envy,byHand}=folder(t);seed(envy.store);
  assert.equal(envy.sync.reconcile().state,'synced');
  byHand();
  assert.equal(envy.sync.reconcile().state,'conflict');
  decide(envy,'remote');
  assert.equal(envy.sync.reconcile().state,'synced');
  assert.equal(envy.store.list('review_queue').length,0);
});
