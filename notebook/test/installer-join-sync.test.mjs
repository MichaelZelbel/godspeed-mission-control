import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {Store,atomic} from '../core/records/store.mjs';
import {FileSync,joinRepository,useFolderRepository,readSyncConfig} from '../core/sync/git.mjs';

// A reader who set up a server first gives it a private GitHub copy in
// Settings (Connect record sync), then installs Godspeed on a computer and
// pastes that copy's address into the installer. The installer clones it and
// runs `godspeed sync folder` with no paths (joinRepository). Until 8 October
// 2026 that joined it in folder mode, which refused a copy made by Settings
// (its ignore file lets FULL-ALPHA.md and assistant-state/ through) and would
// have sent only notebook/ from the computer. Real repositories, with a local
// bare one standing in for GitHub.
const address='https://github.com/synthetic/copy.git';
function world(t){
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-installer-join-')),remote=path.join(base,'github','copy.git');fs.mkdirSync(remote,{recursive:true});
  // GitHub's address leads to the bare repository, for this process and every Git it starts.
  const saved=Object.fromEntries(['GIT_CONFIG_COUNT','GIT_CONFIG_KEY_0','GIT_CONFIG_VALUE_0'].map(k=>[k,process.env[k]]));
  Object.assign(process.env,{GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'url.'+pathToFileURL(path.join(base,'github')).href+'/.insteadOf',GIT_CONFIG_VALUE_0:'https://github.com/synthetic/'});
  const original=FileSync.prototype.verifyRemote;FileSync.prototype.verifyRemote=async()=>{};
  t.after(()=>{FileSync.prototype.verifyRemote=original;for(const [k,v] of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v;fs.rmSync(base,{recursive:true,force:true});});
  const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
  git(remote,'init','-q','--bare','--initial-branch=main');
  return {base,git};
}
// What Settings does on the server (scripts/sync-worker.mjs, "configure"): a
// plain folder becomes a repository with the policy's ignore file, and its
// first round puts everything the policy shares on GitHub, FULL-ALPHA.md and
// the assistant's state included.
async function serverWithCopy({base}){
  const dir=path.join(base,'server');
  for(const [file,text] of [['FULL-ALPHA.md','# Integrated notebook\n'],['AGENTS.md','# My mission control\n'],['rules/server-rule.md','A rule written on the server.\n']])atomic(path.join(dir,file),text);
  const store=new Store(dir,{device:'vps'}),sync=new FileSync(store);
  await sync.verifyRemote(address);sync.initialize(address);atomic(path.join(store.state,'sync-config.json'),JSON.stringify({enabled:true}));
  store.save('notes',{title:'Made on the server',content:'Before the computer joined.'});
  assert.equal(sync.reconcile().state,'synced');
  return {dir,store,sync};
}

test('a computer that joins a copy made in Settings syncs everything Settings syncs, in both directions',async t=>{
  const w=world(t),server=await serverWithCopy(w);
  // Git for Windows writes Windows line endings on checkout (core.autocrlf=true), and the installer clones before anything is set.
  const dir=path.join(w.base,'computer');w.git(w.base,'clone','-q','-c','core.autocrlf=true',address,dir);
  assert.ok(fs.readFileSync(path.join(dir,'rules','server-rule.md')).includes(13),'the clone has Windows line endings');
  // What the installer got until now: a refusal, and nothing joined.
  const store=new Store(dir,{device:'laptop-1234abcd'});
  await assert.rejects(useFolderRepository(store,undefined),/FULL-ALPHA\.md/);
  assert.deepEqual(await joinRepository(store),{enabled:true,remote:address});
  assert.deepEqual(readSyncConfig(store.state),{enabled:true},'connected the way Settings connects');
  assert.equal(fs.readFileSync(path.join(dir,'rules','server-rule.md'),'utf8'),'A rule written on the server.\n','given back exactly as committed');
  const computer={store,sync:new FileSync(store)};
  assert.equal(computer.sync.folder,null);
  assert.equal(computer.sync.reconcile().state,'synced');
  assert.equal(w.git(dir,'status','--porcelain'),'','nothing on the computer reads as changed');
  // A page and a document changed on each side.
  computer.store.save('notes',{title:'Made on the computer',content:'After joining.'});
  atomic(path.join(dir,'rules','server-rule.md'),'A rule written on the server, sharpened on the computer.\n');
  atomic(path.join(dir,'profile','about-me.md'),'Written on the computer.\n');
  atomic(path.join(server.dir,'rules','second-rule.md'),'Another rule from the server.\n');
  server.store.save('notes',{title:'Second from the server',content:'While the computer worked.'});
  assert.equal(computer.sync.reconcile().state,'synced');
  assert.equal(server.sync.reconcile().state,'synced');
  assert.equal(computer.sync.reconcile().state,'synced');
  const titles=s=>{s.scan(true);return s.list('notes').map(n=>n.title).sort();};
  const all=['Made on the computer','Made on the server','Second from the server'];
  assert.deepEqual(titles(server.store),all);assert.deepEqual(titles(computer.store),all);
  assert.equal(fs.readFileSync(path.join(server.dir,'rules','server-rule.md'),'utf8'),'A rule written on the server, sharpened on the computer.\n','a document the server had, changed on the computer');
  assert.equal(fs.readFileSync(path.join(server.dir,'profile','about-me.md'),'utf8'),'Written on the computer.\n','outside notebook/ too');
  assert.equal(fs.readFileSync(path.join(dir,'rules','second-rule.md'),'utf8'),'Another rule from the server.\n');
  assert.deepEqual(server.sync.pendingConflicts(),[]);assert.deepEqual(computer.sync.pendingConflicts(),[]);
});

test('an owner\'s own mission control repository still joins in folder mode and commits only notebook/',async t=>{
  const w=world(t),seed=path.join(w.base,'seed'),ignore='/.godspeed/\n/conflicts/\n/FULL-ALPHA.md\n/assistant-state/\n';
  // Programs and settings tracked beside the notebook: sessions commit them (D-288, D-289).
  for(const [file,text] of [['.gitignore',ignore],['.gitattributes','* text=auto eol=lf\nnotebook/** -text\n'],['AGENTS.md','Owner manual\n'],['tools/run.sh','echo owner\n']])atomic(path.join(seed,file),text);
  w.git(seed,'init','-q','-b','main');w.git(seed,'add','-A');w.git(seed,'-c','user.name=Owner','-c','user.email=owner@localhost','commit','-qm','Owner');w.git(seed,'push','-q',address,'main');
  const dir=path.join(w.base,'envy');w.git(w.base,'clone','-q',address,dir);
  const joined=await joinRepository(new Store(dir));
  assert.equal(joined.repository,'folder');assert.deepEqual(joined.paths,['notebook']);
  assert.equal(fs.readFileSync(path.join(dir,'.gitignore'),'utf8'),ignore,'the owner\'s ignore file is untouched');
  const plain=path.join(w.base,'plain');fs.mkdirSync(plain);
  await assert.rejects(joinRepository(new Store(plain)),/no repository of its own/);
});
