import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Store, atomic } from '../core/records/store.mjs';
import { FileSync } from '../core/sync/git.mjs';
import { installStarter } from '../core/starter-workspace.mjs';
import { installSkillTree } from '../core/packaged-skills.mjs';
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
const read=(...parts)=>fs.readFileSync(path.join(...parts),'utf8');
const identity=dir=>{git(dir,'config','user.name','Candidate Test');git(dir,'config','user.email','test@localhost');};

// An owner's existing mission control is its own repository, cloned to several
// machines. Joining a knowledge repository that grew from the starter on a
// server must bring the server's records in, send the owner's files out, and
// leave the owner's repository exactly as every other clone expects it.
function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-adopt-test-')),knowledge=path.join(root,'knowledge.git'),hub=path.join(root,'hub.git');
  for(const bare of [knowledge,hub]){fs.mkdirSync(bare);git(bare,'init','--bare','--initial-branch=main');}
  const serverDir=path.join(root,'server');git(root,'clone',knowledge,serverDir);identity(serverDir);
  const server=new Store(serverDir,{device:'vps'}),serverSync=new FileSync(server);serverSync.initialize('https://github.com/synthetic/private.git');
  atomic(path.join(serverDir,'AGENTS.md'),'Starter manual\n');atomic(path.join(serverDir,'rules','example.md'),'Starter rule\n');
  atomic(path.join(serverDir,'skills','demo','SKILL.md'),'Packaged skill\n');atomic(path.join(serverDir,'skills','packaged-only','SKILL.md'),'Only on the server\n');
  const imported=server.save('notes',{title:'From Menerio',content:'Imported on the server'});
  assert.equal(serverSync.reconcile().state,'synced');
  const ownerDir=path.join(root,'owner');git(root,'clone',hub,ownerDir);identity(ownerDir);
  atomic(path.join(ownerDir,'.gitignore'),'secret.txt\n');atomic(path.join(ownerDir,'secret.txt'),'synthetic-secret');
  atomic(path.join(ownerDir,'AGENTS.md'),'Owner manual\n');atomic(path.join(ownerDir,'rules','example.md'),'Owner rule\n');atomic(path.join(ownerDir,'rules','own.md'),'Only the owner has this\n');
  atomic(path.join(ownerDir,'skills','demo','SKILL.md'),'Owner edited skill\n');atomic(path.join(ownerDir,'dev','tool.sh'),'#!/bin/sh\n');
  git(ownerDir,'add','-A');git(ownerDir,'commit','-m','Owner mission control');git(ownerDir,'push','origin','main');
  return {root,knowledge,hub,server,serverSync,owner:new Store(ownerDir,{device:'desktop'}),imported};
}
function join(owner,knowledge,options){
  const sync=new FileSync(owner,options);sync.initialize('https://github.com/synthetic/private.git');
  // The synthetic GitHub address stands in for the private repository.
  git(owner.root,'--git-dir='+path.join(owner.state,'sync.git'),'remote','set-url','origin',knowledge);
  return sync;
}

test('an adopted mission control keeps its own repository untouched',()=>{
  const {owner,knowledge,hub}=fixture(),head=git(owner.root,'rev-parse','HEAD'),tracked=git(owner.root,'ls-files');
  const sync=join(owner,knowledge);
  assert.ok(fs.existsSync(path.join(owner.state,'sync.git')),'The knowledge repository lives beside the owner repository');
  assert.equal(sync.reconcile().state,'synced');
  assert.equal(read(owner.root,'.gitignore'),'secret.txt\n');
  assert.equal(git(owner.root,'rev-parse','HEAD'),head);assert.equal(git(owner.root,'ls-files'),tracked);
  assert.equal(git(owner.root,'diff','--cached','--name-only'),'');
  assert.equal(git(owner.root,'remote','get-url','origin'),hub);
  const shared=git(owner.root,'--git-dir='+path.join(owner.state,'sync.git'),'ls-files');
  assert.doesNotMatch(shared,/dev\/tool\.sh|secret\.txt|\.godspeed/);
});

