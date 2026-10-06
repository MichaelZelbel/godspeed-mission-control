import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Store, atomic } from '../core/records/store.mjs';
import { FileSync, useFolderRepository } from '../core/sync/git.mjs';
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
const read=(...parts)=>fs.readFileSync(path.join(...parts),'utf8');

// One repository carries a mission control between machines: its owner's
// sessions and jobs commit and pull in it, and the notebook, on the machines
// that run one, commits only its own folder through it. Nothing reaches a
// machine twice by two routes, so nothing arrives as an untracked copy.
const ignore='/.godspeed/\n/conflicts/\n/FULL-ALPHA.md\n/assistant-state/\ndev/*\n';
function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-folder-test-')),origin=path.join(root,'origin.git');
  fs.mkdirSync(origin);git(origin,'init','--bare','--initial-branch=main');
  const seed=path.join(root,'seed');git(root,'clone',origin,seed);identity(seed,'Owner');
  for(const [file,text] of [['.gitignore',ignore],['.gitattributes','* text=auto eol=lf\nnotebook/** -text\n'],['AGENTS.md','Owner manual\n'],['rules/own.md','Owner rule\n'],['skills/demo/SKILL.md','Owner skill\n']])atomic(path.join(seed,file),text);
  git(seed,'add','-A');git(seed,'commit','-m','Owner mission control');git(seed,'push','origin','main');
  const clone=name=>{const dir=path.join(root,name);git(root,'clone',origin,dir);identity(dir,'Owner');return dir;};
  const machine=(name,paths=['notebook'])=>{const dir=clone(name),store=new Store(dir,{device:name});atomic(path.join(store.state,'sync-config.json'),JSON.stringify({enabled:true,repository:'folder',paths}));return {dir,store,sync:new FileSync(store)};};
  return {root,origin,clone,machine};
}
function identity(dir,name){git(dir,'config','user.name',name);git(dir,'config','user.email',name.toLowerCase()+'@localhost');}
const status=dir=>git(dir,'status','--porcelain','--untracked-files=all');
const remoteFiles=(dir,commit='origin/main')=>git(dir,'ls-tree','-r','--name-only',commit).split('\n');

test('the notebook commits only its own folder and leaves the owner work, index and ignore file alone',()=>{
  const {machine}=fixture(),envy=machine('envy');
  atomic(path.join(envy.dir,'rules','own.md'),'Staged by a session\n');git(envy.dir,'add','rules/own.md');
  atomic(path.join(envy.dir,'AGENTS.md'),'Being edited\n');
  const note=envy.store.save('notes',{title:'Shared note',content:'From envy'});
  assert.equal(envy.sync.reconcile().state,'synced');
  const pushed=git(envy.dir,'show','--name-only','--format=%an','origin/main').split('\n').filter(Boolean);
  assert.equal(pushed[0],'Godspeed Mission Control');
  assert.deepEqual(pushed.slice(1),['notebook/Shared note.md'],'Only the note left the machine');
  assert.equal(git(envy.dir,'diff','--cached','--name-only'),'rules/own.md','The session work stays staged');
  assert.equal(git(envy.dir,'diff','--name-only'),'AGENTS.md','The unsaved edit stays as it was');
  assert.equal(read(envy.dir,'.gitignore'),ignore);
  assert.equal(fs.existsSync(path.join(envy.store.state,'sync.git')),false);
});

test('notes travel both ways through the one repository and arrive tracked',()=>{
  const {machine}=fixture(),envy=machine('envy'),server=machine('server',['*']);
  const note=envy.store.save('notes',{title:'Travels',content:'Written on envy'});
  assert.equal(envy.sync.reconcile().state,'synced');assert.equal(server.sync.reconcile().state,'synced');
  assert.equal(server.store.get('notes',note.id).content,'Written on envy');
  assert.equal(status(server.dir),'','The server holds it as a tracked file, not an untracked copy');
  server.store.save('notes',{...server.store.get('notes',note.id),content:'Edited on the server'},server.store.get('notes',note.id)._hash);
  assert.equal(server.sync.reconcile().state,'synced');assert.equal(envy.sync.reconcile().state,'synced');
  assert.equal(envy.store.get('notes',note.id).content,'Edited on the server');
  assert.equal(status(envy.dir),'');
});

test('the owner commits arrive in the same pull and nothing is left untracked',()=>{
  const {clone,machine}=fixture(),envy=machine('envy'),laptop=clone('laptop');
  atomic(path.join(laptop,'rules','own.md'),'Changed by a session on the laptop\n');atomic(path.join(laptop,'rules','new.md'),'A new rule\n');
  git(laptop,'add','-A');git(laptop,'commit','-m','Session work');git(laptop,'push','origin','main');
  envy.store.save('contacts',{name:'Someone'});
  assert.equal(envy.sync.reconcile().state,'synced');
  assert.equal(read(envy.dir,'rules','new.md'),'A new rule\n');assert.equal(status(envy.dir),'');
  git(laptop,'pull','--rebase','--autostash','origin','main');
  assert.ok(fs.readdirSync(path.join(laptop,'notebook','People')).length===1,'A plain git pull brings the notebook to a machine without one');
});

