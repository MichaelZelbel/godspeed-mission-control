import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store,hash} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';
import {NO_AI_ANALYSIS} from '../core/no-ai.mjs';

// #735: with no AI connected, Batch Media Analysis tried every upload, each
// failed for that one reason, and the panel showed only "1 failed".
function fixture(t,options){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-media-backfill-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const query=new QueryService(new Store(root));
  query.execute({table:'note_attachments',operation:'insert',values:{filename:'holiday.png',storage_path:'owner/holiday.png',mime_type:'image/png'}});
  return {root,query,domains:new Domains(query,options)};
}

test('with no AI the scan says so and the run is refused with the reason, counting nothing as failed',async t=>{
  const {query,domains}=fixture(t,{});
  const scan=await domains.invoke('backfill-media-analysis',{mode:'scan'});
  assert.equal(scan.ai_connected,false);
  assert.equal(scan.unanalyzed_total,1);
  await assert.rejects(domains.invoke('backfill-media-analysis',{mode:'run'}),{message:NO_AI_ANALYSIS});
  assert.deepEqual(query.rows('media_analysis'),[]);
});

test('with an AI connected the scan says so and the run analyses the upload as before',async t=>{
  const {root,query,domains}=fixture(t,{provider:async()=>({description:'A beach',extracted_text:'',topics:['holiday'],pages:[]})});
  const media=path.join(root,'media');fs.mkdirSync(media,{recursive:true});domains.mediaRoot=media;
  const bytes=Buffer.from('fake png bytes');fs.writeFileSync(path.join(media,'holiday.png'),bytes);
  fs.writeFileSync(path.join(media,hash('owner/holiday.png')+'.mapping.json'),JSON.stringify({file:'holiday.png',sha256:hash(bytes),contentType:'image/png'}));
  const scan=await domains.invoke('backfill-media-analysis',{mode:'scan'});
  assert.equal(scan.ai_connected,true);
  assert.equal(scan.unanalyzed_total,1);
  const run=await domains.invoke('backfill-media-analysis',{mode:'run'});
  assert.deepEqual({processed:run.processed,failed:run.failed},{processed:1,failed:0});
  const [row]=query.rows('media_analysis');
  assert.equal(row.storage_path,'owner/holiday.png');assert.equal(row.analysis_status,'complete');assert.equal(row.description,'A beach');
});
