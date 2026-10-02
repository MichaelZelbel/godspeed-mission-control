import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { hash } from './records/store.mjs';
export function seed(store){
  const templates=JSON.parse(fs.readFileSync(fileURLToPath(new URL('../data/templates.json',import.meta.url)),'utf8'));
  const batch=[];for(const template of templates){
    const id='template-'+template.slug;if(store.get('collection_templates',id))continue;
    const digest=hash(id),uid=digest.slice(0,8)+'-'+digest.slice(8,12)+'-5'+digest.slice(13,16)+'-a'+digest.slice(17,20)+'-'+digest.slice(20,32),at='2026-10-02T00:00:00.000Z';
    batch.push({...store.prepare('collection_templates',{...template,id,uid,usage_count:0,created_at:at}),updated_at:at,device:'seed'});
  }
  if(batch.length)store.withLock(()=>store.commit(batch));
}
