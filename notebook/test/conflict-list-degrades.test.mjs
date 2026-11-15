// SY13: one broken conflict must not throw away the whole /api/conflicts list.
// A stale-write conflict whose record no longer exists makes conflictView throw;
// before the fix the route mapped every conflict through it and 400'd the list,
// so a real pending conflict could never be reached and resolved.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store,atomic} from '../core/records/store.mjs';
import {createService} from '../server/main.mjs';

function fixture(){return new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-conflict-list-')));}
function write(store,conflict){atomic(path.join(store.root,'conflicts',conflict.id+'.json'),JSON.stringify(conflict));return conflict;}

test('a conflict whose record is gone is shown degraded and the rest of the list still loads',async()=>{
  const store=fixture();
  // One ordinary, resolvable conflict about a live note.
  const note=store.save('notes',{title:'Live note',content:'Original'});
  write(store,{id:'live-one',kind:'stale-write',type:'notes',record_id:note.id,local:{...note,content:'Pending'},remote:note});
  // One conflict whose record no longer exists: conflictView throws for it.
  write(store,{id:'gone-one',kind:'stale-write',type:'notes',record_id:'note-that-was-removed'});
  const service=await createService({root:store.root,port:0}),base='http://127.0.0.1:'+service.address.port;
  try{
    const res=await fetch(base+'/api/conflicts'),body=await res.json();
    assert.equal(res.status,200,'the list must load even with one broken conflict');
    assert.equal(body.data.length,2,'both conflicts are listed');
    const gone=body.data.find(c=>c.id==='gone-one'),live=body.data.find(c=>c.id==='live-one');
    assert.ok(gone&&gone.degraded===true,'the broken conflict is marked degraded');
    assert.equal(gone.path,'notes/note-that-was-removed');
    assert.ok(live&&/Original/.test(live.current),'the healthy conflict still carries its current version');
  }finally{await service.close();}
});
