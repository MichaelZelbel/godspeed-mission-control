// Pictures and PDFs travel with the private GitHub copy (media-store.mjs):
// each item of 50 MB or less is also kept in notebook/_media/, named by its
// content hash, so a second computer that has only the notebook serves it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createService} from '../server/main.mjs';
import {mediaObjectName} from '../core/media-names.mjs';
import {CARRY_LIMIT,carriedName,carryMedia,findMedia} from '../core/media-store.mjs';

for(const key of Object.keys(process.env))if(/^(GODSPEED_|HERMES_)/.test(key))delete process.env[key];
const sha=value=>createHash('sha256').update(value).digest('hex');
const picture=Buffer.from('89504e470d0a1a0a0000000d49484452','hex');
const picturePath='user/33333333-3333-4333-8333-333333333333.png';
const workspace=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'gm-carried-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;};
async function start(t,root,mediaRoot=path.join(root,'m'),device='local'){
  process.env.GODSPEED_ASSISTANT_CONFIG=path.join(root,'no-assistant.json');
  const service=await createService({root,mediaRoot,port:0,device}),base='http://127.0.0.1:'+service.address.port;
  let open=true;const close=async()=>{if(open){open=false;await service.close();}};t.after(close);
  const upload=async(original,data,type='image/png')=>{const form=new FormData();form.set('file',new Blob([data],{type}),path.basename(original));form.set('path',original);const r=await fetch(base+'/api/media/upload',{method:'POST',body:form});return {status:r.status,body:await r.json()};};
  const read=async original=>{const r=await fetch(base+'/api/media/file/'+encodeURIComponent(original));return {status:r.status,type:r.headers.get('content-type'),bytes:Buffer.from(await r.arrayBuffer())};};
  return {service,base,mediaRoot,carried:path.join(root,'notebook','_media'),upload,read,close};
}
const snapshot=dir=>Object.fromEntries(fs.readdirSync(dir).sort().map(name=>[name,sha(fs.readFileSync(path.join(dir,name)))]));

test('a picture saved through the upload lands in notebook/_media and is served from there',async t=>{
  const root=workspace(t),{upload,read,carried,mediaRoot}=await start(t,root);
  assert.equal((await upload(picturePath,picture)).status,200);
  assert.deepEqual(fs.readFileSync(path.join(carried,sha(picture)+'.png')),picture);
  const mapping=JSON.parse(fs.readFileSync(path.join(carried,sha(picturePath)+'.mapping.json'),'utf8'));
  assert.deepEqual(mapping,{path:picturePath,file:sha(picture)+'.png',sha256:sha(picture),size:picture.length,contentType:'image/png'});
  // The media root keeps its own copy as before.
  assert.ok(fs.existsSync(path.join(mediaRoot,mediaObjectName(sha(picture),picturePath))));
  assert.ok(fs.existsSync(path.join(mediaRoot,sha(picturePath)+'.mapping.json')));
  const served=await read(picturePath);
  assert.equal(served.status,200);assert.equal(served.type,'image/png');assert.deepEqual(served.bytes,picture);
});

test('a second install with only the notes folder serves the same picture, and a removal there travels',async t=>{
  const first=workspace(t),one=await start(t,first);
  assert.equal((await one.upload(picturePath,picture)).status,200);await one.close();
  const second=workspace(t);fs.cpSync(path.join(first,'notebook'),path.join(second,'notebook'),{recursive:true});
  const two=await start(t,second);
  assert.deepEqual(fs.readdirSync(two.mediaRoot),[],'the second install has an empty media root');
  const served=await two.read(picturePath);
  assert.equal(served.status,200);assert.equal(served.type,'image/png');assert.deepEqual(served.bytes,picture);
  const removed=await fetch(two.base+'/api/media/remove',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({paths:[picturePath]})});
  assert.equal(removed.status,200);await removed.json();
  assert.equal((await two.read(picturePath)).status,404);
  assert.ok(JSON.parse(fs.readFileSync(path.join(two.carried,sha(picturePath)+'.mapping.json'),'utf8')).removed_at,'the removal is in the carried mapping, which travels');
});

test('the first run copies the existing media once and changes nothing in the media root',async t=>{
  const root=workspace(t),mediaRoot=path.join(root,'m'),carried=path.join(root,'notebook','_media');fs.mkdirSync(mediaRoot,{recursive:true});
  const live='chat/old/Scan 1.pdf',gone='chat/old/gone.jpg',pdf=Buffer.from('%PDF-1.4 synthetic'),jpg=Buffer.from('synthetic jpeg');
  for(const [original,data,type,extra] of [[live,pdf,'application/pdf',{}],[gone,jpg,'image/jpeg',{removed_at:'2026-11-01T00:00:00.000Z'}]]){
    const file=mediaObjectName(sha(data),original);fs.writeFileSync(path.join(mediaRoot,file),data);
    fs.writeFileSync(path.join(mediaRoot,sha(original)+'.mapping.json'),JSON.stringify({path:original,file,sha256:sha(data),size:data.length,contentType:type,removal_review:'kept here',...extra}));
  }
  const before=snapshot(mediaRoot);
  assert.deepEqual(carryMedia({mediaRoot,carried}),{copied:2},'one file and its mapping');
  assert.deepEqual(fs.readdirSync(carried).sort(),[sha(pdf)+'.pdf',sha(live)+'.mapping.json'].sort(),'a removed item is not carried');
  assert.equal(JSON.parse(fs.readFileSync(path.join(carried,sha(live)+'.mapping.json'),'utf8')).removal_review,undefined,'one computer\'s own decision stays there');
  assert.deepEqual(carryMedia({mediaRoot,carried}),{copied:0});
  assert.deepEqual(snapshot(mediaRoot),before,'nothing in the media root was moved, changed or deleted');
  const {read}=await start(t,root,mediaRoot);
  assert.deepEqual((await read(live)).bytes,pdf);
  assert.deepEqual(snapshot(mediaRoot),before);
});

