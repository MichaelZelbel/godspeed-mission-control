import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';

// "Move this note to the trash" in its chat removed the note for good: a
// tombstone, never in Trash, nothing to restore, and a shared note stayed
// public (7 October 2026). It now goes to Trash, as the editor's own Move to
// Trash does, and its public link stops.
test('note chat moves a note to Trash and ends its public link',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-chat-trash-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store=new Store(root),query=new QueryService(store),domains=new Domains(query,{provider:async request=>request.kind==='note-chat'?{reply:'Moved it to the trash.',trash_note:true}:{terms:[]}});
  const note=store.save('notes',{title:'Old plan',content:'Nothing here matters any more'});
  const share=store.save('shared_notes',{note_id:note.id,is_active:true,token_hash:'x'});
  const result=await domains.invoke('note-chat',{note_id:note.id,message:'Move this note to the trash'});
  const now=store.get('notes',note.id);
  assert.equal(now.removed_at,undefined,'not removed for good');
  assert.equal(now.is_trashed,true);
  assert.ok(now.trashed_at);
  assert.ok(query.rows('notes').some(n=>n.id===note.id&&n.is_trashed),'it shows in Trash');
  assert.equal(store.get('shared_notes',share.id).is_active,false);
  assert.deepEqual(result.tool_results,[{tool:'trash_note',success:true}]);
});
