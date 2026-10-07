import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';

// DM4 (7 October 2026): collection chat cut a long text field to ~600 chars in
// the prompt copy, and the model's edit of that cut copy was saved as the whole
// field, so a 2,234-char description became 601 ending in an ellipsis. The note
// chat fix (0e7a8b0) was never applied to collections. A field the model saw
// only truncated must never overwrite the real value.
test('collection chat does not save a truncated field copy over the real long value',async()=>{
  const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-coll-cut-'))),query=new QueryService(store);
  const c=query.execute({table:'collections',operation:'insert',values:{name:'Recipes',field_schema:[{key:'name',label:'Name',type:'text',primary:true},{key:'description',label:'Description',type:'longtext'}]}}).data[0];
  const long='Draft recipe. '+'Step: stir the pot slowly and taste. '.repeat(60);
  const item=query.execute({table:'collection_items',operation:'insert',values:{collection_id:c.id,data:{name:'Soup',description:long}}}).data[0];
  let shownLen=null;
  const domains=new Domains(query,{provider:async request=>{const shown=request.context.items[0];shownLen=shown.data.description.length;return JSON.stringify({reply:'Changed the first word.',item_updates:[{id:shown.id,data:{description:shown.data.description.replace(/^Draft/,'Final')}}]});}});
  const r=await domains.invoke('collection-chat',{collection_id:c.id,message:'Change the first word of the soup description to Final'});
  const saved=store.get('collection_items',item.id).data.description;
  assert.ok(shownLen<=601,'the model was shown only the truncated field');
  assert.equal(saved,long,'the real long value is kept, not the cut copy');
  assert.equal(saved.length,long.length);
  assert.ok(!saved.endsWith('…'),'no ellipsis stored as content');
  assert.equal(r.tool_results.length,0,'nothing was saved from the truncated view');
});

// A field the model WAS shown in full is still editable as before.
test('collection chat still saves an edit to a short field the model saw whole',async()=>{
  const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-coll-short-'))),query=new QueryService(store);
  const c=query.execute({table:'collections',operation:'insert',values:{name:'Recipes',field_schema:[{key:'name',label:'Name',type:'text',primary:true}]}}).data[0];
  const item=query.execute({table:'collection_items',operation:'insert',values:{collection_id:c.id,data:{name:'Soup'}}}).data[0];
  const domains=new Domains(query,{provider:async()=>({reply:'Renamed it.',item_updates:[{id:item.id,data:{name:'Stew'}}]})});
  const r=await domains.invoke('collection-chat',{collection_id:c.id,message:'Rename Soup to Stew'});
  assert.equal(store.get('collection_items',item.id).data.name,'Stew');
  assert.equal(r.tool_results.length,1);
});