test('a file over 50 MB stays on this computer and its library item says so',async t=>{
  const root=workspace(t),{base,upload,read,carried,mediaRoot}=await start(t,root);
  const big=Buffer.alloc(CARRY_LIMIT+1,7),original='user/44444444-4444-4444-8444-444444444444.mp4';
  assert.equal((await upload(original,big,'video/mp4')).status,200);
  assert.deepEqual(fs.existsSync(carried)?fs.readdirSync(carried):[],[],'neither the file nor its mapping is carried');
  assert.ok(fs.existsSync(path.join(mediaRoot,mediaObjectName(sha(big),original))));
  const served=await read(original);assert.equal(served.status,200);assert.equal(served.bytes.length,big.length);
  assert.equal((await upload(picturePath,picture)).status,200);
  const kept=await(await fetch(base+'/api/media/kept-here')).json();
  assert.deepEqual(kept.data,[{path:original,size:big.length}]);
});

test('stored names come only from the content hash and a known extension',async t=>{
  const digest='b'.repeat(64);
  assert.equal(carriedName(digest,'../../Ärzte brief.MD'),digest);
  assert.equal(carriedName(digest,'notes.json'),digest);
  assert.equal(carriedName(digest,'x.JPEG'),digest+'.jpeg');
  assert.equal(carriedName(digest,'folder.png/no extension'),digest);
  assert.throws(()=>carriedName('../x','a.png'));
  // A mapping from another computer is never trusted with a file name.
  const root=workspace(t),carried=path.join(root,'notebook','_media'),mediaRoot=path.join(root,'m');fs.mkdirSync(carried,{recursive:true});fs.mkdirSync(mediaRoot);
  fs.writeFileSync(path.join(carried,sha(picture)+'.png'),picture);
  fs.writeFileSync(path.join(carried,sha(picturePath)+'.mapping.json'),JSON.stringify({path:picturePath,file:'../../etc/passwd',sha256:sha(picture),size:picture.length,contentType:'image/png'}));
  assert.equal(findMedia({mediaRoot,carried},picturePath).file,path.join(carried,sha(picture)+'.png'));
  fs.writeFileSync(path.join(carried,sha('other')+'.mapping.json'),JSON.stringify({path:picturePath,file:sha(picture)+'.png',sha256:sha(picture)}));
  assert.equal(findMedia({mediaRoot,carried},'other'),null,'a mapping that names another path is not read');
});

test('a removal made in the media root before the copy still hides the item',async t=>{
  const root=workspace(t),{upload,read,carried,mediaRoot}=await start(t,root);
  assert.equal((await upload(picturePath,picture)).status,200);
  // An older computer's removal arrives in the media root only (pairing tombstone).
  const file=path.join(mediaRoot,sha(picturePath)+'.mapping.json');
  fs.writeFileSync(file,JSON.stringify({...JSON.parse(fs.readFileSync(file,'utf8')),removed_at:'2026-11-13T00:00:00.000Z'}));
  assert.equal((await read(picturePath)).status,404);
  assert.deepEqual(carryMedia({mediaRoot,carried}),{copied:1});
  assert.equal(JSON.parse(fs.readFileSync(path.join(carried,sha(picturePath)+'.mapping.json'),'utf8')).removed_at,'2026-11-13T00:00:00.000Z');
});

test('media sync with the server takes a file the notebook already carries instead of downloading it',async t=>{
  const vpsRoot=workspace(t),localRoot=workspace(t),vps=await start(t,vpsRoot,undefined,'vps'),local=await start(t,localRoot);
  const created=await(await fetch(vps.base+'/api/pair/create',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).json();
  await local.service.mediaSync.pair(vps.base,created.code);
  assert.equal((await vps.upload(picturePath,picture)).status,200);
  fs.mkdirSync(local.carried,{recursive:true});fs.copyFileSync(path.join(vps.carried,sha(picture)+'.png'),path.join(local.carried,sha(picture)+'.png'));
  const asked=[],request=local.service.mediaSync.request.bind(local.service.mediaSync);
  local.service.mediaSync.request=(route,options)=>{asked.push(route);return request(route,options);};
  const result=await local.service.mediaSync.reconcile();
  assert.equal(result.state,'synced');assert.equal(result.found,1);assert.equal(result.downloaded,0);
  assert.ok(!asked.some(route=>route.startsWith('/api/media/blob/')),'nothing was downloaded');
  assert.deepEqual(fs.readFileSync(path.join(local.mediaRoot,mediaObjectName(sha(picture),picturePath))),picture);
});
