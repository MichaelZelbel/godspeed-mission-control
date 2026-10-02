import { hash, encode } from './records/store.mjs';
import { tables } from './query.mjs';
export function importExport(query,exported){
  if(exported.format!==1||!Array.isArray(exported.records))throw new Error('Expected format 1 records export');
  const store=query.store;
  return store.withLock(()=>{
    const mapping=store.get('import_mappings','menerio'),known=mapping?.entries||{},entries={...known},prepared=[];
    for(const row of exported.records){
      if(!tables.has(row.type)||!row.id)throw new Error('Export has an unknown domain or missing stable ID');
      if(row.type.endsWith('_connections')||row.type==='mcp_api_tokens')throw new Error('Do not import connector credentials into synced records');
      const key=row.type+'/'+row.id,digest=hash(row),old=store.get(row.type,known[key]?.id||row.id);
      if(known[key]?.digest===digest)continue;
      if(old&&known[key]&&old._hash!==known[key].savedHash)throw new Error('An imported record was edited locally. Resolve before reimporting '+key);
      if(old&&!known[key])throw new Error('An existing record has the imported ID. Review '+key);
      const record=store.prepare(row.type,{...row,id:known[key]?.id||row.id,import_origin:'menerio'},old);
      prepared.push(record);entries[key]={id:record.id,uid:record.uid,digest};
    }
    // References resolve against the whole staged graph, not import ordering.
    for(const record of prepared)record.references=query.references(record.type,record).map(ref=>{
      const target=prepared.find(r=>r.type===ref.type&&r.id===ref.id);return target?{...ref,uid:target.uid}:ref;
    });
    for(const record of prepared)entries[record.type+'/'+record.id].savedHash=hash(encode(record));
    if(prepared.length)store.commit([...prepared,store.prepare('import_mappings',{id:'menerio',entries},mapping)]);
    return {imported:prepared.length,unchanged:exported.records.length-prepared.length};
  });
}
