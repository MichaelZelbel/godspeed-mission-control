import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {SearchIndex} from '../core/index/search.mjs';
import {MeaningIndex} from '../core/index/meaning.mjs';

// Meaning search sends the text it indexes to an outside embeddings service
// (OpenRouter, OpenAI). It sent every record the word index holds: notes
// hidden from assistants, sensitive notes, notes about a hidden person and
// facts in a private section (7 October 2026). What reaches that service is
// what may reach a model (visibleRows); word search, which stays on this
// machine, still finds everything for the owner.
test('the embeddings service is sent no hidden, sensitive or private record',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-meaning-privacy-'));
  const store=new Store(root),query=new QueryService(store),insert=(table,values)=>query.execute({table,operation:'insert',values}).data[0];
  insert('notes',{title:'Open note',content:'Ordinary visible words'});
  insert('notes',{title:'Hidden note',content:'Secret hidden words',ai_visibility:'hidden'});
  insert('notes',{title:'Sensitive note',content:'Sensitive therapy words',is_sensitive:true});
  const person=insert('contacts',{name:'Kept private person',ai_visibility:'hidden'});
  insert('notes',{title:'About them',content:'Words about the kept private person',contact_id:person.id});
  insert('profile_categories',{slug:'health',name:'Health',visibility_scope:'private'});
  insert('fact_slots',{subject_type:'self',attribute:'diagnosis',label:'Diagnosis',category_slug:'health'});
  insert('claims',{subject_type:'self',attribute:'diagnosis',value:'Private diagnosis text'});
  const index=new SearchIndex(store);index.syncRecords();
  t.after(()=>{index.close();fs.rmSync(root,{recursive:true,force:true});});
  const sent=[];
  index.meaning=new MeaningIndex(index,{config:{url:'http://127.0.0.1:9/v1',model:'fictional',dimensions:3},embed:async texts=>{sent.push(...texts);return {vectors:texts.map(()=>Float32Array.from([1,0,0]))};}});
  await index.meaning.step({budget:512});
  const all=sent.join('\n');
  assert.match(all,/Ordinary visible words/);
  for(const secret of ['Secret hidden words','Sensitive therapy words','kept private person','Private diagnosis text'])assert.ok(!all.includes(secret),secret+' was sent to the embeddings service');
  // A note hidden later loses its vector on the next round.
  const open=store.list('notes').find(n=>n.title==='Open note');
  store.save('notes',{id:open.id,ai_visibility:'hidden'});index.syncRecords();
  await index.meaning.step({budget:512});
  assert.equal(index.meaning.vectors.digests(index.meaning.space).has(open.uid),false);
  // The owner's word search finds the hidden note all the same.
  const found=await index.searchHybrid('Secret hidden',{limit:10});
  assert.ok(found.rows.some(r=>r.title==='Hidden note'));
});
