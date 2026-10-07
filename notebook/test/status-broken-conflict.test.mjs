import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createService} from '../server/main.mjs';

async function service(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-hardening-')),uiRoot=path.join(root,'ui');fs.mkdirSync(uiRoot);fs.writeFileSync(path.join(uiRoot,'index.html'),'<!doctype html><title>Notebook</title>');
  const s=await createService({root:path.join(root,'workspace'),port:0,uiRoot});
  t.after(async()=>{await s.close();fs.rmSync(root,{recursive:true,force:true});});
  return {s,base:'http://127.0.0.1:'+s.address.port};
}

// One saved conflict whose file does not read (cut off by a full disk, edited
// by hand) made the status the dashboard asks for every few seconds fail as a
// whole, and the screens showed the server as broken (7 October 2026). It is
// listed as damaged and the rest answers.
test('one unreadable conflict file does not take the status down',async t=>{
  const {s,base}=await service(t);
  fs.mkdirSync(path.join(s.store.root,'conflicts'),{recursive:true});
  fs.writeFileSync(path.join(s.store.root,'conflicts','broken.json'),'{"id":"broken","kind":');
  fs.writeFileSync(path.join(s.store.root,'conflicts','fine.json'),JSON.stringify({id:'fine',kind:'git',path:'rules/own.md'}));
  const response=await fetch(base+'/api/status');
  assert.equal(response.status,200);
  const status=await response.json();
  assert.deepEqual(status.conflicts.map(c=>c.id).sort(),['broken','fine']);
  assert.equal(status.conflicts.find(c=>c.id==='broken').degraded,true);
});
