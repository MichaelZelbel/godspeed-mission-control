import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { slug, hash, identityIds } from './records/store.mjs';
import {nativeRows} from './native-personal.mjs';
import {dueRows} from './native-due.mjs';
import {assertAssistantRecord,assertAssistantLinks} from './assistant-mutations.mjs';
import {nativeJobs} from './native-scheduler.mjs';
import {nativeCardRows} from './card-commands.mjs';

const inventory = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../../docs/full-version/source-inventory.json', import.meta.url)), 'utf8'));
export const tables = new Set(inventory.dependencies.flatMap(d => d.tables).filter(t => t !== 'note-attachments'));
for (const table of ['goals', 'jobs', 'job_receipts', 'settings', 'permissions', 'decisions', 'habits', 'journal', 'deadlines', 'comments', 'notifications', 'note_conversations', 'import_mappings','record_history','event_corrections','embeddings']) tables.add(table);
for(const table of ['health_episodes','medications','health_observations','watch_topics','watch_observations','outside_numbers','subscriptions','forecasts','work_items','coach_talks','connector_status','work_tool_receipts','approvals','command_receipts'])tables.add(table);
const views = new Set(['world_entities', 'world_events', 'world_claims', 'profile_facts', 'v_ai_allowance_current','coach_talks','habits','journal']);
for(const table of ['watch_candidates','watch_runs','watch_findings'])tables.add(table);
for(const table of ['lead_entries','lead_runs','lead_examples','lead_positions','lead_contacts','lead_market','radar_decisions','radar_trials','radar_trial_results'])tables.add(table);
tables.add('lead_measurements');
tables.add('lead_comparisons');
const defaults = {
  contacts: { notes: null, app_mappings: {}, merged_into: null, is_favorite: false, is_sensitive: false, last_viewed_at: null },
  contact_groups:{is_archived:false,is_trashed:false,parent_group_id:null,sensitivity:'normal',group_type:'custom',stages:[],success_criteria:[],attributes_schema:{},status:'active'},
  contact_group_memberships:{status:'new',position:0,attributes:{},notes:null},
  entities: { description: null, entity_type: 'other', ai_visibility: 'visible', is_sensitive: false },
  collections: { field_schema: [], visibility: 'personal', icon: null, description: null, agent_instructions: null, settings: {} },
  collection_items: { data: {}, is_favorite: false, folder_id: null, last_viewed_at: null },
  profile_categories: { contact_id: null, sort_order: 0, visibility_scope: 'personal', icon: 'User' },
  claims: { subject_type: 'self', subject_id: null, valid_to: null, valid_from: null, confidence: 'confirmed', cardinality: 'one', source_type: 'manual', origin: 'manual' },
  fact_slots: { subject_type: 'self', subject_id: null, contact_id: null, category_slug: null, show_to_agent: true, is_pinned: false, cardinality: 'one' },
  review_queue: { status: 'pending_review', payload: {}, is_sensitive: false, applied_at: null, blocked_at: null, snoozed_until: null, reviewed_at: null, source_note_id: null },
  moments: { description: null, happened_end: null, person_id: null, category: null, status: 'confirmed', ai_visibility: 'visible', participants: [], metadata: {} },
  contact_relationships: { status: 'confirmed', confidence: 'confirmed', valid_to: null, metadata: {} },
  profiles: { display_name: 'Owner', timezone: 'UTC', preferences: {} },
};
const links = { contact_id: 'contacts', person_id: 'contacts', note_id: 'notes', source_note_id: 'notes', linked_note_id: 'notes',
  collection_id: 'collections', folder_id: 'collection_item_folders', moment_id: 'moments', entity_id: 'entities',
  from_contact_id: 'contacts', to_contact_id: 'contacts', parent_folder_id: 'collection_item_folders', claim_id: 'claims', slot_id: 'fact_slots', category_id: 'profile_categories', group_id: 'contact_groups',parent_group_id:'contact_groups',target_note_id:'notes',evidence_note_id:'notes',document_id:'notes',topic_id:'contact_topics' };
