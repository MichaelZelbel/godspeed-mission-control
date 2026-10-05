import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {Store} from '../core/records/store.mjs';import {missingRuns} from '../core/missing-runs.mjs';
test('independent missing-run reads honor owner, pauses and retained attempted evidence without writing anything',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-missing-runs-')),store=new Store(root),now=Date.now(),due=new Date(now-7200000).toISOString();
 store.save('settings',{id:'installation',owner:'vps'});
 for(const [id,fields] of [['missed',{}],['paused',{paused:true}],['other',{owner:'local'}],['approval',{state:'awaiting_approval'}],['review',{state:'needs_review'}],['finished',{}],['uncertain',{outward:true}],['future',{next_run:new Date(now+60000).toISOString()}]])store.save('jobs',{id,kind:'disk-check',state:'pending',owner:'vps',paused:false,next_run:due,...fields});
 for(const [id,state] of [['finished','verified'],['uncertain','attempted']])store.save('job_receipts',{id:id+'-'+Date.parse(due),job_id:id,state});
 const files=fs.readdirSync(path.join(root,'notebook/jobs')).map(f=>path.join(root,'notebook/jobs',f)),before=files.map(f=>[fs.readFileSync(f,'utf8'),fs.statSync(f).mtimeMs]);
 const result=missingRuns(root,now,'vps');assert.deepEqual(result.map(r=>r.job_id),['missed']);assert.equal(result[0].receipt_state,'missing');assert.deepEqual(files.map(f=>[fs.readFileSync(f,'utf8'),fs.statSync(f).mtimeMs]),before);
 assert.deepEqual(missingRuns(root,now,'local'),[]);assert.deepEqual(missingRuns(root,now-7000000,'vps'),[]);store.save('job_receipts',{id:'missed-'+Date.parse(due),job_id:'missed',state:'verified'});assert.deepEqual(missingRuns(root,now,'vps'),[]);
});
