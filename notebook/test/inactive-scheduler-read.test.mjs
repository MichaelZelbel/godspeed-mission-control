import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {Scheduler} from '../core/jobs/scheduler.mjs';

test('inactive routines do not repeatedly rescan the vault and later activation runs once',async()=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-inactive-scheduler-')));
 store.save('settings',{id:'installation',owner:'local',timezone:'UTC',delivery:'notebook'});
 const at=new Date().toISOString();
 for(let i=0;i<30;i++)store.save('jobs',{id:'paused-'+i,kind:'selftest',owner:'local',paused:true,next_run:at,state:'pending',interval_ms:60000});
 store.save('jobs',{id:'later',kind:'selftest',owner:'local',paused:false,next_run:new Date(Date.now()+3600000).toISOString(),state:'pending',interval_ms:60000});
 store.save('jobs',{id:'other-owner',kind:'selftest',owner:'vps',paused:false,next_run:at,state:'pending',interval_ms:60000});
 let runs=0,scans=0;const scan=store.scan.bind(store);store.scan=()=>{scans++;return scan();};
 const scheduler=new Scheduler(store,{executor:async()=>{runs++;return {verified:true,silent:true};}});
 assert.deepEqual(await scheduler.tick(),[]);assert.equal(runs,0);assert.equal(scans,3);
 assert.equal(store.list('job_receipts').length,0);
 store.save('jobs',{id:'paused-0',paused:false});
 await scheduler.tick();assert.equal(runs,1);
 await scheduler.tick();assert.equal(runs,1);
 assert.equal(store.get('jobs','paused-1').paused,true);
});
