import {visibleRows} from '../core/visibility.mjs';
const actions={create_contact_topic:'create',update_contact_topic:'update',discuss_contact_topic:'discuss',archive_contact_topic:'archive',reopen_contact_topic:'reopen',undo_contact_topic_event:'undo'};
export const topicToolNames=['list_contact_topics','get_contact_topic_history',...Object.keys(actions)];
export const topicDefinitions=topicToolNames.map(name=>({name,description:name==='list_contact_topics'?'Read the exact visible person\'s discussion topics, filtered by status, priority then oldest first. Follow next_cursor.':name==='get_contact_topic_history'?'Read one visible discussion topic\'s latest events first. Follow next_cursor before undoing.':'Apply one explicitly requested discussion-topic '+actions[name]+' with a fresh request_id UUID and current expected_version. Retry an uncertain transport with the identical request and UUID. This never creates a reminder.',inputSchema:{type:'object',properties:{contact_id:{type:'string'},topic_id:{type:'string'},request_id:{type:'string'},expected_version:{type:'integer'},title:{type:'string',maxLength:300},mode:{enum:['one_off','recurring']},priority:{enum:['high','normal','low']},status:{enum:['active','completed','archived','all']},patch:{type:'object'},discussed_at:{type:'string'},close_after:{type:'boolean'},event_id:{type:'string'},cursor:{type:'string'},limit:{type:'integer'}}}}));
function page(rows,a,key){
 const limit=Math.max(1,Math.min(100,Number(a.limit)||50)),offset=a.cursor?rows.findIndex(row=>row.id===a.cursor)+1:0;
 if(a.cursor&&!offset)throw Error('The page changed; reread its first page');const selected=rows.slice(offset,offset+limit);
 return {[key]:selected,next_cursor:offset+limit<rows.length?selected.at(-1).id:null};
}
export function topicTool(name,a,{query,store}){
 return query.withSnapshot(()=>{
  const people=new Set(visibleRows(query,'contacts').map(p=>p.id)),topics=visibleRows(query,'contact_topics').filter(t=>people.has(t.contact_id)),topic=a.topic_id?topics.find(t=>t.id===a.topic_id):null;
  if(name==='list_contact_topics'){
   if(!people.has(a.contact_id))throw Error('Choose an exact visible person');
   if(a.status&&!['active','completed','archived','all'].includes(a.status))throw Error('Choose a supported topic status');
   const priorities={high:0,normal:1,low:2};return page(topics.filter(t=>t.contact_id===a.contact_id&&(!a.status||a.status==='all'||t.status===a.status)).sort((a,b)=>(priorities[a.priority]??1)-(priorities[b.priority]??1)||a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id)),a,'topics');
  }
  if(name==='get_contact_topic_history'){
   if(!topic)throw Error('Choose a visible existing topic');return page(visibleRows(query,'contact_topic_events').filter(e=>e.topic_id===topic.id).sort((a,b)=>b.after_state.version-a.after_state.version),a,'events');
  }
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(a.request_id||''))throw Error('Use a fresh request UUID and retain it on retry');
  if(name==='create_contact_topic'){if(!people.has(a.contact_id))throw Error('Choose an exact visible person');}
  else if(!topic)throw Error('Choose a visible existing topic');
  const fields={...a,action:actions[name]};delete fields.request_id;
  const result=query.topicCommand(a.request_id,fields);return {...result,person_url:'/dashboard/people/'+result.topic.contact_id};
 });
}
