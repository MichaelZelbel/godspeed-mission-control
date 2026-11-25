
const CHAT_OPTIONS_EVENT='godspeed:chat-options';
let startedRequest=0,publishedRequest=0,latestOptions;

export function publishChatOptions(options){
 if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent(CHAT_OPTIONS_EVENT,{detail:options}));
 return options;
}

export function listenForChatOptions(listener){
 const receive=event=>listener(event.detail);
 window.addEventListener(CHAT_OPTIONS_EVENT,receive);
 return()=>window.removeEventListener(CHAT_OPTIONS_EVENT,receive);
}

export const MODEL_LIST_UNAVAILABLE='Your AI is connected, but its model choices could not be loaded.';

// A failed model list is asked again after 5 s, 15 s and 60 s, then once a minute (#1124).
const RETRY_DELAYS=[5000,15000,60000];
export function retryDelay(failures){return RETRY_DELAYS[Math.min(Math.max(failures,1),RETRY_DELAYS.length)-1];}

export function isCurrentAIError(message){
 return /Your AI (?:key or sign-in was refused|could not be reached|is connected only to the notebook)/.test(String(message||''));
}

export async function loadChatOptions({fetcher=fetch,signal,timeoutMs=15000}={}){
 const request=++startedRequest;
 const deadline=AbortSignal.timeout(timeoutMs),combined=signal?AbortSignal.any([signal,deadline]):deadline;
 let response;
 try{response=await fetcher('/api/chat/options',{signal:combined});}catch(error){if(signal?.aborted)throw error;throw Error('Model choices did not load. Try again.');}
 let data;try{data=await response.json();}catch{throw Error('Your server did not return readable model choices. Try again.');}
 if(!response.ok)throw Error(typeof data?.error==='string'?data.error:'Model choices could not be loaded. Try again.');
 if(!Array.isArray(data?.models)||!data.models.length||data.models.some(m=>typeof m?.id!=='string'||!Array.isArray(m.efforts)||m.efforts.some(e=>typeof e!=='string')))throw Error('No model choices are available from the connected account.');
 const current=data.models.some(m=>m.id===data.current)?data.current:data.models.length===1&&data.models[0].id===''?'':null;
 if(current===null)throw Error('The configured model is not among the available choices.');
 // connected:false is the server saying no AI is connected at all (#563); any other answer is a connected AI.
 const options={current,label:data.connected===false?'No AI connected':typeof data.current==='string'?data.current:'Connected model',connected:data.connected!==false,usable:data.connected!==false&&data.usable!==false,availability:data.availability,models:data.models};
 // Several open surfaces can finish their five-second reads out of order. An older
 // ready answer must not overwrite a newer refusal or recovery everywhere else.
 if(request<publishedRequest)return latestOptions;
 publishedRequest=request;latestOptions=options;
 return publishChatOptions(options);
}
