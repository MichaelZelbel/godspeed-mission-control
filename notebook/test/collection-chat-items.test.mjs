import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {chatContext} from '../core/chat-context.mjs';

// The collection chat saw the first twenty items only. Asked which of 37
// films were watched with one person, it named one watched with another and
// missed four (6 October 2026, the real Movies & TV collection).
const setup=()=>{const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-collection-chat-'))),query=new QueryService(store);
  const collection=store.save('collections',{name:'Films',field_schema:[{key:'title',label:'Title',type:'text',primary:true},{key:'with',label:'Watched with',type:'text'},{key:'notes',label:'Notes',type:'longtext'}]});
  return {store,query,collection};};

test('every item of an ordinary collection reaches its chat',()=>{
  const {store,query,collection}=setup();
  for(let i=0;i<40;i++)store.save('collection_items',{collection_id:collection.id,data:{title:'Film '+i,with:i===35?'Fictional Mei':'nobody'}});
  const context=chatContext(query,{collection_id:collection.id,message:'Which films did I watch with Mei?'});
  assert.equal(context.items.length,40);assert.equal(context.items_total,40);
  assert.ok(context.items.some(i=>i.data.with==='Fictional Mei'));
  assert.equal(context.item_titles,undefined,'nothing left out, so no separate list of titles');
});

test('a collection too large to send whole sends the items the question names, and every title',()=>{
  const {store,query,collection}=setup(),long='x'.repeat(4000);
  store.transaction(view=>view.commit(Array.from({length:200},(_,i)=>store.prepare('collection_items',{collection_id:collection.id,title:'Book '+i,data:{title:'Book '+i,notes:long,with:i===157?'Fictional Mei':'nobody'},references:[{type:'collections',id:collection.id,uid:collection.uid,field:'collection_id'}]}))));
  const context=chatContext(query,{collection_id:collection.id,message:'Which books did I read with Mei?'});
  assert.ok(context.items.length<200);assert.equal(context.item_titles.length,200);assert.equal(context.items_total,200);
  assert.ok(context.items.some(i=>i.data.with==='Fictional Mei'),'the item the question is about is given in full');
});

test('an item the model sends as plain fields is saved with those fields, and an empty one is refused',async()=>{
  const {store,query,collection}=setup(),{Domains}=await import('../core/domains.mjs'),domains=new Domains(query);
  domains.provider=async()=>({reply:'Added Catan.',items_created:[{title:'Catan',with:'Fictional Mei'}]});
  await domains.invoke('collection-chat',{collection_id:collection.id,message:'Add Catan, which I play with Mei'});
  const items=store.list('collection_items').filter(i=>i.collection_id===collection.id);
  assert.deepEqual(items.map(i=>i.data),[{title:'Catan',with:'Fictional Mei'}]);
  domains.provider=async()=>({reply:'Added it.',items_created:[{}]});
  await assert.rejects(domains.invoke('collection-chat',{collection_id:collection.id,message:'Add a film'}),/without any values/);
  assert.equal(store.list('collection_items').filter(i=>i.collection_id===collection.id).length,1);
});
