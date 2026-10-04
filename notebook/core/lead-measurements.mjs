import {hash,safe} from './records/store.mjs';import {visibleRows} from './visibility.mjs';import {publicSource} from './public-source.mjs';
const supported=['numeric','citation-matches'];
const validPath=value=>typeof value==='string'&&value.length<200&&value.split('.').every(k=>/^[A-Za-z0-9_-]+$/.test(k)&&!['__proto__','constructor','prototype'].includes(k));
const valueAt=(data,field)=>field.split('.').reduce((value,key)=>value&&Object.hasOwn(value,key)?value[key]:undefined,data);
export function monthlyConfiguration(query,input){
 if(!input||typeof input.enabled!=='boolean')throw Error('Choose whether monthly progress measurement is enabled');
 if(!input.enabled)return {enabled:false};
 if(!Number.isInteger(input.day)||input.day<1||input.day>28||!Array.isArray(input.rungs)||!input.rungs.length||input.rungs.length>10)throw Error('Select a monthly day from one to twenty-eight and at most ten progress rungs');
 const ids=new Set(),goals=visibleRows(query,'goals');
 const rungs=input.rungs.map(r=>{
  safe(r.id);if(ids.has(r.id))throw Error('Progress rung IDs must be distinct');ids.add(r.id);
  if(typeof r.title!=='string'||!r.title.trim()||r.title.length>200||!supported.includes(r.kind))throw Error('Give each progress rung a title and supported measurement kind');
  if(!goals.some(g=>g.id===r.goal_id&&['adopted','active'].includes(g.status)))throw Error('Link each progress rung to an existing adopted goal');
  const url=new URL(r.url);if(url.username||url.password||url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname))||[...url.searchParams.keys()].some(k=>/^(?:token|key|api[_-]?key|access[_-]?token|password|secret)$/i.test(k)))throw Error('Progress sources need public HTTPS URLs without credentials');
  if(r.kind==='numeric'&&!validPath(r.value_path))throw Error('Select the actual numeric JSON value path');
  if(r.kind==='citation-matches'&&(!validPath(r.items_path)||!validPath(r.text_path)||typeof r.phrase!=='string'||r.phrase.trim().length<10||r.phrase.length>1000))throw Error('Select the actual search results, their text field and an exact quoted idea');
  return {id:r.id,title:r.title.trim(),goal_id:r.goal_id,url:url.href,kind:r.kind,...r.kind==='numeric'?{value_path:r.value_path}:{items_path:r.items_path,text_path:r.text_path,phrase:r.phrase}};
 });
 return {enabled:true,day:input.day,rungs};
}

// The observed returned result count is not a claim about every mention on the internet.
export async function monthlyMeasurements({store,query,settings,day,readSource=publicSource}){
 const configured=settings.monthly;if(!configured?.enabled||Number(day.slice(8,10))<configured.day)return [];
 const period=day.slice(0,7),configuration_hash=hash(configured),output=[];
 for(const rung of configured.rungs){
  const goal=visibleRows(query,'goals').find(g=>g.id===rung.goal_id&&['adopted','active'].includes(g.status));if(!goal)continue;
  const id='lead-measurement-'+hash([period,configuration_hash,rung.id]);
  const existing=store.get('lead_measurements',id);if(existing){output.push(existing);continue;}
  let fields={state:'UNVERIFIED',value:null,reason:'The source has not been measured'},source;
  try{
   source=await readSource(rung.url);const json=JSON.parse(source.content);
   if(rung.kind==='numeric'){
    const value=valueAt(json,rung.value_path);if(typeof value!=='number'||!Number.isFinite(value))throw Error('The selected source field is not a finite observed number');
    fields={state:'verified',value,reason:'Actual numeric value read from the selected JSON source',value_path:rung.value_path,quote:JSON.stringify(value)};
   }else{
    const items=valueAt(json,rung.items_path);if(!Array.isArray(items)||items.length>10000||items.some(item=>typeof valueAt(item,rung.text_path)!=='string'))throw Error('The selected source does not contain a complete supported result list');
    const matches=items.map((item,index)=>({index,text:valueAt(item,rung.text_path)})).filter(item=>item.text.includes(rung.phrase));
    fields={state:'verified',value:matches.length,reason:'Exact idea matches among these returned search results; no author name is required',returned_results:items.length,matches:matches.map(m=>({index:m.index,quote:rung.phrase,text_hash:hash(m.text)})),scope:'returned-results-only'};
   }
  }catch(error){fields={state:'UNVERIFIED',value:null,reason:error.message};}
  const measurement=await store.withLockAsync(()=>{
   const repeated=store.get('lead_measurements',id);if(repeated)return repeated;
   if(hash(store.get('settings','lead')?.monthly||null)!==configuration_hash||!visibleRows(query,'goals').some(g=>g.id===goal.id&&g._hash===goal._hash&&['adopted','active'].includes(g.status)))throw Error('The progress goal or monthly configuration changed during measurement');
   const previous=visibleRows(query,'lead_measurements').filter(m=>m.rung_id===rung.id).sort((a,b)=>a.observed_at.localeCompare(b.observed_at)).at(-1);
   const observation=source?store.prepare('watch_observations',{...source,sha256:hash(source.content),source_app:'lead-monthly',observed_at:source.fetched_at,rung_id:rung.id}):null;
   const record=store.prepare('lead_measurements',{id,rung_id:rung.id,title:rung.title,goal_id:rung.goal_id,period,configuration_hash,observed_at:source?.fetched_at||new Date().toISOString(),source_url:rung.url,source_id:observation?.id||null,source_hash:observation?.sha256||null,previous_id:previous?.id||null,...fields});
   store.commit([...(observation?[observation]:[]),record]);return record;
  });output.push(measurement);
 }
 return output;
}