test('the first join keeps the owner files and brings the server records in',()=>{
  const {owner,knowledge,server,serverSync,imported}=fixture(),sync=join(owner,knowledge);
  assert.equal(sync.reconcile().state,'synced');
  assert.equal(read(owner.root,'AGENTS.md'),'Owner manual\n');assert.equal(read(owner.root,'rules','example.md'),'Owner rule\n');
  assert.equal(read(owner.root,'skills','demo','SKILL.md'),'Owner edited skill\n');
  assert.equal(read(owner.root,'skills','packaged-only','SKILL.md'),'Only on the server\n');
  assert.equal(owner.get('notes',imported.id).title,'From Menerio');assert.deepEqual(sync.pendingConflicts(),[]);
  assert.equal(serverSync.reconcile().state,'synced');
  assert.equal(read(server.root,'AGENTS.md'),'Owner manual\n');assert.equal(read(server.root,'rules','own.md'),'Only the owner has this\n');
  assert.equal(fs.existsSync(path.join(server.root,'dev','tool.sh')),false);assert.equal(fs.existsSync(path.join(server.root,'secret.txt')),false);
});

test('installers, archives and files too large to upload stay on the owner machine',()=>{
  const {owner,knowledge}=fixture();
  atomic(path.join(owner.root,'work','notes.md'),'Small and shared\n');atomic(path.join(owner.root,'work','artifacts','setup.exe'),'installer');
  atomic(path.join(owner.root,'work','artifacts','copy.tar.gz'),'archive');atomic(path.join(owner.root,'work','artifacts','huge [1].bin'),Buffer.alloc(4096,1));
  const sync=join(owner,knowledge,{largeFile:2048});
  assert.equal(sync.reconcile().state,'synced');
  const shared=git(owner.root,'--git-dir='+path.join(owner.state,'sync.git'),'ls-tree','-r','--name-only','HEAD');
  assert.match(shared,/work\/notes\.md/);assert.doesNotMatch(shared,/setup\.exe|copy\.tar\.gz|huge/);
  assert.equal(sync.reconcile().state,'synced','The kept file does not come back as a pending change');
});

test('a checkout inside the folder and the paths a machine keeps to itself stay out of sync',()=>{
  const {owner,knowledge}=fixture();
  const checkout=path.join(owner.root,'work','trials','another-app');fs.mkdirSync(checkout,{recursive:true});git(checkout,'init','-q');atomic(path.join(checkout,'app.js'),'build');
  atomic(path.join(owner.root,'work','artifacts','server-login','token.txt'),'synthetic login');atomic(path.join(owner.root,'work','plan.md'),'Shared plan\n');
  atomic(path.join(owner.state,'sync-local-only'),'# trial copies\nwork/artifacts/server-login/\n');
  const sync=join(owner,knowledge);
  assert.equal(sync.reconcile().state,'synced');
  const shared=git(owner.root,'--git-dir='+path.join(owner.state,'sync.git'),'ls-tree','-r','--name-only','HEAD');
  assert.match(shared,/work\/plan\.md/);assert.doesNotMatch(shared,/another-app|server-login/);
});

test('after the first join, edits travel both ways and concurrent ones are kept for review',()=>{
  const {owner,knowledge,server,serverSync}=fixture(),sync=join(owner,knowledge);
  assert.equal(sync.reconcile().state,'synced');assert.equal(serverSync.reconcile().state,'synced');
  atomic(path.join(server.root,'rules','own.md'),'Changed on the server\n');server.save('contacts',{name:'Server person'});
  assert.equal(serverSync.reconcile().state,'synced');assert.equal(sync.reconcile().state,'synced');
  assert.equal(read(owner.root,'rules','own.md'),'Changed on the server\n');assert.ok(owner.list('contacts').some(c=>c.name==='Server person'));
  assert.match(git(owner.root,'status','--porcelain','--','rules'),/rules\/own\.md/,'The owner repository sees the change as an ordinary edit');
  atomic(path.join(server.root,'AGENTS.md'),'Server edit\n');atomic(path.join(owner.root,'AGENTS.md'),'Owner edit\n');
  assert.equal(serverSync.reconcile().state,'synced');assert.equal(sync.reconcile().state,'conflict');
  assert.equal(read(owner.root,'AGENTS.md'),'Owner edit\n');
});

