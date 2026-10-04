import { toast } from 'sonner';
const states = new Map<string,any>();
const queues = new Map<string,Promise<void>>();
export async function hydrateFileChats(){
  // The sign-in gate waits for this, so whatever goes wrong here is the whole
  // screen. A timed-out signal threw its own wording ("signal is timed out")
  // straight at the person, who had asked for a dashboard, not a stopwatch.
  let r:Response;
  try { r=await fetch('/api/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({table:'note_conversations'}),signal:AbortSignal.timeout(15000)}); }
  catch { throw new Error('Your server is busy saving and did not answer in time. Try again in a moment.'); }
  if(!r.ok)throw new Error('Conversation history could not be loaded');
  const result=await r.json();for(const row of result.data||[])states.set(row.context_key,row.state);
}
export function loadFileChat(key:string){return states.get(key)||{messages:[],summary:'',summarizedUpTo:0};}
export function saveFileChat(key:string,state:any,clear=false){
  const expected=loadFileChat(key);
  if(!clear&&JSON.stringify(expected)===JSON.stringify(state))return;
  states.set(key,state);
  const previous=queues.get(key)||Promise.resolve();
  const next=previous.catch(()=>{}).then(async()=>{
    const r=await fetch('/api/chat-state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({context_key:key,state,...(clear?{clear:true,expected_state:expected}:{})})});
    if(!r.ok)throw new Error('Conversation history was not saved. Keep this window open and retry.');
    const result=await r.json();
    if(result.state&&states.get(key)===state&&JSON.stringify(result.state)!==JSON.stringify(state)){
      states.set(key,result.state);window.dispatchEvent(new CustomEvent('godspeed:chat-history-updated',{detail:{key}}));
    }
  });
  queues.set(key,next);next.catch(e=>toast.error(e.message));
}
export function clearFileChat(key:string){saveFileChat(key,{messages:[],summary:'',summarizedUpTo:0},true);}
