export async function loadChatOptions({fetcher=fetch,signal,timeoutMs=15000}={}){
 const deadline=AbortSignal.timeout(timeoutMs),combined=signal?AbortSignal.any([signal,deadline]):deadline;
 let response;
 try{response=await fetcher('/api/chat/options',{signal:combined});}catch(error){if(signal?.aborted)throw error;throw Error('Model choices did not load. Try again.');}
 let data;try{data=await response.json();}catch{throw Error('Your server did not return readable model choices. Try again.');}
 if(!response.ok)throw Error(typeof data?.error==='string'?data.error:'Model choices could not be loaded. Try again.');
 if(!Array.isArray(data?.models)||!data.models.length||data.models.some(m=>typeof m?.id!=='string'||!Array.isArray(m.efforts)||m.efforts.some(e=>typeof e!=='string')))throw Error('No model choices are available from the connected account.');
 const current=data.models.some(m=>m.id===data.current)?data.current:data.models.length===1&&data.models[0].id===''?'':null;
 if(current===null)throw Error('The configured model is not among the available choices.');
 return {current,label:typeof data.current==='string'?data.current:'Connected model',models:data.models};
}