test('a starter never adds example rules, profile pages or recipes to an existing mission control',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-starter-test-')),starter=path.join(root,'starter'),existing=path.join(root,'existing'),fresh=path.join(root,'fresh');
  for(const [file,text] of [['AGENTS.md','Starter manual'],['rules/example.md','Example rule'],['profile/people.md','Template'],['skills/demo/SKILL.md','Skill']])atomic(path.join(starter,file),text);
  atomic(path.join(existing,'AGENTS.md'),'Owner manual');atomic(path.join(existing,'rules','own.md'),'Owner rule');fs.mkdirSync(fresh);
  installStarter(existing,starter);installStarter(fresh,starter);
  assert.equal(read(existing,'AGENTS.md'),'Owner manual');assert.equal(fs.existsSync(path.join(existing,'rules','example.md')),false);
  assert.equal(fs.existsSync(path.join(existing,'profile','people.md')),false);assert.equal(fs.existsSync(path.join(existing,'skills','demo')),false);
  assert.equal(read(fresh,'skills','demo','SKILL.md'),'Skill');
  assert.equal(read(fresh,'rules','example.md'),'Example rule');assert.equal(read(fresh,'profile','people.md'),'Template');
  fs.unlinkSync(path.join(fresh,'profile','people.md'));installStarter(fresh,starter);
  assert.equal(read(fresh,'profile','people.md'),'Template','A starter-made folder still gets a deleted starter file back');
});

test('packaged recipes keep the owner skills of an adopted mission control and never stop sync over them',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-recipes-test-')),recipes=path.join(root,'recipes'),owner=path.join(root,'owner'),store=new Store(owner);
  for(const [file,text] of [['own/SKILL.md','Packaged copy of the owner skill'],['own/extra.md','Reader-kit helper'],['fresh/SKILL.md','New packaged skill v1']])atomic(path.join(recipes,file),text);
  atomic(path.join(owner,'skills','own','SKILL.md'),'The owner original');
  const install=name=>installSkillTree(store,path.join(recipes,name),path.join(owner,'skills',name),{adopted:true});
  install('own');install('fresh');
  assert.equal(read(owner,'skills','own','SKILL.md'),'The owner original');assert.equal(fs.existsSync(path.join(owner,'skills','own','extra.md')),false);
  assert.equal(read(owner,'skills','fresh','SKILL.md'),'New packaged skill v1');
  atomic(path.join(owner,'skills','fresh','SKILL.md'),'Edited by the owner');atomic(path.join(recipes,'fresh','SKILL.md'),'New packaged skill v2');install('fresh');
  assert.equal(read(owner,'skills','fresh','SKILL.md'),'Edited by the owner');
  assert.equal(fs.existsSync(path.join(owner,'conflicts')),false,'No conflict stops synchronization');
  atomic(path.join(recipes,'later','SKILL.md'),'Later skill v1');install('later');atomic(path.join(recipes,'later','SKILL.md'),'Later skill v2');install('later');
  assert.equal(read(owner,'skills','later','SKILL.md'),'Later skill v2','An unedited packaged skill is still updated');
});

test('a ledger from before the folder was adopted never puts package helpers into the owner skills',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-ledger-test-')),recipes=path.join(root,'recipes'),owner=path.join(root,'owner'),store=new Store(owner);
  for(const [file,text] of [['poster/SKILL.md','Packaged poster'],['poster/LICENSE','License'],['poster/tools/run.mjs','helper']])atomic(path.join(recipes,file),text);
  // The workspace began as a starter: the package installed the whole skill and the ledger recorded it.
  installSkillTree(store,path.join(recipes,'poster'),path.join(owner,'skills','poster'));
  fs.rmSync(path.join(owner,'skills','poster'),{recursive:true});
  // Then it became the owner's mission control, whose own poster skill has no helpers.
  atomic(path.join(owner,'skills','poster','SKILL.md'),'The owner poster skill');
  installSkillTree(store,path.join(recipes,'poster'),path.join(owner,'skills','poster'),{adopted:true});
  assert.deepEqual(fs.readdirSync(path.join(owner,'skills','poster')),['SKILL.md']);
  assert.equal(read(owner,'skills','poster','SKILL.md'),'The owner poster skill');
});
