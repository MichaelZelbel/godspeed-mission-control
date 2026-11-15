import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {SearchIndex} from '../core/index/search.mjs';
import {importOrphanChunks} from '../core/menerio-chunks.mjs';

// Menerio's passages that hold text found in no note (an attached PDF read out)
// become searchable records of their note; the note's own passages do not.
test('only passages with text found in no note are imported, once, and search finds them',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-chunks-')),source=path.join(root,'archive');fs.mkdirSync(source);
  const store=new Store(path.join(root,'ws'));const note=store.save('notes',{id:'2f1c0000-0000-4000-8000-000000000001',uid:'2f1c0000-0000-4000-8000-000000000001',title:'Fictional lease',content:'See the attached PDF.'});
  fs.writeFileSync(path.join(source,'notes.json'),JSON.stringify([{id:note.id,title:'Fictional lease',content:'See the attached PDF.'}]));
  fs.writeFileSync(path.join(source,'note_chunks.json'),JSON.stringify([
    {id:'c1',note_id:note.id,chunk_index:'0',heading_path:'None',content:'See the attached PDF.',created_at:'2026-08-15 23:58:24.263369+00'},
    {id:'c2',note_id:note.id,chunk_index:'1',heading_path:'Page 1',content:'Fictional tenant Erika Musterfrau pays 950 euros a month, notice period three months.',created_at:'2026-08-15 23:58:24.263369+00'}]));
  assert.deepEqual(importOrphanChunks(store,source),{found:1,added:1,already:0,missing_note:0});
  assert.equal(importOrphanChunks(store,source).added,0,'a second run adds nothing');
  const index=new SearchIndex(store);try{
    assert.ok(index.search('Musterfrau notice').some(r=>r.type==='note_chunks'));
    // Until 6 October 2026 such a hit was listed under the passage's id; it is the note that was found.
    const found=index.passagesAsNotes(index.search('Musterfrau notice'));
    assert.deepEqual(found.map(r=>[r.type,r.id,r.title,r.via]),[['notes',note.id,'Fictional lease','passage']]);
    assert.equal(index.passagesAsNotes([...index.search('Fictional lease'),...index.search('Musterfrau')]).filter(r=>r.id===note.id).length,1,'the note is listed once');
  }finally{index.close();}
  assert.equal(store.get('note_chunks','c2').note_id,note.id);
});
