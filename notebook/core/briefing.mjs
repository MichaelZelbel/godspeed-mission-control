import {visibleRows} from './visibility.mjs';
import {hash} from './records/store.mjs';
import {procedure} from './procedures.mjs';
import {deadlineLive,remind} from './deadline-reminders.mjs';
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
import {currentHealth,healthSafeReply,unknownHealthColumns,PHONE_VIA} from './health-inputs.mjs';
import {cycleOperation} from './cycle-operations.mjs';
import {addonCommand} from './native-personal.mjs';
import {dayOf} from './trackers.mjs';
import {linkFacts,worldFacts,ownerRelationships,newestOnly,fieldList} from './world-facts.mjs';
const BRIEFING_SOURCE_SELECTORS=Object.freeze({
 notes:({actionSources,previousNotes,dayNotes})=>[...new Map([...actionSources,...previousNotes,...dayNotes].map(note=>[note.id,note])).values()],
 watch_topics:({query,selectedTopics})=>visibleRows(query,'watch_topics').filter(t=>selectedTopics.has(t.id)),
 watch_findings:({context})=>context.watch_findings,
 goals:({context})=>context.goals,
 decisions:({context})=>context.decisions,
 work_items:({context})=>context.work,
 deadlines:({context})=>context.deadlines,
 health_observations:({context})=>context.health,
 health_episodes:({context})=>context.episodes,
 medications:({context})=>context.medications,
 watch_observations:({context})=>context.source_receipts,
 job_receipts:({rehearsals})=>rehearsals,
 lead_entries:({contribution})=>contribution?[contribution]:[],
});
export const BRIEFING_SOURCE_TABLES=Object.freeze(Object.keys(BRIEFING_SOURCE_SELECTORS));
// The day a briefing note belongs to is the day it was asked for (brief_day), which a write that
// commits after local midnight must not move; notes saved before that field have only created_at.
const briefedOn=(note,zone)=>note.source_app==='morning-brief'&&(note.brief_day||(note.created_at&&dayOf(new Date(note.created_at),zone)));
const installationZone=store=>store.get('settings','installation')?.timezone||'UTC';
// The notes that may say whose a trip or appointment of today is (#386): one naming today, or a date
// range holding it, and anything written in the last three days.
const DAY_RANGE=/(\d{4}-\d{2}-\d{2})\s*(?:-|–|to|bis|until)\s*(\d{4}-\d{2}-\d{2})/gi;
const namesDay=(text,today)=>text.includes(today)||[...text.matchAll(DAY_RANGE)].some(([,from,to])=>from<=today&&today<=to);
function notesAboutDay(rows,today,nowMs){
 const recent=note=>{const made=Date.parse(note.created_at);return made<=nowMs&&made>=nowMs-3*86400000;};
 return rows.filter(note=>note.source_app!=='morning-brief'&&!note.is_trashed&&(namesDay(String(note.title||'')+'\n'+String(note.content||'').slice(0,4000),today)||recent(note)))
  .sort((a,b)=>String(b.updated_at||b.created_at||'').localeCompare(String(a.updated_at||a.created_at||''))).slice(0,20);
}

// Today's saved briefing note as the assistant may see it; hidden is true when a note for today
// exists but the person has hidden it, so that nothing is written beside it.
export function savedBriefToday(store,now=new Date()){
 const zone=installationZone(store),today=dayOf(now,zone),query=new QueryService(store);
 const mine=rows=>rows.filter(n=>briefedOn(n,zone)===today).at(-1);
 if(!mine(query.rows('notes')))return {note:null,hidden:false};
 const note=mine(visibleRows(query,'notes'));
 return note?{note,hidden:false}:{note:null,hidden:true};
}

