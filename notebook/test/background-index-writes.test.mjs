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
 const store=new Store(root,{device:'local'}),note=store.save('notes',{title:'Fictional plan',content:'before-marker'}),index=new SearchIndex(store);t.after(()=>{index.close();fs.rmSync(root,{recursive:true,force:true});});
 let started=performance.now();await index.rebuildBackground();const pass=performance.now()-started;
 fs.writeFileSync(path.join(root,'archives','batch-0','new-finding.md'),'# Fresh\nzebrafinch observation');
 let reads=0;const read=index.readBackground.bind(index);index.readBackground=async()=>{reads++;const documents=await read();return documents;};
 // A receipt several times during one read of the workspace.
 const every=Math.max(100,Math.round(pass/4));let writes=0;
 const writer=setInterval(()=>{writes++;const receipt=store.save('job_receipts',{job_id:'watch-sweeper',kind:'watch',state:'verified'});index.update([receipt]);},every);
 started=performance.now();const done=index.rebuildBackground().then(()=>performance.now()-started);
 // While the refresh reads, the note changes and goes into the index on its own.
 await new Promise(r=>setTimeout(r,Math.min(every,pass/3)));const changed=store.save('notes',{id:note.id,content:'after-marker'});index.update([changed]);
 const limit=Math.max(10000,pass*10),finished=await Promise.race([done,new Promise(r=>setTimeout(()=>r(null),limit))]);
 clearInterval(writer);await done;
 t.diagnostic(`one read ${pass.toFixed(0)} ms; refresh while writing every ${every} ms: ${finished===null?'unfinished':finished.toFixed(0)+' ms'}, ${reads} reads, ${writes} receipts`);
 assert.notEqual(finished,null,`the refresh was still reading after ${limit.toFixed(0)} ms (${reads} reads, ${writes} receipts written)`);
 assert.ok(reads<=2,'the refresh did not start over for writes it never indexes: '+reads+' reads');
 assert.equal(index.search('zebrafinch').length,1,'the file another program changed is searchable');
 assert.equal(index.search('after-marker').length,1);assert.equal(index.search('before-marker').length,0,'the refresh did not put back the older text it had read');
});
