import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {backup,restoreSeparateCopy} from '../core/archives.mjs';

function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-archive-space-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const store=new Store(path.join(root,'live')),media=path.join(root,'media');fs.mkdirSync(media);
 store.save('notes',{id:'source',content:'Exact source bytes, including ü and \n.'});
 fs.mkdirSync(path.join(store.root,'assistant-state'));fs.writeFileSync(path.join(store.root,'assistant-state','one.bin'),Buffer.alloc(4096,137));
 fs.linkSync(path.join(store.root,'assistant-state','one.bin'),path.join(store.root,'assistant-state','two.bin'));
 fs.writeFileSync(path.join(media,'video.bin'),Buffer.from([0,255,7,19]));
 return {root,store,media,source:path.join(root,'backup')};
}
test('insufficient backup capacity creates no destination and preserves older backup bytes',t=>{
 const f=fixture(t);backup(f.store,f.media,f.source);
 const before=fs.readFileSync(path.join(f.source,'backup.json')),destination=path.join(f.root,'new-parent','backup');
 t.mock.method(fs,'statfsSync',()=>({bavail:0n,bsize:4096n}));
 assert.throws(()=>backup(f.store,f.media,destination),/Creating a backup needs .*Free at least/);
 assert.equal(fs.existsSync(path.dirname(destination)),false);
 assert.deepEqual(fs.readFileSync(path.join(f.source,'backup.json')),before);
});
test('restore capacity includes both staged and published logical bytes plus media before creating artifacts',t=>{
 const f=fixture(t);backup(f.store,f.media,f.source);
 const target=new Store(path.join(f.root,'empty')),before=fs.readdirSync(target.state);
 let logical=0,count=0;const manifest=JSON.parse(fs.readFileSync(path.join(f.source,'backup.json')));
 for(const entry of manifest.files){const copies=entry.path.startsWith('media/')?1:2;logical+=fs.statSync(path.join(f.source,entry.path)).size*copies;count+=copies;}
 // One byte below the complete requirement: hard-linked source names each need
 // full copies, and a small fixture still reserves 256 MiB for server writes.
 const needed=BigInt(logical+count*16384+1048576+256*1024*1024);
 let checked; t.mock.method(fs,'statfsSync',(location,options)=>{checked=location;assert.equal(options.bigint,true);return {bavail:needed-1n,bsize:1n};});
 assert.throws(()=>restoreSeparateCopy(target,f.source),/Restoring a separate copy needs/);
 assert.equal(checked,fs.realpathSync(target.state));
 assert.deepEqual(fs.readdirSync(target.state),before);
 assert.equal(fs.existsSync(path.join(target.state,'restored-copies')),false);
});
test('sufficient capacity performs a real separate restore and verifies exact durable and media bytes',t=>{
 const f=fixture(t);backup(f.store,f.media,f.source);const target=new Store(path.join(f.root,'empty'));
 t.mock.method(fs,'statfsSync',()=>({bavail:1024n**4n,bsize:1n}));
 const result=restoreSeparateCopy(target,f.source);assert.equal(result.verified,true);assert.equal(result.records,1);
 const manifest=JSON.parse(fs.readFileSync(path.join(f.source,'backup.json')));
 assert.equal(result.compared_files,manifest.files.length);
 for(const entry of manifest.files){const copied=entry.path.startsWith('media/')?path.join(result.media,entry.path.slice(6)):path.join(result.workspace,entry.path);assert.deepEqual(fs.readFileSync(copied),fs.readFileSync(path.join(f.source,entry.path)));}
 assert.equal(fs.existsSync(path.join(result.workspace,'.godspeed','transactions')),true);
});
