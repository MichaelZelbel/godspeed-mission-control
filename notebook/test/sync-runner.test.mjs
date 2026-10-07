import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {SyncRunner} from '../core/sync/runner.mjs';
test('a slow sync keeps the event loop available and concurrent requests share one worker',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-sync-runner-')),worker=path.join(root,'worker.mjs');
 fs.writeFileSync(worker,"setTimeout(()=>console.log(JSON.stringify({state:'synced'})),1000)");
 const runner=new SyncRunner(root,{worker}),first=runner.run(),second=runner.run();assert.equal(first,second);
 let responsive=false;await new Promise(resolve=>setTimeout(()=>{responsive=true;resolve();},20));assert.ok(responsive);assert.equal(runner.starts,1);
 assert.equal((await first).state,'synced');assert.equal(runner.pending,null);await runner.close();
});
test('an invalid sync address fails explicitly without enabling automatic retries',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-sync-invalid-')),runner=new SyncRunner(root);
 await assert.rejects(runner.configure('not-a-repository'),/GitHub repository address/);assert.equal(fs.existsSync(path.join(root,'.godspeed/sync-config.json')),false);await runner.close();
});
