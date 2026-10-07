import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {Store} from '../core/records/store.mjs';
import {FileSync} from '../core/sync/git.mjs';
import {conflictView,resolveSavedConflict} from '../core/conflicts.mjs';
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
const open=dir=>{const folder=path.join(dir,'conflicts');return fs.existsSync(folder)?fs.readdirSync(folder).map(n=>JSON.parse(fs.readFileSync(path.join(folder,n),'utf8'))).filter(c=>!c.resolved_at):[];};

// Both machines changed the same line of a document; sync kept both for
// review, and the owner chose. A decision was reused only against the very
// commit the other machines were at when it was saved, so when they had
// moved on meanwhile (another note saved there), the same conflict came back
// and had to be decided again, and again (7 October 2026). A decision now
// holds as long as the other machines' version of that file is the one that
// was reviewed.
test('a decided conflict does not come back when the other machines moved on elsewhere',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-decided-')),remote=path.join(root,'remote.git');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(remote);git(remote,'init','--bare','--initial-branch=main');
  const machine=name=>{const dir=path.join(root,name);git(root,'clone','-q','-c','core.autocrlf=false',remote,dir);git(dir,'config','user.name',name);git(dir,'config','user.email',name+'@localhost');const store=new Store(dir,{device:name}),sync=new FileSync(store);sync.initialize('https://github.com/synthetic/private.git');return {dir,store,sync};};
  const desktop=machine('desktop'),rule=path.join('rules','own.md');
  fs.mkdirSync(path.join(desktop.dir,'rules'),{recursive:true});fs.writeFileSync(path.join(desktop.dir,rule),'Line one\n');
  assert.equal(desktop.sync.reconcile().state,'synced');
  const laptop=machine('laptop');assert.equal(laptop.sync.reconcile().state,'synced');
  fs.writeFileSync(path.join(laptop.dir,rule),'Line one, as the laptop has it\n');assert.equal(laptop.sync.reconcile().state,'synced');
  fs.writeFileSync(path.join(desktop.dir,rule),'Line one, as the desktop has it\n');
  assert.equal(desktop.sync.reconcile().state,'conflict');
  const [conflict]=open(desktop.dir);assert.equal(conflict.path,'rules/own.md');
  resolveSavedConflict(desktop.store,{id:conflict.id,choice:'merged',text:'Line one, as both agreed\n',expected_hash:conflictView(desktop.store,conflict.id).current_hash});
  // Meanwhile the laptop saves something else.
  laptop.store.save('notes',{title:'Elsewhere',content:'Unrelated\n'});assert.equal(laptop.sync.reconcile().state,'synced');
  const status=desktop.sync.reconcile();
  assert.equal(status.state,'synced',JSON.stringify(status)+' '+JSON.stringify(open(desktop.dir).map(c=>c.path)));
  assert.equal(fs.readFileSync(path.join(desktop.dir,rule),'utf8'),'Line one, as both agreed\n');
  assert.equal(laptop.sync.reconcile().state,'synced');
  assert.equal(fs.readFileSync(path.join(laptop.dir,rule),'utf8'),'Line one, as both agreed\n');
  assert.ok(desktop.store.list('notes').some(n=>n.title==='Elsewhere'));
});
