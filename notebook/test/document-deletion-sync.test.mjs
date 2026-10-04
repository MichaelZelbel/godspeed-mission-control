import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Store, atomic } from '../core/records/store.mjs';
import { FileSync } from '../core/sync/git.mjs';
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
function fixture(files){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-deletion-test-')),remote=path.join(root,'remote.git');fs.mkdirSync(remote);git(remote,'init','--bare','--initial-branch=main');
  const machine=name=>{const dir=path.join(root,name);git(root,'clone','-c','core.autocrlf=false',remote,dir);git(dir,'config','user.name','Candidate Test');git(dir,'config','user.email','test@localhost');const store=new Store(dir,{device:name}),sync=new FileSync(store);sync.initialize('https://github.com/synthetic/private.git');return [store,sync];};
  const [a,sa]=machine('server');
  for(const [file,text] of Object.entries(files))atomic(path.join(a.root,file),text);
  assert.equal(sa.reconcile().state,'synced');
  const [b,sb]=machine('laptop');assert.equal(sb.reconcile().state,'synced');
  return {a,b,sa,sb};
}

test('a document deleted on one machine is deleted on the other and stays deleted',()=>{
  const {a,b,sa,sb}=fixture({'rules/example.md':'Example rule\n','rules/kept.md':'Kept\n'});
  assert.ok(fs.existsSync(path.join(b.root,'rules','example.md')));
  fs.unlinkSync(path.join(a.root,'rules','example.md'));
  assert.equal(sa.reconcile().state,'synced');assert.equal(sb.reconcile().state,'synced');
  assert.equal(fs.existsSync(path.join(b.root,'rules','example.md')),false);assert.equal(fs.readFileSync(path.join(b.root,'rules','kept.md'),'utf8'),'Kept\n');
  assert.equal(sb.reconcile().state,'synced');assert.equal(sa.reconcile().state,'synced');
  assert.equal(fs.existsSync(path.join(a.root,'rules','example.md')),false,'The other machine does not upload it again');
});

test('a document changed here while deleted elsewhere is kept for review, never silently removed',()=>{
  const {a,b,sa,sb}=fixture({'rules/example.md':'Example rule\n'});
  fs.unlinkSync(path.join(a.root,'rules','example.md'));assert.equal(sa.reconcile().state,'synced');
  atomic(path.join(b.root,'rules','example.md'),'Edited on the laptop\n');
  assert.equal(sb.reconcile().state,'conflict');
  assert.equal(fs.readFileSync(path.join(b.root,'rules','example.md'),'utf8'),'Edited on the laptop\n');
});

test('a remote removal of most documents at once stops for review',()=>{
  const files=Object.fromEntries(Array.from({length:30},(_,i)=>['work/item-'+i+'.md','Item '+i+'\n']));
  const {a,b,sa,sb}=fixture(files);
  for(const file of Object.keys(files))fs.unlinkSync(path.join(a.root,file));
  assert.equal(sa.reconcile().state,'synced');
  assert.notEqual(sb.reconcile().state,'synced');
  assert.ok(Object.keys(files).every(file=>fs.existsSync(path.join(b.root,file))));
});
