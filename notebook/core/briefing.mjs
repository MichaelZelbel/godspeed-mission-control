import {visibleRows} from './visibility.mjs';
import {hash} from './records/store.mjs';
import {procedure} from './procedures.mjs';
import {remind} from './goal-loop.mjs';
import {watchCommand} from './watch-commands.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Store} from './records/store.mjs';
import {QueryService} from './query.mjs';
import {checkVoice} from './voice-check.mjs';
import {recipeContext} from './recipe-context.mjs';
import {fileContext} from './context.mjs';
import {localPath} from './local-path.mjs';
export async function briefing(job,{store,query,provider}){
 if(job.rehearsal){
  const copy=path.join(store.state,'brief-rehearsals',randomUUID());fs.mkdirSync(copy,{recursive:true,mode:0o700});
  await store.waitForWriter();store.withLock(()=>{
   fs.cpSync(store.recordsRoot,path.join(copy,'records'),{recursive:true,preserveTimestamps:true});
   for(const name of ['profile','rules','due','coach','journal','routines/headache']){const source=path.join(store.root,name);if(fs.existsSync(source))fs.cpSync(source,path.join(copy,name),{recursive:true,preserveTimestamps:true});}
   // file-newer tests only existence and mtime. Reproduce that evidence without
   // copying unrelated deliverables or credential contents into the rehearsal.
   const due=path.join(store.root,'due');
   if(fs.existsSync(due))for(const name of fs.readdirSync(due).filter(n=>n.endsWith('.md'))){
    const text=fs.readFileSync(localPath(store.root,'due/'+name),'utf8');
    if(!/^SELF-CHECK:\s*file-newer\s*$/m.test(text))continue;
    const value=text.match(/^SELF-CHECK-ARG:\s*(.+)$/m)?.[1]?.trim();if(!value)continue;
    const original=localPath(store.root,value),relative=path.relative(store.root,original);
    if(relative.split(path.sep).some(p=>p.startsWith('.')))throw Error('Rehearsal dependency must not use private runtime state');
    if(!fs.existsSync(original))continue;
    const target=localPath(copy,relative),stat=fs.statSync(original);
    if(fs.existsSync(target))continue;
    if(stat.isDirectory())fs.mkdirSync(target,{recursive:true});
    else {fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,'',{mode:0o600});}
    fs.utimesSync(target,stat.atime,stat.mtime);
   }
  });
  const rehearsalStore=new Store(copy,{device:store.device}),rehearsalQuery=new QueryService(rehearsalStore);
  return {...await runBriefing(job,{store:rehearsalStore,query:rehearsalQuery,provider}),rehearsal_workspace:copy};
 }
 return runBriefing(job,{store,query,provider});
}
async function runBriefing(job,{store,query,provider}){
 if(!provider)throw Error('Connect an assistant before writing a briefing');
 remind({},{store,query});
 const watch=visibleRows(query,'watch_topics').filter(t=>!t.paused&&t.include_in_brief);
 if(watch.length)await procedure({id:job.id+'-sources',kind:'watch',topic_ids:watch.map(t=>t.id)},{store,query,provider});
 const context={goals:visibleRows(query,'goals').filter(g=>['active','adopted'].includes(g.status)),decisions:visibleRows(query,'decisions').slice(-10),work:visibleRows(query,'work_items').slice(-20),deadlines:visibleRows(query,'deadlines').filter(d=>d.status!=='closed'),health:visibleRows(query,'health_observations').filter(h=>Date.parse(h.observed_at)>=Date.now()-7*86400000),episodes:visibleRows(query,'health_episodes').filter(h=>Date.parse(h.onset_at)>=Date.now()-30*86400000),medications:visibleRows(query,'medications').filter(h=>Date.parse(h.taken_at)>=Date.now()-30*86400000),source_receipts:visibleRows(query,'watch_observations').filter(o=>Date.parse(o.observed_at)>=Date.now()-48*3600000),previous:visibleRows(query,'notes').filter(n=>n.source_app==='morning-brief').slice(-3).map(n=>({id:n.id,title:n.title,content:n.content,created_at:n.created_at,verification_id:n.verification_id,delivery_verification_id:n.delivery_verification_id})),rehearsals:visibleRows(query,'job_receipts').filter(r=>r.kind==='brief-rehearsal').slice(-2).map(r=>({id:r.id,state:r.state,error:r.error,result:r.result,finished_at:r.finished_at}))};
 context.watch_findings=JSON.parse(watchCommand({store,query},['pull','--channel','brief','--dry-run']).result);
 context.workflow=recipeContext(store,'morning-note');
 context.workspace_sources=fileContext(store,20000);
 const writerContract='Write only the short useful morning note from these actual sources. Use concise everyday language and the configured voice, without em dashes, headings or machinery chatter. Include one factual health sentence using only fresh recorded inputs, or honestly say fresh observations are missing. Include one useful action and its adopted goal. Retain uncertainty. Do not repeat unchanged prior advice or claim a draft caused real-world progress. No unsupported figures, invented links, medical diagnosis or requests for self-management.';
 const profile=path.join(store.root,'profile','voice.md'),voice=fs.existsSync(profile)?fs.readFileSync(profile,'utf8'):null;
 const codeGate=text=>{const errors=[];if(typeof text!=='string'||!text.trim())errors.push('Briefing produced no text');else{if(text.includes('\u2014'))errors.push('Use the configured plain writing style');if(voice){const checked=checkVoice(text,voice);if(checked.configured&&!checked.passed)errors.push('Configured voice check failed: '+checked.hits.map(h=>h.value).join(', '));}if(context.previous.some(n=>n.content.trim()===text.trim()))errors.push('The same note was already saved; do not repeat it');}return errors;};
 const verify=async(text,check)=>{const raw=await provider({kind:'brief-verification',check,context:{sources:context,draft:text},contract:check==='source-facts'?'Check this exact draft against its actual dated sources and previous notes. Return JSON {passed:boolean,reason:string}. Fail unsupported claims, stale health, invented outcomes, absent health sentence and unchanged advice. Do not rewrite or send.':'Independently read this as a tired person seeing none of the work. Check clear meaning, usefulness, actual reachable decision artifacts, one current health sentence, no jargon or internal codes, and no repeated unanswered advice. Return JSON {passed:boolean,reason:string}. Do not rewrite or send.'});let verdict;try{verdict=typeof raw==='string'?JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g,'')):raw;}catch{verdict={passed:false,reason:'Briefing check returned no valid verdict'};}if(!verdict||typeof verdict!=='object')verdict={passed:false,reason:'Briefing check returned no verdict'};const receipt=store.save('job_receipts',{kind:check==='source-facts'?'brief-verification':'brief-delivery-verification',check,job_id:job.id,state:verdict.passed===true?'verified':'failed',source_hash:hash(context),draft_hash:hash(text),verdict,finished_at:new Date().toISOString()});return {verdict,receipt};};
 let draft,check,deliveryCheck,feedback=[];
 for(let attempt=0;attempt<2;attempt++){
  draft=await provider({kind:'morning-brief',phase:attempt?'one-rewrite':'write',context:{...context,...(attempt?{rejected_draft:draft,check_feedback:feedback}:{})},contract:writerContract+(attempt?' Correct the rejected note using these exact failure reasons. This is the single permitted rewrite.':'')});
  if(typeof draft!=='string'||!draft.trim())throw Error('Briefing produced no text');
  const code=codeGate(draft),facts=await verify(draft,'source-facts'),reader=await verify(draft,'plain-words-and-delivery');
  feedback=[...code,...[facts,reader].filter(r=>r.verdict.passed!==true).map(r=>r.verdict.reason||'No accepted evidence')];
  store.save('job_receipts',{kind:'brief-code-gate',job_id:job.id,attempt,state:code.length?'failed':'verified',source_hash:hash(context),draft_hash:hash(draft),errors:code,finished_at:new Date().toISOString()});
  if(!feedback.length){check=facts.receipt;deliveryCheck=reader.receipt;break;}
  if(attempt===1)throw Error('Briefing check failed after one rewrite: '+feedback.join('; '));
 }
 const finalErrors=codeGate(draft);if(finalErrors.length)throw Error('Final exact briefing check failed: '+finalErrors.join('; '));
 if(job.rehearsal)return {verified:true,silent:true,rehearsal:true,source_hash:hash(context),draft_hash:hash(draft),verification_ids:[check.id,deliveryCheck.id]};
 const key='brief-'+hash(draft);if(store.get('notifications',key))return {verified:true,silent:true};
 const note=store.prepare('notes',{title:'Your morning briefing',content:draft,source_app:'morning-brief',verification_id:check.id,delivery_verification_id:deliveryCheck.id,sources:context.source_receipts.map(s=>s.id),evidence:context});
 await store.waitForWriter();
 store.withLock(()=>{const findings=context.watch_findings.filter(f=>draft.includes(f.what)&&draft.includes(f.link)).map(f=>store.get('watch_findings',f.id)).filter(f=>f?.status==='pending');store.commit([note,store.prepare('notifications',{id:key,record_id:note.id,verification_id:check.id,status:'ready'}),...findings.map(f=>store.prepare('watch_findings',{status:'shown',shown_at:new Date().toISOString(),channel:'brief',delivery_note_id:note.id},f))]);});
 return {verified:true,record_id:note.id,content_hash:store.get('notes',note.id)._hash,delivery:'notebook'};
}
