import {hash} from './records/store.mjs';
import {randomUUID} from 'node:crypto';

const conversationRecord=(store,key)=>store.get('note_conversations','chat-'+hash(key).slice(0,24));
export const conversationRuntimeId=input=>input.conversation_session?input.conversation_id+':session:'+input.conversation_session:input.conversation_id;
export function bindConversationSession(store,input){
 if(!input.conversation_id?.startsWith('notebook:'))return;
 const session=conversationRecord(store,input.conversation_id.slice(9))?.state?.session_id||'';
 if((session||input.conversation_session!==undefined)&&input.conversation_session!==session)throw Object.assign(Error('This conversation was cleared in another window. Reopen it before sending a message.'),{code:'CONFLICT'});
 input.conversation_session=session;
}

const sameMessage=(a,b)=>a.role===b.role&&a.content===b.content;
const prefix=(short,long)=>short.length<=long.length&&short.every((message,i)=>sameMessage(message,long[i]));
const withoutAnsweredFailures=messages=>messages.map((message,i)=>{
 if(message.role!=='user'||messages[i+1]?.role!=='assistant'||!message.lastFailure)return message;
 const answered={...message};delete answered.lastFailure;return answered;
});
// Another window on the same conversation saved turns this one never saw. The
// stored turns keep their place and this window's turns that the store lacks
// follow them, so neither window's messages are lost or repeated. A turn both
// hold keeps the fields only this window knows, such as an edit's undo.
function joined(stored,incoming){
 const messages=[...stored];let shared=0;
 while(shared<stored.length&&shared<incoming.length&&sameMessage(stored[shared],incoming[shared])){messages[shared]={...stored[shared],...incoming[shared]};shared++;}
 const unmatched=stored.map((_,i)=>i).slice(shared);
 for(const message of incoming.slice(shared)){
  const at=unmatched.findIndex(i=>sameMessage(stored[i],message));
  if(at<0)messages.push(message);else{const i=unmatched.splice(at,1)[0];messages[i]={...stored[i],...message};}
 }
 return messages;
}
export function saveConversationState(store,input,{asyncWriter=false,signal}={}){
 const key=input.context_key;let state=input.state;
 if(typeof key!=='string'||!key||key.length>400||!Array.isArray(state?.messages)||state.messages.some(m=>!['user','assistant'].includes(m.role)||typeof m.content!=='string'))throw Error('Invalid conversation state');
 return (asyncWriter?store.withLockAsync.bind(store):store.withLock.bind(store))(()=>{
  const id='chat-'+hash(key).slice(0,24),old=store.get('note_conversations',id),current=old?.state,revision=old?.revision;
  if(input.clear===true){
   if(state.messages.length||!input.expected_state||(current&&hash(input.expected_state)!==hash(current)))throw Object.assign(Error('Conversation changed before clearing. Reopen it and review the current history.'),{code:'CONFLICT'});
   state={messages:[],summary:'',summarizedUpTo:0,session_id:randomUUID()};
  }else if(current){
   if((state.session_id||'')!==(current.session_id||''))return {ok:true,state:current,revision,ignored_stale:true};
   if(hash(current)===hash(state))return {ok:true,state:current,revision,unchanged:true};
   if(!prefix(current.messages,state.messages)){
    state={...current,messages:withoutAnsweredFailures(joined(current.messages,state.messages))};
    if(hash(state)===hash(current))return {ok:true,state:current,revision,ignored_stale:true};
   }else{
    if(state.messages.length===current.messages.length&&(state.summarizedUpTo||0)<(current.summarizedUpTo||0))return {ok:true,state:current,revision,ignored_stale:true};
    state={...state,messages:withoutAnsweredFailures(state.messages.map((message,i)=>({...current.messages[i],...message})))};
   }
  }
  store.commit([store.prepare('note_conversations',{id,context_key:key,state},old),store.prepare('conversation_messages',{context_key:key,state_snapshot:state})]);
  return {ok:true,state,revision:store.get('note_conversations',id).revision};
 },{signal});
}

export function retainCompletedConversation(store,input,result,{asyncWriter=false,signal}={}){
 if(typeof result?.reply!=='string'||!input.conversation_id?.startsWith('notebook:'))return;
 const key=input.conversation_id.slice('notebook:'.length),id='chat-'+hash(key).slice(0,24);
 return (asyncWriter?store.withLockAsync.bind(store):store.withLock.bind(store))(()=>{
  const old=store.get('note_conversations',id);
  // A reply already running when another window clears belongs to its old session.
  if((input.conversation_session||'')!==(old?.state?.session_id||''))return;
  if(input.request_id&&old?.completed_request_ids?.includes(input.request_id))return;
  const state=old?.state||{messages:[],summary:'',summarizedUpTo:0},messages=[...state.messages];
  // The reply follows its own question. When another window's question was
  // saved after it while this reply ran, the question is no longer last, and
  // adding it again would show it twice.
  let at=messages.findLastIndex((m,i)=>m.role==='user'&&m.content===input.message&&messages[i+1]?.role!=='assistant')+1;
  if(!at){messages.push({role:'user',content:input.message,...(input.files?.length?{attachments:input.files}:{})});at=messages.length;}
  messages[at-1]={...messages[at-1]};
  delete messages[at-1].lastFailure;
  messages.splice(at,0,{role:'assistant',content:result.reply,...(result.tool_results?{toolResults:result.tool_results}:{}),...(result.notes_created?.length?{notesCreated:result.notes_created}:{})});
  store.commit([store.prepare('note_conversations',{id,context_key:key,state:{...state,messages},completed_request_ids:[...(old?.completed_request_ids||[]),...(input.request_id?[input.request_id]:[])]},old)]);
 },{signal});
}

// A message the notebook itself says into a notebook chat, such as a waiting step's question.
export function appendAssistantMessage(store,key,content){
 const id='chat-'+hash(key).slice(0,24);
 return store.withLock(()=>{
  const old=store.get('note_conversations',id),state=old?.state||{messages:[],summary:'',summarizedUpTo:0};
  store.commit([store.prepare('note_conversations',{id,context_key:key,state:{...state,messages:[...state.messages,{role:'assistant',content}]}},old)]);
 });
}
