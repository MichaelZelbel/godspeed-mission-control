import {visibleRows} from '../core/visibility.mjs';
const schema={type:'object',properties:{},additionalProperties:true};
const definitions=[
  {name:'search_knowledge',description:'Search the rebuildable index of user records.',inputSchema:{type:'object',properties:{query:{type:'string'}},required:['query']}},
  {name:'list_records',description:'Read file-backed notes, contacts, profile facts, world views, collections, timeline, media metadata, reviews, comments, goals or work.',inputSchema:{type:'object',properties:{type:{type:'string'},filters:{type:'array'},limit:{type:'integer'}},required:['type']}},
  {name:'save_record',description:'Save one user record with optimistic conflict detection. Preserve its id and hash for edits. Use review suggestions for AI-inferred facts.',inputSchema:{type:'object',properties:{type:{type:'string'},value:{type:'object'},expected_hash:{type:'string'}},required:['type','value']}},
  {name:'capture_note',description:'Capture the user\'s note in a durable Markdown file.',inputSchema:{type:'object',properties:{title:{type:'string'},content:{type:'string'}},required:['content']}},
  {name:'write_fact',description:'Record a confirmed fact and close earlier single-valued claims. AI inference must instead create a pending review_queue record.',inputSchema:schema},
  {name:'record_event',description:'Append a timeline event. Earlier events are never replaced.',inputSchema:schema},
  {name:'structural_change',description:'Rename a file with stable UUID and retained alias, edit a display name, merge records or tombstone a removal. Use only for changes the user requested.',inputSchema:{type:'object',properties:{type:{type:'string'},id:{type:'string'},action:{enum:['display-name','rename','merge','remove']},options:{type:'object'}},required:['type','id','action']}},
  {name:'review_suggestions',description:'Apply, reject, snooze or roll back user-reviewed suggestions. Never accept inferred personal facts without user approval.',inputSchema:schema},
  {name:'validate_knowledge',description:'Validate file identity and typed references without changing invalid files.',inputSchema:schema}
];
export async function mcp(input,{store,query,index,domains}){
  const id=input.id??null;let result;
  try{
    if(input.method==='initialize')result={protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'godspeed-mission-control',version:'0.1.0-alpha.1'}};
    else if(input.method==='notifications/initialized')return null;
    else if(input.method==='ping')result={};
    else if(input.method==='tools/list')result={tools:definitions};
    else if(input.method==='tools/call'){
      const {name,arguments:a={}}=input.params||{};let value;
      if(name==='search_knowledge')value=index.search(a.query).filter(r=>r.type!=='workspace_file'&&visibleRows(query,r.type).some(v=>v.id===r.id));
      else if(name==='list_records'){const allowed=new Set(visibleRows(query,a.type).map(r=>r.id));value=query.execute({table:a.type,filters:a.filters||[],limit:a.limit||100}).data.filter(r=>allowed.has(r.id));}
      else if(name==='save_record')value=query.execute({table:a.type,operation:a.value.id?'upsert':'insert',values:a.value,expected:a.value.id?{[a.value.id]:a.expected_hash}:{}}).data;
      else if(name==='capture_note')value=await domains.invoke('quick-capture',a);
      else if(name==='write_fact')value=domains.writeFact(a);
      else if(name==='record_event')value=query.execute({table:'moments',operation:'insert',values:a}).data;
      else if(name==='structural_change')value=store.structural(a.type,a.id,a.action,a.options);
      else if(name==='review_suggestions')value=await domains.invoke('review-queue-bulk',a);
      else if(name==='validate_knowledge'){store.scan();value={problems:store.problems};}
      else throw new Error('Unknown tool');
      result={content:[{type:'text',text:JSON.stringify(value)}]};
    }else return {jsonrpc:'2.0',id,error:{code:-32601,message:'Unknown method'}};
    return {jsonrpc:'2.0',id,result};
  }catch(e){return input.method==='tools/call'?{jsonrpc:'2.0',id,result:{content:[{type:'text',text:e.message}],isError:true}}:{jsonrpc:'2.0',id,error:{code:-32602,message:e.message}};}
}
