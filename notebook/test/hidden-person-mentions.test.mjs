import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {visibleRows} from '../core/visibility.mjs';
import {mcp} from '../server/mcp.mjs';

const fixture=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-hidden-mentions-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const store=new Store(root),query=new QueryService(store);return {store,query};};
const insert=(query,table,values)=>query.execute({table,operation:'insert',values}).data[0];
const update=(query,table,row,values)=>query.execute({table,operation:'update',values,filters:[['eq','id',row.id]],expected:{[row.id]:query.rows(table).find(r=>r.id===row.id)._hash}});

// The setting "Auto-hide content linked to sensitive people" promises that the notes
// and moments that mention a hidden person are hidden from the AI too. Until 8 October
// 2026 only notes linked to them were: a note that only named them, in its words or in
// what processing found in it (metadata.matched_people), still reached the model.
function notebook(query){
  const anna=insert(query,'contacts',{name:'Anna Weber',aliases:['Anni'],ai_visibility:'visible'});
  const bob=insert(query,'contacts',{name:'Bob Lane'});
  const notes={
    named:insert(query,'notes',{title:'Lunch',content:'Lunch with Anna Weber about her knee.'}),
    nickname:insert(query,'notes',{title:'Call from anni',content:'She called.'}),
    matched:insert(query,'notes',{title:'Tuesday',content:'She said the knee is better.',metadata:{matched_people:[{contact_id:anna.id,name:'Anna'}]}}),
    linked:insert(query,'notes',{title:'Letter',content:'A letter.'}),
    other:insert(query,'notes',{title:'Book club',content:'Bob Lane recommended a novel.'}),
    lookalike:insert(query,'notes',{title:'Party',content:'Annika came, and Anna Webers bakery was closed.'}),
  };
  insert(query,'person_documents',{contact_id:anna.id,note_id:notes.linked.id});
  const moments={named:insert(query,'moments',{title:'Dinner with Anna Weber',happened_at:'2026-05-01'}),other:insert(query,'moments',{title:'Dentist',happened_at:'2026-05-02'})};
  return {anna,bob,notes,moments};
}
const ids=(query,type)=>visibleRows(query,type).map(r=>r.id).sort();

test('a hidden person hides the notes and moments that name them, not the others',t=>{
  const {query}=fixture(t),{anna,notes,moments}=notebook(query);
  assert.deepEqual(ids(query,'notes'),Object.values(notes).map(n=>n.id).sort(),'nothing is hidden while she is visible');
  update(query,'contacts',anna,{ai_visibility:'hidden'});
  assert.deepEqual(ids(query,'notes'),[notes.other.id,notes.lookalike.id].sort());
  assert.deepEqual(ids(query,'moments'),[moments.other.id]);
  update(query,'contacts',anna,{ai_visibility:'visible'});
  assert.deepEqual(ids(query,'notes'),Object.values(notes).map(n=>n.id).sort(),'made visible again, her notes come back');
});

test('a sensitive person hides them while the setting is on, and not when it is off',t=>{
  const {query}=fixture(t),{anna,notes}=notebook(query);
  update(query,'contacts',anna,{is_sensitive:true});
  assert.deepEqual(ids(query,'notes'),[notes.other.id,notes.lookalike.id].sort());
  insert(query,'mcp_preferences',{hide_sensitive_from_ai:false});
  assert.equal(ids(query,'notes').length,Object.keys(notes).length);
});

test('an assistant reading the notes does not get a note that only names a hidden person',async t=>{
  const {store,query}=fixture(t),{anna,notes}=notebook(query);
  update(query,'contacts',anna,{ai_visibility:'hidden'});
  const call=async(name,args)=>JSON.parse((await mcp({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}},{store,query,index:null,domains:{}})).result.content[0].text);
  const listed=(await call('list_records',{type:'notes'})).map(n=>n.id);
  assert.ok(listed.includes(notes.other.id));
  for(const hidden of ['named','nickname','matched','linked'])assert.ok(!listed.includes(notes[hidden].id),hidden);
});
