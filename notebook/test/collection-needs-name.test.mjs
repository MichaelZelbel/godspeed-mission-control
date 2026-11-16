import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';

const setup=()=>{const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-collection-name-')));return {store,query:new QueryService(store)};};
const MESSAGE='A collection needs a name. Type a name and save again.';
const collections=query=>query.execute({table:'collections'}).data;

test('a new collection without a name is refused and nothing is written',()=>{
  const {query}=setup();
  for(const values of [{id:'a'},{id:'b',name:''},{id:'c',name:'   '},{id:'d',name:null}]){
    assert.throws(()=>query.execute({table:'collections',operation:'insert',values}),{message:MESSAGE});
  }
  assert.throws(()=>query.execute({table:'collections',operation:'upsert',values:{id:'e'}}),{message:MESSAGE});
  assert.deepEqual(collections(query),[]);
});

test('an old collection without a name is readable and can be repaired',()=>{
  const {store,query}=setup();
  store.save('collections',{id:'old',description:'Written by an older notebook',field_schema:[]});
  const read=collections(query);
  assert.deepEqual(read.map(collection=>collection.id),['old']);
  assert.equal(read[0].name,undefined);
  assert.throws(()=>query.execute({table:'collections',operation:'update',values:{id:'old',description:'Changed'},filters:[['eq','id','old']]}),{message:MESSAGE});
  query.execute({table:'collections',operation:'update',values:{id:'old',name:'Repaired'},filters:[['eq','id','old']]});
  assert.equal(collections(query)[0].name,'Repaired');
  assert.equal(collections(query)[0].description,'Written by an older notebook');
});

test('an existing named collection cannot be edited to have a blank name',()=>{
  const {query}=setup();
  query.execute({table:'collections',operation:'insert',values:{id:'named',name:'Reading list'}});
  assert.throws(()=>query.execute({table:'collections',operation:'update',values:{id:'named',name:'   '},filters:[['eq','id','named']]}),{message:MESSAGE});
  assert.equal(collections(query)[0].name,'Reading list');
});
