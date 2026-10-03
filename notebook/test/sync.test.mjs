import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Store, atomic } from '../core/records/store.mjs';
import { FileSync } from '../core/sync/git.mjs';
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-sync-test-')),remote=path.join(root,'remote.git');fs.mkdirSync(remote);git(remote,'init','--bare','--initial-branch=main');
  const a=path.join(root,'desktop');git(root,'clone',remote,a);git(a,'config','user.name','Candidate Test');git(a,'config','user.email','test@localhost');
  const store=new Store(a,{device:'desktop'});atomic(path.join(a,'.gitignore'),'*\n!records/\n!records/**\n!.gitignore\n');
  const note=store.save('notes',{title:'Shared',content:'Base'});const sync=new FileSync(store);sync.commitLocal();git(a,'push','origin','main');
  const b=path.join(root,'laptop');git(root,'clone',remote,b);git(b,'config','user.name','Candidate Test');git(b,'config','user.email','test@localhost');
  return {a:store,b:new Store(b,{device:'laptop'}),note,remote};
}
test('offline independent edits and reconnect converge through actual Git',()=>{
  const {a,b}=fixture();a.save('notes',{title:'Desktop note',content:'A'});b.save('contacts',{name:'Laptop person'});
  assert.equal(new FileSync(a).reconcile().state,'synced');assert.equal(new FileSync(b).reconcile().state,'synced');assert.equal(new FileSync(a).reconcile().state,'synced');
  assert.equal(a.list('notes').length,2);assert.equal(b.list('notes').length,2);assert.equal(a.list('contacts').length,1);
});
test('same record conflict preserves base and both sides, never puts conflict markers into notes',()=>{
  const {a,b,note}=fixture();a.save('notes',{id:note.id,content:'Desktop'});b.save('notes',{id:note.id,content:'Laptop'});
  new FileSync(a).reconcile();const sync=new FileSync(b);assert.equal(sync.reconcile().state,'conflict');
  const id=sync.pendingConflicts()[0].replace('.json',''),conflict=JSON.parse(fs.readFileSync(path.join(b.root,'conflicts',id+'.json'),'utf8'));
  assert.match(conflict.base,/Base/);assert.match(conflict.local,/Laptop/);assert.match(conflict.remote,/Desktop/);
  assert.equal(b.get('notes',note.id).content,'Laptop');assert.doesNotMatch(fs.readFileSync(b.file(note),'utf8'),/<<<<<<<|>>>>>>>/);
  sync.resolve(id,'local');assert.equal(sync.reconcile().state,'synced');new FileSync(a).reconcile();assert.equal(a.get('notes',note.id).content,'Laptop');
});
test('network loss leaves offline edits available and secrets and index never enter Git',()=>{
  const {a,remote}=fixture();atomic(path.join(a.root,'private-token.txt'),'synthetic-secret');a.save('notes',{title:'Offline',content:'Still available'});
  git(a.root,'remote','set-url','origin',path.join(remote,'missing'));
  const result=new FileSync(a).reconcile();assert.equal(result.state,'pending');assert.ok(a.list('notes').some(r=>r.title==='Offline'));
  const tracked=git(a.root,'ls-files');assert.doesNotMatch(tracked,/private-token|sqlite|\.godspeed/);
});

test('packaged hidden skill markers never enter synced files',()=>{
  const {a}=fixture(),sync=new FileSync(a);
  sync.initialize('https://github.com/synthetic/private.git');
  fs.mkdirSync(path.join(a.root,'skills','example'),{recursive:true});
  atomic(path.join(a.root,'skills','example','SKILL.md'),'Synthetic skill');
  atomic(path.join(a.root,'skills','example','.shipped-sha256'),'packaging marker');
  sync.commitLocal();const tracked=git(a.root,'ls-files');
  assert.match(tracked,/skills\/example\/SKILL.md/);assert.doesNotMatch(tracked,/shipped-sha256/);
});

test('similar independent assistant profiles keep their paths when syncing',()=>{
  const {a,b}=fixture();const sa=new FileSync(a),sb=new FileSync(b);
  sa.initialize('https://github.com/synthetic/private.git');sb.initialize('https://github.com/synthetic/private.git');
  const first='assistant-state/00000000-0000-4000-8000-000000000001/database.json',second='assistant-state/00000000-0000-4000-8000-000000000002/database.json';
  atomic(path.join(a.root,first),JSON.stringify({format:1,database:'state.db',profile:first.split('/')[1],tables:[],padding:'same '.repeat(100)}));
  assert.equal(sa.reconcile().state,'synced');assert.equal(sb.reconcile().state,'synced');
  fs.unlinkSync(path.join(b.root,first));atomic(path.join(b.root,second),JSON.stringify({format:1,database:'state.db',profile:second.split('/')[1],tables:[],padding:'same '.repeat(100)}));
  assert.equal(sb.reconcile().state,'synced');
  atomic(path.join(a.root,first),JSON.stringify({format:1,database:'state.db',profile:first.split('/')[1],tables:['new message'],padding:'same '.repeat(100)}));
  const outcome=sa.reconcile();assert.equal(outcome.state,'conflict');
  const conflicts=sa.pendingConflicts().map(n=>JSON.parse(fs.readFileSync(path.join(a.root,'conflicts',n))));
  assert.ok(conflicts.every(c=>c.path===first),JSON.stringify(conflicts.map(c=>c.path)));assert.ok(conflicts.every(c=>!c.local||JSON.parse(c.local).profile===first.split('/')[1]));
});

test('invalid assistant snapshots stay local instead of entering Git',()=>{
  const {a}=fixture(),sync=new FileSync(a);
  sync.initialize('https://github.com/synthetic/private.git');
  const name='assistant-state/00000000-0000-4000-8000-000000000001/state.json';
  atomic(path.join(a.root,name),'<<<<<<< unresolved merge');
  assert.equal(sync.reconcile().state,'pending');
  assert.doesNotMatch(git(a.root,'ls-files'),/state.json/);
});
