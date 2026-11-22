import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store,atomic} from '../core/records/store.mjs';
import {Scheduler} from '../core/jobs/scheduler.mjs';
import {runSpendGuard} from '../core/spend-guard.mjs';
import {BRIEFING_SOURCE_TABLES,briefingReads} from '../core/briefing.mjs';

// #974: a connected OpenRouter key makes the server save the spend-guard job (ensureSpendGuard in
// server/main.mjs), whose receipt stays when a low balance makes it noisy. The brief must not read it.
test('after the first start with a key connected and a low balance, the brief reads nothing',async()=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-first-start-')));
 store.save('settings',{id:'installation',owner:'local',timezone:'UTC',delivery:'notebook'});
 atomic(path.join(store.state,'provider.json'),JSON.stringify({url:'https://openrouter.ai/api/v1/chat/completions',key:'sk-fixture',model:'fixture/model'}));
 store.save('jobs',{id:'spend-guard',kind:'spend-guard',owner:store.get('settings','installation').owner,paused:false,state:'pending',next_run:new Date().toISOString(),interval_ms:3600000});
 const fetcher=async url=>new Response(JSON.stringify(String(url).endsWith('/key')?{data:{usage_daily:0,limit:100,limit_remaining:90}}:{data:{balance:1}}),{status:200,headers:{'content-type':'application/json'}});
 const scheduler=new Scheduler(store,{device:'local',executor:job=>runSpendGuard({store,fetcher})});
 await scheduler.tick();
 const kept=store.list('job_receipts');
 assert.deepEqual(kept.map(r=>r.kind),['spend-guard']);
 for(const table of BRIEFING_SOURCE_TABLES)assert.deepEqual(briefingReads(table,store.list(table)),[],table);
});
