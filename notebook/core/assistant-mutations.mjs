import {visibleRows} from './visibility.mjs';
import {QueryService} from './query.mjs';

// Validate current records and their complete reference graph, rather than a
// previously supplied prompt or the patch's replacement owner fields.
export function assertAssistantRecord(query,type,id,seen=new Set()) {
 const record=query.store.get(type,id),key=type+'/'+record?.id;
 if(!record||record.removed_at||record.is_trashed||!visibleRows(query,type).some(r=>r.id===record.id))throw Error('Choose a visible existing record');
 if(type==='claims'&&!visibleRows(query,'profile_facts').some(r=>r.id===record.id&&r.show_to_agent))throw Error('This fact is hidden from the assistant');
 if(seen.has(key))return record;seen.add(key);
 assertAssistantLinks(query,type,record,seen);return record;
}
export function assertAssistantLinks(query,type,value,seen=new Set(),historicalTargets=new Set()) {
 for(const ref of [...value.references||[],...query.references(type,value)])assertAssistantRecord(query,ref.type,ref.id,seen);
 if(type==='notes')for(const id of value.related||[])assertAssistantRecord(query,'notes',id,seen);
 if(type==='review_queue'){
  if(value.payload)assertAssistantLinks(query,type,value.payload,seen);
  for(const target of value.applied_targets||[]){const table=target.type==='claim'?'claims':target.type;if(!historicalTargets.has(table+'/'+target.id))assertAssistantRecord(query,table,target.id,seen);}
 }
}
// Records that decide what an assistant may see, approve, share, run or be
// told. No assistant writes them, through any tool: until 6 October 2026
// save_record could switch off hide_sensitive_from_ai, record the owner's
// approval, open an anonymous public share and plant standing instructions.
// An explicit personal operation (pause a routine, switch the journal off)
// keeps its own schedules, settings and receipts; its code writes those rows,
// never the model's values.
export const controlTables=new Set(['mcp_preferences','approvals','shared_notes','permissions','user_roles','agent_instructions','mcp_api_tokens','user_mcp_servers','connected_apps','discord_connections','gdrive_connections','github_connections','godspeed_connections','telegram_connections','import_mappings','gdrive_imports','github_sync_log','jobs','job_receipts','work_tool_receipts','command_receipts','settings','notification_preferences','ai_suggestion_preferences','record_history','embeddings','profiles']);
const operationTables=new Set(['jobs','settings','command_receipts']);
// What the generic save_record writes: the owner's notes, people, things,
// timeline, collections, Lexicon pages and actions, and proposed facts as
// review items. Facts themselves go through write_fact and review; goals,
// routines and health through personal_operation.
export const assistantRecordTables=new Set(['notes','note_folders','note_connections','comments','contacts','contact_interactions','contact_relationships','contact_groups','contact_group_memberships','person_documents','entities','moments','moment_participants','moment_entities','collections','collection_items','collection_item_folders','wiki_pages','wiki_page_sources','action_items','review_queue']);
const instructionsRefused='Only the owner changes the instructions assistants follow. Tell them what you would change.';
export function assertAssistantTable(type,toolName){
 if(type==='agent_instructions')throw Error(instructionsRefused);
 if(controlTables.has(type)&&!(toolName==='personal_operation'&&operationTables.has(type)))throw Error('This record controls what assistants may see or do. Only the owner changes it.');
 // A changed moment is kept as a correction of it (query.mjs).
 if(toolName==='save_record'&&!assistantRecordTables.has(type)&&type!=='event_corrections')throw Error('save_record cannot write '+type+' records. Use the tool made for them.');
}
// Records a key's scopes cover beyond toolScope's prefixes. Anything else
// a key cannot write.
const derivedScopes={event_corrections:'world',user_self_aliases:'profile',note_attachments:'notes'};
export function assistantMutationContext({store,query,domains,scopes},input,toolName) {
 const ownerStore=store,guard=Object.create(store),expected=input.expected||input.expected_hashes||{};
 ownerStore.scan();const initialUids=new Set([...ownerStore.records.values()].map(r=>r.uid));
 guard.scan=()=>{ownerStore.scan();guard.records=ownerStore.records;return guard.records;};
 guard.get=(type,id)=>{const record=ownerStore.get(type,id);if(record)assertAssistantRecord(query,type,id);return record;};
 const guardedQuery=new QueryService(guard);
 guard.commit=(records,options={})=>{
  guardedQuery.withSnapshot(()=>{
   for(const next of records){
    assertAssistantTable(next.type,toolName);
    const old=ownerStore.records.get(next.type+'/'+next.id)||[...ownerStore.records.values()].find(r=>r.uid===next.uid);
    if(next.type==='collections'&&(next.agent_instructions??null)!==(old?.agent_instructions??null))throw Error(instructionsRefused);
    if(old){
     const current=assertAssistantRecord(guardedQuery,old.type,old.id),supplied=expected[old.type+'/'+old.id]||expected[old.id]||(old.id===input.id||old.id===input.value?.id?input.expected_hash||input.expected:undefined)||input.options?.expected?.[old.id]||(old.id===(input.options?.target||input.options?.target_id)?input.options?.expected_hash:undefined)||(old.type==='contact_topics'&&old.id===input.topic_id&&old.version===input.expected_version?current._hash:undefined);
     if(initialUids.has(old.uid)){
      if(typeof supplied!=='string'||!supplied.trim())throw Error('Read the current record hash before editing');
      if(supplied!==current._hash)ownerStore.conflict(old.type,next,current);
     }
    }
    // A record no scope covers is one no key may write (until 6 October 2026 it was allowed).
    if(scopes){const scope=domains.toolScope?.(next.type)||derivedScopes[next.type]||(toolName==='personal_operation'?'actions':null);if(!scope||!scopes.includes(scope))throw Error('This key cannot change a linked record domain');}
   }
   for(const key of options.removeKeys||[]){const old=ownerStore.records.get(key);if(old){assertAssistantTable(old.type,toolName);assertAssistantRecord(guardedQuery,old.type,old.id);}}
   const projected=Object.create(guard);projected.records=new Map(guard.records);projected.scan=()=>projected.records;projected.get=(type,id)=>projected.records.get(type+'/'+id)||[...projected.records.values()].find(r=>r.type===type&&(r.aliases||[]).includes(id));
   for(const key of options.removeKeys||[])projected.records.delete(key);
   for(const next of records)projected.records.set(next.type+'/'+next.id,next);
   const projectedQuery=new QueryService(projected);for(const next of records){
    const historicalTargets=new Set(),prior=ownerStore.records.get('review_queue/'+next.id);
    // A rollback receipt describes what was written, including records this
    // same authorized Undo now tombstones. Its original targets were already
    // visibility/version checked above; they are not new projected links.
    if(toolName==='review_suggestions'&&['rollback','remove','block','reject','never_again'].includes(input.action||input.decision)&&next.type==='review_queue'&&['removed','blocked'].includes(next.status)&&next.rolled_back_at&&prior?.undo_receipt_version===1&&prior.undo_supported!==false&&JSON.stringify(next.applied_targets)===JSON.stringify(prior.applied_targets)){
     for(const target of prior.applied_targets||[]){
      const table=target.type==='claim'?'claims':target.type,key=table+'/'+target.id,current=ownerStore.records.get(key),after=projected.records.get(key);
      if(!target.before&&!target.shared&&current?._hash===target.after_hash&&after?.uid===current.uid&&after.removed_at&&records.some(record=>record.type===table&&record.id===target.id&&record.removed_at))historicalTargets.add(key);
     }
    }
    assertAssistantLinks(projectedQuery,next.type,next,new Set(),historicalTargets);
   }
  });
  return ownerStore.commit(records,options);
 };
 const guardedDomains=Object.assign(Object.create(Object.getPrototypeOf(domains)),domains,{store:guard,query:guardedQuery,assistant:true});
 return {store:guard,query:guardedQuery,domains:guardedDomains};
}
