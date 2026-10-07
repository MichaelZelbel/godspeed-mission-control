import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createService} from '../server/main.mjs';

async function service(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-hardening-')),uiRoot=path.join(root,'ui');fs.mkdirSync(uiRoot);fs.writeFileSync(path.join(uiRoot,'index.html'),'<!doctype html><title>Notebook</title>');
  const s=await createService({root:path.join(root,'workspace'),port:0,uiRoot});
  t.after(async()=>{await s.close();fs.rmSync(root,{recursive:true,force:true});});
  return {s,base:'http://127.0.0.1:'+s.address.port};
}

// The notebook's pages could be shown inside another site's frame, where a
// page made to look like something else gets the owner to click its
// buttons (7 October 2026). Only the notebook itself may frame them.
test('the notebook pages may be framed by the notebook only',async t=>{
  const {base}=await service(t);
  const response=await fetch(base+'/');
  assert.equal(response.status,200);
  assert.match(response.headers.get('content-security-policy')||'',/frame-ancestors 'self'/);
  assert.equal(response.headers.get('x-frame-options'),'SAMEORIGIN');
});
