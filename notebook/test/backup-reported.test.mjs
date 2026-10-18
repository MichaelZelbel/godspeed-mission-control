import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {BackupSchedule} from '../core/backup-schedule.mjs';
import {readNotices} from '../core/notices.mjs';

// Nightly backups from the start, and a failed one said (18 October 2026). A computer made no
// nightly backup before its first goal, and a failed one reached nobody.
const temporary=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-backup-reported-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;};
const runner=(store,{fail=false}={})=>{const state={runs:0,fail};return {state,run:async()=>{state.runs++;if(state.fail)throw Error('Backup stopped before it was complete (exit 1). Nothing of it was kept. '+path.join(store.state,'backups','x'));const id=String(Date.now()+state.runs);fs.mkdirSync(path.join(store.state,'backups',id),{recursive:true});fs.writeFileSync(path.join(store.state,'backups',id,'backup.json'),'{}');return {id};}};};

test('a computer with no goal yet makes its nightly backup, and one that does not run the routines still does not',async t=>{
 const store=new Store(temporary(t),{device:'pc'}),r=runner(store),schedule=new BackupSchedule({store,runner:r,device:'pc'});
 assert.ok(!store.get('settings','installation'),'nothing set up yet');
 const night=Date.parse('2026-10-19T12:00:00Z');await schedule.tick(night);assert.equal(r.state.runs,1,'backed up before any goal');
 const joined=new Store(temporary(t),{device:'laptop'});joined.save('settings',{id:'installation',owner:'vps',timezone:'Europe/Berlin'});
 const other=runner(joined);await new BackupSchedule({store:joined,runner:other,device:'laptop'}).tick(night);assert.equal(other.state.runs,0,'the server backs up, not this computer');
});

test('a failed nightly backup is said once a day, in plain words, on the bell and where the routines\' results go, until one works',async t=>{
 const store=new Store(temporary(t),{device:'pc'});store.save('settings',{id:'installation',owner:'pc',timezone:'Europe/Berlin'});
 const r=runner(store,{fail:true}),schedule=new BackupSchedule({store,runner:r,device:'pc'}),night=Date.parse('2026-10-19T02:00:00Z');
 await assert.rejects(schedule.tick(night),/Backup stopped/);
 const [notice]=readNotices(store);
 assert.match(notice.text,/^Your nightly backup did not work: Backup stopped before it was complete \(exit 1\)\. Nothing of it was kept\. \[folder\]\. It is tried again in an hour\. To save one now, open Settings in the notebook and click Save a backup under Recovery\.$/);
 assert.ok(!notice.text.includes(store.state),'without the machine\'s folders');
 const bell=store.get('notifications','backup-failed');assert.equal(bell.status,'pending');assert.equal(bell.link,'/dashboard/settings#recovery');
 // Tried again after its wait, failing again the same day: said once that day.
 await assert.rejects(schedule.tick(night+2*3600000),/Backup stopped/);assert.equal(readNotices(store).length,1);
 assert.equal(schedule.status().failures,2);
 r.state.fail=false;await schedule.tick(night+5*3600000);
 assert.equal(store.get('notifications','backup-failed').status,'resolved','a backup that works clears it');assert.equal(schedule.status().failures,0);
});
