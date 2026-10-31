import {visibleRows} from '../core/visibility.mjs';
import {retireShares} from '../core/shares.mjs';
import {toolScope,scopedQuery} from '../core/api-keys.mjs';
import {topicDefinitions,topicToolNames,topicTool} from './topic-tools.mjs';
import {assistantMutationContext,assertAssistantTable} from '../core/assistant-mutations.mjs';
import {memoryDefinitions,memoryToolNames,memoryTool,searchNotes,relatedTo,readFile} from './memory-tools.mjs';
import {notebookAddress} from '../core/notebook-address.mjs';
import {VERSION} from '../core/version.mjs';
import {contextStatus,markContext,setTimezone,keepAbout} from '../core/context-setup.mjs';
import {linkTargets} from '../core/graph.mjs';
import {recordType,existingPerson,samePersonAnswer,collectionShape} from './save-record.mjs';
const schema={type:'object',properties:{},additionalProperties:true};
// A tool's object and list arguments are declared, so a client sends them as objects and lists.
// Until 24 October 2026 personal_operation, write_fact and record_event declared none, and Claude
// Code sent personal_operation's expected as JSON text ("{\"collections/<id>\":\"<hash>\"}"): no
// hash was found in it, and every change to a tracker, a habit or a meal was refused with "Read the
// current record hash before editing", while the same call sent with curl went through.
const text={type:'string'},texts={type:'array',items:text},number={type:'number'};
const hashes=what=>({type:'object',additionalProperties:{type:'string'},description:'The current hash of '+what+', by "<table>/<id>", such as {"collections/<id>":"<hash>"}'});
const personalOperation={type:'object',properties:{
  type:{type:'string',description:'The operation, such as tracker-list, track, tracker-talk, food, cycle, headache, goal-reading or routine-change'},
  id:text,tracker:{type:'string',description:'A tracker\'s or habit\'s id or name, from tracker-list'},talk:{type:'string',description:'A coaching talk by its area, such as health'},
  action:text,words:{type:'string',description:'Their message as they wrote it'},value:{description:'The number or answer they gave'},on:text,
  expected:hashes('every record the operation changes, from tracker-list or the record\'s own read'),expected_hashes:hashes('every record the operation changes (the same as expected)'),
  data:{type:'object',description:'One entry\'s columns by their keys, for a tracker with several columns'},
  fields:{type:'array',description:'A new tracker\'s columns',items:{type:'object',properties:{label:text,type:text,unit:text,min:number,max:number}}},
  items:{type:'array',description:'Food: what they ate, one entry per food',items:{type:'object',properties:{food:text,item:text,grams:number,count:number,unit:text,assumed:{type:'boolean'}}}},
  answers:{type:'array',items:{type:'object'}},queries:texts,
  meds:{type:'array',items:{type:'object',properties:{med:text,dose:text}}},symptoms:texts,triggers:texts,pain_where:texts,
  args:{type:'array',description:'A command\'s words, for due-command, watch-command, lead-command, radar-command and subscription-command',items:text}
},required:['type'],additionalProperties:true};
// Text that is exactly the JSON object or list a declared argument takes is read as that object or
// list, once, as a call comes in; so is expected (and expected_hashes, and structural_change's
// options.expected) for every tool. Anything else stays as it came: a hash given on its own, a note
// that starts with a brace. Whether a hash is the current one is still the write guard's to decide
// (assistant-mutations.mjs), unchanged: a wrong one conflicts and a missing one is refused.
const fromJson=(value,kind)=>{
  if(typeof value!=='string')return undefined;const given=value.trim();
  if(!given.startsWith(kind==='array'?'[':'{'))return undefined;
  let parsed;try{parsed=JSON.parse(given);}catch{return undefined;}
  return kind==='array'?(Array.isArray(parsed)?parsed:undefined):(parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:undefined);
};
export function declaredArguments(tool,args){
  if(!args||typeof args!=='object'||Array.isArray(args))return args;
  const out={...args},declared=tool?.inputSchema?.properties||{};
  for(const [key,value] of Object.entries(out)){
    const kind=['expected','expected_hashes'].includes(key)?'object':declared[key]?.type;
    if(kind==='object'||kind==='array'){const parsed=fromJson(value,kind);if(parsed!==undefined)out[key]=parsed;}
  }
  const inner=out.options&&typeof out.options==='object'?fromJson(out.options.expected,'object'):undefined;
  if(inner)out.options={...out.options,expected:inner};
  return out;
}
// The record types list_records and search_knowledge may return to an assistant:
// the owner's own content, each a type whose visibility rule (visibility.mjs)
// actually hides records about a hidden person, a private section or a sensitive
// subject. Bookkeeping and link types (record_history, notifications,
// review_queue, contact_topic_events, note_connections,
// receipts, embeddings, conversation_messages, settings, jobs and the control
// tables) have no such rule, so visibleRows returns them all, and until
// 7 October 2026 a hidden note's content came back inside record_history.snapshot
// or notifications.body. Topics, facts and reviews have their own filtered tools.
export const listableTypes=new Set(['notes','note_folders','contacts','contact_groups','contact_group_memberships','contact_relationships','entities','claims','fact_slots','profile_categories','moments','moment_participants','moment_entities','collections','collection_items','collection_item_folders','comments','goals','work_items','deadlines','habits','forecasts','journal','coach_talks','health_observations','action_items','contact_topics','weekly_reviews','media_analysis']);
const definitions=[
  ...topicDefinitions,
  ...memoryDefinitions,
  // The getting-to-know-you chat after the technical setup (core/context-setup.mjs, recipe
  // context-setup): what is known already, where the chat stands, and the three things it keeps.
  {name:'context_setup',description:'The getting-to-know-you chat that follows the setup; use it only as the context-setup recipe says. action "status": what is known already (where the chat stands, the time zone and whether it came from their computer or an answer, whether they told you about themselves, their goals) and where they see it in the notebook. "start", "done", "skip": where the chat stands (skip when they skipped all of it). "timezone" with city: their city, as your clock and the notebook\'s. "about" with text and words: keeps what they told you about themselves where you read it before you help; text is their own words, a file they sent, or the summary they confirmed. "goal" with title and words: files what they want help with first as their first goal. words is their latest message copied exactly.',inputSchema:{type:'object',properties:{action:{type:'string',enum:['status','start','done','skip','timezone','about','goal']},city:{type:'string'},text:{type:'string'},title:{type:'string'},words:{type:'string'}},required:['action']}},
  {name:'get_notebook_link',description:'The web address where the owner opens this notebook in a browser, where it opens, and how they sign in there. Give all of it when they ask for the link to their notebook, or how to open or sign in to it.',inputSchema:{type:'object',properties:{}}},
  {name:'list_note_folders',description:'List visible notebook folders and their note counts before filing a note.',inputSchema:schema},
  {name:'search_notes',description:'Find visible, untrashed notes by words and, when connected, by meaning, including text read out of their attached documents. Returns ids, titles, folders, a matching excerpt and current revision hashes. source native leaves out mirrored Mission Control files, godspeed keeps only them.',inputSchema:{type:'object',properties:{query:{type:'string'},source:{enum:['native','all','godspeed']},limit:{type:'integer'},offset:{type:'integer'},view:{enum:['snippet','metadata']}},required:['query']}},
  {name:'get_note',description:'Read one visible, untrashed note by id (or exact title) including its current hash, before editing it; or a Mission Control file by the path a search returned.',inputSchema:{type:'object',properties:{note:{type:'string',description:'Note id (preferred) or exact title'},id:{type:'string'}}}},
  {name:'retrieve_memory',description:'Compare exact visible note windows with independent broad results. Includes original offsets and hashes; read the full source and current dated claims before answering.',inputSchema:{type:'object',properties:{query:{type:'string'}},required:['query']}},
  {name:'update_note',description:'Update exactly the given note fields; content replaces the whole body, so read the note with get_note first. With the hash from get_note a note changed since is refused. Without one, the version this server last showed you (get_note, a search or a list) is the one checked, and a note it never showed you is checked against its current version. Old revisions are kept either way.',inputSchema:{type:'object',properties:{note_id:{type:'string'},id:{type:'string'},expected_hash:{type:'string'},title:{type:'string'},content:{type:'string'},folder_path:{type:'string'},tags:{type:'array',items:{type:'string'}},is_favorite:{type:'boolean'},is_pinned:{type:'boolean'}}}},
  {name:'personal_operation',description:'Apply an explicitly requested goal, obligation, coach, habit, journal, health, tracker, memory, forecast or routine operation. Read current IDs first. Never approve an outward action. A number they give for a goal\'s weekly number ("I wrote 1,400 words this week", "14 subscribers now") is goal-reading {id,value,where?,on?}: the reading its moves are judged by; a goal without a weekly number gets none, say so. Trackers ("track belly 92"): read the tracker recipe first (skill_view tracker), then tracker-list (every tracker with its other names, columns, current hashes and the open questions); track {tracker,value|data,on?,words}; a name no tracker has: tracker-hold {name,unit?,value?,words}, which only asks; a tracker set up on purpose with several columns: tracker-hold {name,fields:[{label,type,unit?,min?,max?}],words}; their yes, in a later message: tracker-create {proposal_id,words}; corrections and deletions: tracker-correct {tracker,value?|remove:true}; which coaching talk looks at a tracker ("The health talk may also look at my sleep tracker", "The health talk no longer needs my sleep tracker"): tracker-talk {tracker,talk:<area>,remove?:true,instead?:true,words} with the tracker\'s hash; any number of talks may look at a tracker, adding one never asks and the others keep looking, remove takes away only that talk, and instead:true only when their own words say this talk instead of the others; a habit the same way, with its id and expected {"habits/<id>":"<hash>"}, its own area\'s talk always looking at it. words is their message as they wrote it; on is their own day words ("Friday", "yesterday") or YYYY-MM-DD, and a weekday is the most recent one. Relay the reply exactly as it comes. Changing an existing entry or tracker needs expected {"collection_items/<id>":"<hash>"} from tracker-list. A habit is a tracker with specialist habit: track {tracker:<its id>,answer?:done|no|skip,words:<the person\'s message>} records the day and their words in the coach\'s own file. The period and the cycle (the tracker with specialist cycle) are never track: cycle {action:track|over|forecast|status|brief|heads-up|talk|leave-out|count|decline|delete,flow?,pain?,pain_where?,symptoms?,note?,on?,start?,why?,enabled?,talk?,confirm?,language?}, as the cycle-tracker recipe says, and its reply goes to her word for word and whole; a fertile window, ovulation, safe days, conceiving or a diagnosis is cycle decline, never your own answer. What they eat (the tracker with specialist food) is never track: food {action:status|search|track|answer|remember|correct|today|target|settings|talk|barcode|product,items?:[{food:<an id from food search>,item,grams?,count?,unit?,assumed?}],meal?,preset?,question?,grams?,answers?,name?,item?,count?,remove?,entry_id?,totals?,sex?,age?,height_cm?,weight_kg?,activity?,goal?,numbers?,pregnant?,breastfeeding?,eating_disorder?,code?,query?,on?,at?,language?}, as the food-tracker recipe says: code works out every number from the food table, and its reply goes to them word for word and whole. A meal and an answer only add records; a correction needs the hash of its row, and a saved meal, the target and the settings the hash of the tracker. Headaches (the tracker with specialist headache) are never track: headache {action:start|log|set|med|end|cancel,at?,from?,to?,pain?,side?,quality?,symptoms?,triggers?,meds?:[{med,dose?}],taken?,episode?,words}.',inputSchema:personalOperation},
  {name:'search_knowledge',description:'Search the rebuildable index of user records.',inputSchema:{type:'object',properties:{query:{type:'string'}},required:['query']}},
  {name:'list_records',description:'Read file-backed notes, contacts, profile facts, world views, collections, timeline, media metadata, reviews, comments, goals or work.',inputSchema:{type:'object',properties:{type:{type:'string'},filters:{type:'array'},limit:{type:'integer'}},required:['type']}},
  {name:'save_record',description:'Save one note, person, thing, timeline entry, collection or item, action or review suggestion with optimistic conflict detection. Preserve its id and hash for edits. type is notes, contacts (a person: name, relationship, notes), entities, moments, collections, collection_items, action_items or review_queue. A new collection: type collections, value {name, description, field_schema: [{label, type}]}, one entry per column (type text, number, date, select with options, boolean, url); the first column is each item\'s title; then add items with add_collection_item. A person whose name already has a page is not added twice: the answer is that page, unless same_name_is_another_person is true. Use review suggestions for AI-inferred facts; settings, shares, approvals, routines and assistant instructions stay with the owner.',inputSchema:{type:'object',properties:{type:{type:'string'},value:{type:'object'},expected_hash:{type:'string'},same_name_is_another_person:{type:'boolean',description:'Only for a new person who is not the one already in the notebook under the same name'}},required:['type','value']}},
  {name:'capture_note',description:'Capture the user\'s note once in a durable Markdown file, preserving the chosen folder, tags and related-note links. Give it a short title a person would search for. related takes the ids (or exact titles) of the notes to link. The answer\'s linked lists the links that were saved; similar_not_linked lists notes that look alike but are not linked.',inputSchema:{type:'object',properties:{title:{type:'string'},content:{type:'string'},folder_path:{type:'string'},tags:{type:'array',items:{type:'string'}},related:{type:'array',items:{type:'string'}}},required:['content']}},
  {name:'write_fact',description:'Record a confirmed fact and close earlier single-valued claims. AI inference must instead create a pending review_queue record.',inputSchema:{type:'object',properties:{subject_type:{enum:['self','contact','entity']},subject_id:text,contact_id:text,entity_id:text,attribute:text,label:text,value:text,valid_from:text,evidence_quote:text,source_type:text,source_id:text,replaces_claim_id:text,replaces_claim_hash:text,expected:hashes('an older value of this fact filed under another name, which this one ends')},additionalProperties:true}},
  {name:'record_event',description:'Append a timeline event. Earlier events are never replaced.',inputSchema:{type:'object',properties:{title:text,description:text,happened_at:text},additionalProperties:true}},
  {name:'structural_change',description:'Rename, change a name, merge or remove a user-requested record. Read every affected record first. Supply expected_hash for the source and expected keyed by type/id for every other changed record, including incoming links and a merge target.',inputSchema:{type:'object',properties:{type:{type:'string'},id:{type:'string'},action:{enum:['display-name','rename','merge','remove']},expected_hash:{type:'string'},expected:hashes('every other record the change touches'),options:{type:'object'}},required:['type','id','action','expected_hash']}},
  {name:'review_suggestions',description:'Decide on the suggestions waiting in the owner\'s Review page, when the owner asks. action remove (or rollback), block (never suggest it again) or snooze, with ids: the suggestions to decide on; without ids, every waiting one. action keep files what a model inferred, so it needs words: the owner\'s request copied exactly from their latest message. Never keep inferred personal facts the owner did not ask to keep.',inputSchema:{type:'object',properties:{action:{enum:['remove','rollback','block','snooze','keep']},ids:{type:'array',items:{type:'string'}},words:{type:'string',description:'For keep: the owner\'s request, copied exactly from their message.'},until:{type:'string'}},required:['action']}},
  {name:'validate_knowledge',description:'Validate file identity and typed references without changing invalid files.',inputSchema:schema},
  // The assistant's path to the page that shows who it is (core/identity-shelf.mjs). Hermes' own file tools
  // ask a person before writing AGENTS.md or SOUL.md and refuse where nobody can answer (the
  // notebook's chat, Telegram), so "rename yourself" had no way through; this is the one, with an
  // earlier version kept for every change and the owner's own words required.
  {name:'identity_files',description:'Read or change what makes this mission control behave as it does, exactly as the notebook page that shows them does: who you are (target "who", the persona paragraph of AGENTS.md, nothing else of it), the owner\'s extra instructions you read right after it (target "extra", assistant/extra-instructions.md; your program\'s SOUL.md is written from the two), your rules (target "rule:<name>", rules/<name>.md; the one-line list in AGENTS.md follows by itself), what you know about the owner (target "profile:<name>", profile/<name>.md) and your skills (target "skill:<name>", skills/<name>/SKILL.md). Use this, not file tools, when the owner asks you to rename yourself, change your character, add, change or remove a rule, or change something you know about them or a skill. The owner may name a rule or a skill by the number that page shows ("rule 13"): action overview gives each its number n, the rules read before every job numbered as in AGENTS.md. A rule\'s line says what it means only after its kind (group): never is "I must never: <line>", must is "I must: <line>"; quote a rule with its kind, never its line alone. action: overview, read (gives the fields and the hash), history (earlier versions), save (who: text = the whole new paragraph; extra: text = the whole new extra instructions, empty for none; rule: fields with only what changes among {title (its short name, a few words), line (the one sentence), group must|never|how, always (read before every job), story}; skill: fields {description, steps}; profile: text), add_rule (fields), remove_rule, undo (the last change), restore (version = an id from history). Every change needs words: the owner\'s request copied exactly from their message, and expected_hash from read. Every change is kept, and the owner can undo it on that page. The answer\'s now is what the file holds after the change, read back from disk: report that, never what you meant to write.',inputSchema:{type:'object',properties:{action:{enum:['overview','read','history','save','add_rule','remove_rule','undo','restore']},target:{type:'string'},text:{type:'string'},fields:{type:'object'},version:{type:'string'},expected_hash:{type:'string'},words:{type:'string',description:'The owner\'s request, copied exactly from their message.'}},required:['action']}}
];
// The version of each note this server last handed an assistant (get_note, a
// search, a list), so an update_note without a hash is checked against what
// the assistant read. Menerio's update_note took no hash and the owner's skills
// still call it so; until 6 October 2026 the current hash stood in, and an
// owner edit made after the assistant's read was overwritten. Kept per server
// process: after a restart the current version stands in again.
const readVersions=new WeakMap();
const versionsOf=store=>{let seen=readVersions.get(store);if(!seen)readVersions.set(store,seen=new Map());return seen;};
export function rememberRead(store,notes){const seen=versionsOf(store);for(const n of notes||[])if(n?.id&&typeof n._hash==='string'){seen.delete(n.id);seen.set(n.id,n._hash);}while(seen.size>20000)seen.delete(seen.keys().next().value);}
// delegated: the call comes with a key the owner gave another program, not
// from the owner or the installation's own assistant (api-keys.mjs).
// `explain` turns an error into what the caller is told (server/main.mjs
// userFacing): a refusal plainly, an internal failure without its insides.
// Until 7 October 2026 an assistant was handed the raw text of any error.
export async function mcp(input,{store,query,index,domains,scopes,delegated=false,explain=error=>error.message}){
  const id=input.id??null,owner=store,seen=notes=>rememberRead(owner,notes);let result;
  // A key reads through its own view: what its scopes cover (api-keys.mjs).
  query=scopedQuery(query,scopes);
  try{
    if(input.method==='initialize')result={protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'godspeed-mission-control',version:VERSION}};
    else if(input.method==='notifications/initialized')return null;
    else if(input.method==='ping')result={};
    else if(input.method==='tools/list')result={tools:definitions};
    else if(input.method==='tools/call'){
      const name=input.params?.name,a=declaredArguments(definitions.find(tool=>tool.name===name),input.params?.arguments??{});let value;
      if(memoryToolNames.includes(name)){
        const scoped=Object.assign(Object.create(Object.getPrototypeOf(domains)),domains,{toolScope:type=>toolScope('save_record',{type}),delegated:!!delegated});
        value=await memoryTool(name,a,{store,query,index,domains,seen,scopes},expected=>assistantMutationContext({store,query,domains:scoped,scopes},{...a,expected},name));
        return {jsonrpc:'2.0',id,result:{content:[{type:'text',text:typeof value==='string'?value:JSON.stringify(value)}]}};
      }
      // Menerio named the note note_id; the write guard reads id (6 October 2026: an edit by
      // note_id was refused as if no version had been read).
      if(name==='update_note'&&a.note_id&&!a.id)a.id=a.note_id;
      // Menerio's update_note took no version: the one this server last showed is the one read.
      if(name==='update_note'&&a.id&&!a.expected_hash){const current=visibleRows(query,'notes').find(n=>n.id===a.id);if(current)a.expected_hash=versionsOf(owner).get(a.id)||current._hash;}
      // "collection", "Contact" or "people" names the type it means (save-record.mjs).
      if(['save_record','structural_change','list_records'].includes(name)&&a.type!==undefined)a.type=recordType(a.type,name==='list_records'?listableTypes:undefined);
      // Refused before anything is read, in plain words (the guard's commit refuses them too).
      if(['save_record','structural_change'].includes(name))assertAssistantTable(String(a.type||''),name);
      if(['save_record','update_note','capture_note','personal_operation','write_fact','record_event','structural_change','review_suggestions',...topicToolNames.filter(n=>!n.startsWith('list_')&&!n.startsWith('get_'))].includes(name)){
        domains=Object.assign(Object.create(Object.getPrototypeOf(domains)),domains,{toolScope:type=>toolScope('save_record',{type}),delegated:!!delegated});
        ({store,query,domains}=assistantMutationContext({store,query,domains,scopes},a,name));
      }
      if(name==='identity_files'){
        // Another program's key reads and changes none of it: these files steer every later job.
        if(delegated)throw Error('Only this mission control\'s own assistant reads and changes these files.');
        const shelf=domains.identity;if(!shelf)throw Error('This notebook cannot show or change who you are, your rules or your skills.');
        const action=String(a.action||''),write=['save','add_rule','remove_rule','undo','restore'].includes(action);
        if(write&&!shelf.ownerAsked(a.words))throw Error('Change these only when the owner asked for it. Pass their request as words, copied exactly from their latest message; or they can change it themselves on the notebook page that shows who you are.');
        const options={expected_hash:typeof a.expected_hash==='string'?a.expected_hash:undefined,by:'assistant',words:a.words};
        if(['save','remove_rule'].includes(action)&&options.expected_hash===undefined)throw Error('Read it first (action read) and pass its hash as expected_hash.');
        value=action==='overview'?shelf.overview():action==='read'?shelf.read(a.target):action==='history'?await shelf.versions(a.target):action==='save'?await shelf.save(a.target,{text:a.text,fields:a.fields},options)
          :action==='add_rule'?await shelf.addRule(a.fields||{},options):action==='remove_rule'?await shelf.removeRule(a.target,options):action==='undo'?await shelf.undo(a.target,options):action==='restore'?await shelf.restore(a.target,String(a.version||''),options):(()=>{throw Error('Choose an action: overview, read, history, save, add_rule, remove_rule, undo or restore.');})();
      }
      else if(topicToolNames.includes(name))value=topicTool(name,a,{store,query});
      // Each machine's notebook knows its own address (core/notebook-address.mjs); the server passes the port it listens on.
      else if(name==='get_notebook_link')value=(domains.notebookAddress||notebookAddress)();
      else if(name==='context_setup'){
        // What it keeps steers every later answer, so only this mission control's own assistant
        // keeps it, and only with the owner's own latest words, as on the page that shows it.
        if(delegated)throw Error('Only this mission control\'s own assistant leads the getting-to-know-you chat.');
        const action=String(a.action||''),shelf=domains.identity,home=shelf?.assistantHome?.()||process.env.HERMES_HOME;
        if(['about','goal'].includes(action)&&!shelf?.ownerAsked(a.words))throw Error('Keep this only with the owner\'s own words: pass their latest message, copied exactly, as words.');
        if(action==='status')value=contextStatus(store,{goals:query.rows('goals')});
        else if(['start','done','skip'].includes(action))value={state:markContext(store,action).state};
        else if(action==='timezone')value=await setTimezone(store,{city:String(a.city||''),from:'answer',home});
        else if(action==='about')value=await keepAbout(store,{text:String(a.text||'')});
        else if(action==='goal'){const title=String(a.title||'').replace(/\s+/g,' ').trim();if(!title)throw Error('Name the goal in a few words.');value=await domains.invoke('personal-operation',{type:'goal-add',title,status:'adopted'});}
        else throw Error('Choose status, start, done, skip, timezone, about or goal');
      }
      else if(name==='list_note_folders')value=query.withSnapshot(()=>{
        const notes=visibleRows(query,'notes').filter(n=>!n.is_trashed),folders=new Map(visibleRows(query,'note_folders').map(f=>[f.folder_path||f.path||'',0]));
        for(const note of notes){const folder=note.folder_path||'';folders.set(folder,(folders.get(folder)||0)+1);}
        return [...folders].map(([folder_path,note_count])=>({folder_path,note_count})).sort((a,b)=>a.folder_path.localeCompare(b.folder_path));
      });
      else if(name==='search_notes')value=await searchNotes(a,{store,query,index,domains,seen,scopes});
      // A Mission Control file found by search_notes or search_brain is read by its path.
      else if(name==='get_note'&&(value=readFile({store,index,scopes},a.note||a.id)));
      else if(name==='get_note'||name==='update_note'){
        const ref=a.note_id||a.id||a.note,notes=visibleRows(query,'notes').filter(n=>!n.is_trashed),note=notes.find(n=>n.id===ref)||(name==='get_note'?notes.filter(n=>n.title===ref).sort((x,y)=>String(y.updated_at).localeCompare(String(x.updated_at)))[0]:null);if(!note)throw Error('Choose a visible existing note');
        if(name==='get_note'){value=note;seen([note]);}
        else{
          if(typeof a.expected_hash!=='string'||!a.expected_hash)throw Error('Read the current note hash before editing');
          const fields=Object.fromEntries(['title','content','folder_path','tags','is_favorite','is_pinned'].filter(key=>a[key]!==undefined).map(key=>[key,a[key]]));
          if(!Object.keys(fields).length)throw Error('Choose the note fields to update');
          if(fields.folder_path!==undefined&&(typeof fields.folder_path!=='string'||fields.folder_path.includes('\\')||fields.folder_path.startsWith('/')||fields.folder_path.split('/').some(part=>['.','..'].includes(part))))throw Error('Choose a relative notebook folder');
          if(fields.tags!==undefined&&(!Array.isArray(fields.tags)||fields.tags.some(tag=>typeof tag!=='string')))throw Error('Use a list of tags');
          value=query.execute({table:'notes',operation:'update',values:fields,filters:[['eq','id',note.id]],expected:{[note.id]:a.expected_hash}}).data;
          if(Array.isArray(value)&&value.length===1)value=value[0];
          seen([owner.get('notes',note.id)]);
        }
      }
      else if(name==='retrieve_memory')value=await domains.invoke('retrieve-memory',a);
      else if(name==='search_knowledge'){value=query.withSnapshot(()=>index.search(a.query).filter(r=>listableTypes.has(r.type)&&(!scopes||scopes.includes(toolScope('list_records',{type:r.type})))&&visibleRows(query,r.type).some(v=>v.id===r.id)));}
      // Hidden records leave first, then the limit counts (until 6 October 2026 five hidden notes ahead of three visible ones made a limit of 5 return none).
      else if(name==='list_records'){if(!listableTypes.has(String(a.type)))throw Error('list_records reads the owner\'s own content, not '+a.type+' records. Use the tool made for them.');const allowed=new Set(visibleRows(query,a.type).map(r=>r.id));value=query.execute({table:a.type,filters:a.filters||[]}).data.filter(r=>allowed.has(r.id)).slice(0,Math.max(0,Number(a.limit)||100));if(a.type==='notes')seen(value);}
      // A note moved to Trash or removed is public no more, as on the screens'
      // paths. Until 7 October 2026 an assistant's did stay public.
      else if(name==='save_record'){
        const fresh=!a.value.id,same=fresh&&a.type==='contacts'&&a.same_name_is_another_person!==true?existingPerson(query,a.value):null;
        if(same)value=[samePersonAnswer(same)];
        else{
          const values=fresh&&a.type==='collections'?collectionShape(a.value):a.value;
          value=query.execute({table:a.type,operation:fresh?'insert':'upsert',values,expected:fresh?{}:{[a.value.id]:a.expected_hash},assistant:true}).data;
          if(a.type==='notes'&&(a.value.is_trashed===true||a.value.removed_at))await retireShares(owner,(Array.isArray(value)?value:[value]).map(n=>n?.id));
        }
      }
      else if(name==='capture_note'){
        // A related note named by its exact title is that note (an assistant
        // knows the titles it found, not always their ids).
        // One that names no note it can see is left out and named in the answer.
        const notes=visibleRows(query,'notes').filter(n=>!n.is_trashed),unknown=[];
        if(Array.isArray(a.related))a.related=[...new Set(a.related.flatMap(ref=>{
          if(typeof ref!=='string'||notes.some(n=>n.id===ref))return [ref];
          const titled=notes.filter(n=>String(n.title||'').trim().toLowerCase()===ref.trim().toLowerCase());
          if(titled.length===1)return [titled[0].id];unknown.push(ref);return [];
        }))];
        const captured=await domains.invoke('quick-capture',a),note=captured.note;
        // What the answer calls linked is only what was saved: the notes in related and
        // the notes its [[links]] name. On 9 October 2026 an assistant reported the
        // notes this answer called "related", which were only alike, as links it had made.
        const byTitle=new Map(notes.map(n=>[String(n.title||'').trim().toLowerCase(),n])),linked=new Map();
        for(const id of note.related||[]){const n=notes.find(x=>x.id===id);if(n)linked.set(n.id,{id:n.id,title:n.title});}
        for(const target of linkTargets(note.content)){const n=byTitle.get(target.toLowerCase());if(n&&n.id!==note.id)linked.set(n.id,{id:n.id,title:n.title});else if(!n)unknown.push(target);}
        const similar=relatedTo({query,index},note).filter(r=>!linked.has(r.id)&&r.id!==note.id);
        value={...captured,id:note.id,title:note.title,folder_path:note.folder_path||'',linked:[...linked.values()],...(unknown.length?{links_to_no_note:unknown}:{}),similar_not_linked:similar,
          about_links:linked.size?'Only the notes in linked are linked to this note.':'This note is linked to no other note. The notes in similar_not_linked only look alike; they are not linked.'};
        seen([owner.get('notes',note.id)]);
      }
      else if(name==='personal_operation')value=await domains.invoke('personal-operation',a);
      else if(name==='write_fact')value=domains.writeFact(a);
      else if(name==='record_event')value=query.execute({table:'moments',operation:'insert',values:a}).data;
      else if(name==='structural_change'){value=a.type==='moments'&&['remove','display-name'].includes(a.action)?query.execute({table:'moments',operation:a.action==='remove'?'delete':'update',values:{title:a.options?.name},filters:[['eq','id',a.id]],expected:{[a.id]:a.expected_hash},assistant:true}).data:store.structural(a.type,a.id,a.action,{...a.options,target:a.options?.target||a.options?.target_id});if(a.type==='notes'&&a.action==='remove')await retireShares(owner,[value?.id||a.id]);}
      else if(name==='review_suggestions'){
        // Keeping a suggestion files what a model inferred, so only on the owner's own request, in their
        // words (identity-shelf.mjs ownerAsked); removing, rolling back and snoozing take it away.
        if(['keep','accept'].includes(a.action||a.decision)&&!domains.identity?.ownerAsked?.(a.words))throw Error('Keep a suggestion only when the owner asked for it: pass their request as words, copied exactly from their latest message. Removing, rolling back and snoozing need no words.');
        value=await domains.invoke('review-queue-bulk',a);
      }
      else if(name==='validate_knowledge'){store.scan();value={problems:store.problems};}
      else throw new Error('Unknown tool');
      result={content:[{type:'text',text:typeof value==='string'?value:JSON.stringify(value)}]};
    }else return {jsonrpc:'2.0',id,error:{code:-32601,message:'Unknown method'}};
    return {jsonrpc:'2.0',id,result};
  }catch(e){const text=explain(e);return input.method==='tools/call'?{jsonrpc:'2.0',id,result:{content:[{type:'text',text}],isError:true}}:{jsonrpc:'2.0',id,error:{code:-32602,message:text}};}
}