test('the same note changed on two machines ends as one review item and never as conflict markers',()=>{
  const {machine}=fixture(),envy=machine('envy'),server=machine('server',['*']);
  const note=envy.store.save('notes',{title:'Contested',content:'Line one\n'});
  assert.equal(envy.sync.reconcile().state,'synced');assert.equal(server.sync.reconcile().state,'synced');
  const edit=(m,text)=>{const r=m.store.get('notes',note.id);m.store.save('notes',{...r,content:text},r._hash);};
  edit(server,'Server version\n');edit(envy,'Envy version\n');
  assert.equal(server.sync.reconcile().state,'synced');
  assert.equal(envy.sync.reconcile().state,'synced','A settled conflict does not hold the notebook back');
  const file=path.join('notebook','Contested.md');
  assert.doesNotMatch(read(envy.dir,file),/<<<<<<<|>>>>>>>/);assert.match(read(envy.dir,file),/Envy version/);
  const reviews=envy.sync.pendingConflicts();assert.equal(reviews.length,1);
  const review=JSON.parse(read(envy.dir,'conflicts',reviews[0]));
  assert.equal(review.path,file.split(path.sep).join('/'));assert.equal(review.kept,'local');
  assert.match(review.local,/Envy version/);assert.match(review.remote,/Server version/);
  assert.equal(server.sync.reconcile().state,'synced');
  assert.match(read(server.dir,file),/Envy version/);assert.deepEqual(server.sync.pendingConflicts(),[],'One review item, on one machine');
  envy.sync.resolve(reviews[0].replace(/\.json$/,''),'remote');
  assert.equal(envy.sync.reconcile().state,'synced');assert.equal(server.sync.reconcile().state,'synced');
  assert.equal(server.store.get('notes',note.id).content,'Server version\n','The reviewed choice travels like any edit');
});

test('a pull that would overwrite an unsaved owner edit waits and loses nothing',()=>{
  const {clone,machine}=fixture(),envy=machine('envy'),laptop=clone('laptop');
  atomic(path.join(laptop,'rules','own.md'),'Laptop version\n');git(laptop,'commit','-qam','Laptop');git(laptop,'push','origin','main');
  atomic(path.join(envy.dir,'rules','own.md'),'Unsaved on envy\n');
  const note=envy.store.save('notes',{title:'Waits',content:'Saved meanwhile'});
  const result=envy.sync.reconcile();
  assert.equal(result.state,'pending');assert.match(result.detail,/rules\/own\.md/);
  assert.equal(read(envy.dir,'rules','own.md'),'Unsaved on envy\n');
  assert.equal(git(envy.dir,'log','-1','--format=%s'),'Save notebook records','The note is saved locally meanwhile');
  git(envy.dir,'checkout','--','rules/own.md');
  assert.equal(envy.sync.reconcile().state,'synced');
  assert.equal(read(envy.dir,'rules','own.md'),'Laptop version\n');assert.ok(remoteFiles(envy.dir).includes('notebook/Waits.md'));
});

test('files the owner changed on two machines are left to Git, untouched',()=>{
  const {clone,machine}=fixture(),envy=machine('envy'),laptop=clone('laptop');
  atomic(path.join(laptop,'rules','own.md'),'Laptop version\n');git(laptop,'commit','-qam','Laptop');git(laptop,'push','origin','main');
  atomic(path.join(envy.dir,'rules','own.md'),'Envy version\n');git(envy.dir,'commit','-qam','Envy session');
  envy.store.save('notes',{title:'Also here',content:'x'});
  const head=git(envy.dir,'rev-parse','HEAD'),result=envy.sync.reconcile();
  assert.equal(result.state,'pending');assert.match(result.detail,/outside the notebook/);
  assert.equal(read(envy.dir,'rules','own.md'),'Envy version\n');assert.equal(git(envy.dir,'rev-parse','HEAD~1'),head);
  assert.equal(git(envy.dir,'rev-parse','origin/main'),git(laptop,'rev-parse','HEAD'),'Nothing was pushed over the conflict');
});

test('a repository in the middle of a merge or a rebase is left alone',()=>{
  const {machine}=fixture(),envy=machine('envy');
  envy.store.save('notes',{title:'Later',content:'x'});
  for(const marker of ['MERGE_HEAD','index.lock']){
    const file=path.join(envy.dir,'.git',marker);fs.writeFileSync(file,marker==='MERGE_HEAD'?git(envy.dir,'rev-parse','HEAD')+'\n':'');
    const result=envy.sync.reconcile();assert.equal(result.state,'pending');assert.match(result.detail,/busy/);
    assert.equal(git(envy.dir,'log','-1','--format=%s'),'Owner mission control');fs.unlinkSync(file);
  }
  assert.equal(envy.sync.reconcile().state,'synced');
});

