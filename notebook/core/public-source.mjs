// Public research only. Account access belongs to the private connector layer.
export async function publicSource(raw,{fetcher=fetch,timeoutMs=15000,maxBytes=1024*1024}={}){
 const url=new URL(raw);
 if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw Error('Public sources require HTTPS or a local test source');
 if(url.username||url.password||[...url.searchParams.keys()].some(k=>/^(?:token|key|api[_-]?key|access[_-]?token|password|secret)$/i.test(k)))throw Error('Source URLs must not contain credentials');
 const response=await fetcher(url,{signal:AbortSignal.timeout(timeoutMs),redirect:'error'});
 if(!response.ok)throw Error('Source returned HTTP '+response.status);
 const reader=response.body.getReader(),chunks=[];let length=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>maxBytes)throw Error('Public source exceeds its byte limit');chunks.push(value);}}finally{await reader.cancel();}
 const content=Buffer.concat(chunks).toString('utf8');if(!content.trim())throw Error('Source returned no readable text');return {url:url.href,content,status:response.status,fetched_at:new Date().toISOString()};
}
export function redactedSourceURL(raw){try{const url=new URL(raw);url.username='';url.password='';for(const key of [...url.searchParams.keys()])if(/^(?:token|key|api[_-]?key|access[_-]?token|password|secret)$/i.test(key))url.searchParams.set(key,'REDACTED');return url.href;}catch{return 'Invalid configured source URL';}}
