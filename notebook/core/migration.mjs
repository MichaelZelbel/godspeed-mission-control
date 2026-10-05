import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Store,atomic,encode,hash} from './records/store.mjs';
import {QueryService,tables} from './query.mjs';

const secretColumns=new Set(['access_token','refresh_token','github_token','bot_token','webhook_secret','webhook_url','channel_token','start_page_token','share_token','pairing_code','key_hash','key_prefix','token_hash','token_prefix','auth','password','credentials','code_challenge','caller_hash','user_code']);
const credentialTables=new Set(['godspeed_api_keys','mcp_api_tokens','godspeed_connect_requests','godspeed_devices','user_roles','user_suspensions']);
const operationalTables=new Set(['godspeed_api_usage','github_sync_log','llm_call_fingerprints','vcredit_usage','vcredit_reservations']);
const caches=new Set(['embedding','search_vector']);
const deferredTables=new Set(['note_connections','note_chunks']);
export function scrub(value){
  if(Array.isArray(value))return value.map(scrub);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!secretColumns.has(k)&&!caches.has(k)).map(([k,v])=>[k,scrub(v)]));
  return value;
}
export function identifier(value){if(!/^[a-z_][a-z0-9_-]*$/i.test(value))throw new Error('Invalid source identifier');return '"'+value+'"';}
export function checkedUser(value){if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value))throw new Error('Use the verified source account UUID');return value;}
export function ownership(catalog,user){
  checkedUser(user);const filters=new Map();
  for(const table of catalog){
    if(table.columns.includes('user_id'))filters.set(table.name,alias=>alias+'."user_id"::text=\''+user+'\'');
    else if(table.name==='profiles')filters.set(table.name,alias=>alias+'."id"::text=\''+user+'\'');
    else if(table.name==='activity_events')filters.set(table.name,alias=>alias+'."actor_id"::text=\''+user+'\'');
  }
  // Rows without their own owner must join a proven owned parent, never all rows.
  for(let pass=0;pass<catalog.length;pass++){
    let added=false;
    for(const table of catalog)if(!filters.has(table.name)){
      const links=table.foreignKeys.filter(f=>filters.has(f.parent)&&f.columns.length===f.parentColumns.length);
      if(!links.length)continue;
      const parents=links.map(f=>({f,filter:filters.get(f.parent)}));
      filters.set(table.name,alias=>parents.map(({f,filter},i)=>{const p=alias+'p'+i;return 'exists(select 1 from public.'+identifier(f.parent)+' '+p+' where '+f.columns.map((c,j)=>p+'.'+identifier(f.parentColumns[j])+'='+alias+'.'+identifier(c)).join(' and ')+' and '+filter(p)+')';}).join(' or '));added=true;
    }
    if(!added)break;
  }
  return filters;
}
export async function readPages(source,table,where,{pageSize=200,onPage=()=>{}}={}){
  const rows=[],seen=new Set();let offset=0;
  for(;;){
    const page=await source.page(table,where,offset,pageSize);
    if(!Array.isArray(page))throw new Error('Source returned a malformed page');
    for(const row of page){const id=JSON.stringify(table.primaryKey.map(k=>row[k]));if(seen.has(id))throw new Error('Duplicate or unstable source pagination: '+table.name);seen.add(id);rows.push(scrub(row));}
    offset+=page.length;onPage(offset);if(page.length<pageSize)break;
  }
  return rows;
}
export function safeDestination(root,relative){
  if(typeof relative!=='string'||relative.includes('\\')||relative.split('/').some(p=>p==='..'||p==='.')||path.isAbsolute(relative))throw new Error('Unsafe migration path');
  const target=path.resolve(root,relative);if(!target.startsWith(path.resolve(root)+path.sep))throw new Error('Migration path left its bundle');return target;
}
export async function copyAccount(source,destination,{pageSize=200,onProgress=()=>{},resume=false}={}){
  const existing=fs.existsSync(destination);
  if(existing&&!resume)throw new Error('Copy requires a new empty directory');
  fs.mkdirSync(destination,{recursive:true,mode:0o700});
  const catalog=await source.catalog(),filters=ownership(catalog,source.user),manifest=existing?JSON.parse(fs.readFileSync(path.join(destination,'migration.json'),'utf8')):{format:1,sourceProject:source.project,sourceUser:source.user,createdAt:new Date().toISOString(),complete:false,tables:[],files:[],excluded:[],unowned:[],media:[]};
  if(manifest.format!==1||manifest.complete||manifest.sourceProject!==source.project||manifest.sourceUser!==source.user)throw new Error('Only an incomplete copy of this account can resume');
  const save=()=>atomic(path.join(destination,'migration.json'),JSON.stringify(manifest,null,2));save();
  const all={};
  for(const table of catalog){
    if(credentialTables.has(table.name)||operationalTables.has(table.name)){manifest.tables=manifest.tables.filter(t=>t.name!==table.name);manifest.files=manifest.files.filter(f=>f.path!=='source/'+table.name+'.json');if(!manifest.excluded.some(t=>t.table===table.name))manifest.excluded.push({table:table.name,reason:credentialTables.has(table.name)?'Account access or credential records are not migrated':'Generated connection usage or quota telemetry is not personal content'});continue;}
    if(!filters.has(table.name)){manifest.unowned.push(table.name);continue;}
    if(!table.primaryKey.length)throw new Error('Owned table has no stable paging key: '+table.name);
    const where=filters.get(table.name)('s'),before=await source.fingerprint(table,where);
    const prior=manifest.tables.find(t=>t.name===table.name);
    if(prior){if(before.count!==prior.count||before.digest!==prior.sourceDigest)throw new Error('Source changed since the interrupted copy: '+table.name);const file=manifest.files.find(f=>f.path==='source/'+table.name+'.json');if(!file||hash(fs.readFileSync(safeDestination(destination,file.path)))!==file.sha256)throw new Error('Interrupted copy failed its integrity check');all[table.name]=JSON.parse(fs.readFileSync(safeDestination(destination,file.path),'utf8'));onProgress({table:table.name,count:prior.count,resumed:true});continue;}
    const rows=await readPages(source,table,where,{pageSize:before.count>10000?5000:pageSize,onPage:count=>onProgress({table:table.name,count,inProgress:true})});
    const after=await source.fingerprint(table,where);
    if(before.count!==rows.length||before.count!==after.count||before.digest!==after.digest)throw new Error('Source changed during copy; retry in new storage: '+table.name);
    const relative='source/'+table.name+'.json',content=JSON.stringify(rows,null,2);atomic(safeDestination(destination,relative),content);
    manifest.tables.push({name:table.name,count:rows.length,primaryKey:table.primaryKey,sourceDigest:after.digest});manifest.files.push({path:relative,sha256:hash(content)});all[table.name]=rows;save();onProgress({table:table.name,count:rows.length});
  }
  const objects=await source.media(all);
  for(const object of objects){
    if(manifest.media.some(m=>m.bucket===object.bucket&&m.name===object.name))continue;
    const id=hash(object.bucket+'/'+object.name),relative='media/'+id,content=await source.download(object);
    if(object.size!=null&&content.length!==Number(object.size))throw new Error('Media size mismatch');
    if(object.sha256&&hash(content)!==object.sha256)throw new Error('Media source digest mismatch');
    atomic(safeDestination(destination,relative),content);manifest.files.push({path:relative,sha256:hash(content)});manifest.media.push({...object,path:relative,sha256:hash(content),size:content.length});save();
  }
  // Check every table again: separate pages must not silently mix changing data.
  const final=source.fingerprints?await source.fingerprints(manifest.tables.map(entry=>({table:catalog.find(t=>t.name===entry.name),where:filters.get(entry.name)('s')}))):null;
  for(const entry of manifest.tables){const table=catalog.find(t=>t.name===entry.name),current=final?.find(r=>r.name===entry.name)||await source.fingerprint(table,filters.get(entry.name)('s'));if(current.count!==entry.count||current.digest!==entry.sourceDigest)throw new Error('Source changed before verification: '+entry.name);}
  manifest.complete=true;manifest.verifiedAt=new Date().toISOString();save();return manifest;
}
export function verifyBundle(root){
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'migration.json'),'utf8'));
  if(manifest.format!==1||!manifest.complete)throw new Error('Migration copy is incomplete');
  for(const file of manifest.files)if(hash(fs.readFileSync(safeDestination(root,file.path)))!==file.sha256)throw new Error('Migration integrity mismatch: '+file.path);
  for(const table of manifest.tables){const rows=JSON.parse(fs.readFileSync(safeDestination(root,'source/'+table.name+'.json')));if(rows.length!==table.count)throw new Error('Migration count mismatch');}
  return manifest;
}
function stableId(table,row,key){return row.id||'source-'+createHash('sha256').update(table+'/'+JSON.stringify(key.map(k=>row[k]))).digest('hex').slice(0,32);}
export function stageAccount(bundle,destination,{disposable=false}={}){
  const manifest=verifyBundle(bundle);if(fs.existsSync(destination))throw new Error('Stage requires new empty storage; existing notes are never overwritten');
  const store=new Store(destination),query=new QueryService(store),records=[],archived=[];
  for(const table of manifest.tables){
    const rows=JSON.parse(fs.readFileSync(path.join(bundle,'source',table.name+'.json')));
    // Unsupported screens still retain all of their source records in the archive.
    if(!tables.has(table.name)||deferredTables.has(table.name)||table.name.endsWith('_connections')||['connected_apps','shared_notes','user_mcp_servers'].includes(table.name)){if(rows.length)archived.push({table:table.name,count:rows.length,reason:deferredTables.has(table.name)?'Graph and chunk data retained in the source archive; graph screen is not available yet':'Source-only feature or connection configuration retained without activation'});continue;}
    for(const row of rows){
      const sourceId=stableId(table.name,row,table.primaryKey),id=table.name==='profiles'?'owner':sourceId;
      const value={...row,id,uid:sourceId,user_id:'owner',aliases:[...new Set([...(row.aliases||[]),...(id!==sourceId?[sourceId]:[])])],metadata:{...row.metadata,menerio_source_user:manifest.sourceUser,menerio_source_id:sourceId,menerio_source_table:table.name}};
      if(table.name==='contact_groups'){value.group_type=row.type;value.is_archived=!!row.archived_at;}
      if(table.name==='contact_interactions')value.interaction_type=row.type;
      if(table.name==='moments'&&row.deleted_at)value.removed_at=row.deleted_at;
      if(table.name==='profile_entries_archive')value.metadata.archived_profile_entry=true;
      const record=store.prepare(table.name,value);if(row.created_at)record.created_at=row.created_at;if(row.updated_at)record.updated_at=row.updated_at;records.push(record);
    }
  }
  const identities=new Map();for(const r of records)for(const id of [r.id,...r.aliases])identities.set(r.type+'/'+id,r);query.store={get:(type,id)=>identities.get(type+'/'+id)};
  for(const record of records)record.references=query.references(record.type,record);
  const unavailable=[];
  for(const record of [...records])for(const ref of record.references)if(!identities.has(ref.type+'/'+ref.id)){
    // Legacy source timelines can retain people IDs after those contacts disappear.
    // A hidden tombstone keeps that historical edge without inventing person facts.
    if(ref.type!=='contacts'||!/^[a-f0-9-]{36}$/i.test(ref.id))throw new Error('A source relationship has an unavailable target: '+ref.type);
    const digest=hash('migration-reference/'+ref.type+'/'+ref.id),uid=digest.slice(0,8)+'-'+digest.slice(8,12)+'-5'+digest.slice(13,16)+'-a'+digest.slice(17,20)+'-'+digest.slice(20,32);
    const tombstone=store.prepare('contacts',{id:ref.id,uid,removed_at:manifest.verifiedAt,ai_visibility:'hidden',metadata:{migration_unavailable_source:true,source_id:ref.id},references:[]});records.push(tombstone);identities.set('contacts/'+ref.id,tombstone);unavailable.push({type:'contacts',id:ref.id});
  }
  for(const record of records)for(const ref of record.references){const target=identities.get(ref.type+'/'+ref.id);if(target)ref.uid=target.uid;}
  if(disposable){
    // A preview can be rebuilt from the verified source. Avoid thousands of
    // synchronous journal flushes for this private, noncanonical staging copy.
    // Names are given for the whole set at once, so two notes with one title
    // get " 2" instead of the second overwriting the first.
    const {targets}=store.planPaths(records);
    for(const record of records){const file=path.join(store.recordsRoot,...targets.get(record.type+'/'+record.id).split('/'));fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,encode(record));}
  }else store.withLock(()=>store.commit(records));
  store.scan();if(store.problems.length)throw new Error('Migrated references need review; the staged copy was retained');
  // Complete sanitized source archive lives outside synced knowledge and model context.
  const archive=path.join(store.state,'migration-source');fs.mkdirSync(archive,{recursive:true,mode:0o700});for(const entry of manifest.files){const target=safeDestination(archive,entry.path);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(safeDestination(bundle,entry.path),target);}atomic(path.join(archive,'migration.json'),JSON.stringify(manifest,null,2));
  const mediaRoot=path.join(store.state,'media');fs.mkdirSync(mediaRoot,{recursive:true});
  for(const media of manifest.media){
    const original=media.name,filename=media.sha256+'-'+path.posix.basename(original).replace(/[^a-zA-Z0-9_.-]/g,'_');fs.copyFileSync(safeDestination(bundle,media.path),path.join(mediaRoot,filename));
    const mapping={path:original,file:filename,sha256:media.sha256,size:media.size,contentType:media.contentType||'application/octet-stream'};
    const mappingFile=path.join(mediaRoot,hash(original)+'.mapping.json');if(fs.existsSync(mappingFile))throw new Error('Same storage path appears in multiple buckets; review retained copy');atomic(mappingFile,JSON.stringify(mapping));
  }
  const report={format:1,sourceProject:manifest.sourceProject,sourceUser:manifest.sourceUser,stagedRecords:records.length,sourceRows:manifest.tables.reduce((n,t)=>n+t.count,0),notes:store.list('notes').length,contacts:store.list('contacts').length,media:manifest.media.length,archivedTables:archived,unavailableSourceReferences:unavailable,referenceProblems:store.problems,sourceUnchanged:true,automaticSyncConfigured:false,providerConfigured:false};
  atomic(path.join(store.state,'migration-report.json'),JSON.stringify(report,null,2));return report;
}
