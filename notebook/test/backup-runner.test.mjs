import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store,hash} from '../core/records/store.mjs';import {BackupRunner} from '../core/backup-runner.mjs';import {restoreSeparateCopy} from '../core/archives.mjs';
import {createService} from '../server/main.mjs';

test('backup captures exact retained records and media without stopping timers or duplicating concurrent requests',async()=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-backup-worker-'))),media=path.join(store.state,'media');fs.mkdirSync(media);
 store.save('notes',{id:'fictional-source',content:'Exact fictional source bytes.'});fs.writeFileSync(path.join(media,'fixture.bin'),Buffer.alloc(16*1024*1024,143));
 const runner=new BackupRunner(store,media);let ticks=0;const timer=setInterval(()=>ticks++,5);
 try{
  const first=runner.run();assert.equal(runner.run(),first);const result=await first;assert.ok(ticks>0);
  const manifest=JSON.parse(fs.readFileSync(path.join(result.path,'backup.json'),'utf8'));assert.equal(manifest.records,1);
  assert.equal(hash(fs.readFileSync(path.join(result.path,'media/fixture.bin'))),hash(fs.readFileSync(path.join(media,'fixture.bin'))));
  assert.equal(fs.readdirSync(path.join(store.state,'backups')).length,1);
  assert.equal(restoreSeparateCopy(store,result.path).verified,true);
 }finally{clearInterval(timer);}
});

test('HTTP health keeps answering while normal backup capture runs',async()=>{
 const service=await createService({root:fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-backup-health-')),port:0}),base='http://127.0.0.1:'+service.address.port;
 try{
  service.store.save('notes',{content:'Fictional health responsiveness evidence.'});
  fs.writeFileSync(path.join(service.store.state,'media/fixture.bin'),Buffer.alloc(32*1024*1024,23));
  let finished=false;const capture=fetch(base+'/api/backup',{method:'POST'}).then(async response=>{assert.equal(response.status,200);const value=await response.json();finished=true;return value;});
  let answered=0;
  while(!finished){const response=await fetch(base+'/health',{signal:AbortSignal.timeout(2000)});assert.equal(response.status,200);if(!finished)answered++;await new Promise(resolve=>setTimeout(resolve,5));}
  assert.ok(answered>0,'Health must respond during backup, not just after it');assert.ok((await capture).path);
 }finally{await service.close();}
});

test('the snapshot lock covers media copying and complete manifest publication',()=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-backup-consistency-')));
 let captured=false;
 store.backup(path.join(store.state,'backups','fixture'),{finalize:()=>{assert.ok(fs.existsSync(path.join(store.state,'workspace.lock')));assert.throws(()=>new Store(store.root),/being written/);captured=true;}});
 assert.equal(captured,true);assert.equal(fs.existsSync(path.join(store.state,'workspace.lock')),false);
});
