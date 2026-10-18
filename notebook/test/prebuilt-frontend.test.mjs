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

// Every UI file is scanned, not one component: the habit artwork (13 October) and then the impact
// scale (17 October) each broke the image build because the UI imported a shared file the Docker
// frontend stage had not copied, while every local build, which sees the whole repository, passed.
test('Docker frontend copies every file the UI imports from outside its own folder and verifies/copies its same dist directory',()=>{
 const kit=path.resolve(import.meta.dirname,'../..'),docker=fs.readFileSync(path.join(kit,'docker/full-candidate/Dockerfile'),'utf8');
 const frontend=docker.split(/\nFROM /)[0],workdir=frontend.match(/^WORKDIR (\S+)$/m)?.[1];assert.ok(workdir);
 const copies=[...frontend.matchAll(/^COPY (\S+) (\S+)$/gm)].filter(([,source])=>source.endsWith('/')).map(([,source,destination])=>({source,destination:path.posix.resolve(workdir,destination)}));
 const resolveCopy=container=>{const copy=copies.filter(c=>container===c.destination||container.startsWith(c.destination+'/')).sort((a,b)=>b.destination.length-a.destination.length)[0];return copy?path.join(kit,copy.source,path.posix.relative(copy.destination,container)):null;};
 const ui=resolveCopy(workdir),files=[];assert.ok(ui&&fs.existsSync(path.join(ui,'src')));
 const walk=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())walk(file);else if(/\.(tsx?|jsx?|mjs)$/.test(entry.name))files.push(file);}};walk(path.join(ui,'src'));
 let shared=0;
 for(const file of files){
  const inContainer=path.posix.join(workdir,path.relative(ui,file).split(path.sep).join('/'));
  for(const [,relative] of fs.readFileSync(file,'utf8').matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["'](\.\.?\/[^"']+)["']/g)){
   const container=path.posix.resolve(path.posix.dirname(inContainer),relative);
   if(container===workdir||container.startsWith(workdir+'/'))continue;
   shared++;const copied=resolveCopy(container);
   assert.ok(copied&&fs.existsSync(copied),path.relative(kit,file)+' imports '+relative+', so the Docker frontend stage must copy it to '+container);
  }
 }
 assert.ok(shared>0,'the scan must see the UI imports of shared files');
 assert.ok(frontend.includes('node /verify-prebuilt-frontend.mjs '+workdir+' "$REVISION"'),'verified prebuilt root must be the UI folder');
 assert.ok(docker.includes('COPY --from=frontend '+path.posix.join(workdir,'dist')+' /opt/godspeed/kit/notebook/ui/dist'),'runtime must receive the verified/built UI dist');
});
