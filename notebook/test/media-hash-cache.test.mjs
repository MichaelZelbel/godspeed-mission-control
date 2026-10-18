// SY12: an idle media reconcile round must not re-read and re-hash every
// already-downloaded file. The hash is cached by (path,size,mtime); only a
// changed file is recomputed, and a real change is still caught.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {Store,atomic,hash} from '../core/records/store.mjs';
import {MediaSync} from '../core/sync/media.mjs';

test('unchanged downloaded media is not re-hashed every round, and a real change is detected',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-media-cache-')),store=new Store(root),media=path.join(store.state,'media');
  fs.mkdirSync(media,{recursive:true});
  const mappings=[];
  for(let i=0;i<3;i++){const bytes=Buffer.alloc(4096,i+1),sha=hash(bytes),file=sha+'-video'+i+'.mp4';
    fs.writeFileSync(path.join(media,file),bytes);const m={path:'videos/video'+i+'.mp4',file,sha256:sha,size:bytes.length};mappings.push(m);
    atomic(path.join(media,hash(m.path)+'.mapping.json'),JSON.stringify(m));}
  const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(req.url==='/api/media/manifest'?{data:mappings}:{}));});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  atomic(path.join(store.state,'pair.json'),JSON.stringify({origin:'http://127.0.0.1:'+server.address().port,key:'k',offline:'all'}));
  const sync=new MediaSync(store,media);
  const realRead=fs.readFileSync;let mp4Reads=0;
  fs.readFileSync=(file,...rest)=>{if(typeof file==='string'&&file.endsWith('.mp4'))mp4Reads++;return realRead(file,...rest);};
  try{
    assert.equal((await sync.reconcile()).state,'synced');
    assert.equal(mp4Reads,3,'the first round hashes each file once');
    mp4Reads=0;
    assert.equal((await sync.reconcile()).state,'synced');
    assert.equal(mp4Reads,0,'an idle round must not re-hash unchanged media');
    // A real change (new bytes, new size and mtime) is recomputed and caught.
    fs.appendFileSync(path.join(media,mappings[1].file),Buffer.from([9]));
    mp4Reads=0;
    const after=await sync.reconcile();
    assert.ok(mp4Reads>0,'a changed file is re-hashed');
    assert.equal(after.state,'pending');assert.match(String(after.error),/integrity mismatch/);
  }finally{fs.readFileSync=realRead;server.close();}
});
