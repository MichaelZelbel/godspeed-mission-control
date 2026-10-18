import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';
import {createService} from '../server/main.mjs';
const root=()=>fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-dashboard-write-'));
// A real second process holding the workspace lock, exactly as the sync worker
// and the assistant do on a server that is also running background work.
async function holdOtherWriter(workspace,ms=400){
 const child=spawn(process.execPath,['-e',"const fs=require('fs'),path=require('path'),file=path.join(process.argv[1],'.godspeed','workspace.lock');const fd=fs.openSync(file,'wx');fs.writeFileSync(fd,JSON.stringify({pid:process.pid}));fs.closeSync(fd);process.stdout.write('held');setTimeout(()=>{fs.unlinkSync(file)},Number(process.argv[2]));",workspace,String(ms)],{stdio:['ignore','pipe','pipe'],windowsHide:true});
 const closed=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error('Test writer failed: '+code)));});
 await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.stderr.once('data',d=>reject(Error(String(d))));});
 return {closed};
}
const call=(base,body)=>fetch(base+'/api/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});

test('an edited note still saves when a background writer takes the workspace between the wait and the write',async()=>{
 const service=await createService({root:root(),port:0}),base='http://127.0.0.1:'+service.address.port;
 try{
  const created=await(await call(base,{table:'notes',operation:'insert',values:{id:'dashboard-edit-contention',title:'Before',content:'Before body'},selection:'*',single:true})).json();
  assert.equal(created.error,null,'insert should succeed on an idle workspace');
  // The dashboard autosave arrives while the sync worker owns the lock. The
  // server waits for the writer, so the window the UI loses its edit in is the
  // gap between that wait returning and the write taking the lock itself.
  const original=service.store.waitForWriter.bind(service.store);let injected=false,other;
  service.store.waitForWriter=async options=>{await original(options);if(!injected){injected=true;other=await holdOtherWriter(service.store.root);}};
  const response=await call(base,{table:'notes',operation:'update',values:{title:'After',content:'After body'},filters:[['eq','id','dashboard-edit-contention']],selection:'*',single:true});
  const result=await response.json();
  assert.equal(response.status,200,'the edit must not be refused: '+JSON.stringify(result));
  assert.equal(result.error,null,'the edit must not report an error: '+JSON.stringify(result.error));
  await other.closed;
  assert.equal(service.store.get('notes','dashboard-edit-contention').content,'After body');
 }finally{await service.close();}
});
