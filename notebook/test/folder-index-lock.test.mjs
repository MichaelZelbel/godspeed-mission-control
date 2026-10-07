import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
import {Store,atomic} from '../core/records/store.mjs';
import {FileSync} from '../core/sync/git.mjs';
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
const identity=(dir,name)=>{git(dir,'config','user.name',name);git(dir,'config','user.email',name.toLowerCase()+'@localhost');};

// Syncing through the mission control's own repository, the notebook moves
// the owner's branch to its pushed commit and then brings the owner's index
// level with it. A Git of the owner's holding the index for a moment then
// (an editor's status, a session's add) made that second step fail after the
// first: the owner's index showed the notebook's own commit as staged
// changes taking it back, ready to be committed by the next "git commit"
// (7 October 2026). The notebook waits for the moment to pass.
test('a moment\'s index lock does not leave the owner index behind the branch',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-index-lock-')),origin=path.join(root,'origin.git');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(origin);git(origin,'init','--bare','--initial-branch=main');
  const seed=path.join(root,'seed');git(root,'clone','-q',origin,seed);identity(seed,'Owner');
  for(const [file,text] of [['.gitignore','/.godspeed/\n/conflicts/\n/FULL-ALPHA.md\n/assistant-state/\n'],['.gitattributes','* text=auto eol=lf\nnotebook/** -text\n'],['AGENTS.md','Owner manual\n']])atomic(path.join(seed,file),text);
  git(seed,'add','-A');git(seed,'commit','-qm','Owner mission control');git(seed,'push','-q','origin','main');
  const machine=name=>{const dir=path.join(root,name);git(root,'clone','-q',origin,dir);identity(dir,'Owner');const store=new Store(dir,{device:name});atomic(path.join(store.state,'sync-config.json'),JSON.stringify({enabled:true,repository:'folder',paths:['notebook']}));return {dir,store,sync:new FileSync(store)};};
  const envy=machine('envy'),laptop=machine('laptop');
  laptop.store.save('notes',{title:'From the laptop',content:'a\n'});assert.equal(laptop.sync.reconcile().state,'synced');
  envy.store.save('notes',{title:'From envy',content:'b\n'});
  // The owner's Git takes the index just as the branch has moved, for a moment.
  const lock=path.join(envy.dir,'.git','index.lock'),real=envy.sync.gitBytes.bind(envy.sync);let held=false;
  envy.sync.gitBytes=(args,cwd,options)=>{
    if(!held&&args.includes('update-ref')){held=true;const out=real(args,cwd,options);fs.writeFileSync(lock,'');spawn(process.execPath,['-e',`setTimeout(()=>require('fs').rmSync(${JSON.stringify(lock)},{force:true}),1500)`],{detached:true,stdio:'ignore',windowsHide:true}).unref();return out;}
    return real(args,cwd,options);
  };
  const status=envy.sync.reconcile();
  assert.ok(held,'the lock was taken at that moment');
  assert.equal(status.state,'synced',JSON.stringify(status));
  assert.equal(git(envy.dir,'diff','--cached','--name-only'),'','the owner index matches the branch');
  assert.equal(git(envy.dir,'status','--porcelain'),'');
});
