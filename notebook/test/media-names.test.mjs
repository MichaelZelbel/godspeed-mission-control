import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createService} from '../server/main.mjs';
import {mediaObjectName,mediaFileName} from '../core/media-names.mjs';

for(const key of Object.keys(process.env))if(/^(GODSPEED_|HERMES_)/.test(key))delete process.env[key];
const sha=value=>createHash('sha256').update(value).digest('hex');
async function start(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'gm-'));const mediaRoot=path.join(root,'m');
 process.env.GODSPEED_ASSISTANT_CONFIG=path.join(root,'no-assistant.json');
 const service=await createService({root,mediaRoot,port:0}),base='http://127.0.0.1:'+service.address.port;
 t.after(async()=>{await service.close();fs.rmSync(root,{recursive:true,force:true});});
 const upload=async(name,text)=>{const form=new FormData();form.set('file',new Blob([text],{type:'text/plain'}),name);form.set('path','chat/22222222-2222-4222-8222-222222222222/'+name);const r=await fetch(base+'/api/media/upload',{method:'POST',body:form});return {status:r.status,data:await r.json()};};
 return {root,mediaRoot,service,base,upload};
}

test('media names: one short sanitized name for every stored file',()=>{
 const digest='a'.repeat(64);
 for(const original of ['Ärztebrief.txt','notes..v2.txt','chat/x/'+'A'.repeat(140)+'.txt','.hidden','../../etc/passwd','Straße und Größe.pdf','---','']){
  const name=mediaObjectName(digest,original);
  assert.match(name,/^a{64}-[a-zA-Z0-9][a-zA-Z0-9_.-]*$/,original);assert.ok(name.length<=64+1+60,original);assert.ok(!name.includes('..'),original);
  assert.equal(mediaFileName(name),name);
 }
 assert.equal(mediaObjectName(digest,'Ärztebrief.txt'),digest+'-Aerztebrief.txt');
 assert.match(mediaObjectName(digest,'B'.repeat(200)+'.jpeg'),/\.jpeg$/);
 // Names written before 6 October 2026 (up to 64+1+181 characters) are still read.
 assert.equal(mediaFileName(digest+'-'+'A'.repeat(126)+'.txt'),digest+'-'+'A'.repeat(126)+'.txt');
 for(const bad of ['../x','a/b','a\\b','.','..','',null,'x'.repeat(300)])assert.throws(()=>mediaFileName(bad));
});

test('uploads with German, doubled-dot and long names save and read back, and the server keeps running',async t=>{
 const {base,upload}=await start(t);
 for(const name of ['Ärztebrief.txt','notes..v2.txt','A'.repeat(130)+'.txt']){
  const saved=await upload(name,'hello '+name);assert.equal(saved.status,200,name+': '+JSON.stringify(saved.data));
  const r=await fetch(base+'/api/media/file/'+encodeURIComponent(saved.data.data.path));assert.equal(r.status,200,name);assert.equal(await r.text(),'hello '+name);
 }
 assert.equal((await fetch(base+'/health')).status,200);
});

test('an old long name, a missing file and a missing blob answer 404 instead of stopping the server',async t=>{
 const {base,mediaRoot}=await start(t);
 const data='hello',name='A'.repeat(126)+'.txt',original='chat/22222222-2222-4222-8222-222222222222/'+name,file=sha(data)+'-'+name;
 fs.writeFileSync(path.join(mediaRoot,sha(original)+'.mapping.json'),JSON.stringify({path:original,file,sha256:sha(data),size:data.length,contentType:'text/plain'}));
 let r=await fetch(base+'/api/media/file/'+encodeURIComponent(original));assert.equal(r.status,404);await r.text();
 // The same old name with its file present is read.
 fs.writeFileSync(path.join(mediaRoot,file),data);
 r=await fetch(base+'/api/media/file/'+encodeURIComponent(original));assert.equal(r.status,200);assert.equal(await r.text(),data);
 const blob=sha('x')+'-photo.jpg';
 fs.writeFileSync(path.join(mediaRoot,sha('chat/x/photo.jpg')+'.mapping.json'),JSON.stringify({path:'chat/x/photo.jpg',file:blob,sha256:sha('x'),size:1,contentType:'image/jpeg'}));
 r=await fetch(base+'/api/media/blob/'+encodeURIComponent(blob));assert.equal(r.status,404);await r.text();
 r=await fetch(base+'/api/media/file/'+encodeURIComponent('chat/never-uploaded.png'));assert.equal(r.status,404);await r.text();
 assert.equal((await fetch(base+'/health')).status,200);
});

test('a file-system failure is logged, and the browser gets a plain message without server paths',async t=>{
 const {base,root}=await start(t);const logged=[],error=console.error;console.error=(...args)=>logged.push(args.join(' '));t.after(()=>{console.error=error;});
 const r=await fetch(base+'/api/conflicts/resolve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'00000000-0000-4000-8000-000000000000',choice:'current'})});
 const text=await r.text();assert.equal(r.status,400);
 for(const secret of [root,root.replaceAll('\\','/'),root.replaceAll('\\','\\\\'),'ENOENT'])assert.ok(!text.includes(secret),text);
 assert.ok(logged.some(line=>line.includes('ENOENT')||line.includes('no such file')),logged.join('\n'));
 // An ordinary refusal still reads as written.
 const plain=await fetch(base+'/api/restore-copy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({backup_id:'x'})});
 assert.equal((await plain.json()).error,'Choose one saved backup');
});
