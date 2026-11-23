import {toast} from 'sonner';
import {startupRequest} from './startup-request';
// Storage is a disposable UI cache. Durable preferences are loaded from the file service first.
let installed=false,values:Record<string,string>={},version:string|undefined,timer:any,writing=false,dirty=false;
const durable=(key:string)=>/^(menerio|godspeed|collection|notes|people|world|sidebar|view|theme)/i.test(key)&&!/token|api[-_]key|supabase|session|auth|password/i.test(key);
async function persist(){
 if(writing)return;writing=true;dirty=false;
 try{const response=await fetch('/api/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({table:'settings',operation:'upsert',values:{id:'ui-preferences',preferences:{...values}},expected:version?{'ui-preferences':version}:{}}),keepalive:true});const result=await response.json();if(!response.ok)throw new Error(result.error);version=result.data[0]._hash;}
 catch{toast.error('Your preference change could not be saved. Review conflicting edits in the control desk.');}
 finally{writing=false;if(dirty)timer=setTimeout(persist,100);}
}
export async function hydrateFilePreferences(){
 if(installed)return;
 // Also behind the sign-in gate: see the note in file-chat.ts.
 const response=await startupRequest(signal=>fetch('/api/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({table:'settings',filters:[['eq','id','ui-preferences']]}),signal}));
 if(!response.ok)throw new Error('Could not load your saved preferences');
 const record=(await response.json()).data[0];values=record?.preferences||{};version=record?._hash;
 // The prototype of whatever localStorage is: the browser's Storage, or the tab stand-in when storage is blocked.
 const store=localStorage,proto=Object.getPrototypeOf(store),set=proto.setItem,remove=proto.removeItem;
 const existing=Array.from({length:store.length},(_,i)=>store.key(i) as string);
 for(const key of existing)if(durable(key)&&!(key in values))remove.call(store,key);
 for(const [key,value] of Object.entries(values))set.call(store,key,value);
 const save=()=>{dirty=true;clearTimeout(timer);timer=setTimeout(persist,150);};
 proto.setItem=function(key:string,value:string){set.call(this,key,value);if(this===store&&durable(key)&&values[key]!==String(value)){values[key]=String(value);save();}};
 proto.removeItem=function(key:string){remove.call(this,key);if(this===store&&durable(key)&&key in values){delete values[key];save();}};
 window.addEventListener('pagehide',()=>{if(dirty)void persist();});installed=true;
}
