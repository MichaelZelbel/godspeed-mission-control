import {visibleRows} from './visibility.mjs';
import {hash} from './records/store.mjs';
import {procedure} from './procedures.mjs';
import {remind} from './goal-loop.mjs';
export async function briefing(job,{store,query,provider}){
 if(!provider)throw Error('Connect an assistant before writing a briefing');
 remind({},{store,query});
 const watch=visibleRows(query,'watch_topics').filter(t=>!t.paused&&t.include_in_brief);
 if(watch.length)await procedure({id:job.id+'-sources',kind:'watch',topic_ids:watch.map(t=>t.id)},{store,query,provider});
 const context={goals:visibleRows(query,'goals').filter(g=>['active','adopted'].includes(g.status)),decisions:visibleRows(query,'decisions').slice(-10),work:visibleRows(query,'work_items').slice(-20),deadlines:visibleRows(query,'deadlines').filter(d=>d.status!=='closed'),health:visibleRows(query,'health_observations').filter(h=>Date.parse(h.observed_at)>=Date.now()-7*86400000),episodes:visibleRows(query,'health_episodes').filter(h=>Date.parse(h.onset_at)>=Date.now()-30*86400000),medications:visibleRows(query,'medications').filter(h=>Date.parse(h.taken_at)>=Date.now()-30*86400000),source_receipts:visibleRows(query,'watch_observations').filter(o=>Date.parse(o.observed_at)>=Date.now()-48*3600000),previous:visibleRows(query,'notes').filter(n=>n.source_app==='morning-brief').slice(-3)};
 const draft=await provider({kind:'morning-brief',context,contract:'Write a short useful briefing from these actual sources. Include one factual health line using only fresh recorded inputs, or state that fresh inputs are missing. Include one useful action and its goal. Retain uncertainty. Do not repeat unchanged prior advice or assert that a draft caused real-world progress. No unsupported figures or medical diagnosis.'});
 if(typeof draft!=='string'||!draft.trim())throw Error('Briefing produced no text');
 const raw=await provider({kind:'brief-verification',context:{sources:context,draft},contract:'Check this exact draft against its actual sources and prior deliveries. Return JSON {passed:boolean,reason:string}. Fail unsupported claims, stale health claims, invented outcomes, missing health line or empty/unchanged advice. A criticism must prevent delivery.'});
 let verdict;try{verdict=typeof raw==='string'?JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g,'')):raw;}catch{throw Error('Briefing check returned no valid verdict');}
 const check=store.save('job_receipts',{kind:'brief-verification',job_id:job.id,state:verdict.passed===true?'verified':'failed',source_hash:hash(context),draft_hash:hash(draft),verdict,finished_at:new Date().toISOString()});
 if(verdict.passed!==true)throw Error('Briefing check failed: '+(verdict.reason||'No accepted evidence'));
 if(draft.includes('\u2014'))throw Error('Briefing check failed: use the configured plain writing style');
 const styleRaw=await provider({kind:'brief-verification',check:'usefulness-and-delivery',context:{sources:context,draft},contract:'Independently check usefulness and delivery: one clear useful action supported by the adopted goal; no repeat of unchanged previous advice; one fresh factual health line or honest missing-data line; concise everyday language; every offered decision artifact must actually exist among supplied work or notes. Return JSON {passed:boolean,reason:string}. Do not rewrite or send the draft.'});
 let style;try{style=typeof styleRaw==='string'?JSON.parse(styleRaw.replace(/^```(?:json)?\s*|\s*```$/g,'')):styleRaw;}catch{throw Error('Briefing usefulness check returned no valid verdict');}
 const deliveryCheck=store.save('job_receipts',{kind:'brief-delivery-verification',job_id:job.id,state:style.passed===true?'verified':'failed',source_hash:hash(context),draft_hash:hash(draft),verdict:style,finished_at:new Date().toISOString()});if(style.passed!==true)throw Error('Briefing delivery check failed: '+(style.reason||'No accepted evidence'));
 if(job.rehearsal)return {verified:true,silent:true,rehearsal:true,source_hash:hash(context),draft_hash:hash(draft),verification_ids:[check.id,deliveryCheck.id]};
 const key='brief-'+hash(draft);if(store.get('notifications',key))return {verified:true,silent:true};
 const note=store.save('notes',{title:'Your morning briefing',content:draft,source_app:'morning-brief',verification_id:check.id,delivery_verification_id:deliveryCheck.id,sources:context.source_receipts.map(s=>s.id)});
 store.save('notifications',{id:key,record_id:note.id,verification_id:check.id,status:'ready'});
 return {verified:true,record_id:note.id,content_hash:store.get('notes',note.id)._hash,delivery:'notebook'};
}
