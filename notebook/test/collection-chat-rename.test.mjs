import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';

const fixture=(t,provider)=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-collection-rename-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store=new Store(root),query=new QueryService(store);
  const collection=query.execute({table:'collections',operation:'insert',values:{name:'Recipes',field_schema:[{key:'name',label:'Name',type:'text',primary:true}]}}).data[0];
  const item=query.execute({table:'collection_items',operation:'insert',values:{collection_id:collection.id,data:{name:'Soup'}}}).data[0];
  return {store,collection,item,domains:new Domains(query,{provider:async request=>request.kind==='collection-chat'?provider(item):{terms:[]}})};
};

// The collection chat changes items only when asked to plainly, and it knew
// few words for asking: "Rename Soup to Stew" changed nothing while the reply
// said "Renamed it." (7 October 2026). Rename, mark, set, move, fix, correct
// and replace now ask, and when a change is left out the reply says nothing
// was changed.
test('"Rename Soup to Stew" renames it',async t=>{
  const {store,collection,item,domains}=fixture(t,item=>({reply:'Renamed it.',item_updates:[{id:item.id,data:{name:'Stew'}}]}));
  const result=await domains.invoke('collection-chat',{collection_id:collection.id,message:'Rename Soup to Stew'});
  assert.equal(store.get('collection_items',item.id).data.name,'Stew');
  assert.equal(result.tool_results.length,1);
});

test('a change left out because it was not asked for is not reported as made',async t=>{
  const {store,collection,item,domains}=fixture(t,item=>({reply:'Renamed it to Stew.',item_updates:[{id:item.id,data:{name:'Stew'}}]}));
  const result=await domains.invoke('collection-chat',{collection_id:collection.id,message:'What would be a better name for the soup?'});
  assert.equal(store.get('collection_items',item.id).data.name,'Soup');
  assert.deepEqual(result.tool_results,[]);
  assert.match(result.content,/Nothing in the collection was changed/);
});
