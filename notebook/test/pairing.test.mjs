import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createService} from '../server/main.mjs';
const root=()=>fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-pair-'));
test('one-time candidate pairing transfers verified media, retains offline files and keeps VPS schedule ownership',async()=>{
  const vps=await createService({root:root(),device:'vps',port:0}),local=await createService({root:root(),device:'local',port:0});
  const base='http://127.0.0.1:'+vps.address.port;
  try{
    const created=await(await fetch(base+'/api/pair/create',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).json();
    await local.mediaSync.pair(base,created.code);
    const replay=await fetch(base+'/api/pair/claim',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:created.code})});assert.equal(replay.status,401);
    const form=new FormData();form.append('file',new Blob(['synthetic binary'],{type:'text/plain'}),'example.txt');form.append('path','example.txt');assert.equal((await fetch(base+'/api/media/upload',{method:'POST',body:form})).status,200);
    assert.equal((await local.mediaSync.reconcile()).downloaded,1);const mapping=local.mediaSync.manifest()[0];assert.equal(fs.readFileSync(path.join(local.mediaSync.root,mapping.file),'utf8'),'synthetic binary');
    local.scheduler.configure({goal:'Keep offline records',owner:'vps'});assert.deepEqual(await local.scheduler.tick(),[]);
    await vps.close();assert.equal((await local.mediaSync.reconcile()).state,'pending');assert.equal(fs.readFileSync(path.join(local.mediaSync.root,mapping.file),'utf8'),'synthetic binary');
  }finally{if(vps.server.listening)await vps.close();await local.close();}
});
