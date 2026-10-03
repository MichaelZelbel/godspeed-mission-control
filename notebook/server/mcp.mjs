import {visibleRows} from '../core/visibility.mjs';
import {toolScope} from '../core/api-keys.mjs';
import {topicDefinitions,topicToolNames,topicTool} from './topic-tools.mjs';
const schema={type:'object',properties:{},additionalProperties:true};
const definitions=[
  ...topicDefinitions,
  {name:'list_note_folders',description:'List visible notebook folders and their note counts before filing a note.',inputSchema:schema},
  {name:'search_notes',description:'Find visible, untrashed notes by words. Return their IDs, titles, folders and current revision hashes. source native excludes mirrored external files.',inputSchema:{type:'object',properties:{query:{type:'string'},source:{enum:['native','all']},limit:{type:'integer'}},required:['query']}},
  {name:'get_note',description:'Read one visible, untrashed note including its current hash before editing.',inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id']}},
  {name:'update_note',description:'Update exactly the requested note fields. Requires the hash from get_note; preserves old revisions and refuses stale edits.',inputSchema:{type:'object',properties:{id:{type:'string'},expected_hash:{type:'string'},title:{type:'string'},content:{type:'string'},folder_path:{type:'string'},tags:{type:'array',items:{type:'string'}}},required:['id','expected_hash']}},
  {name:'personal_operation',description:'Apply an explicitly requested goal, obligation, coach, habit, journal, health, memory, forecast or routine operation. Read current IDs first. Never approve an outward action.',inputSchema:schema},
  {name:'search_knowledge',description:'Search the rebuildable index of user records.',inputSchema:{type:'object',properties:{query:{type:'string'}},required:['query']}},
  {name:'list_records',description:'Read file-backed notes, contacts, profile facts, world views, collections, timeline, media metadata, reviews, comments, goals or work.',inputSchema:{type:'object',properties:{type:{type:'string'},filters:{type:'array'},limit:{type:'integer'}},required:['type']}},
  {name:'save_record',description:'Save one user record with optimistic conflict detection. Preserve its id and hash for edits. Use review suggestions for AI-inferred facts.',inputSchema:{type:'object',properties:{type:{type:'string'},value:{type:'object'},expected_hash:{type:'string'}},required:['type','value']}},
  {name:'capture_note',description:'Capture the user\'s note once in a durable Markdown file, preserving the chosen folder, tags and related-note links.',inputSchema:{type:'object',properties:{title:{type:'string'},content:{type:'string'},folder_path:{type:'string'},tags:{type:'array',items:{type:'string'}},related:{type:'array',items:{type:'string'}}},required:['content']}},
  {name:'write_fact',description:'Record a confirmed fact and close earlier single-valued claims. AI inference must instead create a pending review_queue record.',inputSchema:schema},
  {name:'record_event',description:'Append a timeline event. Earlier events are never replaced.',inputSchema:schema},
  {name:'structural_change',description:'Rename a file with stable UUID and retained alias, edit a display name, merge records or tombstone a removal. Use only for changes the user requested.',inputSchema:{type:'object',properties:{type:{type:'string'},id:{type:'string'},action:{enum:['display-name','rename','merge','remove']},options:{type:'object'}},required:['type','id','action']}},
  {name:'review_suggestions',description:'Apply, reject, snooze or roll back user-reviewed suggestions. Never accept inferred personal facts without user approval.',inputSchema:schema},
  {name:'validate_knowledge',description:'Validate file identity and typed references without changing invalid files.',inputSchema:schema}
];
export async function mcp(input,{store,query,index,domains,scopes}){
  const id=input.id??null;let result;
  try{
    if(input.method==='initialize')result={protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'godspeed-mission-control',version:'0.1.0-alpha.1'}};
    else if(input.method==='notifications/initialized')return null;
    else if(input.method==='ping')result={};
    else if(input.method==='tools/list')result={tools:definitions};
    else if(input.method==='tools/call'){
      const {name,arguments:a={}}=input.params||{};let value;
      if(topicToolNames.includes(name))value=topicTool(name,a,{store,query});
      else if(name==='list_note_folders')value=query.withSnapshot(()=>{
        const notes=visibleRows(query,'notes').filter(n=>!n.is_trashed),folders=new Map(visibleRows(query,'note_folders').map(f=>[f.folder_path||f.path||'',0]));
        for(const note of notes){const folder=note.folder_path||'';folders.set(folder,(folders.get(folder)||0)+1);}
        return [...folders].map(([folder_path,note_count])=>({folder_path,note_count})).sort((a,b)=>a.folder_path.localeCompare(b.folder_path));
      });
      else if(name==='search_notes')value=query.withSnapshot(()=>{
        if(typeof a.query!=='string'||!a.query.trim())throw Error('Enter words to search for');
        const terms=a.query.toLowerCase().split(/\s+/).filter(Boolean);
        return visibleRows(query,'notes').filter(n=>!n.is_trashed&&(a.source!=='native'||!n.is_external&&!/^godspeed\//i.test(n.folder_path||'')))
          .map(note=>({note,score:terms.filter(term=>(note.title+' '+note.content).toLowerCase().includes(term)).length}))
          .filter(row=>row.score>0).sort((a,b)=>b.score-a.score).slice(0,Math.max(1,Math.min(100,Number(a.limit)||20))).map(row=>row.note);
      });
      else if(name==='get_note'||name==='update_note'){
        const note=visibleRows(query,'notes').find(n=>n.id===a.id&&!n.is_trashed);if(!note)throw Error('Choose a visible existing note');
        if(name==='get_note')value=note;
        else{
          if(typeof a.expected_hash!=='string'||!a.expected_hash)throw Error('Read the current note hash before editing');
          const fields=Object.fromEntries(['title','content','folder_path','tags'].filter(key=>a[key]!==undefined).map(key=>[key,a[key]]));
          if(!Object.keys(fields).length)throw Error('Choose the note fields to update');
          if(fields.folder_path!==undefined&&(typeof fields.folder_path!=='string'||fields.folder_path.includes('\\')||fields.folder_path.startsWith('/')||fields.folder_path.split('/').some(part=>['.','..'].includes(part))))throw Error('Choose a relative notebook folder');
          if(fields.tags!==undefined&&(!Array.isArray(fields.tags)||fields.tags.some(tag=>typeof tag!=='string')))throw Error('Use a list of tags');
          value=query.execute({table:'notes',operation:'update',values:fields,filters:[['eq','id',note.id]],expected:{[note.id]:a.expected_hash}}).data;
        }
      }
      else if(name==='search_knowledge')value=query.withSnapshot(()=>index.search(a.query).filter(r=>r.type!=='workspace_file'&&(!scopes||scopes.includes(toolScope('list_records',{type:r.type})))&&visibleRows(query,r.type).some(v=>v.id===r.id)));
      else if(name==='list_records'){const allowed=new Set(visibleRows(query,a.type).map(r=>r.id));value=query.execute({table:a.type,filters:a.filters||[],limit:a.limit||100}).data.filter(r=>allowed.has(r.id));}
      else if(name==='save_record')value=query.execute({table:a.type,operation:a.value.id?'upsert':'insert',values:a.value,expected:a.value.id?{[a.value.id]:a.expected_hash}:{}}).data;
      else if(name==='capture_note')value=await domains.invoke('quick-capture',a);
      else if(name==='personal_operation')value=await domains.invoke('personal-operation',a);
      else if(name==='write_fact')value=domains.writeFact(a);
      else if(name==='record_event')value=query.execute({table:'moments',operation:'insert',values:a}).data;
      else if(name==='structural_change')value=a.type==='moments'&&['remove','display-name'].includes(a.action)?query.execute({table:'moments',operation:a.action==='remove'?'delete':'update',values:{title:a.options?.name},filters:[['eq','id',a.id]]}).data:store.structural(a.type,a.id,a.action,a.options);
      else if(name==='review_suggestions')value=await domains.invoke('review-queue-bulk',a);
      else if(name==='validate_knowledge'){store.scan();value={problems:store.problems};}
      else throw new Error('Unknown tool');
      result={content:[{type:'text',text:JSON.stringify(value)}]};
    }else return {jsonrpc:'2.0',id,error:{code:-32601,message:'Unknown method'}};
    return {jsonrpc:'2.0',id,result};
  }catch(e){return input.method==='tools/call'?{jsonrpc:'2.0',id,result:{content:[{type:'text',text:e.message}],isError:true}}:{jsonrpc:'2.0',id,error:{code:-32602,message:e.message}};}
}
