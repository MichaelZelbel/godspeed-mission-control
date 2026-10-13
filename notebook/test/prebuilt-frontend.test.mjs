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

test('Docker frontend preserves UI imports of shared artwork and verifies/copies its same dist directory',()=>{
 const kit=path.resolve(import.meta.dirname,'../..'),docker=fs.readFileSync(path.join(kit,'docker/full-candidate/Dockerfile'),'utf8');
 const frontend=docker.split(/\nFROM /)[0],workdir=frontend.match(/^WORKDIR (\S+)$/m)?.[1];assert.ok(workdir);
 const copies=[...frontend.matchAll(/^COPY (\S+) (\S+)$/gm)].filter(([,source])=>source.endsWith('/')).map(([,source,destination])=>({source,destination:path.posix.resolve(workdir,destination)}));
 const resolveCopy=container=>{const copy=copies.filter(c=>container===c.destination||container.startsWith(c.destination+'/')).sort((a,b)=>b.destination.length-a.destination.length)[0];return copy?path.join(kit,copy.source,path.posix.relative(copy.destination,container)):null;};
 const component=path.posix.join(workdir,'src/components/collections/HabitProgress.tsx'),source=resolveCopy(component);assert.ok(source);assert.ok(fs.existsSync(source));
 for(const [,relative] of fs.readFileSync(source,'utf8').matchAll(/from "([^"]+\.svg)"/g)){
  const container=path.posix.resolve(path.posix.dirname(component),relative),asset=resolveCopy(container);
  assert.ok(asset&&fs.existsSync(asset),'Docker must copy the real shared artwork at '+container);
 }
 assert.ok(frontend.includes('node /verify-prebuilt-frontend.mjs '+workdir+' "$REVISION"'),'verified prebuilt root must be the UI folder');
 assert.ok(docker.includes('COPY --from=frontend '+path.posix.join(workdir,'dist')+' /opt/godspeed/kit/notebook/ui/dist'),'runtime must receive the verified/built UI dist');
});
