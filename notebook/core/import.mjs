import { hash, encode } from './records/store.mjs';
import { tables } from './query.mjs';
// Records that are keys or sign-ins for other services. An export leaves them
// out and an import never takes them: a file someone saves or passes on must
// not carry them. note_connections is not one of them: it is a link the owner
// drew between two notes. Until 18 October 2026 every "_connections" type was
// refused, so the export of any notebook with such a link could not be imported.
const credentialTypes=new Set(['mcp_api_tokens','godspeed_api_keys','connected_apps','user_mcp_servers']);
export const credentialRecord=type=>credentialTypes.has(type)||(type.endsWith('_connections')&&type!=='note_connections');
// The importing notebook's own record of what it imported. One that arrives in
// a file belongs to the notebook that made the file.
// due_copies says which of THIS mission control's due/ files have been copied into THIS notebook
// (due-copy.mjs); another notebook's answer to that says nothing here.
const ownBookkeeping=new Set(['import_mappings','due_copies']);
// A record as the notebook keeps it, without its bookkeeping hash, and with its
// keys in one order, so the same record compares equal however it was written.
const comparable=record=>JSON.stringify(record,(key,value)=>value&&typeof value==='object'&&!Array.isArray(value)
  ?Object.fromEntries(Object.keys(value).filter(name=>name!=='_hash').sort().map(name=>[name,value[name]])):value);
const same=(a,b)=>comparable(a)===comparable(b);
// A starter record the notebook made itself and nobody changed since
// (seeds.mjs gives every one the device "seed" and revision 1).
const untouchedStarter=record=>record.device==='seed'&&record.revision===1;

// What a notebook's export looks like: { "format": 1, "records": [...] }.
export function exportRecords(store){
  return {format:1,records:[...store.scan().values()].filter(r=>!credentialRecord(r.type)).map(r=>{const copy={...r};delete copy._hash;return copy;})};
}

// Brings an export into this notebook. It never writes over a record the
// notebook already has in another version: such a record is kept as it is and
// named in the answer. Until 18 October 2026 the import stopped at the first
// record whose ID the notebook already had, so importing a notebook's own
// export, or any export into a notebook that was set up (every one holds the
// same starter templates), imported nothing.
export function importExport(query,exported){
  if(!exported||typeof exported!=='object'||exported.format!==1||!Array.isArray(exported.records))throw new Error('This file is not a notebook export: it needs "format": 1 and a list of "records", which is what the export command writes');
  const store=query.store;
  return store.withLock(()=>{
    const mapping=store.get('import_mappings','menerio'),known=mapping?.entries||{},entries={...known},prepared=[],kept=[];let unchanged=0,leftOut=0;
    for(const row of exported.records){
      if(!row||typeof row!=='object'||typeof row.type!=='string'||!row.id)throw new Error('This file is not a notebook export: a record in it has no type or no ID');
      if(credentialRecord(row.type)||ownBookkeeping.has(row.type)){leftOut++;continue;}
      if(!tables.has(row.type))throw new Error('This file holds a kind of record this notebook does not know ('+row.type+'); nothing was imported');
      const key=row.type+'/'+row.id,digest=hash(row),old=store.get(row.type,known[key]?.id||row.id);
      if(known[key]?.digest===digest){unchanged++;continue;}
      if(old&&known[key]&&old._hash!==known[key].savedHash)throw new Error('An imported record was edited locally. Resolve before reimporting '+key);
      if(old&&!known[key]){
        // The notebook has this very record already: its own export, or a starter record.
        if(same(old,row)){unchanged++;continue;}
        // A starter record changed in the exporting notebook replaces the
        // untouched starter copy here; anything else here is the owner's and stays.
        if(!untouchedStarter(old)){kept.push(key);continue;}
      }
      if(old&&row.type==='moments')throw new Error('A previously imported event changed. Preserve the original and apply an explicit event correction before reimporting '+key);
      const record=store.prepare(row.type,{...row,id:known[key]?.id||row.id,import_origin:'menerio'},old);
      prepared.push(record);entries[key]={id:record.id,uid:record.uid,digest};
    }
    // References resolve against the whole staged graph, not import ordering.
    for(const record of prepared)record.references=query.references(record.type,record).map(ref=>{
      const target=prepared.find(r=>r.type===ref.type&&r.id===ref.id);return target?{...ref,uid:target.uid}:ref;
    });
    for(const record of prepared)entries[record.type+'/'+record.id].savedHash=hash(encode(record));
    if(prepared.length)store.commit([...prepared,store.prepare('import_mappings',{id:'menerio',entries},mapping)]);
    return {imported:prepared.length,unchanged,...(kept.length?{kept_as_they_are:kept}:{}),...(leftOut?{left_out:leftOut}:{})};
  });
}

// A JSON file as it was saved. Windows PowerShell 5.1 writes what `>` saves
// as UTF-16 with a byte-order mark, and an editor may add a UTF-8 one; JSON.parse
// read either as "Unexpected token". The move plan (workspace-move) is saved the same way.
export function decodeText(bytes){
  if(bytes[0]===0xff&&bytes[1]===0xfe)return bytes.subarray(2).toString('utf16le');
  if(bytes[0]===0xfe&&bytes[1]===0xff){const swapped=Buffer.from(bytes.subarray(2,2+((bytes.length-2)&~1)));swapped.swap16();return swapped.toString('utf16le');}
  // UTF-16 without a mark: every other byte of "{" and plain JSON is zero.
  if(bytes.length>=4&&bytes[1]===0&&bytes[3]===0&&bytes[0]!==0)return bytes.toString('utf16le');
  return bytes.toString('utf8').replace(/^\uFEFF/,'');
}
// An export file; text that is not JSON gets a plain answer.
export function readExportFile(bytes){
  try{return JSON.parse(decodeText(bytes));}catch{throw new Error('This file is not a notebook export: it is not readable JSON. Make a new one with the export command');}
}
