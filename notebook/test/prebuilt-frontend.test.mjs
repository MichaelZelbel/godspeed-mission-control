import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';
import {verifyFrontend} from '../scripts/verify-prebuilt-frontend.mjs';
test('matched package frontend rejects stale source, changed bytes, extra assets and escaped paths',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-frontend-')),revision='a'.repeat(40),content='<p>Fictional interface</p>',manifest={kitCommit:revision,files:[{path:'kit/notebook/ui/dist/index.html',sha256:createHash('sha256').update(content).digest('hex')}]};
 fs.mkdirSync(path.join(root,'dist'));fs.writeFileSync(path.join(root,'dist/index.html'),content);const file=path.join(root,'godspeed-prebuilt-frontend.json');fs.writeFileSync(file,JSON.stringify(manifest));
 assert.equal(verifyFrontend(root,revision).verified_files,1);assert.throws(()=>verifyFrontend(root,'b'.repeat(40)),/another source/);
 fs.writeFileSync(path.join(root,'dist/index.html'),'Changed');assert.throws(()=>verifyFrontend(root,revision),/bytes differ/);fs.writeFileSync(path.join(root,'dist/index.html'),content);
 fs.writeFileSync(path.join(root,'dist/unexpected.js'),'Unexpected');assert.throws(()=>verifyFrontend(root,revision),/bytes differ/);
 manifest.files[0].path='kit/notebook/ui/dist/../outside.txt';fs.writeFileSync(file,JSON.stringify(manifest));assert.throws(()=>verifyFrontend(root,revision),/Invalid frontend/);
});