test('the notebook push runs the owner push check, and its commits start none of the owner jobs',()=>{
  const {machine}=fixture(),envy=machine('envy');
  const hooks=path.join(envy.dir,'.git','hooks');
  fs.writeFileSync(path.join(hooks,'pre-push'),'#!/bin/sh\necho checked > .godspeed/pre-push-ran\n',{mode:0o755});
  fs.writeFileSync(path.join(hooks,'post-commit'),'#!/bin/sh\necho ran > .godspeed/post-commit-ran\n',{mode:0o755});
  envy.store.save('notes',{title:'Checked',content:'x'});
  assert.equal(envy.sync.reconcile().state,'synced');
  assert.ok(fs.existsSync(path.join(envy.store.state,'pre-push-ran')),'The owner pre-push check ran');
  assert.equal(fs.existsSync(path.join(envy.store.state,'post-commit-ran')),false);
});

test('only the server, where nobody else commits, also carries the other files the notebook writes',()=>{
  const {machine}=fixture(),envy=machine('envy'),server=machine('server',['*']);
  atomic(path.join(server.dir,'rules','own.md'),'Written by the assistant on the server\n');atomic(path.join(server.dir,'assistant-state','p','x.json'),'{}');
  assert.equal(server.sync.reconcile().state,'synced');
  assert.equal(git(server.dir,'show','origin/main:rules/own.md'),'Written by the assistant on the server');
  assert.equal(remoteFiles(server.dir).some(n=>n.startsWith('assistant-state/')),false,'What the owner ignores stays ignored');
  atomic(path.join(envy.dir,'rules','own.md'),'Edited on envy, for a session to commit\n');
  assert.equal(envy.sync.reconcile().state,'pending','envy waits rather than commit a file that is not the notebook\'s');
  assert.equal(read(envy.dir,'rules','own.md'),'Edited on envy, for a session to commit\n');
  git(envy.dir,'checkout','--','rules/own.md');assert.equal(envy.sync.reconcile().state,'synced');
  assert.equal(read(envy.dir,'rules','own.md'),'Written by the assistant on the server\n');
});

test('an older workspace has its records folder renamed to notebook once',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-legacy-test-'));
  const first=new Store(root);const note=first.save('notes',{title:'Old',content:'kept'});
  fs.renameSync(path.join(root,'notebook'),path.join(root,'records'));
  const store=new Store(root);
  assert.equal(fs.existsSync(path.join(root,'records')),false);assert.equal(store.get('notes',note.id).content,'kept');
});

test('switching to the folder repository checks the ignore file and sets the old knowledge repository aside',async()=>{
  const {clone}=fixture(),dir=clone('owner'),store=new Store(dir);
  fs.mkdirSync(path.join(store.state,'sync.git'));
  const original=FileSync.prototype.verifyRemote;FileSync.prototype.verifyRemote=async()=>{};
  try{
    fs.writeFileSync(path.join(dir,'.gitignore'),'dev/*\n');
    await assert.rejects(useFolderRepository(store,[]),/\.godspeed\/.*conflicts\//);
    assert.equal(fs.existsSync(path.join(store.state,'sync-config.json')),false);
    fs.writeFileSync(path.join(dir,'.gitignore'),ignore);
    const config=await useFolderRepository(store,[]);
    assert.deepEqual(config.paths,['notebook']);assert.equal(fs.existsSync(path.join(store.state,'sync.git')),false);
    assert.ok(fs.readdirSync(store.state).some(n=>n.startsWith('retired-sync.git-')));
    assert.ok(new FileSync(store).folder);
  }finally{FileSync.prototype.verifyRemote=original;}
});

test('on the server, a file the notebook never commits is set aside instead of blocking every merge',()=>{
  // 6 October 2026: the test server's own assistant wrote brief/<day>.md, the
  // routine machine pushed one of the same name, and the server's notebook
  // waited from 05:02 to 12:05 for a save that could never come.
  const {clone,machine}=fixture(),server=machine('server',['*']),laptop=clone('laptop');
  atomic(path.join(laptop,'brief','2026-10-06.md'),'The real brief\n');git(laptop,'add','-A');git(laptop,'commit','-qm','Brief');git(laptop,'push','origin','main');
  atomic(path.join(server.dir,'brief','2026-10-06.md'),'A test brief written on the server\n');
  assert.equal(server.sync.reconcile().state,'synced');
  assert.equal(read(server.dir,'brief','2026-10-06.md'),'The real brief\n');
  const aside=fs.readdirSync(path.join(server.store.state,'set-aside'));
  assert.equal(read(server.store.state,'set-aside',aside[0],'brief','2026-10-06.md'),'A test brief written on the server\n','kept whole');
  // On a machine where the owner commits, the same thing still waits for the owner.
  const envy=machine('envy');atomic(path.join(laptop,'brief','2026-10-07.md'),'Next\n');git(laptop,'add','-A');git(laptop,'commit','-qm','Next');git(laptop,'push','origin','main');
  atomic(path.join(envy.dir,'brief','2026-10-07.md'),'Mine\n');
  assert.equal(envy.sync.reconcile().state,'pending');assert.equal(read(envy.dir,'brief','2026-10-07.md'),'Mine\n');
});
