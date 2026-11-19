import { toast } from 'sonner';
import {startupRequest} from './startup-request';
// What this window shows, and the newest history the server confirmed for it.
// A window holding saves the server has not answered keeps its own copy; once
// they are answered it takes the confirmed one, which holds them too. A window
// whose last save failed sends its copy again instead, so the server's merge
// keeps what that save lost.
const states = new Map<string,any>();
const confirmed = new Map<string,{state:any,revision:number}>();
const waiting = new Map<string,number>();
const unsaved = new Set<string>();
const queues = new Map<string,Promise<any>>();
// The other windows open on the same notebook, such as a chat's pop-out.
const windows=typeof BroadcastChannel==='function'?new BroadcastChannel('godspeed:chat-states'):null;
function changed(key:string){window.dispatchEvent(new CustomEvent('godspeed:chat-history-updated',{detail:{key}}));}
function settle(key:string){
  if(waiting.get(key))return;
  if(unsaved.has(key)){send(key,states.get(key)).catch(()=>{});return;}
  const next=confirmed.get(key)?.state;
  if(!next||JSON.stringify(next)===JSON.stringify(states.get(key)))return;
  states.set(key,next);changed(key);
}
function remember(key:string,state:any,revision:unknown){
  const known=confirmed.get(key);
  if(known&&typeof revision==='number'&&revision<=known.revision)return false;
  confirmed.set(key,{state,revision:typeof revision==='number'?revision:known?.revision??0});
  return true;
}
function share(key:string,state:any,revision:unknown){
  if(remember(key,state,revision))windows?.postMessage({key,state,revision});
}
if(windows)windows.onmessage=({data})=>{
  if(typeof data?.key==='string'&&Array.isArray(data.state?.messages)&&remember(data.key,data.state,data.revision))settle(data.key);
};
export async function hydrateFileChats(){
  // The sign-in gate waits for this, so whatever goes wrong here is the whole
  // screen. A timed-out signal threw its own wording ("signal is timed out")
  // straight at the person, who had asked for a dashboard, not a stopwatch.
  const r=await startupRequest(signal=>fetch('/api/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({table:'note_conversations'}),signal}));
  if(!r.ok)throw new Error('Conversation history could not be loaded');
  const result=await r.json();for(const row of result.data||[]){states.set(row.context_key,row.state);remember(row.context_key,row.state,row.revision);}
}
export function loadFileChat(key:string){return states.get(key)||{messages:[],summary:'',summarizedUpTo:0};}
export function saveFileChat(key:string,state:any){
  const expected=loadFileChat(key);
  if((expected.session_id||'')!==(state.session_id||'')){queueMicrotask(()=>changed(key));return;}
  if(JSON.stringify(expected)===JSON.stringify(state))return;
  states.set(key,state);
  send(key,state).catch(e=>toast.error(e.message));
}
function send(key:string,state:any){
  waiting.set(key,(waiting.get(key)||0)+1);
  const previous=queues.get(key)||Promise.resolve();
  const next=previous.catch(()=>{}).then(async()=>{
    let result;
    try{
      // A server that cannot be reached is a save that failed too, not a bare "Failed to fetch".
      const r=await fetch('/api/chat-state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({context_key:key,state})}).catch(()=>null);
      if(!r?.ok)throw new Error('Conversation history was not saved. Keep this window open and retry.');
      result=await r.json();
      unsaved.delete(key);
    }catch(e){unsaved.add(key);throw e;}
    finally{waiting.set(key,waiting.get(key)!-1);}
    if(result.state){share(key,result.state,result.revision);settle(key);}
  });
  queues.set(key,next);
  return next;
}
export function clearFileChat(key:string){
  const previous=queues.get(key)||Promise.resolve();
  const next=previous.then(async()=>{
    const expected=loadFileChat(key);
    const r=await fetch('/api/chat-state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({context_key:key,state:{messages:[],summary:'',summarizedUpTo:0},clear:true,expected_state:expected})}).catch(()=>null);
    const result=r?await r.json().catch(()=>({})):{};
    if(!r?.ok)throw new Error(result.error||'This conversation could not be cleared. Please try again.');
    states.set(key,result.state);unsaved.delete(key);
    changed(key);
    share(key,result.state,result.revision);
    return result.state;
  });
  // Keep the failure observable by this caller without poisoning the next attempt.
  queues.set(key,next.catch(()=>{}));
  return next;
}
