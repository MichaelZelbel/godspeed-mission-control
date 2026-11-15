import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {Store} from '../core/records/store.mjs';
import {FileSync} from '../core/sync/git.mjs';
import {NoteProcessing} from '../core/processing.mjs';
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
const reviews=dir=>{const folder=path.join(dir,'conflicts');return fs.existsSync(folder)?fs.readdirSync(folder).map(n=>JSON.parse(fs.readFileSync(path.join(folder,n),'utf8'))):[];};

// Two fresh installs on one private copy, the way Settings connects them.
function installs(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-hold-one-')),remote=path.join(root,'remote.git');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(remote);git(remote,'init','--bare','--initial-branch=main');
  return {remote,install:async(name,now,before=()=>{})=>{
    const dir=path.join(root,name);fs.mkdirSync(dir);
    git(dir,'init','-q','-b','main');git(dir,'config','user.name',name);git(dir,'config','user.email',name+'@localhost');git(dir,'remote','add','origin',remote);
    const store=new Store(dir,{device:name});
    await new NoteProcessing({store,query:{rows:()=>[]},domains:{provider:null},device:name}).tick({now});
    before(store);
    const sync=new FileSync(store);sync.initialize('https://github.com/synthetic/private.git');
    return {dir,store,sync};
  }};
}
const limit=n=>store=>store.save('settings',{...store.get('settings','processing'),daily_limit:n});

// Until November 2026 one saved conflict nobody had resolved stopped every
// sync round on that computer, so no note moved in either direction (#570).
test('an unresolved conflict over the processing settings holds back only that file, and notes keep travelling',async t=>{
  const {remote,install}=installs(t);
  const desktop=await install('desktop',Date.parse('2026-11-13T09:00:00Z'),limit(10));
  assert.equal(desktop.sync.reconcile().state,'synced');
  const laptop=await install('laptop',Date.parse('2026-11-13T09:05:00Z'),limit(20));
  let status=laptop.sync.reconcile();
  assert.equal(status.state,'conflict',JSON.stringify(status));
  assert.equal(status.error,undefined,JSON.stringify(status));
  const [review]=reviews(laptop.dir);
  assert.match(review.path,/settings\/processing/);

  desktop.store.save('notes',{title:'From the desktop',content:'one\n'});
  laptop.store.save('notes',{title:'From the laptop',content:'two\n'});
  for(const side of [desktop,laptop,desktop,laptop]){status=side.sync.reconcile();assert.equal(status.error,undefined,JSON.stringify(status));}

  assert.ok(desktop.store.list('notes').some(n=>n.title==='From the laptop'));
  assert.ok(laptop.store.list('notes').some(n=>n.title==='From the desktop'));
  assert.equal(laptop.sync.pendingConflicts().length,1);
  assert.equal(desktop.store.get('settings','processing').daily_limit,10);
  assert.equal(laptop.store.get('settings','processing').daily_limit,20);
  assert.equal(laptop.sync.last.state,'conflict');
  assert.match(git(remote,'show','main:'+review.path),/"daily_limit": 10\b/);

  // The desktop changes the settings again: the review now shows that version.
  desktop.store.save('settings',{...desktop.store.get('settings','processing'),daily_limit:30});
  desktop.sync.reconcile();laptop.sync.reconcile();
  assert.equal(laptop.store.get('settings','processing').daily_limit,20);
  const [refreshed]=reviews(laptop.dir);
  assert.match(refreshed.remote,/"daily_limit": 30\b/);
  assert.match(refreshed.local,/"daily_limit": 20\b/);

  laptop.sync.resolve(refreshed.id,'local');
  assert.equal(laptop.sync.reconcile().state,'synced');
  assert.equal(desktop.sync.reconcile().state,'synced');
  assert.equal(desktop.store.get('settings','processing').daily_limit,20);
  assert.equal(laptop.store.get('settings','processing').daily_limit,20);
  assert.deepEqual([laptop.sync.pendingConflicts(),desktop.sync.pendingConflicts()],[[],[]]);
});
