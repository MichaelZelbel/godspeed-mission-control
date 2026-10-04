import {hash} from './records/store.mjs';

const sameMessage=(a,b)=>a.role===b.role&&a.content===b.content;
const prefix=(short,long)=>short.length<=long.length&&short.every((message,i)=>sameMessage(message,long[i]));
export function saveConversationState(store,input,{asyncWriter=false,signal}={}){
 const key=input.context_key;let state=input.state;
 if(typeof key!=='string'||!key||key.length>400||!Array.isArray(state?.messages)||state.messages.some(m=>!['user','assistant'].includes(m.role)||typeof m.content!=='string'))throw Error('Invalid conversation state');
 return (asyncWriter?store.withLockAsync.bind(store):store.withLock.bind(store))(()=>{
  const id='chat-'+hash(key).slice(0,24),old=store.get('note_conversations',id),current=old?.state;
  if(current&&hash(current)===hash(state))return {ok:true,state:current,unchanged:true};
  if(input.clear===true){
   if(state.messages.length||!current||!input.expected_state||hash(input.expected_state)!==hash(current))throw Object.assign(Error('Conversation changed before clearing. Reopen it and review the current history.'),{code:'CONFLICT'});
  }else if(current){
   if(prefix(state.messages,current.messages)&&state.messages.length<current.messages.length)return {ok:true,state:current,ignored_stale:true};
   if(!prefix(current.messages,state.messages)){
    // Every competing branch remains available, but cannot replace another reply.
    store.conflict('note_conversations',{...old,state},old);
   }
   if(state.messages.length===current.messages.length&&(state.summarizedUpTo||0)<(current.summarizedUpTo||0))return {ok:true,state:current,ignored_stale:true};
   state={...state,messages:state.messages.map((message,i)=>({...current.messages[i],...message}))};
  }
  store.commit([store.prepare('note_conversations',{id,context_key:key,state},old),store.prepare('conversation_messages',{context_key:key,state_snapshot:state})]);
  return {ok:true,state};
 },{signal});
}

export function retainCompletedConversation(store,input,result,{asyncWriter=false,signal}={}){
 if(typeof result?.reply!=='string'||!input.conversation_id?.startsWith('notebook:'))return;
 const key=input.conversation_id.slice('notebook:'.length),id='chat-'+hash(key).slice(0,24);
 return (asyncWriter?store.withLockAsync.bind(store):store.withLock.bind(store))(()=>{
  const old=store.get('note_conversations',id);
  if(input.request_id&&old?.completed_request_ids?.includes(input.request_id))return;
  const state=old?.state||{messages:[],summary:'',summarizedUpTo:0},messages=[...state.messages];
  if(messages.at(-1)?.role!=='user'||messages.at(-1)?.content!==input.message)messages.push({role:'user',content:input.message,...(input.files?.length?{attachments:input.files}:{})});
  messages.push({role:'assistant',content:result.reply,...(result.tool_results?{toolResults:result.tool_results}:{}),...(result.notes_created?.length?{notesCreated:result.notes_created}:{})});
  store.commit([store.prepare('note_conversations',{id,context_key:key,state:{...state,messages},completed_request_ids:[...(old?.completed_request_ids||[]),...(input.request_id?[input.request_id]:[])]},old)]);
 },{signal});
}
