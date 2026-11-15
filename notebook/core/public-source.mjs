import {outboundFetch} from './outbound-fetch.mjs';
// Public research only. Account access belongs to the private connector layer.
// Read through the outbound check (outbound-fetch.mjs): until 6 October 2026
// http://localhost and 127.0.0.1 were accepted as "local test sources" in the
// product itself; a test now says so with GODSPEED_OUTBOUND_ALLOW_LOCAL.
export async function publicSource(raw,{fetcher,timeoutMs=15000,maxBytes=1024*1024}={}){
 const url=new URL(raw);
 if(url.protocol!=='https:'&&process.env.GODSPEED_OUTBOUND_ALLOW_LOCAL!=='1')throw Error('Public sources require HTTPS');
 if(url.username||url.password||[...url.searchParams.keys()].some(k=>/^(?:token|key|api[_-]?key|access[_-]?token|password|secret)$/i.test(k)))throw Error('Source URLs must not contain credentials');
 const response=await outboundFetch(url.href,{},{fetcher,timeoutMs,maxBytes,maxRedirects:0});
 if(!response.ok)throw Error('Source returned HTTP '+response.status);
 const content=Buffer.from(await response.arrayBuffer()).toString('utf8');if(!content.trim())throw Error('Source returned no readable text');return {url:url.href,content,status:response.status,fetched_at:new Date().toISOString()};
}
export function redactedSourceURL(raw){try{const url=new URL(raw);url.username='';url.password='';for(const key of [...url.searchParams.keys()])if(/^(?:token|key|api[_-]?key|access[_-]?token|password|secret)$/i.test(key))url.searchParams.set(key,'REDACTED');return url.href;}catch{return 'Invalid configured source URL';}}
