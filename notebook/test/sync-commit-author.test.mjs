import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {Store} from '../core/records/store.mjs';
import {FileSync} from '../core/sync/git.mjs';
import {machineDevice} from '../core/device-id.mjs';
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();

function withoutDeviceName(t){
  const before=process.env.GODSPEED_DEVICE;delete process.env.GODSPEED_DEVICE;
  t.after(()=>{if(before===undefined)delete process.env.GODSPEED_DEVICE;else process.env.GODSPEED_DEVICE=before;});
}
function copy(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-author-')),remote=path.join(root,'remote.git');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(remote);git(remote,'init','-q','--bare','--initial-branch=main');
  const install=(name,device)=>{
    const dir=path.join(root,name);fs.mkdirSync(dir);git(dir,'init','-q','-b','main');git(dir,'remote','add','origin',remote);
    const store=new Store(dir,device?{device}:undefined),sync=new FileSync(store);sync.initialize('https://github.com/synthetic/private.git');
    return {dir,store,sync};
  };
  return {remote,install,authors:()=>git(remote,'log','--format=%an <%ae>','main').split('\n')};
}

// Until 13 November 2026 every computer committed as "Godspeed Mission
// Control", so the copy's history could not say which computer changed what.
// The sync worker builds its Store without a device, as these installs do.
test('each computer\'s sync commits name that computer, the same name on every sync',t=>{
  withoutDeviceName(t);
  const {install,authors}=copy(t),desktop=install('desktop');
  desktop.store.save('notes',{title:'From the desktop',content:'one\n'});
  assert.equal(desktop.sync.reconcile().state,'synced');
  const first=authors();
  const laptop=install('laptop');
  assert.equal(laptop.sync.reconcile().state,'synced');
  laptop.store.save('notes',{title:'From the laptop',content:'two\n'});
  assert.equal(laptop.sync.reconcile().state,'synced');
  desktop.store.save('notes',{title:'Again from the desktop',content:'three\n'});
  assert.equal(desktop.sync.reconcile().state,'synced');
  const desktopName=machineDevice(desktop.dir).id,laptopName=machineDevice(laptop.dir).id;
  assert.notEqual(desktopName,laptopName);
  const desktopAuthor=`Godspeed Mission Control (${desktopName}) <${desktopName}@godspeed.localhost>`,laptopAuthor=`Godspeed Mission Control (${laptopName}) <${laptopName}@godspeed.localhost>`;
  const all=authors();
  assert.deepEqual([...new Set(all)].sort(),[desktopAuthor,laptopAuthor].sort(),all.join('\n'));
  assert.deepEqual(first,[desktopAuthor]);
  assert.equal(all[0],desktopAuthor,'the desktop\'s latest commit carries the name its first one did');
});

test('a computer named by its launcher commits under that name',t=>{
  const {install,authors}=copy(t),server=install('server','vps');
  server.store.save('notes',{title:'From the server',content:'one\n'});
  assert.equal(server.sync.reconcile().state,'synced');
  assert.deepEqual(authors(),['Godspeed Mission Control (vps) <vps@godspeed.localhost>']);
});
