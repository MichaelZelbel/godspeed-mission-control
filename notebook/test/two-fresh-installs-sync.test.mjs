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

// A fresh install the way Settings meets it: an empty folder connected to the
// private copy, whose first processing run has already saved the processing
// settings with its own start time.
function installs(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-two-fresh-')),remote=path.join(root,'remote.git');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(remote);git(remote,'init','--bare','--initial-branch=main');
  return async(name,now,before=()=>{})=>{
    const dir=path.join(root,name);fs.mkdirSync(dir);
    git(dir,'init','-q','-b','main');git(dir,'config','user.name',name);git(dir,'config','user.email',name+'@localhost');git(dir,'remote','add','origin',remote);
    const store=new Store(dir,{device:name});
    await new NoteProcessing({store,query:{rows:()=>[]},domains:{provider:null},device:name}).tick({now});
    before(store);
    const sync=new FileSync(store);sync.initialize('https://github.com/synthetic/private.git');
    return {dir,store,sync};
  };
}
const desktopStart=Date.parse('2026-11-13T09:00:00Z'),laptopStart=Date.parse('2026-11-13T09:05:00Z');

// Until 13 November 2026 the second install's own processing settings were
// kept for review, and its sync stopped for a conflict nobody made.
test('two fresh installs on one empty private copy both finish their first sync, and a note then travels',async t=>{
  const install=installs(t),desktop=await install('desktop',desktopStart);
  assert.equal(desktop.sync.reconcile().state,'synced');
  const laptop=await install('laptop',laptopStart),status=laptop.sync.reconcile();
  assert.equal(status.state,'synced',JSON.stringify(status));
  assert.deepEqual(reviews(laptop.dir),[]);
  assert.equal(laptop.store.list('settings').filter(s=>s.id==='processing').length,1);
  desktop.store.save('notes',{title:'Hello',content:'from the desktop\n'});
  assert.equal(desktop.sync.reconcile().state,'synced');
  assert.equal(laptop.sync.reconcile().state,'synced');
  assert.equal(laptop.store.list('notes').find(n=>n.title==='Hello')?.content,'from the desktop\n');
});

test('the same note changed differently on both computers is still a conflict',async t=>{
  const install=installs(t),desktop=await install('desktop',desktopStart);
  assert.equal(desktop.sync.reconcile().state,'synced');
  const laptop=await install('laptop',laptopStart);
  assert.equal(laptop.sync.reconcile().state,'synced');
  const note=desktop.store.save('notes',{title:'Plans',content:'one\n'});
  assert.equal(desktop.sync.reconcile().state,'synced');
  assert.equal(laptop.sync.reconcile().state,'synced');
  desktop.store.save('notes',{...desktop.store.get('notes',note.id),content:'from the desktop\n'});
  laptop.store.save('notes',{...laptop.store.get('notes',note.id),content:'from the laptop\n'});
  assert.equal(desktop.sync.reconcile().state,'synced');
  const status=laptop.sync.reconcile();
  assert.equal(status.state,'conflict',JSON.stringify(status));
  assert.ok(reviews(laptop.dir).some(r=>/Plans/.test(r.path)),JSON.stringify(reviews(laptop.dir).map(r=>r.path)));
});

test('processing settings someone changed before the first sync are still kept for review',async t=>{
  const install=installs(t),desktop=await install('desktop',desktopStart);
  assert.equal(desktop.sync.reconcile().state,'synced');
  const laptop=await install('laptop',laptopStart,store=>store.save('settings',{...store.get('settings','processing'),daily_limit:10}));
  const status=laptop.sync.reconcile();
  assert.equal(status.state,'conflict',JSON.stringify(status));
  const kept=reviews(laptop.dir);
  assert.equal(kept.length,1,JSON.stringify(kept.map(r=>r.path)));
  assert.match(kept[0].path,/settings\/processing/);
});
