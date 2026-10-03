import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {jobExecutor} from '../core/runtime.mjs';
test('brief sources are prepared before writing and failed judgment prevents delivery',async()=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-brief-'))),query=new QueryService(store),calls=[];
 store.save('health_observations',{metric:'Fictional energy',value:6,observed_at:new Date().toISOString()});
 const provider=async i=>{calls.push(i);return i.kind==='brief-verification'?JSON.stringify({passed:false,reason:'Invented result absent from sources'}):'Fictional energy improved to 10.';};
 await assert.rejects(jobExecutor(provider,query)({kind:'morning-brief',id:'brief'},{store,settings:{}}),/Invented/);assert.equal(query.rows('notes').filter(n=>n.source_app==='morning-brief').length,0);
 assert.ok(calls.find(i=>i.kind==='morning-brief').context.health.some(h=>h.value===6));assert.ok(query.rows('job_receipts').some(r=>r.kind==='brief-verification'&&r.state==='failed'));
});
