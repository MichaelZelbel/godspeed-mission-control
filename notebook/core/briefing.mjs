import {visibleRows} from './visibility.mjs';
import {hash} from './records/store.mjs';
import {procedure} from './procedures.mjs';
import {remind} from './deadline-reminders.mjs';
import {watchCommand} from './watch-commands.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Store} from './records/store.mjs';
import {QueryService} from './query.mjs';
import {checkVoice} from './voice-check.mjs';
import {ruleRefusals,describeRefusal,cutRefused} from './briefing-cut.mjs';
import {recipeContext} from './recipe-context.mjs';
import {fileContext} from './context.mjs';
import {localPath} from './local-path.mjs';
import {currentHealth} from './health-inputs.mjs';
import {cycleOperation} from './cycle-operations.mjs';
import {addonCommand} from './native-personal.mjs';
export async function briefing(job,{store,query,provider}){
 if(job.rehearsal){
  const copy=path.join(store.state,'brief-rehearsals',randomUUID());fs.mkdirSync(copy,{recursive:true,mode:0o700});
  await store.waitForWriter();await store.withLockAsync(()=>{
   fs.cpSync(store.recordsRoot,path.join(copy,path.basename(store.recordsRoot)),{recursive:true,preserveTimestamps:true});
   // A rehearsal is a copy of the workspace, so the rooms the brief reads come along as they are.
   // 'due' is among them not to read a reminder out of it - a reminder is a record now (#90) and
   // the line below takes its self check from there - but because a file in it that no program can
   // read has no record on purpose and is said as "needs a look" every day until it is fixed: the
   // rehearsal must say the same thing the real brief would.
   for(const name of ['profile','rules','due','coach','journal','routines/headache','routines/charm']){const source=path.join(store.root,name);if(fs.existsSync(source))fs.cpSync(source,path.join(copy,name),{recursive:true,preserveTimestamps:true});}
   // file-newer tests only existence and mtime. Reproduce that evidence without
   // copying unrelated deliverables or credential contents into the rehearsal.
   // Which reminders have such a self check is the records' answer (deadline-records.mjs:
   // SELF-CHECK and SELF-CHECK-ARG are self_check and self_check_arg), read under the lock this
   // already holds.
   for(const reminder of store.list('deadlines')){
    if(!reminder.native_slug||String(reminder.self_check||'').trim().toLowerCase()!=='file-newer')continue;
    const value=String(reminder.self_check_arg||'').trim();if(!value)continue;
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
 const voiceFile=path.join(store.root,'profile','voice.md'),voice=fs.existsSync(voiceFile)?fs.readFileSync(voiceFile,'utf8'):null;
 // A line Godspeed requires word for word that breaks those same rules is left out and reported (issue #117).
 const leftOut=[];
 const watch=visibleRows(query,'watch_topics').filter(t=>!t.paused&&t.include_in_brief);
 if(watch.length)await procedure({id:job.id+'-sources',kind:'watch',topic_ids:watch.map(t=>t.id)},{store,query,provider});
 const context={goals:visibleRows(query,'goals').filter(g=>['active','adopted'].includes(g.status)),decisions:visibleRows(query,'decisions').slice(-10),work:visibleRows(query,'work_items').slice(-20),deadlines:visibleRows(query,'deadlines').filter(d=>d.status!=='closed'),health:visibleRows(query,'health_observations').filter(h=>Date.parse(h.observed_at)>=Date.now()-7*86400000),episodes:visibleRows(query,'health_episodes').filter(h=>Date.parse(h.onset_at)>=Date.now()-30*86400000),medications:visibleRows(query,'medications').filter(h=>Date.parse(h.taken_at)>=Date.now()-30*86400000),source_receipts:[],previous:visibleRows(query,'notes').filter(n=>n.source_app==='morning-brief').slice(-3).map(n=>({id:n.id,title:n.title,content:n.content,created_at:n.created_at,verification_id:n.verification_id,delivery_verification_id:n.delivery_verification_id})),rehearsals:visibleRows(query,'job_receipts').filter(r=>r.kind==='brief-rehearsal').slice(-2).map(r=>({id:r.id,state:r.state,error:r.error,result:r.result,finished_at:r.finished_at}))};
 const health=currentHealth(query);context.health=health.observations;context.health_freshness=health;
 context.episodes=context.episodes.filter(row=>Date.parse(row.onset_at)<=Date.now());context.medications=context.medications.filter(row=>Date.parse(row.taken_at)<=Date.now());
 context.watch_findings=JSON.parse(watchCommand({store,query},['pull','--channel','brief','--dry-run']).result);
 // Selected feeds and the actual selected finding need their latest evidence,
 // not every repeat of every source collected by other workflows.
 const selectedTopics=new Set([...watch.map(t=>t.id),...context.watch_findings.map(f=>f.topic_id)]),latestSources=new Map();
 for(const source of visibleRows(query,'watch_observations').filter(o=>selectedTopics.has(o.topic_id)&&Date.parse(o.observed_at)<=Date.now()&&Date.parse(o.observed_at)>=Date.now()-48*3600000).sort((a,b)=>a.observed_at.localeCompare(b.observed_at)))latestSources.set(JSON.stringify([source.topic_id,source.url]),source);
 context.source_receipts=[...latestSources.values()];

 let contribution=visibleRows(query,'lead_entries').filter(e=>e.status==='ready'&&e.note_id&&e.content).sort((a,b)=>String(b.delivery_day).localeCompare(String(a.delivery_day))).find(e=>visibleRows(query,'notes').some(n=>n.id===e.note_id&&n.content===e.content));
 if(contribution){const refusals=ruleRefusals(contribution.content+'\n/dashboard/notes/'+encodeURIComponent(contribution.note_id),voice,{alone:true});if(refusals.length){leftOut.push({name:'the checked contribution',line:contribution.title||contribution.id,refusals});contribution=null;}}
 context.contribution=contribution?{id:contribution.id,title:contribution.title,content:contribution.content,link:'/dashboard/notes/'+encodeURIComponent(contribution.note_id),state:'draft',source_ids:contribution.evidence?.map(e=>e.source_id)||[]}:null;
 const actionSources=[],actionArtifacts=[];
 if(contribution){const source=visibleRows(query,'notes').find(n=>n.id===contribution.note_id);actionSources.push(source);actionArtifacts.push({kind:'review-checked-contribution',record_id:contribution.id,title:contribution.title,goal:context.goals.find(g=>g.id===contribution.goal_id)?.title||null,link:context.contribution.link,next_step:'Review this exact checked draft and decide whether to use it. It has not been sent or published.'});}
 for(const item of context.work.filter(w=>w.state==='awaiting_approval'&&w.draft_id)){
  const source=visibleRows(query,'notes').find(n=>n.id===item.draft_id);if(!source)continue;
  actionSources.push(source);actionArtifacts.push({kind:'review-prepared-work',record_id:item.id,title:item.title,goal:context.goals.find(g=>g.id===item.goal_id)?.title||null,link:'/dashboard/notes/'+encodeURIComponent(source.id),content:source.content,source_hash:source._hash,next_step:'Read the exact prepared change before deciding whether to allow it. Permission has not been granted.'});
 }
 context.action_artifacts=actionArtifacts;
 // Her cycle heads-up (D-321 step 4): one line, only on the day two days before the forecast window
 // and only when she switched it on; null otherwise. The brief carries it word for word.
 try{context.cycle_heads_up=cycleOperation({store,query},{action:'brief'}).line||null;}catch{context.cycle_heads_up=null;}
 if(context.cycle_heads_up){const refusals=ruleRefusals(context.cycle_heads_up,voice,{alone:true});if(refusals.length){leftOut.push({name:'the cycle heads-up line',line:context.cycle_heads_up,refusals});context.cycle_heads_up=null;}}
 // The Charm Challenge line, written by the add-on itself. A rehearsal never settles a finish into the record (--no-write).
 try{context.charm_line=String(JSON.parse(addonCommand(store,{addon:'charm',args:job.rehearsal?['brief','--no-write']:['brief']}).result).reply||'').trim()||null;}catch{context.charm_line=null;}
 if(context.charm_line){const refusals=ruleRefusals(context.charm_line,voice,{alone:true});if(refusals.length){leftOut.push({name:'the Charm Challenge line',line:context.charm_line,refusals});context.charm_line=null;}}
 for(const out of leftOut){const id='repair-brief-line-'+hash([out.name,out.line]),old=store.get('work_items',id);if(old&&old.state!=='verified')continue;store.save('work_items',{id,kind:'repair',title:'The morning briefing left out '+out.name+', because it breaks your writing rules',state:'needs_review',job_id:job.id,line_name:out.name,line:out.line,refusals:out.refusals,error:out.refusals.map(describeRefusal).join('; '),check:'The line passes the writing rules in profile/voice.md, or the rule is changed',allowed_action:'inspect-and-retry',dependencies:[],max_attempts:3});}
 context.workflow=recipeContext(store,'morning-note');
 context.workspace_sources=fileContext(store,20000);
 const sourceRefs={notes:actionSources,watch_topics:visibleRows(query,'watch_topics').filter(t=>selectedTopics.has(t.id)),watch_findings:context.watch_findings,goals:context.goals,decisions:context.decisions,work_items:context.work,deadlines:context.deadlines,health_observations:context.health,health_episodes:context.episodes,medications:context.medications,watch_observations:context.source_receipts};
 const ids=rows=>rows.map(r=>r.id).sort();
 const checkCurrentSources=()=>query.withSnapshot(()=>{
  for(const [type,selected] of Object.entries(sourceRefs)){const current=new Map(visibleRows(query,type).map(r=>[r.id,r]));if(selected.some(r=>current.get(r.id)?._hash!==r._hash))throw Error('Briefing sources changed during judgment; retain its checks and prepare a new draft');}
  if(hash(ids(context.goals))!==hash(ids(visibleRows(query,'goals').filter(g=>['active','adopted'].includes(g.status))))||hash(ids(context.deadlines))!==hash(ids(visibleRows(query,'deadlines').filter(d=>d.status!=='closed')))||hash(ids(context.health))!==hash(ids(currentHealth(query).observations))||hash(context.workspace_sources)!==hash(fileContext(store,20000))||hash(context.workflow)!==hash(recipeContext(store,'morning-note')))throw Error('Briefing sources changed during judgment; retain its checks and prepare a new draft');
 });
 const writerContract='Write only the short useful morning note from these actual sources. Use concise everyday language and the configured voice, without em dashes, headings or machinery chatter. Include one factual health sentence using only fresh recorded inputs, or honestly say fresh observations are missing. Explain the useful next action and the goal it serves in everyday words. User decisions must refer to an actual action_artifacts item with its exact link and reviewed content; an unprepared work item or a goal is not a finished proposal to approve. When contribution is present, make reviewing that checked contribution the main user action; include its complete copy-ready content unchanged and exactly its usable notebook link. Do not confuse that choice with approval for a different unprepared workflow. It is a draft awaiting the user’s choice, not a posted result. When no prepared artifact needs a decision, do not invent an approval request. Retain uncertainty. Do not repeat unchanged prior advice or claim a draft caused real-world progress. No unsupported figures, invented links, medical diagnosis or requests for self-management. When cycle_heads_up is a line, put it in word for word as one line of its own, and say nothing else about the cycle. When charm_line is a line, put it in word for word as one line of its own, and say nothing else about the Charm Challenge.';
 const codeGate=text=>{const errors=[];if(typeof text!=='string'||!text.trim())errors.push('Briefing produced no text');else{if(context.cycle_heads_up&&!text.split(/\r?\n/).some(line=>line.trim()===context.cycle_heads_up))errors.push('Include the cycle heads-up line word for word, as one line of its own');if(context.charm_line&&!text.split(/\r?\n/).some(line=>line.trim()===context.charm_line))errors.push('Include the Charm Challenge line word for word, as one line of its own');if(text.includes('\u2014'))errors.push('Use the configured plain writing style');if(context.contribution&&(!text.includes(context.contribution.content)||!text.includes(context.contribution.link)))errors.push('Include the complete checked contribution and its usable link');if(voice){const checked=checkVoice(text,voice);if(checked.configured&&!checked.passed)errors.push('Configured voice check failed: '+checked.hits.map(h=>h.value).join(', '));}if(context.previous.some(n=>n.content.trim()===text.trim()))errors.push('The same note was already saved; do not repeat it');}return errors;};
 // The Charm Challenge line is the person's own count, written by the add-on and checked word for word
 // by the gate above. Without this the plain-words check, with a real model, failed every brief while a
 // challenge ran, calling the line unexplained jargon (walk-through, 26 October 2026).
 const ownLines=context.charm_line?' The line "'+context.charm_line+'" is the person\'s own Charm Challenge count: they started it themselves, the program writes it and checks it word for word. Never fail the draft because of that line; judge the rest of the note.':'';
 const verify=async(text,check)=>{const raw=await provider({kind:'brief-verification',check,context:{sources:context,draft:text},contract:(check==='source-facts'?'Check this exact draft against its actual dated sources and previous notes. Return JSON {passed:boolean,reason:string}. Fail unsupported claims, stale health, invented outcomes, absent health sentence and unchanged advice. Do not rewrite or send.':'Independently read this as a tired person seeing none of the work. Check clear meaning, usefulness, actual reachable decision artifacts, one current health sentence, no jargon or internal codes, and no repeated unanswered advice. Return JSON {passed:boolean,reason:string}. Do not rewrite or send.')+ownLines});let verdict;try{verdict=typeof raw==='string'?JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g,'')):raw;}catch{verdict={passed:false,reason:'Briefing check returned no valid verdict'};}if(!verdict||typeof verdict!=='object')verdict={passed:false,reason:'Briefing check returned no verdict'};const receipt=await store.saveAsync('job_receipts',{kind:check==='source-facts'?'brief-verification':'brief-delivery-verification',check,job_id:job.id,state:verdict.passed===true?'verified':'failed',source_hash:hash(context),draft_hash:hash(text),verdict,finished_at:new Date().toISOString()});return {verdict,receipt};};
 let draft,check,deliveryCheck,feedback=[],cutReceipt=null,fallback=null;
 for(let attempt=0;attempt<2;attempt++){
  draft=await provider({kind:'morning-brief',phase:attempt?'one-rewrite':'write',context:{...context,...(attempt?{rejected_draft:draft,check_feedback:feedback}:{})},contract:writerContract+(attempt?' Correct the rejected note using these exact failure reasons. This is the single permitted rewrite.':'')});
  if(typeof draft!=='string'||!draft.trim())throw Error('Briefing produced no text');
  const code=codeGate(draft),facts=await verify(draft,'source-facts'),reader=await verify(draft,'plain-words-and-delivery');
  feedback=[...code,...[facts,reader].filter(r=>r.verdict.passed!==true).map(r=>r.verdict.reason||'No accepted evidence')];
  await store.saveAsync('job_receipts',{kind:'brief-code-gate',job_id:job.id,attempt,state:code.length?'failed':'verified',source_hash:hash(context),draft_hash:hash(draft),errors:code,finished_at:new Date().toISOString()});
  if(!feedback.length){check=facts.receipt;deliveryCheck=reader.receipt;break;}
  if(attempt===1){
   // A model check that still fails names no sentence, and a note repeated word for word has none to
   // cut: those stop the job as they always did. What is left is a refusal of the code checks, and
   // each of those names the sentence or line that carries it (issue #117).
   if([facts,reader].some(r=>r.verdict.passed!==true)||code.some(e=>/already saved/.test(e)))throw Error('Briefing check failed after one rewrite: '+feedback.join('; '));
   check=facts.receipt;deliveryCheck=reader.receipt;
   const required=[context.cycle_heads_up,context.charm_line].filter(Boolean),c=context.contribution;
   const protectedLines=[...required,...(c?[...c.content.split(/\r?\n/),c.link]:[])];
   const cut=cutRefused(draft,voice,protectedLines);let text=cut.text;
   const missing=[...required.filter(line=>!text.split(/\r?\n/).some(l=>l.trim()===line)),...(c&&!text.includes(c.content)?[c.content]:[]),...(c&&!text.includes(c.link)?[c.link]:[])];
   if(missing.length)text=text.trimEnd()+'\n\n'+missing.join('\n\n');
   const own=text.split(/\r?\n/).filter(l=>l.trim()&&!protectedLines.some(p=>p.trim()===l.trim())),remaining=codeGate(text);
   if(!remaining.length&&own.length){
    cutReceipt=await store.saveAsync('job_receipts',{kind:'brief-cut',job_id:job.id,state:'verified',errors:code,cut:cut.cut,restored:missing,draft_hash:hash(draft),kept_hash:hash(text),finished_at:new Date().toISOString()});
    draft=text;break;
   }
   // Nothing useful is left: the short note that says so, with the lines Godspeed owes word for word.
   const day=new Date().toISOString().slice(0,10),own_lines=[...required,...(c?[c.content,c.link]:[])];
   const refusals=[...code,...remaining.filter(e=>!code.includes(e))];
   const fallbackText=['Your full morning briefing for '+day+' could not be written today, because what was drafted broke your writing rules. A repair item has been opened for it.',...own_lines].join('\n\n');
   cutReceipt=await store.saveAsync('job_receipts',{kind:'brief-cut',job_id:job.id,state:'fallback',errors:code,cut:cut.cut,restored:missing,draft_hash:hash(draft),kept_hash:hash(fallbackText),finished_at:new Date().toISOString()});
   fallback={day,refusals,cut:cut.cut,draft_hash:hash(draft)};draft=fallbackText;break;
  }
 }
 const finalErrors=fallback?[]:codeGate(draft);if(finalErrors.length)throw Error('Final exact briefing check failed: '+finalErrors.join('; '));
 if(job.rehearsal){checkCurrentSources();return {verified:true,silent:true,rehearsal:true,source_hash:hash(context),draft_hash:hash(draft),verification_ids:[check.id,deliveryCheck.id],...(fallback?{fallback:true}:{}),...(cutReceipt&&!fallback?{cut:true}:{}),...(leftOut.length?{left_out:leftOut.map(o=>o.name)}:{})};}
 const key='brief-'+hash(draft);if(store.get('notifications',key))return {verified:true,silent:true};
 const note=store.prepare('notes',{title:'Your morning briefing',content:draft,source_app:'morning-brief',verification_id:check.id,delivery_verification_id:deliveryCheck.id,...(cutReceipt?{cut_receipt_id:cutReceipt.id}:{}),...(fallback?{fallback:true}:{}),sources:context.source_receipts.map(s=>s.id),evidence:context});
 await store.waitForWriter();
 let suppressed=false;await store.withLockAsync(()=>{if(store.get('notifications',key)){suppressed=true;return;}checkCurrentSources();const findings=context.watch_findings.filter(f=>draft.includes(f.what)&&draft.includes(f.link)).map(f=>store.get('watch_findings',f.id)).filter(f=>f?.status==='pending'),entry=context.contribution?store.get('lead_entries',context.contribution.id):null;if(entry&&(entry._hash!==contribution._hash||entry.status!=='ready'||!visibleRows(query,'notes').some(n=>n.id===entry.note_id&&n.content===entry.content)))throw Error('The contribution changed during briefing checks; preserve it and retry later');store.commit([note,...(fallback?[store.prepare('work_items',{id:'repair-brief-fallback-'+hash([job.id,fallback.day]),kind:'repair',title:'Repair the morning briefing of '+fallback.day+': only the short fallback went out',state:'needs_review',job_id:job.id,note_id:note.id,refusals:fallback.refusals,cut:fallback.cut,draft_hash:fallback.draft_hash,error:fallback.refusals.join('; '),check:'The next morning briefing is written in full',allowed_action:'inspect-and-retry',dependencies:[],max_attempts:3})]:[]),store.prepare('notifications',{id:key,record_id:note.id,verification_id:check.id,status:'ready'}),...findings.map(f=>store.prepare('watch_findings',{status:'shown',shown_at:new Date().toISOString(),channel:'brief',delivery_note_id:note.id},f)),...(entry?[store.prepare('lead_entries',{status:'queued',brief_queued_at:new Date().toISOString(),delivery_note_id:note.id},entry)]:[])]);});
 if(suppressed)return {verified:true,silent:true};
 return {verified:true,record_id:note.id,content_hash:store.get('notes',note.id)._hash,delivery:'notebook',...(fallback?{fallback:true}:{}),...(cutReceipt&&!fallback?{cut:true}:{}),...(leftOut.length?{left_out:leftOut.map(o=>o.name)}:{})};
}
