import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {hash,encode} from './records/store.mjs';
const {parseCard}=createRequire(import.meta.url)('../../tools/mc-cards.js');
export function importGoalFiles(store){
 const folder=path.join(store.root,'goals');if(!fs.existsSync(folder))return {imported:0};
 const records=[];let imported=0;
 for(const name of fs.readdirSync(folder).filter(n=>n.endsWith('.md')&&n!=='README.md')){
  const file=path.join(folder,name),text=fs.readFileSync(file,'utf8'),card=parseCard(text);if(!card.f.ID)continue;
  const id=card.f.ID,sourceHash=hash(text),mappingId='legacy-goal-'+hash(name),mapping=store.get('import_mappings',mappingId),old=store.get('goals',id);
  if(mapping?.source_hash===sourceHash)continue;
  const values={id,title:card.f.TITLE||id,status:card.f.STATUS,kind:card.f.KIND,area:card.f.AREA,own_words:card.f['OWN WORDS'],measure:card.f.MEASURE,lead:card.f.LEAD,deadline:card.f.DEADLINE,serves:String(card.f.SERVES||'').split(',').map(s=>s.trim()).filter(Boolean),depends_on:String(card.f['DEPENDS ON']||'').split(',').map(s=>s.trim()).filter(Boolean),protected:card.f.PROTECTED==='yes',importance:card.f.IMPORTANCE||'normal',legacy_fields:card.f,legacy_log:card.log,legacy_source:'goals/'+name,legacy_content:text,progress:old?.progress||[]};
  if(old&&(!mapping||mapping.record_hash!==old._hash))store.conflict('goals',values,old);
  const record=store.prepare('goals',values,old);records.push(record,store.prepare('import_mappings',{id:mappingId,source:'legacy-goals',source_path:'goals/'+name,source_hash:sourceHash,record_type:'goals',record_id:id,record_hash:hash(encode(record))},mapping));imported++;
 }
 if(records.length)store.withLock(()=>store.commit(records));return {imported};
}
