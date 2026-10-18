import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createService} from '../server/main.mjs';

for(const key of Object.keys(process.env))if(/^(GODSPEED_|HERMES_)/.test(key))delete process.env[key];

test('a shared note stops being public when it is trashed, and restoring it does not publish it again',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-share-'));process.env.GODSPEED_ASSISTANT_CONFIG=path.join(root,'no-assistant.json');
 const service=await createService({root,port:0}),base='http://127.0.0.1:'+service.address.port;
 t.after(async()=>{await service.close();fs.rmSync(root,{recursive:true,force:true});});
 const post=async(input)=>(await (await fetch(base+'/api/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)})).json()).data;
 const shared=async token=>(await fetch(base+'/api/shared-note?token='+token)).status;
 const note=(await post({table:'notes',operation:'insert',values:{title:'Fictional plan',content:'Fictional private content'}}))[0];
 await post({table:'shared_notes',operation:'insert',values:{note_id:note.id,share_token:'fictional-share-token',is_active:true}});
 assert.equal(await shared('fictional-share-token'),200);
 const current=(await post({table:'notes',operation:'select',filters:[['eq','id',note.id]]}))[0];
 await post({table:'notes',operation:'update',values:{is_trashed:true,trashed_at:new Date().toISOString()},filters:[['eq','id',note.id]],expected:{[note.id]:current._hash}});
 assert.equal(await shared('fictional-share-token'),404);
 assert.equal(service.store.list('shared_notes').find(s=>s.note_id===note.id).is_active,false);
 const trashed=(await post({table:'notes',operation:'select',filters:[['eq','id',note.id]]}))[0];
 await post({table:'notes',operation:'update',values:{is_trashed:false,trashed_at:null},filters:[['eq','id',note.id]],expected:{[note.id]:trashed._hash}});
 assert.equal(await shared('fictional-share-token'),404);
 // A note trashed earlier, while its share stayed switched on, is not served either.
 const older=service.store.save('notes',{title:'Fictional older',content:'Older private content',is_trashed:true});
 service.store.save('shared_notes',{note_id:older.id,share_token:'fictional-older-token',is_active:true});
 assert.equal(await shared('fictional-older-token'),404);
});
