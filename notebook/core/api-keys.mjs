import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {atomic,hash} from './records/store.mjs';
export class ApiKeys {
  constructor(store){this.state=store.state;this.file=path.join(store.state,'api-keys.json');}
  rows(){return fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):[];}
  write(rows){atomic(this.file,JSON.stringify(rows));fs.chmodSync(this.file,0o600);}
  authenticate(token){return this.rows().find(k=>k.is_active&&(!k.expires_at||Date.parse(k.expires_at)>Date.now())&&k.hash===hash(token));}
  // On a server the installation's own assistant reaches /mcp with a key of its
  // own (wire-assistant.mjs keeps it in assistant-mcp.json). Every other key is
  // one the owner gave another program: delegated, it acts within its scopes
  // and never as the owner (personal-operations.mjs).
  installationAssistant(row){
    if(!row)return false;
    let key=null;try{key=JSON.parse(fs.readFileSync(path.join(this.state,'assistant-mcp.json'),'utf8')).key;}catch{}
    return typeof key==='string'&&key.length>0&&row.hash===hash(key);
  }
  invoke(name,input){
    if(name==='mc-api-keys')return {keys:this.rows().map(({hash,...k})=>k)};
    if(name==='mc-api-keys/generate'){const scopes=input.scopes||[];if(!input.name?.trim()||!scopes.length||scopes.some(s=>!['profile','notes','contacts','actions','media','stats','world','collections'].includes(s)))throw new Error('Choose a key name and supported scopes');const token='godspeed_'+randomBytes(32).toString('hex'),row={id:randomUUID(),name:input.name,scopes,hash:hash(token),key_prefix:token.slice(0,17),created_at:new Date().toISOString(),expires_at:input.expires_at||null,is_active:true};this.write([...this.rows(),row]);return {api_key:token,id:row.id};}
    const id=name.slice('mc-api-keys/'.length);this.write(this.rows().map(r=>r.id===id?{...r,is_active:false,revoked_at:new Date().toISOString()}:r));return {revoked:true};
  }
}
// What a key may read follows what a record is, wherever a tool reads it:
// a fact about the owner needs "profile", a fact about someone else
// "contacts", and "world" covers every fact; a note the coach, the journal, a
// habit check, a goal, an obligation or the morning brief wrote needs
// "actions" as well as "notes". Until 7 October 2026 scope followed the table
// a tool read, so a key holding only "notes" read facts through search_brain,
// and every check-in through the note tools. The key's view of the records
// (scopedQuery) is what every tool of that call reads.
const personalSource=/^(coach|journal|habit|health|headache|goal|due|obligation|morning-brief)/;
export const personalNote=note=>!!(note.goal_id||note.work_id||(Array.isArray(note.habit_ids)&&note.habit_ids.length)||personalSource.test(String(note.source_app||'')));
const factAllowed=(scopes,row)=>{const about=row.subject_type||row.subject_kind;return scopes.includes('world')||(about==='self'?scopes.includes('profile'):about==='contact'&&scopes.includes('contacts'));};
export function scopedQuery(query,scopes){
  if(!Array.isArray(scopes))return query;
  const view=Object.create(query),rows=query.rows;
  view.rows=function(table){
    const all=rows.call(this,table);
    if(table==='notes'&&!scopes.includes('actions'))return all.filter(note=>!personalNote(note));
    if(['claims','profile_facts','world_claims','fact_slots'].includes(table))return all.filter(row=>factAllowed(scopes,row));
    return all;
  };
  return view;
}
export function toolScope(name,args){
  if(['list_contact_topics','get_contact_topic_history','create_contact_topic','update_contact_topic','discuss_contact_topic','archive_contact_topic','reopen_contact_topic','undo_contact_topic_event'].includes(name))return 'contacts';
  if(name==='personal_operation')return 'actions';
  if(['search_knowledge','validate_knowledge','get_stats'].includes(name))return 'stats';
  // Menerio's names (server/memory-tools.mjs).
  if(['search_brain','list_recent','list_recent_notes','trash_note','lexicon_search'].includes(name))return 'notes';
  if(name==='get_user_profile')return 'profile';
  if(['search_contacts','get_contact_context','get_contact_profile','get_person_notes','log_interaction'].includes(name))return 'contacts';
  if(['get_claims','add_claim','create_moment_with_ai','search_moments','search_entities','get_entity_context'].includes(name))return 'world';
  if(['list_collections','get_collection_schema','list_collection_items','add_collection_item','update_collection_item','search_all_collections'].includes(name))return 'collections';
  if(['capture_note','list_note_folders','search_notes','get_note','update_note','retrieve_memory'].includes(name))return 'notes';
  if(['write_fact','record_event'].includes(name))return 'world';
  if(name==='review_suggestions')return 'profile';
  const type=args.type||'';return /^(contacts|contact_|person_)/.test(type)?'contacts':/^(claims|entities|moments|moment_|world_)/.test(type)?'world':/^(profile|fact_|agent_|review_|ai_suggestion)/.test(type)?'profile':/^collection/.test(type)?'collections':/^media|attachment/.test(type)?'media':/^(action|goal|work_|deadline|habit|obligation|forecast|journal|coach)/.test(type)?'actions':/^(note|comments|conversation|wiki_)/.test(type)?'notes':null;
}
