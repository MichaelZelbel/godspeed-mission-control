import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';
import {NO_AI_ANALYSIS} from '../core/no-ai.mjs';

// #735: with no AI connected, Batch Media Analysis tried every upload, each
// failed for that one reason, and the panel showed only "1 failed".
function fixture(t,options){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-media-backfill-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const query=new QueryService(new Store(root));
  query.execute({table:'note_attachments',operation:'insert',values:{filename:'holiday.png',storage_path:'owner/holiday.png',mime_type:'image/png'}});
  return {query,domains:new Domains(query,options)};
}

test('with no AI the scan says so and the run is refused with the reason, counting nothing as failed',async t=>{
  const {query,domains}=fixture(t,{});
  const scan=await domains.invoke('backfill-media-analysis',{mode:'scan'});
  assert.equal(scan.ai_connected,false);
  assert.equal(scan.unanalyzed_total,1);
  await assert.rejects(domains.invoke('backfill-media-analysis',{mode:'run'}),{message:NO_AI_ANALYSIS});
  assert.deepEqual(query.rows('media_analysis'),[]);
});

test('with an AI connected the scan says so',async t=>{
  const {domains}=fixture(t,{provider:async()=>({})});
  const scan=await domains.invoke('backfill-media-analysis',{mode:'scan'});
  assert.equal(scan.ai_connected,true);
  assert.equal(scan.unanalyzed_total,1);
});
