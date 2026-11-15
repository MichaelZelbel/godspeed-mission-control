import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createService} from '../server/main.mjs';
import {Store} from '../core/records/store.mjs';
import {SearchIndex} from '../core/index/search.mjs';

// Stopping the notebook during an update (23 October 2026, issue #29) logged
// "unhandledRejection ... Error: database is not open at SearchIndex.close":
// a second stop signal ran the shutdown again while the first was still on its
// way, and closing the search index a second time threw.
test('the search index can be closed twice',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-index-close-'));
  try{
    const index=new SearchIndex(new Store(root));
    index.close();
    assert.doesNotThrow(()=>index.close());
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('the notebook can be stopped twice, as two stop signals do',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-stop-twice-'));
  const service=await createService({root,port:0});
  await Promise.all([service.close(),service.close()]);
  await service.close();
});
