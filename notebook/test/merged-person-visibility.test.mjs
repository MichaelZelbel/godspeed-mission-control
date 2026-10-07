import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {visibleRows} from '../core/visibility.mjs';

const fixture=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-merged-visible-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const store=new Store(root),query=new QueryService(store);return {store,query};};
const insert=(query,table,values)=>query.execute({table,operation:'insert',values}).data[0];

// Menerio merged duplicate people by marking the duplicate merged_into the
// person kept, and left the duplicate's notes, documents, events and facts
// pointing at it. The import keeps them so. Until 7 October 2026 a merged
// person counted as hidden, so all of that vanished from every assistant;
// it belongs to the person they went into, and is as visible as they are.
function merged(query,{hidden=false}={}){
  const kept=insert(query,'contacts',{name:'Anna',ai_visibility:hidden?'hidden':'visible'});
  const twin=insert(query,'contacts',{name:'Anna (old)',merged_into:kept.id});
  const note=insert(query,'notes',{title:'Dinner with Anna',content:'She moved to Lisbon',contact_id:twin.id});
  const doc=insert(query,'notes',{title:'Anna letter',content:'A letter'});
  insert(query,'person_documents',{contact_id:twin.id,note_id:doc.id});
  const moment=insert(query,'moments',{title:'Anna wedding',happened_at:'2024-05-01'});
  insert(query,'moment_participants',{moment_id:moment.id,person_id:twin.id});
  insert(query,'claims',{subject_type:'contact',subject_id:twin.id,attribute:'home_city',value:'Lisbon'});
  return {kept,twin,note,doc,moment};
}

test("an imported merged person's notes, documents, events and facts reach assistants",t=>{
  const {query}=fixture(t),{twin,note,doc,moment}=merged(query);
  const ids=type=>visibleRows(query,type).map(r=>r.id);
  assert.ok(ids('notes').includes(note.id));
  assert.ok(ids('notes').includes(doc.id));
  assert.ok(ids('moments').includes(moment.id));
  assert.ok(visibleRows(query,'claims').some(c=>c.value==='Lisbon'));
  // The duplicate itself is not a second person.
  assert.ok(!ids('contacts').includes(twin.id));
});

test('they stay hidden when the person they went into is hidden',t=>{
  const {query}=fixture(t),{twin,note,doc,moment}=merged(query,{hidden:true});
  const ids=type=>visibleRows(query,type).map(r=>r.id);
  assert.ok(!ids('notes').includes(note.id));
  assert.ok(!ids('notes').includes(doc.id));
  assert.ok(!ids('moments').includes(moment.id));
  assert.ok(!visibleRows(query,'claims').some(c=>c.value==='Lisbon'));
  assert.ok(!ids('contacts').includes(twin.id));
});
