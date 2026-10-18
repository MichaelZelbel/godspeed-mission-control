import {toast} from 'sonner';
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
 const response=await fetch('/api/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({table:'settings',filters:[['eq','id','ui-preferences']]})});if(!response.ok)throw new Error('Could not load your saved preferences');
 const record=(await response.json()).data[0];values=record?.preferences||{};version=record?._hash;
 const set=Storage.prototype.setItem,remove=Storage.prototype.removeItem;
 for(const key of Object.keys(localStorage))if(durable(key)&&!(key in values))remove.call(localStorage,key);
 for(const [key,value] of Object.entries(values))set.call(localStorage,key,value);
 const save=()=>{dirty=true;clearTimeout(timer);timer=setTimeout(persist,150);};
 Storage.prototype.setItem=function(key:string,value:string){set.call(this,key,value);if(this===localStorage&&durable(key)){values[key]=String(value);save();}};
 Storage.prototype.removeItem=function(key:string){remove.call(this,key);if(this===localStorage&&durable(key)){delete values[key];save();}};
 window.addEventListener('pagehide',()=>{if(dirty)void persist();});installed=true;
}
