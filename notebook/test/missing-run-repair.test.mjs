import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {procedure} from '../core/procedures.mjs';
test('a missing run produces one repair and closes only against that due run, with quiet recovered checks',async()=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-missed-repair-'))),query=new QueryService(store),due=new Date(Date.now()-7200000).toISOString(),id='fictional-missed';
 store.save('settings',{id:'installation',owner:'local'});store.save('jobs',{id,kind:'disk-check',owner:'local',paused:false,state:'pending',next_run:due});
 for(let n=0;n<2;n++)await procedure({kind:'job-check'},{store,query});const repair=query.rows('work_items')[0];assert.equal(query.rows('work_items').length,1);assert.equal(repair.state,'needs_review');
 store.save('job_receipts',{id:'unrelated-later',job_id:id,state:'verified',started_at:new Date().toISOString()});await procedure({kind:'job-check'},{store,query});assert.equal(store.get('work_items',repair.id).state,'needs_review');
 store.save('job_receipts',{id:repair.missing_receipt_id,job_id:id,state:'verified',result:{verified:true}});assert.equal((await procedure({kind:'job-check'},{store,query})).silent,true);assert.equal(store.get('work_items',repair.id).state,'verified');assert.equal(store.get('work_items',repair.id).evidence,repair.missing_receipt_id);
});
