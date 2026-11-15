import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';

const setup=()=>{const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-contact-name-')));return {store,query:new QueryService(store)};};
const MESSAGE='A person needs a name. Type their name and save again.';
const contacts=query=>query.execute({table:'contacts'}).data;

test('a new contact without a name is refused with a plain message and nothing is written',()=>{
  const {query}=setup();
  for(const values of [{id:'a'},{id:'b',name:''},{id:'c',name:'   '},{id:'d',name:null}]){
    assert.throws(()=>query.execute({table:'contacts',operation:'insert',values}),{message:MESSAGE});
  }
  assert.throws(()=>query.execute({table:'contacts',operation:'upsert',values:{id:'e'}}),{message:MESSAGE});
  assert.deepEqual(contacts(query),[]);
  query.execute({table:'contacts',operation:'insert',values:{id:'ok',name:'Ada'}});
  assert.deepEqual(contacts(query).map(c=>c.name),['Ada']);
});

test('an old contact without a name is still read, and can be named, but not changed while nameless',()=>{
  const {store,query}=setup();
  store.save('contacts',{id:'old',relationship:'friend'}); // as an older notebook or a file written by hand has it
  const read=contacts(query);
  assert.deepEqual(read.map(c=>c.id),['old']);
  assert.equal(read[0].name,undefined);
  assert.throws(()=>query.execute({table:'contacts',operation:'update',values:{id:'old',relationship:'colleague'}}),{message:MESSAGE});
  assert.equal(contacts(query)[0].relationship,'friend','the old record was not rewritten');
  query.execute({table:'contacts',operation:'update',values:{id:'old',name:'Grace'}});
  assert.equal(contacts(query)[0].name,'Grace');
});

test('a contact without a name can still be removed',()=>{
  const {store,query}=setup();
  store.save('contacts',{id:'old'});
  query.execute({table:'contacts',operation:'delete',filters:[['eq','id','old']],values:{id:'old'}});
  assert.deepEqual(contacts(query),[]);
});

// Issue 266: opening a person records last_viewed_at, and for an old contact without a name that
// write was refused, so its first open ended in this error.
test('opening an old contact without a name records the view, and still changes nothing else',()=>{
  const {store,query}=setup();
  const old=store.save('contacts',{id:'old',relationship:'friend'});
  const at='2026-11-11T10:00:00.000Z';
  query.execute({table:'contacts',operation:'update',values:{last_viewed_at:at},filters:[['eq','id','old']]});
  const read=contacts(query)[0];
  assert.equal(read.last_viewed_at,at);
  assert.equal(read.relationship,'friend');
  assert.equal(read.name,undefined,'the record was not given a name');
  assert.equal(read.uid,old.uid);
  assert.throws(()=>query.execute({table:'contacts',operation:'update',values:{last_viewed_at:at,relationship:'colleague'},filters:[['eq','id','old']]}),{message:MESSAGE});
  assert.throws(()=>query.execute({table:'contacts',operation:'insert',values:{last_viewed_at:at}}),{message:MESSAGE},'a new person still needs a name');
});
