import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';
import {SearchIndex} from '../core/index/search.mjs';
import {mcp} from '../server/mcp.mjs';

// A key the owner gives another program reads what its scopes cover. Scope
// was decided by the table a tool reads, so a key holding only "notes" read
// facts through search_brain, and the coaching, journal and habit check-ins,
// which are saved as notes, through every note tool (7 October 2026). What a
// key may read is now decided by what a record is: a fact about you needs
// "profile" (or "world"), one about someone else "contacts" (or "world"), and
// a note written by the coach, the journal, a habit check or a goal needs
// "actions" as well as "notes".
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-key-scope-'));
  const store=new Store(root),query=new QueryService(store),insert=(table,values)=>query.execute({table,operation:'insert',values}).data[0];
  insert('notes',{title:'Garden plan',content:'Plant tomatoes near the fence'});
  insert('notes',{title:'From your coach',content:'Coach asked about tomatoes and your sleep',source_app:'coach-tick'});
  insert('notes',{title:'Your journal check-in',content:'Journal entry mentions tomatoes and anxiety',source_app:'journal-tick'});
  insert('notes',{title:'Review head lifts',content:'Habit check about tomatoes',source_app:'habit-check',habit_ids:['h1']});
  insert('claims',{subject_type:'self',attribute:'favourite_vegetable',value:'tomatoes grown at home'});
  const index=new SearchIndex(store);index.syncRecords();
  t.after(()=>{index.close();fs.rmSync(root,{recursive:true,force:true});});
  const call=(name,args,scopes)=>mcp({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}},{store,query,index,domains:new Domains(query),scopes,delegated:true}).then(r=>r.result.content[0].text);
  return {store,call};
}

test('a notes-only key reads ordinary notes, never facts or check-ins',async t=>{
  const {store,call}=fixture(t),scopes=['notes'];
  const brain=await call('search_brain',{query:'tomatoes'},scopes);
  assert.match(brain,/Garden plan/);
  for(const hidden of ['tomatoes grown at home','From your coach','journal check-in','Review head lifts'])assert.ok(!brain.includes(hidden),'search_brain showed '+hidden);
  const notes=await call('search_notes',{query:'tomatoes'},scopes);
  assert.match(notes,/Garden plan/);
  assert.ok(!/From your coach|journal check-in|Review head lifts/.test(notes),notes);
  const coach=store.list('notes').find(n=>n.title==='From your coach');
  assert.ok(!(await call('get_note',{note_id:coach.id},scopes)).includes('your sleep'));
});

test('a key with the scopes for them reads them',async t=>{
  const {call}=fixture(t);
  const brain=await call('search_brain',{query:'tomatoes'},['notes','actions','profile']);
  for(const shown of ['Garden plan','tomatoes grown at home','From your coach','journal check-in','Review head lifts'])assert.ok(brain.includes(shown),'search_brain missed '+shown);
});