function splitFilters(text){let depth=0,quoted=false,part='',items=[];for(const c of text){if(c==='"')quoted=!quoted;if(!quoted&&c==='(')depth++;if(!quoted&&c===')')depth--;if(c===','&&!depth&&!quoted){items.push(part);part='';}else part+=c;}if(part)items.push(part);return items;}
function filterExpression(row,text){
  for(const op of ['and','or'])if(text.startsWith(op+'(')&&text.endsWith(')')){const results=splitFilters(text.slice(op.length+1,-1)).map(p=>filterExpression(row,p));return op==='and'?results.every(Boolean):results.some(Boolean);}
  const match=text.match(/^(.+?)\.(not\.)?(eq|neq|is|in|like|ilike|gt|gte|lt|lte)\.([\s\S]*)$/);if(!match)throw new Error('Invalid filter expression');
  let value=match[4];if(value.startsWith('"')&&value.endsWith('"'))value=value.slice(1,-1).replaceAll('\\"','"');else if(value==='null')value=null;else if(value==='true'||value==='false')value=value==='true';
  if(match[3]==='in')value=splitFilters(String(value).replace(/^\(|\)$/g,''));
  const result=condition(row,[match[3],match[1],value]);return match[2]?!result:result;
}
function getValue(row, key) { return key.replaceAll('->>', '.').replaceAll('->', '.').split('.').reduce((v, k) => v?.[k], row); }
function contains(a, b) { return Array.isArray(b) ? b.every(v => (a || []).includes(v)) : b && typeof b === 'object' ? Object.entries(b).every(([k, v]) => contains(a?.[k], v)) : a === b; }
function condition(row, [op, key, value]) {
  const a = getValue(row, key);
  switch (op) {
    case 'eq': return a === value; case 'neq': return a !== value;
    case 'is': return value === null ? a == null : a === value;
    case 'in': return value.includes(a); case 'contains': return contains(a, value);
    case 'overlaps': return (a || []).some(x => value.includes(x));
    case 'gt': return a > value; case 'gte': return a >= value; case 'lt': return a < value; case 'lte': return a <= value;
    case 'like': case 'ilike': {
      const expression = String(value).split('').map(c => c === '%' ? '.*' : c === '_' ? '.' : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('');
      return new RegExp('^' + expression + '$', op === 'ilike' ? 'i' : '').test(String(a ?? ''));
    }
    case 'not': return !condition(row, [value[0], key, value[1]]);
    case 'or': return splitFilters(String(value)).some(part=>filterExpression(row,part));
    default: throw new Error('Unsupported filter ' + op);
  }
}
// The columns a selection names, as a database would return them; null for
// "everything" or for anything this does not understand. The id and the
// version hash always come along: the dashboard needs both to save safely.
// Sending every column regardless sent the notes list as 63 MB of full text.
export function projection(selection){
  const text=String(selection??'*').trim();if(!text||text==='*')return null;
  const items=[];let depth=0,part='';for(const c of text){if(c==='(')depth++;if(c===')')depth--;if(c===','&&!depth){items.push(part.trim());part='';}else part+=c;}if(part.trim())items.push(part.trim());
  const keys=new Set(['id','_hash']);
  for(const item of items){
    if(item==='*')return null;
    const join=item.match(/^(?:(\w+):)?(\w+)(?:!\w+)?\s*\(/);if(join){keys.add(join[1]||join[2]);continue;}
    const plain=item.match(/^\w+$/);if(plain){keys.add(item);continue;}
    return null;
  }
  return keys;
}
export class QueryService {
  constructor(store) { this.store = store; }
  withSnapshot(read){if(!this.snapshotDepth)this.store.scan();this.snapshotDepth=(this.snapshotDepth||0)+1;try{return read();}finally{this.snapshotDepth--;}}
  rows(table) {
    if(table==='jobs'&&this.nativeHermesHome)return nativeJobs(this.nativeHermesHome,this.store.device);
    if(this.nativeHermesHome&&['goals','forecasts','work_items'].includes(table))return nativeCardRows(this.store,table);
    if(!this.snapshotDepth)this.store.scan();
    // Records of one type come from the store's per-type lists: filtering all
    // sixteen thousand records once per table and query added up.
    let everything=null;const all=()=>everything||=[...this.store.records.values()];
    const ofType=type=>typeof this.store.ofType==='function'?this.store.ofType(type):all().filter(r=>r.type===type);
    const memo=new Map(),list = type => {
      if(memo.has(type))return memo.get(type);
      const values=ofType(type).filter(r=>!r.removed_at);if(type==='deadlines')values.push(...dueRows(this.store));
      if(type!=='moments'){memo.set(type,values);return values;}
      const byMoment=new Map();for(const c of ofType('event_corrections')){let l=byMoment.get(c.moment_id);if(!l)byMoment.set(c.moment_id,l=[]);l.push(c);}
      const corrected=values.map(original=>{const corrections=(byMoment.get(original.id)||[]).slice().sort((a,b)=>a.sequence-b.sequence||a.id.localeCompare(b.id));return corrections.reduce((r,c)=>({...r,...c.patch,_hash:c._hash}),original);}).filter(r=>!r.removed_at);
      memo.set(type,corrected);return corrected;
    };
    const get=(type,id)=>this.store.records.get(type+'/'+id)||ofType(type).find(r=>(r.former_ids||[]).includes(id))||ofType(type).find(r=>(r.aliases||[]).includes(id));
    if (table === 'world_entities') return [...list('contacts').map(r => ({ ...r, source_table: 'contact', kind: 'person', description: r.notes || null, ai_visibility: r.ai_visibility || 'visible' })), ...list('entities').map(r => ({ ...r, source_table: 'entity', kind: r.entity_type }))];
    if (table === 'world_events') return list('moments').map(r => ({ ...r, source_table: 'moment' }));
    if (table === 'world_claims') return [...this.rows('profile_facts').filter(r=>r.visibility_scope!=='private').map(r=>({...r,id:r.claim_id,source_table:'claim',subject_kind:r.subject_type,category:r.category_slug||'other',object_id:null,source_kind:r.source_type,source_ref:r.source_id})),...list('contact_relationships').map(r=>({...r,source_table:'contact_relationship',subject_kind:r.source_type,subject_id:r.source_id,category:'relationship',attribute:'relationship',value:r.custom_label||r.label,object_id:r.target_id,cardinality:'many',confidence:r.confidence||'likely'}))];
    if (table === 'profile_facts') {
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: list('profiles')[0]?.timezone || 'UTC' }).format(new Date());
      return list('claims').map(r => {
      const slot = list('fact_slots').find(s => s.subject_type === r.subject_type && s.subject_id === r.subject_id && s.attribute === r.attribute);
      const category = list('profile_categories').find(s => s.slug === slot?.category_slug && (s.contact_id || null) === (r.subject_type === 'contact' ? r.subject_id : null));
      return { ...r, claim_id: r.id, contact_id: r.subject_type === 'contact' ? r.subject_id : null, is_current: (!r.valid_to || r.valid_to > today) && (!r.valid_from || r.valid_from <= today),
        slot_id: slot?.id || null, label: slot?.label || r.attribute, category_slug: slot?.category_slug || null, category_name: category?.name || null,
        cardinality:slot?.cardinality||r.cardinality,visibility_scope: category?.visibility_scope || 'all', show_to_agent: slot?.show_to_agent ?? false, is_pinned: slot?.is_pinned ?? false, has_conflict: (slot?.cardinality||r.cardinality)!=='many'&&list('claims').filter(c=>c.subject_type===r.subject_type&&c.subject_id===r.subject_id&&c.attribute===r.attribute&&(!c.valid_from||c.valid_from<=today)&&(!c.valid_to||c.valid_to>today)).length>1 };
      });
    }
    if (table === 'v_ai_allowance_current') return [];
    if(table==='notifications')return list(table).map(r=>{
      const note=r.record_id?get('notes',r.record_id):null;
      return {...r,title:r.title||note?.title||'Godspeed needs your attention',body:r.body||r.message||r.reason||note?.content||null,link:r.link||(note&&!note.is_trashed?'/dashboard/notes/'+note.id:'/dashboard/settings'),is_read:r.is_read??r.status==='resolved'};
    });
    if(table==='conversation_messages')return list(table).map(r=>({...r,person_id:r.person_id||r.contact_id||null}));
    if(table==='activity_events'){
      const tracked=new Set(['notes','contacts','claims','entities','collections','collection_items','moments','contact_groups','contact_group_memberships','action_items','contact_topics','profile_categories','fact_slots']);
      const label={notes:'note',contacts:'person',claims:'fact',entities:'world entity',collections:'collection',collection_items:'collection item',moments:'event',contact_groups:'group',contact_group_memberships:'group membership',action_items:'action',contact_topics:'discussion topic',profile_categories:'profile category',fact_slots:'fact setting'};
      const current=all().filter(r=>tracked.has(r.type)),prior=list('record_history').filter(r=>tracked.has(r.source_type)).map(r=>r.snapshot),versions=[...prior,...current];
      const derived=versions.map(r=>({id:'activity-'+hash([r.uid,r.revision,r.updated_at]).slice(0,32),actor_id:'owner',user_id:'owner',item_id:r.id,item_type:label[r.type],action:r.removed_at?'delete':r.revision===1?'create':'update',created_at:r.updated_at,metadata:{source_uid:r.uid,revision:r.revision}}));
      for(const r of list('event_corrections'))derived.push({id:'activity-'+r.uid,actor_id:'owner',user_id:'owner',item_id:r.moment_id,item_type:'event',action:r.patch.removed_at?'delete':'update',created_at:r.created_at,metadata:{correction:true}});
      return [...new Map([...list(table),...derived].map(r=>[r.id,r])).values()];
    }
    if(table==='weekly_reviews')return list(table).map(r=>({...r,review_data:{...r.review_data,gaps:typeof r.review_data?.gaps==='string'?[r.review_data.gaps]:r.review_data?.gaps||[]}}));
    if(table==='collection_items')return list(table).map(r=>{const collection=get('collections',r.collection_id),primary=collection?.field_schema?.find(f=>f.primary),title=primary?r.data?.[primary.key]:r.title;return {...defaults.collection_items,...r,title:title==null?'Untitled':String(title)};});
    return [...list(table),...(['coach_talks','habits','journal','health_episodes','medications'].includes(table)?nativeRows(this.store,table):[])].map(r => ({ ...(defaults[table] || {}), ...r,...table==='contact_groups'?{type:r.group_type||'custom'}:table==='contact_group_memberships'?{last_movement_at:r.last_movement_at||r.created_at}:{} }));
  }
  references(type, value) {
    const refs = [...(value.references || [])].filter(r => !r.field);
    for (const [key, target] of Object.entries(links)) if (value[key]) {
      const record = this.store.get(target, value[key]); refs.push({ type: target, id: value[key], ...(record ? { uid: record.uid } : {}), field: key });
    }
    if (value.subject_id && ['contact', 'entity'].includes(value.subject_type)) {
      const target = value.subject_type === 'contact' ? 'contacts' : 'entities', record = this.store.get(target, value.subject_id);
      refs.push({ type: target, id: value.subject_id, ...(record ? { uid: record.uid } : {}), field: 'subject_id' });
    }
    if(type==='claims'&&value.source_id&&['note','moment'].includes(value.source_type)){const target=value.source_type==='note'?'notes':'moments',record=this.store.get(target,value.source_id);refs.push({type:target,id:value.source_id,...record?{uid:record.uid}:{},field:'source_id'});}
    if(type==='contact_relationships')for(const end of ['source','target'])if(value[end+'_id']&&['contact','entity'].includes(value[end+'_type'])){
      const target=value[end+'_type']==='contact'?'contacts':'entities',id=value[end+'_id'],record=this.store.get(target,id);
      refs.push({type:target,id,...record?{uid:record.uid}:{},field:end+'_id'});
    }
    if(type==='collection_items'&&value.collection_id){
      const collection=this.store.get('collections',value.collection_id);
      for(const field of collection?.field_schema||[]){
        const target={link_note:'notes',link_person:'contacts',link_collection_item:'collection_items'}[field.type];
        if(target){
          const raw=value.data?.[field.key],many=Array.isArray(raw),values=many?raw:raw?[raw]:[];
          for(const [i,link] of values.entries()){
            const object=link&&typeof link==='object',id=object?link.id:link;
            if(typeof id!=='string'||!id)throw new Error('A linked collection value needs a record identifier');
            const record=this.store.get(target,id),key='data.'+field.key+(object?(many?'.'+i:'')+'.id':'');
            refs.push({type:target,id,...record?{uid:record.uid}:{},field:key});
          }
        }
      }
    }
    return [...new Map(refs.map(r => [(r.field || '') + '/' + r.type + '/' + r.id, r])).values()];
  }
  execute(request) {
    const { table, operation = 'select', values, filters = [], orders = [], selection = '*', options = {}, single = false, maybeSingle = false, expected = {}, baselines = {} } = request;
    if (!tables.has(table)) throw new Error('Unknown record domain ' + table);
    let rows = this.rows(table).filter(row => filters.every(f => condition(row, f)));
    if (operation !== 'select') {
      const privateKeys=/^(access_token|refresh_token|api_key|secret|password|token|token_hash|encrypted_token|credentials)$/i;
      const inspect=value=>{if(value&&typeof value==='object')for(const [key,next] of Object.entries(value)){if(privateKeys.test(key))throw new Error('Connector credentials belong in local device configuration, never synced records');inspect(next);}};inspect(values);
      if (views.has(table)||rows.some(r=>r.native_file&&table==='deadlines')) throw new Error('Derived views are read-only; use the personal obligation operation');
      // The dashboard's own writes arrive while background work (the sync
      // worker, the assistant) owns the workspace. executeAsync takes the lock
      // one level up and retries only its acquisition, so a held workspace
      // delays an edit instead of refusing it. See executeAsync below.
      const holding = request.holdingLock ? run => this.store.snapshot(run) : run => this.store.withLock(() => this.store.snapshot(run));
      rows = holding(() => {
        const inputs = operation === 'insert' || operation === 'upsert' ? (Array.isArray(values) ? values : [values]) : rows;
        const changed = inputs.map(value => {
          const old = operation === 'insert' ? null : operation === 'upsert' ? (value.id ? this.store.get(table, value.id) : this.rows(table).find(r => options.onConflict && options.onConflict.split(',').every(k => r[k] === value[k]))) : table==='moments'?value:this.store.get(table, value.id);
          if (operation === 'insert' && value.id && this.store.get(table, value.id)) throw new Error('Record already exists');
          if(request.assistant){
            if(old){assertAssistantRecord(this,table,old.id);if(typeof expected[old.id]!=='string'||!expected[old.id].trim())throw Error('Read the current record hash before editing');if(expected[old.id]!==old._hash)this.store.conflict(table,operation==='update'?values:value,old,baselines[old.id]);}
            assertAssistantLinks(this,table,{...old,...(operation==='update'?values:value)});
          }
          if (old && expected[old.id] && expected[old.id] !== old._hash) {
            const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),base=baselines[old.id];
            const patch=operation==='update'?values:value;
            // Concurrent autosaves of different conversation fields can both
            // advance this display timestamp. It is not authored content.
            if(operation==='delete'||Object.entries(patch).some(([key,next])=>!(table==='contacts'&&key==='conversation_updated_at')&&!same(old[key],next)&&(!base||!same(old[key],base[key]))))this.store.conflict(table,patch,old,base);
          }
          const payload = operation === 'delete' ? { removed_at: new Date().toISOString() } : operation === 'update' ? values : value;
          if(table==='moments'&&old){
            const correction=this.store.prepare('event_corrections',{moment_id:old.id,patch:payload,sequence:this.store.list('event_corrections').filter(c=>c.moment_id===old.id).length+1,references:[{type:'moments',id:old.id,uid:old.uid}]});
            return correction;
          }
          const record = this.store.prepare(table, { ...(defaults[table] || {}), ...old, ...payload }, old);
          if(table==='contact_groups'&&payload.type&&payload.type!=='contact_groups')record.group_type=payload.type;
          if(table==='contact_group_memberships'&&!record.status_changed_at)record.status_changed_at=record.created_at;
          if(table==='contact_group_memberships'&&(!record.last_movement_at||old&&payload.status&&old.status!==payload.status))record.last_movement_at=record.updated_at;
          // The address the create dialog shows ("/collections/books"), unless
          // another collection already has it; then the record's own id makes it unique.
          if (['collections','contact_groups'].includes(table) && !old) { const plain = slug(record.slug||record.name); record.slug = this.rows(table).some(r => String(r.slug||'').toLowerCase() === plain) ? plain+'-'+record.uid.slice(0,8) : plain; }
          if(table==='collection_items'){
            const collection=this.store.get('collections',record.collection_id);if(!collection)throw new Error('Collection missing');
            const primary=collection.field_schema?.find(f=>f.primary);record.title=primary?String(record.data?.[primary.key]??'Untitled'):record.title||'Untitled';
            for(const field of collection.field_schema||[]){const value=record.data?.[field.key];if(value==null||value==='')continue;if(['number','currency'].includes(field.type)&&!Number.isFinite(Number(value)))throw new Error('Expected a number for '+field.label);if(field.type==='boolean'&&typeof value!=='boolean')throw new Error('Expected true or false for '+field.label);if(field.type==='select'&&field.options?.length&&!field.options.includes(value))throw new Error('Unknown choice for '+field.label);}
          }
          record.references = this.references(table, record); return record;
        });
        const gone=operation==='delete'&&table==='contacts'?this.personBelongings(changed.map(c=>c.id)):[];
        this.store.commit([...changed,...gone]); return table==='moments'?this.rows(table).filter(r=>changed.some(c=>c.id===r.id||c.moment_id===r.id)):changed;
      });
    }
    const count = rows.length;
    if (orders.length) rows.sort((a, b) => { for (const [key, settings = {}] of orders) { const av = getValue(a, key), bv = getValue(b, key); if (av === bv) continue; const n = av == null ? (settings.nullsFirst ? -1 : 1) : bv == null ? (settings.nullsFirst ? 1 : -1) : av < bv ? -1 : 1; return settings.ascending === false ? -n : n; } return 0; });
    if (request.range) rows = rows.slice(request.range[0], request.range[1] + 1);
    if (request.limit !== undefined) rows = rows.slice(0, request.limit);
    // Preserve observed joined shapes without a second source of truth.
    // rows() already read a consistent snapshot. Resolve joins from that same
    // snapshot instead of rescanning the whole vault once per joined item.
    // Joins only when the selection asks for one, from one map of identities
    // per view of the store rather than one per query.
    const joins=/\(/.test(String(selection));let identities=null;
    const joined=(type,id)=>{if(!identities){if(this.identityFor!==this.store.records){this.identityCache=new Map();for(const record of this.store.records.values())for(const id of [...identityIds(record),...record.aliases||[]])if(!this.identityCache.has(record.type+'/'+id)||id===record.id)this.identityCache.set(record.type+'/'+id,record);this.identityFor=this.store.records;}identities=this.identityCache;}return identities.get(type+'/'+id)||null;};
    const keep=projection(selection);
    rows = rows.map(r => {
      let result = { ...r, _hash: r._hash || this.store.records.get(table+'/'+r.id)?._hash };
      if(joins){
        if (selection.includes('source_note:')) result.source_note = r.source_note_id ? joined('notes', r.source_note_id) : null;
        if (selection.includes('notes(')) result.notes = r.note_id ? joined('notes', r.note_id) : null;
        if (selection.includes('contacts(')) result.contacts = r.contact_id ? joined('contacts', r.contact_id) : null;
        for(const match of selection.matchAll(/(\w+):(\w+)(?:!\w+)?\(/g)){const [,alias,column]=match,target=links[column]||(tables.has(column)?column:null),foreign=links[column]?column:Object.keys(links).find(key=>links[key]===target&&r[key]);if(target&&foreign)result[alias]=r[foreign]?joined(target,r[foreign]):null;}
      }
      // A list shows a note's first words, not its text: content_preview and
      // content_length stand in for content where a selection names them.
      if(keep?.has('content_preview')&&typeof r.content==='string'){result.content_preview=r.content.slice(0,400);result.content_length=r.content.length;}
      if(keep)result=Object.fromEntries(Object.entries(result).filter(([key])=>keep.has(key)||key==='content_length'&&keep.has('content_preview')));
      return result;
    });
    if (single && rows.length !== 1) throw new Error('Expected one record');
    if (maybeSingle && rows.length > 1) throw new Error('Ambiguous record query');
    return { data: options.head ? null : single || maybeSingle ? rows[0] || null : rows, count, error: null };
  }
  // What goes with a deleted person, as it did in Menerio: their topics, facts,
  // relationships, group memberships, interactions, documents and fact
  // settings. Notes and timeline events that mention them stay. Until
  // 6 October 2026 only the person went, and their topics and facts stayed
  // behind pointing at no one.
  personBelongings(contactIds){
    const ids=new Set(contactIds),now=new Date().toISOString(),out=[],live=type=>this.store.list(type).filter(r=>!r.removed_at);
    const of=r=>ids.has(r.contact_id)||ids.has(r.person_id);
    const topics=live('contact_topics').filter(of),topicIds=new Set(topics.map(t=>t.id));
    const relationships=live('contact_relationships').filter(r=>r.source_type==='contact'&&ids.has(r.source_id)||r.target_type==='contact'&&ids.has(r.target_id));
    for(const r of [...topics,...live('contact_topic_events').filter(e=>topicIds.has(e.topic_id)),...relationships,...live('contact_group_memberships').filter(of),...live('contact_interactions').filter(of),...live('person_documents').filter(of),...live('claims').filter(c=>c.subject_type==='contact'&&ids.has(c.subject_id)),...live('fact_slots').filter(s=>s.subject_type==='contact'&&ids.has(s.subject_id)||ids.has(s.contact_id)),...live('profile_categories').filter(c=>ids.has(c.contact_id))])
      out.push(this.store.prepare(r.type,{removed_at:now},r));
    return out;
  }
  // The write path the dashboard uses. execute() refuses outright when another
  // process holds the workspace, which lost a note edit whenever the sync
  // worker or the assistant happened to be saving. withLockAsync retries the
  // acquisition only: once this callback has started its failure is never
  // replayed, so a half-applied transaction can still never repeat.
  async executeAsync(request, { timeoutMs = 30000, signal } = {}) {
    if ((request.operation || 'select') === 'select') return this.execute(request);
    // The snapshot starts inside the lock, so the rows this write is about are
    // read once and the steps that follow reuse that read.
    return await this.store.withLockAsync(() => this.store.snapshot(() => this.execute({ ...request, holdingLock: true })), { timeoutMs, signal });
  }
  rpc(name, args = {}) {
    if (name === 'capture_note_with_lexicon') return this.store.save('notes', { ...args._note, user_id: 'owner' });
    if (name === 'search_contacts_page') {
      const query = String(args.search_text || '').toLowerCase(), all = this.rows('contacts').filter(r => !r.merged_into && r.id !== args.exclude_contact_id && [r.name, ...r.aliases].some(n => n.toLowerCase().includes(query))).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
      const after = all.filter(r => !args.after_id || r.name > args.after_name || (r.name === args.after_name && r.id > args.after_id));
      const rows = after.slice(0, args.page_size || 50), last = rows.at(-1); return { rows, total: all.length, next: after.length > rows.length ? { name: last.name, id: last.id } : null };
    }
    if (name === 'notes_mentioning_people') return this.rows('notes').filter(r => (args.names || args.p_names || []).some(n => (r.content || '').toLowerCase().includes(n.toLowerCase())));
    if(name==='increment_collection_template_usage'){
      // The templates page names the template by its slug (p_slug); until
      // 6 October 2026 that was refused, so using a template always ended in an error.
      const id=args.template_id||args.p_template_id,old=(id&&this.store.get('collection_templates',id))||(args.p_slug?this.rows('collection_templates').find(t=>t.slug===args.p_slug):null);if(!old)throw new Error('Template missing');return this.store.save('collection_templates',{id:old.id,usage_count:(old.usage_count||0)+1});
    }
    if(name==='reassign_contact_topics')return this.store.withLock(()=>{const topics=this.rows('contact_topics').filter(t=>t.contact_id===args.p_source_contact_id).map(t=>this.store.prepare('contact_topics',{contact_id:args.p_target_contact_id,version:(t.version||0)+1},t));for(const t of topics)t.references=this.references(t.type,t);this.store.commit(topics);return {moved:topics.length};});
    if(name==='apply_contact_topic_command')return this.topicCommand(args.p_request_id,args.p_command);
    if(name==='my_staff_access_log')return [];
    throw new Error('Unimplemented RPC: ' + name);
  }
  topicCommand(requestId,command){
    if(!requestId||!command?.action)throw new Error('Invalid topic command');
    const changed=command.action==='update'?command.patch||{}:command;
    if(changed.title!==undefined&&(typeof changed.title!=='string'||!changed.title.trim()||changed.title.trim().length>300))throw new Error('A topic title needs 1 to 300 characters');
    if(changed.mode!==undefined&&!['one_off','recurring'].includes(changed.mode))throw new Error('Choose one-off or recurring');
    if(changed.priority!==undefined&&!['high','normal','low'].includes(changed.priority))throw new Error('Choose high, normal or low priority');
    if(command.discussed_at!==undefined&&(!/(Z|[+-]\d\d:\d\d)$/.test(command.discussed_at)||!Number.isFinite(Date.parse(command.discussed_at))||Date.parse(command.discussed_at)>Date.now()))throw new Error('A discussion date needs a timezone and cannot be in the future');
    return this.store.withLock(()=>{
      const requestHash=hash(command),previous=this.rows('contact_topic_events').find(e=>e.request_id===requestId);
      if(previous){if(previous.request_hash!==requestHash)throw new Error('Command id reused with another request');return {topic:previous.after_state,event_id:previous.id,replayed:true};}
      const old=command.topic_id?this.store.get('contact_topics',command.topic_id):null;
      if(command.action!=='create'&&(!old||old.version!==command.expected_version)){const error=new Error('The topic changed. Reload before applying this action.');error.code='CONFLICT';throw error;}
      let patch={};const now=new Date().toISOString();
      if(command.action==='create'){if(!command.title?.trim())throw new Error('A topic needs a title');patch={contact_id:command.contact_id,title:command.title.trim(),mode:command.mode||'one_off',priority:command.priority||'normal',status:'active',last_discussed_at:null,completed_at:null,archived_at:null};}
      else if(command.action==='update'){if(Object.keys(command.patch||{}).some(k=>!['title','mode','priority'].includes(k)))throw new Error('Unsupported topic field');patch=command.patch;}
      else if(command.action==='discuss')patch={last_discussed_at:command.discussed_at||now,...command.close_after||old.mode==='one_off'?{status:'completed',completed_at:now}:{}};
      else if(command.action==='archive')patch={status:'archived',archived_at:now};
      else if(command.action==='reopen')patch={status:'active',completed_at:null,archived_at:null};
      else if(command.action==='undo'){const event=this.store.get('contact_topic_events',command.event_id);if(!event||event.topic_id!==old.id||event.after_state.version!==old.version)throw new Error('This event cannot be undone after a newer change');patch=event.before_state||{status:'archived',archived_at:now};}
      else throw new Error('Unsupported topic operation');
      const topic=this.store.prepare('contact_topics',{...patch,version:(old?.version||0)+1},old);topic.references=this.references(topic.type,topic);
      const event=this.store.prepare('contact_topic_events',{topic_id:topic.id,request_id:requestId,request_hash:requestHash,action:command.action,before_state:old,after_state:topic,happened_at:now,reverses_event_id:command.action==='undo'?command.event_id:null});
      this.store.commit([topic,event]);return {topic,event_id:event.id,replayed:false};
    });
  }
}
