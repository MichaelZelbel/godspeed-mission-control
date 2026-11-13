import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createService} from '../server/main.mjs';
import {MEDIA_UPLOAD_MAX_BYTES,MEDIA_UPLOAD_MAX_MB} from '../shared/media-limits.mjs';

// #528: the note editor refused files over 20 MB while /api/media/upload took up to about
// 100 MB, so the items over 50 MB kept on one computer only could not be added in the app. Both
// now hold files to one number, shared/media-limits.mjs. This checks the server against it; the
// editor's own test (ui/src/lib/upload-attachment.limit.test.ts) checks the editor against it.
test('/api/media/upload takes a file of exactly the shared limit and refuses one byte more, naming the limit',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-upload-limit-')),service=await createService({root,port:0}),base='http://127.0.0.1:'+service.address.port;
  const upload=async(size,name)=>{const form=new FormData();form.set('file',new Blob([new Uint8Array(size)],{type:'video/mp4'}),name);form.set('path','owner/'+name);const r=await fetch(base+'/api/media/upload',{method:'POST',body:form});return {status:r.status,body:await r.json()};};
  try{
    assert.ok(MEDIA_UPLOAD_MAX_BYTES>50*1024*1024,'above the size at which a file is kept on one computer only');
    const taken=await upload(MEDIA_UPLOAD_MAX_BYTES,'at-the-limit.mp4');assert.equal(taken.status,200,JSON.stringify(taken.body));
    const refused=await upload(MEDIA_UPLOAD_MAX_BYTES+1,'one-byte-over.mp4');assert.equal(refused.status,413);
    assert.equal(refused.body.error,`This file is too large. Max is ${MEDIA_UPLOAD_MAX_MB} MB.`);
  }finally{await service.close();fs.rmSync(root,{recursive:true,force:true});}
});
