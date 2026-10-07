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

function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-duplicate-review-')),origin=path.join(root,'origin.git');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(origin);git(origin,'init','--bare','--initial-branch=main');
  const seed=path.join(root,'seed');git(root,'clone',origin,seed);identity(seed,'Owner');
  for(const [file,text] of [['.gitignore','/.godspeed/\n/conflicts/\n/FULL-ALPHA.md\n/assistant-state/\n'],['.gitattributes','* text=auto eol=lf\nnotebook/** -text\n'],['AGENTS.md','Owner manual\n']])atomic(path.join(seed,file),text);
  git(seed,'add','-A');git(seed,'commit','-m','Owner mission control');git(seed,'push','origin','main');
  const clone=name=>{const dir=path.join(root,name);git(root,'clone',origin,dir);identity(dir,'Owner');return dir;};
  const envy=clone('envy'),store=new Store(envy,{device:'envy'});atomic(path.join(store.state,'sync-config.json'),JSON.stringify({enabled:true,repository:'folder',paths:['notebook']}));
  return {clone,envy:{dir:envy,store,sync:new FileSync(store)}};
}

// The owner duplicated a page in Obsidian on the laptop and their own Git
// pushed it: two files with one identity. The notebook on envy did not take
// that change and saved the copy for review. Resolving the review followed
// the identity to the original note: keeping this machine's version (no copy)
// removed the original, and taking the other version wrote the copy over it
// (7 October 2026). A review of a copy is about the copy's own file.
test('resolving the review of a duplicated page never touches the original',t=>{
  const {clone,envy}=fixture(t);
  const note=envy.store.save('notes',{title:'Plan',content:'The original plan'});
  assert.equal(envy.sync.reconcile().state,'synced');
  const original=fs.readFileSync(envy.store.file(envy.store.get('notes',note.id)));
  const laptop=clone('laptop');
  fs.copyFileSync(path.join(laptop,'notebook','Plan.md'),path.join(laptop,'notebook','Plan 1.md'));
  git(laptop,'add','-A');git(laptop,'commit','-qm','Obsidian made a copy');git(laptop,'push','-q','origin','main');
  assert.equal(envy.sync.reconcile().state,'conflict');
  const dir=path.join(envy.dir,'conflicts'),[file]=fs.readdirSync(dir),id=file.replace(/\.json$/,'');
  const review=conflictView(envy.store,id);
  assert.equal(review.path,'notebook/Plan 1.md');
  // Taking the copy as it is would put a second file with one identity here.
  assert.throws(()=>resolveSavedConflict(envy.store,{id,choice:'remote',expected_hash:review.current_hash}),/copy/);
  assert.deepEqual(fs.readFileSync(envy.store.file(envy.store.get('notes',note.id))),original);
  // Keeping this machine's version: no copy here, and the original stays.
  resolveSavedConflict(envy.store,{id,choice:'local',expected_hash:review.current_hash});
  const now=envy.store.get('notes',note.id);
  assert.equal(now.removed_at,undefined,'the original note is not removed');
  assert.deepEqual(fs.readFileSync(envy.store.file(now)),original);
  assert.ok(!fs.existsSync(path.join(envy.dir,'notebook','Plan 1.md')));
});
