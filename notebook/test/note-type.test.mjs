import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains,NOTE_TYPES} from '../core/domains.mjs';

// Classify with AI stored "process-note" as a note's type; the type box then
// showed nothing, since no such type exists.
test('classifying a note keeps a type the notebook offers and drops any other',async()=>{
  const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-note-type-'))),domains=new Domains(new QueryService(store));
  const a=store.save('notes',{title:'Fictional plan',content:'Decide the fictional garden layout.'}),b=store.save('notes',{title:'Other',content:'Other fictional text.'});
  let asked='';domains.provider=async input=>{asked=input.contract;return {suggestions:[],metadata:{type:input.input.note_id===a.id?'decision':'process-note',topics:['garden']},tags:['garden']};};
  await domains.invoke('process-note',{note_id:a.id});await domains.invoke('process-note',{note_id:b.id});
  assert.ok(NOTE_TYPES.every(t=>asked.includes(t)),'the model is told the types');
  assert.equal(store.get('notes',a.id).metadata.type,'decision');
  assert.equal(store.get('notes',b.id).metadata.type,undefined);assert.deepEqual(store.get('notes',b.id).metadata.topics,['garden']);
});
