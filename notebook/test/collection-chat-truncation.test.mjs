import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';

const fixture=(t,fields)=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-collection-cut-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store=new Store(root),query=new QueryService(store);
  const collection=query.execute({table:'collections',operation:'insert',values:{name:'Recipes',field_schema:fields}}).data[0];
  return {store,query,collection};
};
const schema=[{key:'name',label:'Name',type:'text',primary:true},{key:'description',label:'Description',type:'longtext'},{key:'rating',label:'Rating',type:'number'}];
const long='Draft recipe. '+'Step: stir the pot slowly and taste. '.repeat(60);

// The collection chat shows the model a long text field cut to 600
// characters. The model's edit of that cut copy was saved as the whole
// field: a 2,234-character description became 601 characters ending in an
// ellipsis (7 October 2026). A field the model saw only in part is never
// written from that part.
test('collection chat never saves the cut copy of a long field',async t=>{
  const {store,query,collection}=fixture(t,schema);
  const item=query.execute({table:'collection_items',operation:'insert',values:{collection_id:collection.id,data:{name:'Soup',description:long,rating:3}}}).data[0];
  let shown=null;
  const domains=new Domains(query,{provider:async request=>{if(request.kind!=='collection-chat')return {terms:[]};shown=request.context.items[0];return {reply:'Changed the first word.',item_updates:[{id:shown.id,data:{description:shown.data.description.replace(/^Draft/,'Final')}}]};}});
  const result=await domains.invoke('collection-chat',{collection_id:collection.id,message:'Change the first word of the soup description to Final'});
  assert.ok(shown.data.description.length<=601,'the model saw only the beginning');
  assert.equal(store.get('collection_items',item.id).data.description,long);
  assert.deepEqual(result.tool_results,[]);
  assert.match(result.content||result.message?.content||JSON.stringify(result),/Description/);
});

// The other fields of that item, which the model saw whole, still change.
test('the fields it saw whole still change on an item with a cut field',async t=>{
  const {store,query,collection}=fixture(t,schema);
  const item=query.execute({table:'collection_items',operation:'insert',values:{collection_id:collection.id,data:{name:'Soup',description:long,rating:3}}}).data[0];
  const domains=new Domains(query,{provider:async request=>{if(request.kind!=='collection-chat')return {terms:[]};const shown=request.context.items[0];return {reply:'Rated it 5.',item_updates:[{id:shown.id,data:{...shown.data,rating:5}}]};}});
  const result=await domains.invoke('collection-chat',{collection_id:collection.id,message:'Change the soup rating to 5'});
  const saved=store.get('collection_items',item.id).data;
  assert.equal(saved.rating,5);
  assert.equal(saved.description,long);
  assert.equal(result.tool_results.length,1);
  assert.equal(result.content,'Rated it 5.','an unchanged cut value sent back is no change to report');
});

test('a short field the model saw whole is saved as before',async t=>{
  const {store,query,collection}=fixture(t,schema);
  const item=query.execute({table:'collection_items',operation:'insert',values:{collection_id:collection.id,data:{name:'Soup'}}}).data[0];
  const domains=new Domains(query,{provider:async()=>({reply:'Changed it.',item_updates:[{id:item.id,data:{name:'Stew'}}]})});
  const result=await domains.invoke('collection-chat',{collection_id:collection.id,message:'Change Soup to Stew'});
  assert.equal(store.get('collection_items',item.id).data.name,'Stew');
  assert.equal(result.tool_results.length,1);
});
