import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store,hash,atomic} from '../core/records/store.mjs';
import {backup,restore,restoreSeparateCopy} from '../core/archives.mjs';
import {BackupSchedule} from '../core/backup-schedule.mjs';

// Reviewed on 6 October 2026: the daily backup held the writer lock for its
// whole copy and hash (seven minutes at 16,000 records, while every server
// save gave up after 30 seconds), a failed scheduled backup left a partial
// copy every ten minutes that nothing counted or removed, and restoring a
// backup wrote into the backup.
const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-backup-snapshot-'));
const tree=root=>{const out={},walk=(dir,rel)=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const r=rel?rel+'/'+e.name:e.name,f=path.join(dir,e.name);if(e.isDirectory()){out[r+'/']='folder';walk(f,r);}else out[r]=hash(fs.readFileSync(f));}};walk(root,'');return out;};

test('a backup copies without the writer lock and still holds the notebook as it was at one moment',t=>{
  const root=temp(),store=new Store(path.join(root,'live')),media=path.join(root,'media');fs.mkdirSync(media);
  const a=store.save('notes',{title:'A',content:'before'});for(let i=0;i<5;i++)store.save('notes',{title:'Filler '+i,content:'x'});
  const lock=path.join(store.state,'workspace.lock'),other=new Store(store.root),copyFile=fs.copyFileSync;let copies=0,unlocked=0,late;
  t.mock.method(fs,'copyFileSync',(from,to,...rest)=>{
    copies++;if(!fs.existsSync(lock))unlocked++;
    // Another program saves while the files are being copied.
    if(copies===2&&!late){late=other.save('notes',{title:'Saved during the copy',content:'late'});other.save('notes',{id:a.id,content:'after'});}
    return copyFile(from,to,...rest);
  });
  const destination=path.join(root,'backup');let duringFinalize;
  store.backup(destination,{finalize:()=>{duringFinalize={locked:fs.existsSync(lock),saved:other.save('notes',{title:'Saved after the snapshot',content:'not in this backup'})};}});
  t.mock.restoreAll();
  assert.ok(late,'the other program could save while the backup copied');assert.ok(unlocked>0,'the copy ran without the lock');
  assert.equal(duringFinalize.locked,false,'media and hashes are done without the lock too');
  const saved=Store.inspect(destination),manifest=JSON.parse(fs.readFileSync(path.join(destination,'backup.json'),'utf8'));
  assert.equal(saved.get('notes',late.id)?.content,'late','what was saved before the snapshot was taken is in it');
  assert.equal(saved.get('notes',a.id).content,'after');assert.equal(saved.get('notes',duringFinalize.saved.id),undefined);
  assert.equal(manifest.records,saved.records.size);assert.deepEqual(saved.problems,[]);
});

test('a backup that fails part-way leaves neither a partial copy nor its destination',t=>{
  const root=temp(),store=new Store(path.join(root,'live')),media=path.join(root,'media');fs.mkdirSync(media);
  for(let i=0;i<5;i++)store.save('notes',{title:'Note '+i,content:'x'});
  const parent=path.join(root,'backups'),destination=path.join(parent,'1759700000000'),copyFile=fs.copyFileSync;let copies=0;
  t.mock.method(fs,'copyFileSync',(...args)=>{if(++copies===3)throw Object.assign(new Error('ENOSPC: the fictional disk is full'),{code:'ENOSPC'});return copyFile(...args);});
  assert.throws(()=>backup(store,media,destination),/fictional disk is full/);t.mock.restoreAll();
  assert.deepEqual(fs.existsSync(parent)?fs.readdirSync(parent):[],[]);
  assert.equal(fs.existsSync(path.join(store.state,'backup-staging'))&&fs.readdirSync(path.join(store.state,'backup-staging')).length,false);
  backup(store,media,destination);assert.equal(JSON.parse(fs.readFileSync(path.join(destination,'backup.json'))).records,5);
});

test('a failed scheduled backup is recorded where the health check sees it, waits before trying again, and leaves nothing behind',async()=>{
  const store=new Store(temp()),folder=path.join(store.state,'backups');
  store.save('settings',{id:'installation',owner:'vps',timezone:'UTC'});
  let runs=0,fail=true;const runner={run:async()=>{runs++;if(fail)throw new Error('Creating a backup needs 9 GB free');const id=String(Date.UTC(2026,9,7,4)+runs);fs.mkdirSync(path.join(folder,id),{recursive:true});fs.writeFileSync(path.join(folder,id,'backup.json'),'{}');return {path:path.join(folder,id)};}};
  // What a backup worker that died part-way leaves.
  fs.mkdirSync(path.join(folder,'.partial-1759700000000','notebook'),{recursive:true});
  const schedule=new BackupSchedule({store,runner,device:'vps'}),at=Date.UTC(2026,9,7,4);
  await assert.rejects(schedule.tick(at),/9 GB free/);
  assert.deepEqual(fs.readdirSync(folder),[],'the partial copy is gone');
  const status=schedule.status();assert.equal(status.failures,1);assert.match(status.last_error,/9 GB free/);assert.ok(Date.parse(status.retry_after)>at);
  const receipts=store.list('job_receipts').filter(r=>r.job_id==='daily-backup');
  assert.equal(receipts.length,1);assert.equal(receipts[0].state,'failed');assert.match(receipts[0].error,/9 GB free/);
  assert.equal(await schedule.tick(at+600000),null,'ten minutes later it does not try again');assert.equal(runs,1);
  await assert.rejects(new BackupSchedule({store,runner,device:'vps'}).tick(Date.parse(status.retry_after)),/9 GB free/);assert.equal(runs,2,'the wait is kept across a restart, and then it tries again');
  fail=false;const later=Date.parse(new BackupSchedule({store,runner,device:'vps'}).status().retry_after);
  assert.ok((await schedule.tick(later)).path);assert.equal(schedule.status().failures,0);assert.equal(schedule.status().last_error,null);
  assert.ok(store.list('job_receipts').some(r=>r.job_id==='daily-backup'&&r.state==='verified'&&r.started_at>receipts[0].started_at),'a later verified run clears the repair item');
});

test('restoring a backup only reads it, so the same backup restores twice, also from before the notebook folder was renamed',()=>{
  const root=temp(),store=new Store(path.join(root,'live'));
  store.save('notes',{title:'Before the rename',content:'kept'});
  const destination=path.join(root,'backup-2026-10-04');backup(store,path.join(store.state,'media'),destination);
  // A backup made before 2026-10-05 holds records/ where notebook/ is now.
  fs.renameSync(path.join(destination,'notebook'),path.join(destination,'records'));
  const manifest=JSON.parse(fs.readFileSync(path.join(destination,'backup.json'),'utf8'));
  manifest.files=manifest.files.map(f=>({...f,path:f.path.replace(/^notebook\//,'records/')}));atomic(path.join(destination,'backup.json'),JSON.stringify(manifest,null,2));
  const before=tree(destination);
  for(const name of ['first','second']){
    const target=new Store(path.join(root,name));assert.equal(restore(target,path.join(target.state,'media'),destination),1);
    assert.equal(target.list('notes')[0].content,'kept');assert.deepEqual(tree(destination),before,'the backup is exactly as it was');
  }
  const copy=restoreSeparateCopy(new Store(path.join(root,'third')),destination);
  assert.equal(copy.verified,true);assert.equal(copy.records,1);assert.deepEqual(copy.excluded_files,[]);assert.deepEqual(tree(destination),before);
});
