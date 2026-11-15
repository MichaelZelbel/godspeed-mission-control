import {outboundFetch} from './outbound-fetch.mjs';
// Public source discovery sends fixed research topics, never workspace contents.
export const radarResearchTopics=['ai-agents','agent-memory','rag'];
const maintainedProjects=['NousResearch/hermes-agent','langchain-ai/langgraph','run-llama/llama_index'];
// A topic's address is read through the outbound check (outbound-fetch.mjs):
// never this server or its network (until 6 October 2026 any address was read).
export async function readRadarSource(url,{accept='application/vnd.github+json',fetcher}={}){
 const response=await outboundFetch(String(url),{headers:{Accept:accept,'User-Agent':'Godspeed-Mission-Control-Radar'}},{fetcher,timeoutMs:15000,maxBytes:1024*1024,maxRedirects:0}).catch(error=>{throw /larger than/.test(error.message)?Error('Radar source exceeds its one-megabyte limit'):error;});
 if(!response.ok)throw Error('Source returned HTTP '+response.status);
 const content=Buffer.from(await response.arrayBuffer()).toString('utf8');if(!content.trim())throw Error('Source returned no readable text');return {content,status:response.status};
}
export async function discoverRadarSources({cycle=0,now=Date.now(),fetcher}={}){
 const topic=radarResearchTopics[cycle%radarResearchTopics.length],since=new Date(now-90*86400000).toISOString().slice(0,10);
 const query='topic:'+topic+' stars:>=100 fork:false archived:false pushed:>='+since;
 const url='https://api.github.com/search/repositories?'+new URLSearchParams({q:query,sort:'updated',order:'desc',per_page:'3'}),checks=[];
 const sources=[0,1].map(offset=>{const project=maintainedProjects[(cycle+offset)%maintainedProjects.length];return {topic:{id:'radar-primary-'+project.replaceAll('/','-'),publication_date:null,source_kind:'github-release'},url:'https://api.github.com/repos/'+project+'/releases?per_page=1'};});
 try{
  const response=await readRadarSource(url,{fetcher}),result=JSON.parse(response.content);if(!Array.isArray(result.items))throw Error('Repository search returned no item list');
  const repositories=result.items.filter(r=>r.private===false&&!r.archived&&!r.fork&&typeof r.full_name==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}\/[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(r.full_name)).slice(0,2);
  checks.push({stage:'discovery',query,url,ok:true,status:response.status,incomplete_results:result.incomplete_results===true,repositories:repositories.map(r=>r.full_name)});
  for(const repo of repositories)sources.push({topic:{id:'radar-discovered-'+repo.full_name.replaceAll('/','-'),source_kind:'github-readme',publication_date:null,discovery_query:query},url:'https://api.github.com/repos/'+repo.full_name+'/readme',accept:'application/vnd.github.raw+json'});
 }catch(error){checks.push({stage:'discovery',query,url,ok:false,error:error.message});}
 return {sources,checks,cycle,topic};
}
export function radarPrimaryContent(raw,kind){
 if(kind!=='github-release')return {content:raw,publication_date:null,primary_url:null};
 const release=JSON.parse(raw)[0];if(!release||release.draft||typeof release.body!=='string'||!release.body.trim())throw Error('Project has no readable published release');
 const url=new URL(release.html_url);if(url.protocol!=='https:'||url.hostname!=='github.com'||url.username||url.password||url.search||!/^\/[a-zA-Z0-9][a-zA-Z0-9_.-]*\/[a-zA-Z0-9][a-zA-Z0-9_.-]*\/releases\//.test(url.pathname))throw Error('Release does not identify its primary project page');
 return {content:release.body,publication_date:Number.isFinite(Date.parse(release.published_at))?release.published_at:null,primary_url:url.href};
}
