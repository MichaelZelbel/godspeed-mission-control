import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';
import {mcp} from '../server/mcp.mjs';

// A note moved to Trash or removed stops being public: the screens' paths do
// that. An assistant moving a shared note to Trash through save_record, or
// removing it through structural_change, left its public link working
// (7 October 2026).
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-assistant-share-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store=new Store(root),query=new QueryService(store),domains=new Domains(query);
  const call=(name,args)=>mcp({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}},{store,query,domains}).then(r=>r.result);
  const shared=title=>{const note=store.save('notes',{title,content:'Shared with a friend'});const share=store.save('shared_notes',{note_id:note.id,is_active:true,token_hash:'x-'+note.id});return {note:store.get('notes',note.id),share};};
  return {store,call,shared};
}

test('an assistant moving a shared note to Trash ends its public link',async t=>{
  const {store,call,shared}=fixture(t),{note,share}=shared('Trip plan');
  const result=await call('save_record',{type:'notes',value:{id:note.id,is_trashed:true},expected_hash:note._hash});
  assert.ok(!result.isError,JSON.stringify(result));
  assert.equal(store.get('notes',note.id).is_trashed,true);
  assert.equal(store.get('shared_notes',share.id).is_active,false);
});

test('an assistant removing a shared note ends its public link',async t=>{
  const {store,call,shared}=fixture(t),{note,share}=shared('Old plan');
  const result=await call('structural_change',{type:'notes',id:note.id,action:'remove',expected_hash:note._hash});
  assert.ok(!result.isError,JSON.stringify(result));
  assert.equal(store.get('shared_notes',share.id).is_active,false);
});