export async function briefing(job,{store,query,provider,now=new Date()}){
 if(job.rehearsal){
  const copy=path.join(store.state,'brief-rehearsals',randomUUID());fs.mkdirSync(copy,{recursive:true,mode:0o700});
  await store.waitForWriter();await store.withLockAsync(()=>{
   fs.cpSync(store.recordsRoot,path.join(copy,path.basename(store.recordsRoot)),{recursive:true,preserveTimestamps:true});
   // A rehearsal is a copy of the workspace, so the rooms the brief reads come along as they are.
   // 'due' is among them not to read a reminder out of it - a reminder is a record now (#90) and
   // the line below takes its self check from there - but because a file in it that no program can
   // read has no record on purpose and is said as "needs a look" every day until it is fixed: the
   // rehearsal must say the same thing the real brief would.
   for(const name of ['profile','rules','due','coach','journal','world','routines/headache','routines/charm']){const source=path.join(store.root,name);if(fs.existsSync(source))fs.cpSync(source,path.join(copy,name),{recursive:true,preserveTimestamps:true});}
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
  return {...await runBriefing(job,{store:rehearsalStore,query:rehearsalQuery,provider,now}),rehearsal_workspace:copy};
 }
 return runBriefing(job,{store,query,provider,now});
}
async function runBriefing(job,{store,query,provider,now}){
 if(!provider)throw Error('Connect an assistant before writing a briefing');
 remind({},{store,query});
 const voiceFile=path.join(store.root,'profile','voice.md'),voice=fs.existsSync(voiceFile)?fs.readFileSync(voiceFile,'utf8'):null;
 // A line Godspeed requires word for word that breaks those same rules is left out and reported (issue #117).
 const leftOut=[];
 const watch=visibleRows(query,'watch_topics').filter(t=>!t.paused&&t.include_in_brief);
 if(watch.length)await procedure({id:job.id+'-sources',kind:'watch',topic_ids:watch.map(t=>t.id)},{store,query,provider});
 const rehearsals=visibleRows(query,'job_receipts').filter(r=>r.kind==='brief-rehearsal').slice(-2);
 const previousNotes=visibleRows(query,'notes').filter(n=>n.source_app==='morning-brief').slice(-3);
 const zone=installationZone(store),today=dayOf(now,zone),dayNotes=notesAboutDay(visibleRows(query,'notes'),today,now.getTime());
 const context={goals:visibleRows(query,'goals').filter(g=>['active','adopted'].includes(g.status)),decisions:visibleRows(query,'decisions').slice(-10),work:visibleRows(query,'work_items').slice(-20),deadlines:visibleRows(query,'deadlines').filter(d=>d.status!=='closed'),health:visibleRows(query,'health_observations').filter(h=>Date.parse(h.observed_at)>=Date.now()-7*86400000),episodes:visibleRows(query,'health_episodes').filter(h=>Date.parse(h.onset_at)>=Date.now()-30*86400000),medications:visibleRows(query,'medications').filter(h=>Date.parse(h.taken_at)>=Date.now()-30*86400000),source_receipts:[],previous:previousNotes.map(n=>({id:n.id,title:n.title,content:n.content,created_at:n.created_at,verification_id:n.verification_id,delivery_verification_id:n.delivery_verification_id})),rehearsals:rehearsals.map(r=>({id:r.id,state:r.state,error:r.error,result:r.result,finished_at:r.finished_at}))};
 const health=currentHealth(query,{now:now.getTime()});context.health=health.observations;context.health_freshness=health;
 const unknownColumns=unknownHealthColumns(health);
 const unknownSources=column=>health.observations.filter(row=>row.via===PHONE_VIA&&row.observed_on===column.date&&(row.metric===column.column||column.data_until&&row.data_until===column.data_until)).map(row=>String(row.id));
 const summaryLine=column=>'On '+column.date+', '+column.column+' was '+column.value+' so far'+(column.data_until?'; phone data stopped at '+column.data_until:'')+'.';
 const weekLine=columns=>{const days=new Set(columns.map(column=>column.date)).size;return days?'This week has '+days+' unknown phone-health '+(days===1?'day.':'days.'):'';};
 const unknownSummaries=unknownColumns.map(column=>({date:column.date,line:summaryLine(column),source_ids:unknownSources(column)}));
 const healthSummaryLines=unknownSummaries.map(summary=>summary.line),unknownWeekLine=weekLine(unknownSummaries);
 context.episodes=context.episodes.filter(row=>Date.parse(row.onset_at)<=Date.now());context.medications=context.medications.filter(row=>Date.parse(row.taken_at)<=Date.now());
 context.watch_findings=JSON.parse(watchCommand({store,query},['pull','--channel','brief','--dry-run']).result);
 // Selected feeds and the actual selected finding need their latest evidence,
 // not every repeat of every source collected by other workflows.
 const selectedTopics=new Set([...watch.map(t=>t.id),...context.watch_findings.map(f=>f.topic_id)]),latestSources=new Map();
 for(const source of visibleRows(query,'watch_observations').filter(o=>selectedTopics.has(o.topic_id)&&Date.parse(o.observed_at)<=Date.now()&&Date.parse(o.observed_at)>=Date.now()-48*3600000).sort((a,b)=>a.observed_at.localeCompare(b.observed_at)))latestSources.set(JSON.stringify([source.topic_id,source.url]),source);
 context.source_receipts=[...latestSources.values()];

 let contribution=visibleRows(query,'lead_entries').filter(e=>e.status==='ready'&&e.note_id&&e.content).sort((a,b)=>String(b.delivery_day).localeCompare(String(a.delivery_day))).find(e=>visibleRows(query,'notes').some(n=>n.id===e.note_id&&n.content===e.content));
 if(contribution){const refusals=ruleRefusals(contribution.content+'\n/dashboard/notes/'+encodeURIComponent(contribution.note_id),voice);if(refusals.length){leftOut.push({name:'the checked contribution',line:contribution.title||contribution.id,refusals});contribution=null;}}
 context.contribution=contribution?{id:contribution.id,note_id:contribution.note_id,title:contribution.title,content:contribution.content,link:'/dashboard/notes/'+encodeURIComponent(contribution.note_id),state:'draft',source_ids:contribution.evidence?.map(e=>e.source_id)||[]}:null;
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
 if(context.cycle_heads_up){const refusals=ruleRefusals(context.cycle_heads_up,voice);if(refusals.length){leftOut.push({name:'the cycle heads-up line',line:context.cycle_heads_up,refusals});context.cycle_heads_up=null;}}
 // The Charm Challenge line, written by the add-on itself. A rehearsal never settles a finish into the record (--no-write).
 try{context.charm_line=String(JSON.parse(addonCommand(store,{addon:'charm',args:job.rehearsal?['brief','--no-write']:['brief']}).result).reply||'').trim()||null;}catch{context.charm_line=null;}
 if(context.charm_line){const refusals=ruleRefusals(context.charm_line,voice);if(refusals.length){leftOut.push({name:'the Charm Challenge line',line:context.charm_line,refusals});context.charm_line=null;}}
 for(const out of leftOut){const id='repair-brief-line-'+hash([out.name,out.line]),old=store.get('work_items',id);if(old&&old.state!=='verified')continue;store.save('work_items',{id,kind:'repair',title:'The morning briefing left out '+out.name+', because it breaks your writing rules',state:'needs_review',job_id:job.id,line_name:out.name,line:out.line,refusals:out.refusals,error:out.refusals.map(describeRefusal).join('; '),check:'The line passes the writing rules in profile/voice.md, or the rule is changed',allowed_action:'inspect-and-retry',dependencies:[],max_attempts:3});}
 context.workflow=recipeContext(store,'morning-note');
 context.workspace_sources=fileContext(store,20000);
 context.day_notes=dayNotes.map(n=>({id:n.id,title:n.title,content:String(n.content||'').slice(0,2000),created_at:n.created_at,updated_at:n.updated_at}));
 // Who is around the owner, and what is dated to hold today about them, so that an event in the
 // owner's calendar is not read as the owner's own trip when a note or fact names someone else (#386).
 // Failing to read it costs this part, not the morning.
 const peopleAround=()=>{try{return query.withSnapshot(()=>{
  const own=visibleRows(query,'profile_facts').filter(r=>!r.removed_at&&!r.deleted_at),facts=newestOnly([...own,...linkFacts(query),...worldFacts(query,own)],fieldList(store.root),today);
  const names=new Map(visibleRows(query,'contacts').map(c=>[c.id,c.name])),holds=f=>(!f.valid_from||f.valid_from<=today)&&(!f.valid_to||f.valid_to>today);
  return {relationships:ownerRelationships(query,facts,today).current,facts:facts.filter(f=>(f.valid_from||f.valid_to)&&holds(f)).slice(0,40).map(f=>({id:String(f.id),subject:f.subject_type==='self'?'you':f.subject_name||names.get(f.subject_id||f.contact_id)||null,attribute:f.attribute,value:f.value,valid_from:f.valid_from||null,valid_to:f.valid_to||null,evidence:f.evidence_quote||null}))};
 });}catch{return {relationships:[],facts:[],unavailable:true};}};
 context.people=peopleAround();
 const sourceRefs=Object.fromEntries(Object.entries(BRIEFING_SOURCE_SELECTORS).map(([table,select])=>[table,select({actionSources,previousNotes,dayNotes,context,contribution,query,rehearsals,selectedTopics})]));
 const ids=rows=>rows.map(r=>r.id).sort();
 const checkCurrentSources=()=>query.withSnapshot(()=>{
  for(const [type,selected] of Object.entries(sourceRefs)){const current=new Map(visibleRows(query,type).map(r=>[r.id,r]));if(selected.some(r=>current.get(r.id)?._hash!==r._hash))throw Error('Briefing sources changed during judgment; retain its checks and prepare a new draft');}
  if(hash(ids(context.goals))!==hash(ids(visibleRows(query,'goals').filter(g=>['active','adopted'].includes(g.status))))||hash(ids(context.deadlines))!==hash(ids(visibleRows(query,'deadlines').filter(d=>d.status!=='closed')))||hash(context.health_freshness)!==hash(currentHealth(query,{now:now.getTime()}))||hash(context.workspace_sources)!==hash(fileContext(store,20000))||hash(context.workflow)!==hash(recipeContext(store,'morning-note'))||hash(context.people)!==hash(peopleAround()))throw Error('Briefing sources changed during judgment; retain its checks and prepare a new draft');
 });
 const writerContract='Write only the short useful morning note from these actual sources. Use concise everyday language and the configured voice, without em dashes, headings or machinery chatter. health_freshness.days is authoritative for daily health totals. A column whose state is settled (a manual value or the Food tracker totals) is known and may be used. Include one factual health sentence using only fresh recorded inputs, or honestly say fresh observations are missing. Explain the useful next action and the goal it serves in everyday words. User decisions must refer to an actual action_artifacts item with its exact link and reviewed content; an unprepared work item or a goal is not a finished proposal to approve. When contribution is present, make reviewing that checked contribution the main user action; include its complete copy-ready content unchanged and exactly its usable notebook link. Do not confuse that choice with approval for a different unprepared workflow. It is a draft awaiting the user’s choice, not a posted result. When no prepared artifact needs a decision, do not invent an approval request. Retain uncertainty. Do not repeat unchanged prior advice or claim a draft caused real-world progress. No unsupported figures, invented links, medical diagnosis or requests for self-management. When cycle_heads_up is a line, put it in word for word as one line of its own, and say nothing else about the cycle. When charm_line is a line, put it in word for word as one line of its own, and say nothing else about the Charm Challenge. An event in the owner’s calendar, a booking or a trip is not proof that the owner is the one who goes: the calendar’s organizer is the calendar’s owner. Before any sentence about the owner’s own day (travel, an appointment, an absence), compare it with day_notes and people. When the event, a note or a fact names someone else, say whose it is. When it is unclear, leave it out. When the owner’s own event overlaps a trip attributed to them, treat that as doubt about the trip, never as a reason to propose moving the event.';
 // The same words may open a later day's briefing; within one day they are a repeat (#195).
 const savedToday=visibleRows(query,'notes').filter(n=>briefedOn(n,zone)===today);
 const codeGate=text=>{const errors=[];if(typeof text!=='string'||!text.trim())errors.push('Briefing produced no text');else{if(context.cycle_heads_up&&!text.split(/\r?\n/).some(line=>line.trim()===context.cycle_heads_up))errors.push('Include the cycle heads-up line word for word, as one line of its own');if(context.charm_line&&!text.split(/\r?\n/).some(line=>line.trim()===context.charm_line))errors.push('Include the Charm Challenge line word for word, as one line of its own');if(text.includes('\u2014'))errors.push('Use the configured plain writing style');if(context.contribution&&(!text.includes(context.contribution.content)||!text.includes(context.contribution.link)))errors.push('Include the complete checked contribution and its usable link');if(voice){const checked=checkVoice(text,voice);if(checked.configured&&!checked.passed)errors.push('Configured voice check failed: '+checked.hits.map(h=>h.value).join(', '));}if(savedToday.some(n=>n.content.trim()===text.trim()))errors.push('The same note was already saved today; do not repeat it');}return errors;};
 const factualFallback=rejectedIds=>{
  const parts=[],excluded=row=>row?.id!=null&&rejectedIds.has(String(row.id));
  const add=line=>{if(!line)return false;const candidate=[...parts,line].join('\n\n');if(codeGate(candidate).some(error=>!error.startsWith('Include ')))return false;parts.push(line);return true;};
  const addFirst=(rows,line)=>rows.some(row=>add(line(row)));
  const text=(value,max=500)=>typeof value==='string'&&value.trim()&&value.length<=max&&!/[\r\n\u0000-\u001f]/.test(value)?value.trim():null;
  const contribution=context.contribution;
  if(contribution&&([contribution.id,contribution.note_id,...contribution.source_ids].some(id=>id!=null&&rejectedIds.has(String(id)))))context.contribution=null;
  const required=[context.cycle_heads_up,context.charm_line].filter(Boolean);
  const goal=context.goals.find(row=>!excluded(row)&&text(row.title)),anyGoal=context.goals.some(row=>!excluded(row));
  addFirst(context.goals,row=>!excluded(row)&&text(row.title)?'One of your saved goals is '+text(row.title)+'.':null);
  const verified=context.work.filter(row=>row.state==='verified'&&row.kind!=='repair'&&!excluded(row)).sort((a,b)=>String(b.verification?.at||b.updated_at||'').localeCompare(String(a.verification?.at||a.updated_at||'')));
  // Work the daily round filed in the work register reaches the notebook as a legacy row with its
  // fields as written, WHAT for its title (9 November 2026: a first day's verified playbook went
  // unnamed, so the fallback said nothing of the work that was done).
  const workTitle=row=>text(row.title)||text(row.legacy_fields?.WHAT);
  const done=verified.find(workTitle);
  addFirst(verified,row=>{const title=workTitle(row);return title?'Godspeed has verified this work: '+title+(/[.?!]$/.test(title)?'':'.'):null;});
  const due=context.deadlines.filter(row=>!excluded(row)&&deadlineLive(row,now.getTime())&&row.due_at&&Number.isFinite(Date.parse(row.due_at))&&Date.parse(row.due_at)>=now.getTime()).sort((a,b)=>Date.parse(a.due_at)-Date.parse(b.due_at));
  addFirst(due,row=>{const on=row.native_file?String(row.due_at).slice(0,10):dayOf(new Date(row.due_at),row.timezone||zone);return text(row.title)?'A dated obligation is '+text(row.title)+', due '+on+'.':null;});
  const keptSummaries=unknownSummaries.filter(summary=>!summary.source_ids.some(id=>rejectedIds.has(id)));
  const unknownAdded=[...keptSummaries.map(summary=>summary.line),weekLine(keptSummaries)].filter(Boolean).filter(line=>add(line)).length>0;
  const observedAt=row=>row.date_precision==='day'&&row.observed_on?String(row.observed_on)+'T00:00:00Z':row.observed_at||row.created_at||'';
  const settled=row=>row.via!==PHONE_VIA||context.health_freshness?.days?.find(day=>day.date===row.observed_on)?.columns?.[row.metric]?.state==='complete';
  const healthAdded=addFirst(context.health.filter(row=>!excluded(row)&&settled(row)).sort((a,b)=>String(observedAt(b)).localeCompare(String(observedAt(a)))),row=>{const metric=text(row.metric,60),value=row.value;return metric&&(typeof value==='number'||typeof value==='string'&&text(value,30))?'A recorded health observation is '+metric+': '+value+'.':null;})||unknownAdded;
  if(!healthAdded&&!context.health.some(row=>!excluded(row)))add('There are no fresh health observations to report.');
  const action=context.contribution
   ?add('Review this checked draft before deciding. It has not been sent.')||add('Review this unsent draft.')
   :done&&add('Next: review the work Godspeed verified and say what it should do with it.')||add(goal?'Ask Godspeed to work on '+text(goal.title)+' and show you one concrete result today.':anyGoal?'Ask Godspeed to complete one goal step.':'Tell Godspeed one goal to work on today, then ask it for the first concrete step.')||add(anyGoal?'Ask Godspeed to complete one goal step.':'Tell Godspeed one goal.')||add(anyGoal?'Work on one goal step today.':'Name one goal today.')||add(anyGoal?'Do one goal step.':'Name one goal.');
  for(const line of required)add(line);
  if(context.contribution){add(context.contribution.content);add(context.contribution.link);}
  const result=parts.join('\n\n');
  if(!action||codeGate(result).length||ruleRefusals(result,voice).length)throw Error('Could not make a checked factual fallback from the available sources');
  return result;
 };
 // The Charm Challenge line is the person's own count, written by the add-on and checked word for word
 // by the gate above. Without this the plain-words check, with a real model, failed every brief while a
 // challenge ran, calling the line unexplained jargon (walk-through, 26 October 2026).
 const ownLines=context.charm_line?' The line "'+context.charm_line+'" is the person\'s own Charm Challenge count: they started it themselves, the program writes it and checks it word for word. Never fail the draft because of that line; judge the rest of the note.':'';
 const verify=async(text,check)=>{const freshness=' health_freshness.days is authoritative. Code rendered every unknown phone column as “so far” with its stopped time. A settled manual or Food-tracker column is known and may be used.';const raw=await provider({kind:'brief-verification',check,context:{sources:context,draft:text},contract:(check==='source-facts'?'Check this exact draft against its actual dated sources and previous notes. Return JSON {passed:boolean,reason:string,rejection_scope:"source-claims"|"non-source",rejected_source_ids:string[]}. If source claims are rejected, set rejection_scope to "source-claims" and list every exact source record id. If the failure is about missing content, clarity, usefulness, or another non-source condition, set rejection_scope to "non-source" and rejected_source_ids to []. Fail unsupported claims, stale health, invented outcomes, absent health sentence and unchanged advice. Read the underlying records, not only a collected summary. Fail a sentence that says the owner (you) travels, attends or is away when the event’s own description, a day_notes note or a people fact names someone else, even when a collected summary says "with" the owner. List those record ids. Do not rewrite or send.':'Independently read this as a tired person seeing none of the work. Check clear meaning, usefulness, actual reachable decision artifacts, one current health sentence, no jargon or internal codes, and no repeated unanswered advice. Return JSON {passed:boolean,reason:string,rejection_scope:"source-claims"|"non-source",rejected_source_ids:string[]}. Use "source-claims" and exact source ids only when rejecting claims from saved records; use "non-source" and [] for every other failure. Do not rewrite or send.')+freshness+ownLines});let verdict;try{verdict=typeof raw==='string'?JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g,'')):raw;}catch{verdict={passed:false,reason:'Briefing check returned no valid verdict'};}if(!verdict||typeof verdict!=='object')verdict={passed:false,reason:'Briefing check returned no verdict'};const receipt=await store.saveAsync('job_receipts',{kind:check==='source-facts'?'brief-verification':'brief-delivery-verification',check,job_id:job.id,state:verdict.passed===true?'verified':'failed',source_hash:hash(context),draft_hash:hash(text),verdict,finished_at:new Date().toISOString()});return {verdict,receipt};};
 let draft,modelDraft,check,deliveryCheck,feedback=[],cutReceipt=null,fallback=null;const allReasons=[],rejectedIds=new Set(),invalidReviews=[];
 const knownIds=new Set([...Object.values(sourceRefs).flat(),...context.action_artifacts.map(artifact=>({id:artifact.record_id})),...context.people.facts.map(f=>({id:f.id})),...(context.contribution?[{id:context.contribution.id},{id:context.contribution.note_id},...context.contribution.source_ids.map(id=>({id}))]:[])].filter(row=>row?.id!=null).map(row=>String(row.id)));
 for(let attempt=0;attempt<2;attempt++){
  const raw=await provider({kind:'morning-brief',phase:attempt?'one-rewrite':'write',context:{...context,...(attempt?{rejected_draft:modelDraft,check_feedback:feedback}:{})},contract:writerContract+(attempt?' Correct the rejected note using these exact failure reasons. This is the single permitted rewrite.':'')});
  let healthError=null;
  try{modelDraft=healthSafeReply(raw,'text',health);}catch(error){healthError=error.message;modelDraft='';}
  draft=[...healthSummaryLines,unknownWeekLine,modelDraft].filter(Boolean).join('\n\n');
  const code=[...(healthError?[healthError]:[]),...codeGate(draft)],facts=await verify(draft,'source-facts'),reader=await verify(draft,'plain-words-and-delivery');
  feedback=[...code,...[facts,reader].filter(r=>r.verdict.passed!==true).map(r=>r.verdict.reason||'No accepted evidence')];
  allReasons.push(...feedback);
  for(const review of [facts,reader]){
   if(review.verdict.passed===true)continue;
   const {rejection_scope:scope,rejected_source_ids:ids=[]}=review.verdict;
   if(!['source-claims','non-source'].includes(scope)||!Array.isArray(ids)||(scope==='source-claims'&&!ids.length)||(scope==='non-source'&&ids.length)){invalidReviews.push({check:review.receipt.check,reason:review.verdict.reason||'No accepted evidence'});continue;}
   for(const id of ids){if(knownIds.has(String(id)))rejectedIds.add(String(id));else invalidReviews.push({check:review.receipt.check,reason:'Unknown source id '+String(id)});}
  }
  await store.saveAsync('job_receipts',{kind:'brief-code-gate',job_id:job.id,attempt,state:code.length?'failed':'verified',source_hash:hash(context),draft_hash:hash(draft),errors:code,finished_at:new Date().toISOString()});
  if(!feedback.length){check=facts.receipt;deliveryCheck=reader.receipt;break;}
  if(attempt===1){
   if(code.some(e=>/already saved today/.test(e)))throw Error('The same note was already saved today');
   if([facts,reader].some(r=>r.verdict.passed!==true)){
    const rejected=draft,reasons=[...feedback];
    try{
     if(invalidReviews.length)throw Error('Could not make a checked factual fallback: '+[...new Map(invalidReviews.map(review=>[review.check,review.reason])).entries()].map(([check,reason])=>check+': '+reason).join('; '));
     draft=factualFallback(rejectedIds);
    }catch(error){
     await store.saveAsync('job_receipts',{kind:'brief-factual-fallback',job_id:job.id,state:'failed',source_hash:hash(context),rejected_draft:rejected,rejected_hash:hash(rejected),reasons,all_reasons:allReasons,fallback_error:error.message,finished_at:new Date().toISOString()});
     throw error;
    }
    const receipt=await store.saveAsync('job_receipts',{kind:'brief-factual-fallback',job_id:job.id,state:'verified',source_hash:hash(context),draft_hash:hash(draft),rejected_draft:rejected,rejected_hash:hash(rejected),reasons,all_reasons:allReasons,rejected_source_ids:[...rejectedIds],checks:['visible sources','voice','required lines','duplicate','length'],finished_at:new Date().toISOString()});
    check=receipt;deliveryCheck=receipt;fallback={day:today,refusals:reasons,cut:[],draft_hash:hash(rejected),checked:true};cutReceipt=receipt;break;
   }
   check=facts.receipt;deliveryCheck=reader.receipt;
   const required=[...healthSummaryLines,unknownWeekLine,context.cycle_heads_up,context.charm_line].filter(Boolean),c=context.contribution;
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
   const fallbackErrors=codeGate(fallbackText);
   if(fallbackErrors.length){
    await store.saveAsync('job_receipts',{kind:'brief-cut',job_id:job.id,state:'failed',errors:code,cut:cut.cut,restored:missing,draft_hash:hash(draft),fallback_errors:fallbackErrors,finished_at:new Date().toISOString()});
    const repairId='repair-brief-fallback-'+hash([job.id,day]);
    if(!store.get('work_items',repairId))await store.saveAsync('work_items',{id:repairId,kind:'repair',title:'Repair the morning briefing of '+day+': nothing went out, because even the short fallback breaks your writing rules',state:'needs_review',job_id:job.id,refusals:[...refusals,...fallbackErrors],cut:cut.cut,draft_hash:hash(draft),error:[...refusals,...fallbackErrors].join('; '),check:'The next morning briefing is written in full',allowed_action:'inspect-and-retry',dependencies:[],max_attempts:3});
    throw Error('Final exact briefing check failed: '+fallbackErrors.join('; '));
   }
   cutReceipt=await store.saveAsync('job_receipts',{kind:'brief-cut',job_id:job.id,state:'fallback',errors:code,cut:cut.cut,restored:missing,draft_hash:hash(draft),kept_hash:hash(fallbackText),finished_at:new Date().toISOString()});
   fallback={day,refusals,cut:cut.cut,draft_hash:hash(draft)};draft=fallbackText;break;
  }
 }
 const finalErrors=codeGate(draft);if(finalErrors.length)throw Error('Final exact briefing check failed: '+finalErrors.join('; '));
 if(job.rehearsal){checkCurrentSources();return {verified:true,silent:true,rehearsal:true,source_hash:hash(context),draft_hash:hash(draft),verification_ids:[check.id,deliveryCheck.id],...(fallback?{fallback:true}:{}),...(cutReceipt&&!fallback?{cut:true}:{}),...(leftOut.length?{left_out:leftOut.map(o=>o.name)}:{})};}
 const key='brief-'+hash([today,draft]);if(store.get('notifications',key))return {verified:true,silent:true};
 const note=store.prepare('notes',{title:'Your morning briefing',content:draft,source_app:'morning-brief',brief_day:today,verification_id:check.id,delivery_verification_id:deliveryCheck.id,...(cutReceipt?{cut_receipt_id:cutReceipt.id}:{}),...(fallback?{fallback:true}:{}),sources:context.source_receipts.map(s=>s.id),evidence:context});
 await store.waitForWriter();
 let suppressed=false;await store.withLockAsync(()=>{if(store.get('notifications',key)){suppressed=true;return;}checkCurrentSources();const findings=context.watch_findings.filter(f=>draft.includes(f.what)&&draft.includes(f.link)).map(f=>store.get('watch_findings',f.id)).filter(f=>f?.status==='pending'),entry=context.contribution?store.get('lead_entries',context.contribution.id):null;if(entry&&(entry._hash!==contribution._hash||entry.status!=='ready'||!visibleRows(query,'notes').some(n=>n.id===entry.note_id&&n.content===entry.content)))throw Error('The contribution changed during briefing checks; preserve it and retry later');store.commit([note,...(fallback?[store.prepare('work_items',{id:'repair-brief-fallback-'+hash([job.id,fallback.day]),kind:'repair',title:'Repair the morning briefing of '+fallback.day+': only the short fallback went out',state:'needs_review',job_id:job.id,note_id:note.id,refusals:fallback.refusals,cut:fallback.cut,draft_hash:fallback.draft_hash,error:fallback.refusals.join('; '),check:'The next morning briefing is written in full',allowed_action:'inspect-and-retry',dependencies:[],max_attempts:3})]:[]),store.prepare('notifications',{id:key,record_id:note.id,verification_id:check.id,status:'ready'}),...findings.map(f=>store.prepare('watch_findings',{status:'shown',shown_at:new Date().toISOString(),channel:'brief',delivery_note_id:note.id},f)),...(entry?[store.prepare('lead_entries',{status:'queued',brief_queued_at:new Date().toISOString(),delivery_note_id:note.id},entry)]:[])]);});
 if(suppressed)return {verified:true,silent:true};
 return {verified:true,record_id:note.id,content_hash:store.get('notes',note.id)._hash,delivery:'notebook',...(fallback?{fallback:true}:{}),...(cutReceipt&&!fallback?{cut:true}:{}),...(leftOut.length?{left_out:leftOut.map(o=>o.name)}:{})};
}
