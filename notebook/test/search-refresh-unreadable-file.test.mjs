import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {performance} from 'node:perf_hooks';
import {Store} from '../core/records/store.mjs';import {SearchIndex} from '../core/index/search.mjs';

// A file the notebook may not read, named in the same watcher batch as a
// readable note, used to throw out the whole batch: the note was not searchable.
test('a readable note refreshed with an unreadable file is searchable within 5 s',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-unreadable-'));
 t.after(()=>{fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const store=new Store(root,{device:'local'}),index=new SearchIndex(store);t.after(()=>index.close());
 fs.mkdirSync(path.join(root,'journal'));
 const locked=path.join(root,'journal','locked.md'),good=path.join(root,'journal','good.md');
 fs.writeFileSync(locked,'# Locked\nsecretword');fs.writeFileSync(good,'# Good\nzebrafinch neighbour');
 // Make the read fail the way chmod 000 does (also holds when run as root).
 const read=fs.readFileSync;t.mock.method(fs,'readFileSync',(file,...rest)=>{if(String(file)===locked)throw Object.assign(new Error('EACCES'),{code:'EACCES'});return read(file,...rest);});
 const started=performance.now();
 index.refreshFiles(['journal/locked.md','journal/good.md']);
 assert.ok(performance.now()-started<5000,'the refresh took under 5 s');
 assert.equal(index.search('zebrafinch').length,1,'the readable neighbour is found');
 assert.equal(index.search('secretword').length,0,'the unreadable file is skipped');
});
