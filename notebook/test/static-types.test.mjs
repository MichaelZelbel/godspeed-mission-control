import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createService} from '../server/main.mjs';

// The PDF reader's worker is pdf.worker.min-<hash>.mjs. Served as
// application/octet-stream, the browser refused it and no PDF could be read.
test('built module scripts, workers and the app manifest are served with types a browser accepts',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-static-')),ui=path.join(root,'.ui');fs.mkdirSync(path.join(ui,'assets'),{recursive:true});
  fs.writeFileSync(path.join(ui,'index.html'),'<html></html>');fs.writeFileSync(path.join(ui,'assets','pdf.worker.min-x.mjs'),'export {}');fs.writeFileSync(path.join(ui,'manifest.webmanifest'),'{}');fs.writeFileSync(path.join(ui,'assets','a.wasm'),'');
  const service=await createService({root,uiRoot:ui,port:0}),base='http://127.0.0.1:'+service.address.port;
  try{
    for(const [file,type] of [['/assets/pdf.worker.min-x.mjs','text/javascript'],['/manifest.webmanifest','application/manifest+json'],['/assets/a.wasm','application/wasm']]){
      const response=await fetch(base+file);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),type,file);await response.text();
    }
  }finally{await service.close();}
});

test('built files named by their content are kept by the browser, the page itself is always checked',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-static-cache-')),ui=path.join(root,'.ui');fs.mkdirSync(path.join(ui,'assets'),{recursive:true});
  fs.writeFileSync(path.join(ui,'index.html'),'<html></html>');fs.writeFileSync(path.join(ui,'assets','index-abc123.js'),'export {}');
  const service=await createService({root,uiRoot:ui,port:0}),base='http://127.0.0.1:'+service.address.port;
  try{
    const asset=await fetch(base+'/assets/index-abc123.js');assert.match(asset.headers.get('cache-control'),/immutable/);await asset.text();
    const page=await fetch(base+'/dashboard/notes');assert.equal(page.headers.get('cache-control'),'no-cache');await page.text();
  }finally{await service.close();}
});
