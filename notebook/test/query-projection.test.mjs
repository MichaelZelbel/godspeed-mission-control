import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService,projection} from '../core/query.mjs';

// The notes list asks for a few columns. The server sent every note whole
// regardless: 63 MB for the real notebook, on every dashboard refresh.
const setup=()=>{const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-projection-')));return {store,query:new QueryService(store)};};

test('a selection of columns returns those columns, with the id and version a save needs',()=>{
  const {store,query}=setup();store.save('notes',{id:'p1',title:'Plan',content:'x'.repeat(100000)});
  const row=query.execute({table:'notes',selection:'id, title, updated_at',filters:[['eq','id','p1']],single:true}).data;
  assert.deepEqual(Object.keys(row).sort(),['_hash','id','title','updated_at']);
  assert.ok(row._hash);
});
test('everything, joins and anything unusual still return whole rows',()=>{
  assert.equal(projection('*'),null);assert.equal(projection(''),null);assert.equal(projection('*, contacts(name)'),null);
  assert.equal(projection('alias:title'),null,'a renamed column is passed through whole rather than guessed');
  assert.equal(projection('data->>name'),null);
  assert.deepEqual([...projection('id, name, contacts(id,name), source_note:notes!source_note_id(id,title)')].sort(),['_hash','contacts','id','name','source_note']);
});
test('a join named in a selection is still filled in',()=>{
  const {store,query}=setup();const person=store.save('contacts',{name:'Ana'});store.save('action_items',{id:'a1',title:'Call',contact_id:person.id});
  const row=query.execute({table:'action_items',selection:'id, title, contacts(name)',filters:[['eq','id','a1']],single:true}).data;
  assert.equal(row.contacts.name,'Ana');assert.equal(row.contact_id,undefined);
});

// The notes list carried every note's whole text: 10 MB per load for the real
// notebook's 1,372 notes. It asks for a preview and the length instead.
test('a list can ask for a note\'s first words and length instead of its text',()=>{
  const {store,query}=setup();store.save('notes',{id:'long',title:'Long',content:'word '.repeat(5000)});
  const row=query.execute({table:'notes',selection:'id, title, content_preview',filters:[['eq','id','long']],single:true}).data;
  assert.equal(row.content,undefined);assert.equal(row.content_preview.length,400);assert.equal(row.content_length,25000);
});
