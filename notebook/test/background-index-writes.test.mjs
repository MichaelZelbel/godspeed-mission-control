import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {performance} from 'node:perf_hooks';
import {Store} from '../core/records/store.mjs';import {SearchIndex} from '../core/index/search.mjs';

// A write bumped the refresh's counter even for records that are never
// searched (run receipts), and a refresh that saw the counter move started
// over: with a routine writing more often than one read of the workspace
// takes, the ten-minute refresh never finished and a file changed by another
// program never became searchable.
test('a full refresh finishes while the notebook keeps writing, and keeps the newer rows it wrote',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-refresh-writes-'));
 for(let i=0;i<400;i++){const folder=path.join(root,'archives','batch-'+(i%20));fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'entry-'+i+'.md'),'# Entry '+i+'\n'+'Archived journal text about the knee doctor and groceries. '.repeat(30));}
 const store=new Store(root,{device:'local'}),note=store.save('notes',{title:'Fictional plan',content:'before-marker'}),index=new SearchIndex(store);t.after(async()=>{await index.close();fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 let started=performance.now();await index.rebuildBackground();const pass=performance.now()-started;
 fs.writeFileSync(path.join(root,'archives','batch-0','new-finding.md'),'# Fresh\nzebrafinch observation');
 let reads=0;const read=index.readBackground.bind(index);index.readBackground=async()=>{reads++;const documents=await read();return documents;};
 let writes=0,writing=true;const write=()=>{writes++;const receipt=store.save('job_receipts',{job_id:'watch-sweeper',kind:'watch',state:'verified'});index.update([receipt]);};
 started=performance.now();write();const save=performance.now()-started;writes=0;
 // A receipt several times during one read of the workspace: one every hundred
 // files it reads. A receipt is saved synchronously and syncs to disk many
 // times, over 100 ms on a busy disk; a writer on a clock that fires again as
 // soon as a save ends leaves the refresh one step per save and it never ends.
 const breathe=index.breathe.bind(index);let files=0;index.breathe=async()=>{if(writing&&++files%100===0)write();return breathe();};
 started=performance.now();const done=index.rebuildBackground().then(()=>performance.now()-started);
 // While the refresh reads, the note changes and goes into the index on its own.
 await new Promise(r=>setTimeout(r,pass/4));const changed=store.save('notes',{id:note.id,content:'after-marker'});index.update([changed]);
 const limit=20*(pass+5*save),finished=await Promise.race([done,new Promise(r=>setTimeout(()=>r(null),limit))]);
 writing=false;await done;
 t.diagnostic(`one read ${pass.toFixed(0)} ms, one receipt ${save.toFixed(0)} ms; refresh while writing: ${finished===null?'unfinished':finished.toFixed(0)+' ms'}, ${reads} reads, ${writes} receipts`);
 assert.notEqual(finished,null,`the refresh was still reading after ${limit.toFixed(0)} ms (${reads} reads, ${writes} receipts written)`);
 assert.ok(reads<=2,'the refresh did not start over for writes it never indexes: '+reads+' reads');
 assert.equal(index.search('zebrafinch').length,1,'the file another program changed is searchable');
 assert.equal(index.search('after-marker').length,1);assert.equal(index.search('before-marker').length,0,'the refresh did not put back the older text it had read');
});
