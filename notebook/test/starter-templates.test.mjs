import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createService } from '../server/main.mjs';

const emptyFolder=()=>fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-starter-templates-'));
const client=service=>{
  const base='http://127.0.0.1:'+service.address.port;
  const post=async(route,input)=>{const response=await fetch(base+'/api/'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});assert.equal(response.status,200,await response.clone().text());return (await response.json()).data;};
  return {query:input=>post('query',input),rpc:(rpc,args)=>post('rpc',{rpc,args})};
};
const sample={text:'Fictional text',longtext:'Fictional longer text',number:4,date:'2026-11-19',url:'https://example.com/recipe'};

test('a notebook started on an empty folder lists the starter templates, and Books, Recipes and Movies each create a working collection',async()=>{
  const service=await createService({root:emptyFolder(),port:0}),{query,rpc}=client(service);
  try{
    const templates=await query({table:'collection_templates',operation:'select'}),bySlug=new Map(templates.map(t=>[t.slug,t]));
    for(const slug of ['household-knowledge','home-maintenance','job-applications','workout-log','wine-journal','books','recipes','movies'])assert.ok(bySlug.has(slug),slug+' is listed');
    for(const slug of ['books','recipes','movies']){
      const template=bySlug.get(slug);
      // What the templates page's create dialog sends.
      const collection=await query({table:'collections',operation:'insert',single:true,values:{name:template.name,slug:'my-'+slug,icon:template.icon,description:template.description,visibility:'private',field_schema:template.field_schema,agent_instructions:template.agent_instructions}});
      assert.deepEqual(collection.field_schema.map(f=>f.key),template.field_schema.map(f=>f.key));
      const data=Object.fromEntries(template.field_schema.map(f=>[f.key,f.type==='select'?f.options[0]:sample[f.type]]));
      const [item]=await query({table:'collection_items',operation:'insert',values:{collection_id:collection.id,data}});
      assert.deepEqual(item.data,data);
      const [listed]=await query({table:'collection_items',operation:'select',filters:[['eq','id',item.id]]});
      assert.equal(listed.title,data[template.field_schema.find(f=>f.primary).key]);
    }
    await rpc('increment_collection_template_usage',{p_slug:'books'});
    assert.equal(service.store.get('collection_templates','template-books').usage_count,1);
  }finally{await service.close();}
});

test('a starter template the owner deleted stays deleted when the notebook starts again',async()=>{
  const root=emptyFolder();
  let service=await createService({root,port:0});
  try{await client(service).query({table:'collection_templates',operation:'delete',filters:[['eq','id','template-books']]});}finally{await service.close();}
  service=await createService({root,port:0});
  try{
    const slugs=(await client(service).query({table:'collection_templates',operation:'select'})).map(t=>t.slug);
    assert.ok(!slugs.includes('books'));assert.ok(slugs.includes('movies'));
  }finally{await service.close();}
});
