import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createService } from '../server/main.mjs';
test('actual HTTP notebook CRUD, media preview, profile review, backup and restart',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-service-test-'));
  let service=await createService({root,port:0,provider:async()=> 'A concrete conversation draft.'});
  let base='http://127.0.0.1:'+service.address.port;
  const post=async(route,value)=>{const response=await fetch(base+'/api/'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data;};
  try{
    await post('setup',{goal:'Prepare a conversation',timezone:'Europe/Berlin'});
    const note=(await post('query',{table:'notes',operation:'insert',values:{title:'My note',content:'Local'},single:true})).data;
    const person=(await post('query',{table:'contacts',operation:'insert',values:{name:'Alex'},single:true})).data;
    await post('functions/normalize-profile',{action:'write_fact',contact_id:person.id,label:'Home city',value:'A town'});
    assert.equal((await post('query',{table:'world_claims'})).data.length,1);
    const form=new FormData();form.append('file',new Blob(['candidate media'],{type:'text/plain'}),'example.txt');form.append('path','owner/example.txt');
    const uploaded=await fetch(base+'/api/media/upload',{method:'POST',body:form});assert.equal(uploaded.status,200);
    const downloaded=await fetch(base+'/api/media/file/'+encodeURIComponent('owner/example.txt'));assert.equal(await downloaded.text(),'candidate media');
    const backup=await post('backup',{});assert.ok(fs.existsSync(backup.path));
    await service.close();service=await createService({root,port:0});base='http://127.0.0.1:'+service.address.port;
    assert.equal((await post('query',{table:'notes',filters:[['eq','id',note.id]],single:true})).data.content,'Local');
    const denied=await fetch(base+'/api/query',{method:'POST',headers:{'Content-Type':'application/json','Origin':'https://unrelated.example'},body:'{}'});assert.equal(denied.status,403);
  }finally{await service.close();}
});
