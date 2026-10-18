import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {BackupSchedule} from '../core/backup-schedule.mjs';

// Until 6 October 2026 a backup was made only when someone pressed the button.
const setup=device=>{
  const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-backup-schedule-')),{device});
  store.save('settings',{id:'installation',owner:'vps',timezone:'Europe/Berlin'});
  let runs=0;const runner={run:async()=>{runs++;const id=String(Date.parse('2026-10-06T03:00:00Z')+runs);fs.mkdirSync(path.join(store.state,'backups',id),{recursive:true});fs.writeFileSync(path.join(store.state,'backups',id,'backup.json'),'{}');return {id};}};
  return {store,schedule:new BackupSchedule({store,runner,device,keep:2}),runs:()=>runs};
};

test('one backup a day after 03:00 in the owner\'s timezone, on the routine machine only, keeping the newest',async()=>{
  const {store,schedule,runs}=setup('vps');
  assert.equal(await schedule.tick(Date.parse('2026-10-06T00:30:00Z')),null,'02:30 in Berlin is too early');
  await schedule.tick(Date.parse('2026-10-06T01:30:00Z'));assert.equal(runs(),1,'03:30 in Berlin');
  await schedule.tick(Date.parse('2026-10-06T09:00:00Z'));assert.equal(runs(),1,'once that day');
  for(const id of ['1','2'])fs.mkdirSync(path.join(store.state,'backups',id),{recursive:true}),fs.writeFileSync(path.join(store.state,'backups',id,'backup.json'),'{}');
  fs.mkdirSync(path.join(store.state,'backups','3'));
  await schedule.tick(Date.parse('2026-10-07T02:00:00Z'));assert.equal(runs(),2,'the next day');
  assert.deepEqual(fs.readdirSync(path.join(store.state,'backups')).sort(),['3',String(Date.parse('2026-10-06T03:00:00Z')+1),String(Date.parse('2026-10-06T03:00:00Z')+2)].sort(),'two newest kept; an unfinished one is never touched');
  const laptop=setup('local');await laptop.schedule.tick(Date.parse('2026-10-06T09:00:00Z'));assert.equal(laptop.runs(),0);
  store.save('settings',{id:'backups',enabled:false});assert.equal(schedule.due(Date.parse('2026-10-08T09:00:00Z')),false);
});

test('a server short of disk can keep fewer backups',async()=>{
  const {store,schedule}=setup('vps');
  for(const id of ['1','2','3'])fs.mkdirSync(path.join(store.state,'backups',id),{recursive:true}),fs.writeFileSync(path.join(store.state,'backups',id,'backup.json'),'{}');
  store.save('settings',{id:'backups',keep:1});
  await schedule.tick(Date.parse('2026-10-06T09:00:00Z'));
  assert.equal(fs.readdirSync(path.join(store.state,'backups')).length,1);
});
