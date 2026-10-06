import fs from 'node:fs';import path from 'node:path';
import {hash,atomic,safe,encode} from './records/store.mjs';
import {Scheduler} from './jobs/scheduler.mjs';
import {nativeOperation,addonCommand,ensureNativeSchedules} from './native-personal.mjs';
import {cardCommand,importCardFiles} from './card-commands.mjs';
import {dueCommand,dueRows} from './native-due.mjs';
import {subscriptionCommand} from './subscriptions.mjs';
import {watchCommand,addWatchTopic} from './watch-commands.mjs';
import {leadCommand} from './lead-commands.mjs';
import {radarCommand} from './radar-lifecycle.mjs';
import {localParts,addDays,zonedToUtc} from '../../third-party/addons/godspeed-coach/lib/clock.mjs';
import {nextCalendarRun} from './jobs/calendar.mjs';
import {readTable} from '../../third-party/addons/godspeed-coach/lib/auto.mjs';
import {localPath} from './local-path.mjs';
import {visibleRows} from './visibility.mjs';
export const operationContract=`Return JSON {reply,notes_created?:[{title,content}],operations?:[{type,source_quote,...fields}]}. Use an operation only when the user's current message explicitly requests that change. source_quote must be exact user words requesting it, never a note quote. Supported operations:
goal-add {title,measure,status?:adopted|provisional,wait_for_report?:boolean}; goal-change {id,title?,measure?,status?:adopted|provisional|paused|achieved|retired,wait_for_report?:boolean,reason}; goal-outcome {id,evidence,value?,outcome};
When the user explicitly asks to wait for their separate report after an applied change, persist wait_for_report:true in that goal. Do not enable it without that request.
obligation-add {title,due_at,target_at?,recurrence?:{days}}; obligation-complete {id,evidence}; obligation-snooze {id,until};
coach-open {area:health|work-money|relationships,question}; coach-reply {id,content}; coach-close {id}; habit-agree {talk_id,title,agreement,check_at}; habit-observe {id,observation,answer:done|no|skip};
journal-add {content}; journal-switch {enabled}; health-add {metric,value,unit,observed_at};
memory-confirm {label,value,evidence_quote,subject_type:self|contact|entity,subject_id?:actual supplied ID,replaces_claim_id?:actual supplied current claim ID}; memory-propose {label,value,evidence_quote,subject_type:self|contact|entity,subject_id?:actual supplied ID};
Memory must identify whose fact it is. Use self only for the user's own fact, contact for a supplied person, and entity for a supplied thing. Never save another person's fact as self. Ask when the person or thing is ambiguous or missing; never invent an ID.
When correcting an existing remembered fact, memory-confirm MUST include replaces_claim_id from the supplied current claims. Preserve its actual attribute even if the user calls it something different. A new label does not correct an existing fact. Ask which fact when it is ambiguous; do not claim a correction without identifying the old claim.
routine-change {id,paused?,calendar?:{time:HH:MM,weekdays?:[0..6]}}; forecast-settle {id,observed,evidence}.
work-allow-local {id,note_id}: allow the selected work to edit exactly this local note, preserving its current revision as the precondition.
work-retry-draft {id}: explicitly retry a failed or interrupted local draft, preserving all prior attempts and versions. Never retry an applied or outward action.
work-record-observation {id,evidence,passed:boolean,value?:number}: record the user's actual reported check for the exact selected observation task. Failed checks are evidence, not successful outcomes. Never invent a value or infer completion from a draft.
Every operation MUST contain source_quote. Copy the entire current user message exactly into that field, including the request verb. Without it, no operation can run. Use supplied IDs; ask to resolve ambiguity. ISO dates must include timezone. No outward actions or credentials. Never claim a change persisted until the operation succeeds.`;
const required=(value,label)=>{if(typeof value!=='string'||!value.trim())throw Error(label+' is required');return value.trim();};
const date=(value,label)=>{required(value,label);if(!Number.isFinite(Date.parse(value))||!/(Z|[+-]\d\d:\d\d)$/.test(value))throw Error(label+' needs an ISO date with timezone');return new Date(value).toISOString();};
function memorySubject(domains,input){
 const type=input.subject_type||(input.contact_id?'contact':input.entity_id?'entity':'self');
 if(!['self','contact','entity'].includes(type))throw Error('Choose whose fact this is: yourself, a person or a thing');
 const ids=[input.subject_id,input.contact_id,input.entity_id].filter(Boolean);
 if(new Set(ids).size>1||input.contact_id&&type!=='contact'||input.entity_id&&type!=='entity'||type==='self'&&ids.length)throw Error('The memory subject is inconsistent');
 if(type==='self')return {subject_type:'self',subject_id:null};
 const id=required(ids[0],'Memory subject ID'),row=visibleRows(domains.query,type==='contact'?'contacts':'entities').find(r=>r.id===id&&!r.removed_at&&!r.is_trashed&&!r.merged_into);
 if(!row)throw Error('Choose an existing visible person or thing before saving their fact');
 return {subject_type:type,subject_id:id,...(type==='contact'?{contact_id:id}:{entity_id:id})};
}
function memoryCorrection(domains,input,subject){
 if(!input.replaces_claim_id)return {};
 const fact=visibleRows(domains.query,'profile_facts').find(r=>r.claim_id===input.replaces_claim_id&&r.is_current&&r.show_to_agent);
 if(!fact||fact.subject_type!==subject.subject_type||(fact.subject_id||null)!==(subject.subject_id||null))throw Error('Choose an existing visible current claim belonging to this same memory subject');
 const claim=domains.store.get('claims',fact.claim_id);
 return {attribute:fact.attribute,label:fact.label||input.label,replaces_claim_id:claim.id,replaces_claim_hash:claim._hash};
}
// The coaching, habit and journal operations write the add-ons' own files,
// outside the record store, so no record transaction can take them back.
const NATIVE=['coach-open','coach-reply','coach-close','habit-agree','habit-observe','journal-add','journal-switch'];
function nativeArguments(input){
 const type=input.type;
 if(type==='coach-open'){if(!['health','work-money','relationships'].includes(input.area))throw Error('Choose a supported coaching area');required(input.question,'Coaching question');}
 if(type==='coach-reply')required(input.content,'Reply');
 if(type==='habit-agree'){required(input.title,'Habit');required(input.agreement,'Explicit agreement');date(input.check_at,'Next check-in');}
 if(type==='habit-observe'){required(input.observation,'Observation');if(!['done','no','skip'].includes(input.answer))throw Error('Habit observation needs an explicit done, no or skip answer');}
 if(type==='journal-add')required(input.content,'Journal entry');
 if(type==='journal-switch'&&typeof input.enabled!=='boolean')throw Error('Choose enabled or disabled');
 // The due files' own obligations (native-due.mjs), checked here before any change is made.
 if(type==='obligation-complete')required(input.evidence,'Completion evidence');
 if(type==='obligation-snooze')date(input.until,'New target');
}
const outsideRecords=(domains,op)=>NATIVE.includes(op.type)||op.type==='routine-change'&&!!domains.nativeScheduler||process.env.GODSPEED_ORIGINAL_RUNTIME==='on'&&['goal-add','goal-change','goal-outcome','forecast-settle'].includes(op.type)||['obligation-complete','obligation-snooze'].includes(op.type)&&dueRows(domains.store).some(d=>d.id===op.id);
// The same domains, reading and writing a staged view of the store.
const staged=(domains,store)=>{const query=new domains.query.constructor(store);query.nativeHermesHome=domains.query.nativeHermesHome;return Object.assign(Object.create(Object.getPrototypeOf(domains)),domains,{store,query});};
// A copy of the records to try a change on, without the workspace lock and
// never written: what Store.transaction stages, kept here.
function rehearsal(store){
 const records=new Map(store.scan()),view=Object.create(store);
 return Object.assign(view,{records,scan:()=>records,withLock:fn=>fn(),snapshot:fn=>fn(),
  get:(type,id)=>records.get(type+'/'+id)||[...records.values()].find(r=>r.type===type&&((r.former_ids||[]).includes(id)||(r.aliases||[]).includes(id)))||null,
  list:(type,{removed=false}={})=>[...records.values()].filter(r=>r.type===type&&(removed||!r.removed_at)),
  commit:rows=>{for(const raw of rows){const record={...raw};delete record._hash;records.set(record.type+'/'+record.id,{...record,_hash:hash(encode(record))});}}});
}
export function personalOperation(domains,input){
 const {store,query}=domains,type=input.type;
 if(type==='routine-change'&&domains.nativeScheduler)return domains.nativeScheduler.control(input);
 if(process.env.GODSPEED_ORIGINAL_RUNTIME==='on'&&['goal-add','goal-change','goal-outcome','forecast-settle'].includes(type)){
  let card='goals',args;
  if(type==='goal-add')args=['file','--kind','outcome','--status',input.status||'adopted','--title',required(input.title,'Goal'),'--measure',input.measure||'','--source','Notebook request, '+new Date().toISOString()];
  else {const table=type==='forecast-settle'?'forecasts':'goals',item=query.rows(table).find(r=>r.id===input.id);if(!item)throw Error('Choose an existing '+table+' item');
   if(type==='goal-change'){const fields={title:'TITLE',measure:'MEASURE',status:'STATUS'};args=['change',item.id,'--set',Object.entries(fields).filter(([k])=>input[k]!==undefined).map(([k,f])=>f+'='+required(input[k],f)).join(';'),'--why',required(input.reason,'Reason')];}
   else if(type==='goal-outcome')args=['progress',item.id,'--evidence',required(input.evidence,'Evidence')];
   else {card='forecast';args=['resolve',item.id,'--outcome',input.observed?'yes':'no','--evidence',required(input.evidence,'Evidence')];}
  }
  const result=cardCommand(store,{card,args});return type==='goal-add'?query.rows('goals').find(r=>r.title===input.title):query.rows(card==='goals'?'goals':'forecasts').find(r=>r.id===input.id)||result;
 }
 if(type==='addon-command'){const result=addonCommand(store,input);if(input.addon!=='headache')ensureNativeSchedules(store,input.addon);return result;}
 if(type==='card-command')return cardCommand(store,input);
 if(type==='due-command')return dueCommand(store,input.args);
 if(type==='subscription-command')return subscriptionCommand(store,input.args);
 if(type==='watch-command')return watchCommand(domains,input.args);
 if(type==='lead-command')return leadCommand(domains,input.args);
 if(type==='radar-command')return radarCommand(domains,input.args);
 if(['obligation-complete','obligation-snooze'].includes(type)){
  const native=dueRows(store).find(d=>d.id===input.id);if(native){if(input.expected&&input.expected!==native._hash)throw Error('Obligation changed; reload before saving');
   if(type==='obligation-complete'){required(input.evidence,'Completion evidence');return dueCommand(store,['done',native.native_slug,'--evidence',input.evidence]);}
   return dueCommand(store,['target',native.native_slug,date(input.until,'New target').slice(0,10)]);
  }
 }
 if(type==='import-card-files')return importCardFiles(store,input.card);
 if(type==='health-import-csv'){
  required(input.content,'CSV health data');const content=input.content;if(content.length>1000000)throw Error('Health CSV exceeds one megabyte');const file=path.join(store.root,'observations/health-inputs',hash(content)+'.csv');atomic(file,content);const table=readTable(file),rows=[];
  const timezone=store.get('settings','installation')?.timezone||'UTC',today=localParts(new Date(),timezone).date;let measurements=0;
  for(const [day,values] of Object.entries(table)){
   const parsed=Date.parse(day+'T00:00:00Z');if(!Number.isFinite(parsed)||new Date(parsed).toISOString().slice(0,10)!==day||day>today)throw Error('Health CSV needs actual current or earlier calendar dates');
   for(const [metric,raw] of Object.entries(values)){if(metric==='date'||!raw||!Number.isFinite(Number(raw)))continue;if(!/^[a-zA-Z][a-zA-Z0-9_ -]{0,79}$/.test(metric))throw Error('Health column needs a clear measurement name');measurements++;const id='health-feed-'+hash([input.source||'selected-csv',day,metric]),previous=store.get('health_observations',id);if(previous?.value===Number(raw)&&previous?.date_precision==='day')continue;rows.push(store.prepare('health_observations',{id,metric,value:Number(raw),source:input.source||'Selected CSV',source_file:path.relative(store.root,file).replaceAll('\\','/'),observed_on:day,date_precision:'day',observed_at:zonedToUtc(day,'00:00',timezone).toISOString()},previous));}
  }
  if(!Object.keys(table).length||!measurements)throw Error('CSV needs a date column with YYYY-MM-DD dates and numeric measurement columns');store.withLock(()=>store.commit(rows));return {imported:rows.length,source_file:path.relative(store.root,file)};
 }
 if(type==='watch-add'){
  const title=required(input.title,'Watch topic'),url=new URL(required(input.url,'Source address'));if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))throw Error('Use an HTTPS source or an isolated local test source');
  if(url.username||url.password||[...url.searchParams.keys()].some(k=>/^(?:token|key|api[_-]?key|access[_-]?token|password|secret)$/i.test(k)))throw Error('Use a public source address without credentials');
  if(!Number.isInteger(input.minutes)||input.minutes<1||input.minutes>525600)throw Error('Choose the number of minutes between checks');required(input.criteria,'Meaningful change criteria');
  return addWatchTopic(store,{title,urls:[url.href],criteria:input.criteria,cadence_minutes:input.minutes,include_in_brief:input.include_in_brief===true,radar:input.radar===true,lead:input.lead===true,paused:false});
 }
 if(type==='watch-change'){const topic=store.get('watch_topics',required(input.id,'Watch ID'));if(!topic)throw Error('Watch topic missing');if(typeof input.paused!=='boolean')throw Error('Choose pause or resume');return store.withLock(()=>{const job=store.get('jobs','watch-'+topic.id);store.commit([store.prepare('watch_topics',{paused:input.paused},topic),...(job?[store.prepare('jobs',{paused:input.paused},job)]:[])]);return store.get('watch_topics',topic.id);});}
 if(NATIVE.includes(type)){
  nativeArguments(input);
  const result=store.withLock(()=>nativeOperation(store,input));ensureNativeSchedules(store,type.startsWith('journal')?'journal':'coach');
  if(type==='habit-agree')store.save('jobs',{id:'habit-check-'+result.id,kind:'habit-check',habit_id:result.id,owner:store.get('settings','installation')?.owner||store.device,paused:false,next_run:date(input.check_at,'Next check-in'),interval_ms:7*86400000,state:'pending'});
  return result;
 }
 const old=table=>{const r=store.get(table,required(input.id,'Record ID'));if(!r||r.removed_at)throw Error('Record does not exist');if(input.expected&&input.expected!==r._hash)store.conflict(table,input,r);return r;};
 if(type==='work-record-observation'){
  const item=old('work_items'),evidence=required(input.evidence,'Reported check evidence');
  if(item.kind!=='observation')throw Error('Choose the exact selected observation task');
  if(typeof input.passed!=='boolean')throw Error('Report whether the agreed check passed or failed');
  if(input.value!==undefined&&!Number.isFinite(input.value))throw Error('A measurement must be a finite reported number');
  const digest=hash({evidence,passed:input.passed,value:input.value??null});
  if(item.state==='verified'){if(item.verification?.report_hash===digest)return item;throw Error('This check is already recorded; retain corrections as a new goal observation');}
  const goal=store.get('goals',item.goal_id),decision=store.get('decisions',item.decision_id);
  if(!['adopted','active'].includes(goal?.status)||decision?.state!=='selected'||item.state!=='awaiting_approval')throw Error('The observation goal or decision is no longer active');
  return store.withLock(()=>{
   const current=store.get('work_items',item.id),currentGoal=store.get('goals',goal.id);if(current._hash!==item._hash||currentGoal._hash!==goal._hash)throw Error('Observation work changed; reload before saving');
   const result=store.prepare('notes',{title:'Reported check: '+item.title,content:'Agreed check: '+item.check+'\nReported result: '+(input.passed?'passed':'failed')+(input.value!==undefined?'\nReported measurement: '+input.value:'')+'\nUser evidence: '+evidence+'\nSource: user-reported observation; the software verified saving this report, not the underlying real-world event.',source_app:'goal-observation',goal_id:goal.id,work_id:item.id});
   const verification={kind:'reported-observation',work_id:item.id,result_id:result.id,content_hash:hash(encode(result)),passed:input.passed,value:input.value??null,outcome:input.passed?'check passed':'check failed',evidence,report_hash:digest,at:new Date().toISOString()};
   store.commit([result,store.prepare('work_items',{state:'verified',result_id:result.id,verification},current),store.prepare('goals',{progress:[...(currentGoal.progress||[]),verification]},currentGoal)]);
   return store.get('work_items',item.id);
  });
 }
 if(type==='work-retry-draft'){
  const item=old('work_items');
  if(item.kind!=='draft'||item.allowed_action!=='save-draft'||!['failed','needs_review','attempted'].includes(item.state))throw Error('Only a failed or interrupted local draft can be retried');
  const goal=store.get('goals',item.goal_id),decision=store.get('decisions',item.decision_id);
  if(!['adopted','active'].includes(goal?.status)||decision?.state!=='selected')throw Error('The draft goal or decision is no longer active');
  const running=query.rows('job_receipts').some(receipt=>{
   if(receipt.kind!=='goal-work'||receipt.state!=='attempted'||!receipt.pid)return false;
   try{process.kill(receipt.pid,0);return true;}catch(error){return error.code!=='ESRCH';}
  });
  if(running)throw Error('Draft work is still running; wait before retrying');
  return store.withLock(()=>{
   const current=store.get('work_items',item.id);if(current._hash!==item._hash)throw Error('Draft changed; reload before retrying');
   const now=new Date().toISOString(),job=store.get('jobs','goal-work');
   store.commit([store.prepare('work_items',{state:'pending',error:null,retry_after:now,max_attempts:Math.max(item.max_attempts||3,(item.attempts||0)+1),retry_reviews:[...(item.retry_reviews||[]),{at:now,previous_state:item.state,previous_error:item.error||null}]},current),...(job?[store.prepare('jobs',{paused:false,state:'pending',next_run:now,retry_count:0},job)]:[])]);
   return store.get('work_items',item.id);
  });
 }
 if(type==='goal-add'){
  const title=required(input.title,'Goal'),status=input.status||'adopted';if(!['adopted','provisional'].includes(status))throw Error('Choose adopted or provisional');
  if(input.wait_for_report!==undefined&&typeof input.wait_for_report!=='boolean')throw Error('Choose whether to wait for your separate outcome report');
  const existing=query.rows('goals').find(g=>g.title===title&&!g.removed_at);if(existing)return existing;
  new Scheduler(store).configure({goal:title});const goal=query.rows('goals').find(g=>g.title===title);return store.save('goals',{id:goal.id,status,measure:input.measure||null,wait_for_report:input.wait_for_report===true,progress:goal.progress||[]});
 }
 if(type==='goal-change'){
  const g=old('goals');required(input.reason,'Reason for change');if(input.status&&!['adopted','provisional','paused','achieved','retired'].includes(input.status))throw Error('Unsupported goal status');
  if(input.title!==undefined)required(input.title,'Goal');if(input.measure!==undefined)required(input.measure,'Progress measure');
  if(input.wait_for_report!==undefined&&typeof input.wait_for_report!=='boolean')throw Error('Choose whether to wait for your separate outcome report');
  const changes=Object.fromEntries(['title','measure','status','wait_for_report'].filter(k=>input[k]!==undefined).map(k=>[k,input[k]]));
  if(input.title!==undefined)changes.own_words=input.title;
  return store.withLock(()=>{const next=store.prepare('goals',{...changes,changes:[...(g.changes||[]),{reason:input.reason,at:new Date().toISOString(),before:{title:g.title,measure:g.measure,status:g.status}}]},g);
   const pending=query.rows('work_items').filter(w=>w.goal_id===g.id&&!['verified','cancelled'].includes(w.state)).map(w=>store.prepare('work_items',{state:'cancelled',reason:'Goal changed: '+input.reason},w));
   const decisions=query.rows('decisions').filter(d=>d.goal_id===g.id&&d.state==='selected'&&pending.some(w=>w.decision_id===d.id)).map(d=>store.prepare('decisions',{state:'cancelled',reason:'Goal changed: '+input.reason},d));
   const forecasts=query.rows('forecasts').filter(f=>f.goal_id===g.id&&f.status==='open').map(f=>store.prepare('forecasts',{status:'needs_review',reason:input.reason},f));store.commit([next,...pending,...decisions,...forecasts]);return store.get('goals',g.id);});
 }
 if(type==='goal-outcome'){const g=old('goals');required(input.evidence,'Outcome evidence');if(input.value!==undefined&&input.value!==null&&!Number.isFinite(input.value))throw Error('A measured outcome value must be a finite number');return store.save('goals',{id:g.id,progress:[...(g.progress||[]),{kind:'observed',evidence:input.evidence,value:input.value??null,outcome:input.outcome||'observed',at:new Date().toISOString()}]},g._hash);}
 if(type==='goal-evidence'){
  const g=old('goals');if(!['playbook','diagnosis'].includes(input.kind))throw Error('Choose playbook or diagnosis');const content=required(input.content,'Evidence document'),relative='goals/'+(input.kind==='playbook'?'playbooks/':'diagnoses/')+safe(g.id)+(input.kind==='playbook'?'':'-current')+'.md',file=path.join(store.root,relative);
  return store.withLock(()=>{localPath(store.root,relative);const current=store.get('goals',g.id);if(current._hash!==g._hash)store.conflict('goals',input,current);const previous=fs.existsSync(file)?fs.readFileSync(file,'utf8'):null;if(input.file_hash!==undefined&&input.file_hash!==(previous?hash(previous):null))throw Error('Goal evidence changed; reload before saving');const next=store.prepare('goals',{[input.kind]:content,legacy_log:[...(g.legacy_log||[]),{date:new Date().toISOString().slice(0,10),event:input.kind==='playbook'?'PLAYBOOK':'DIAGNOSIS',rest:relative}]},current);store.commit([next],{files:[...(previous?[{file:'goals/history/'+safe(g.id)+'-'+hash(previous)+'.md',text:previous}]:[]),{file:relative,text:content}]});return store.get('goals',g.id);});
 }
 if(type==='obligation-add'){
  if(input.recurrence&&(!Number.isInteger(input.recurrence.days)||input.recurrence.days<1||input.recurrence.days>366))throw Error('Recurrence needs 1 to 366 days');
  if(!input.due_at&&!input.target_at)throw Error('An obligation needs a target or a deadline');
  if(input.completion_check&&(!['note-contains'].includes(input.completion_check.type)||!store.get('notes',input.completion_check.note_id)||!input.completion_check.text?.trim()))throw Error('Choose a local note and exact completion text');
  return store.save('deadlines',{title:required(input.title,'Obligation'),due_at:input.due_at?date(input.due_at,'Deadline'):null,target_at:input.target_at?date(input.target_at,'Target'):null,start_at:input.start_at?date(input.start_at,'Start'):new Date().toISOString(),timezone:store.get('settings','installation')?.timezone||'UTC',status:'open',recurrence:input.recurrence||null,completion_check:input.completion_check||null,completion_baseline_hash:input.completion_check?.note_id?store.get('notes',input.completion_check.note_id)?._hash:null});
 }
 if(type==='obligation-complete'){
  const d=old('deadlines');required(input.evidence,'Completion evidence');if(d.status==='closed')return {id:d.id,next_id:d.next_id,already_closed:true};
  return store.withLock(()=>{const timezone=d.timezone||store.get('settings','installation')?.timezone||'UTC',shift=value=>{if(!value)return null;const local=localParts(new Date(value),timezone);return zonedToUtc(addDays(local.date,d.recurrence.days),local.hm,timezone).toISOString();};
   const next=d.recurrence?store.prepare('deadlines',{title:d.title,status:'open',timezone,due_at:shift(d.due_at),target_at:shift(d.target_at),start_at:shift(d.start_at),recurrence:d.recurrence,previous_id:d.id,completion_check:d.completion_check,completion_baseline_hash:d.completion_check?.note_id?store.get('notes',d.completion_check.note_id)?._hash:null}):null;
   store.commit([store.prepare('deadlines',{status:'closed',closed_at:new Date().toISOString(),completion_evidence:input.evidence,next_id:next?.id||null},d),...(next?[next]:[])]);return {id:d.id,next_id:next?.id};});
 }
 if(type==='obligation-snooze'){const d=old('deadlines');return store.save('deadlines',{id:d.id,snoozed_until:date(input.until,'Snooze date')},d._hash);}
 if(type==='coach-open'){
  if(!['health','work-money','relationships'].includes(input.area))throw Error('Choose a supported coaching area');
  const open=query.rows('coach_talks').find(t=>t.area===input.area&&t.status==='open');if(open)return open;
  return store.save('coach_talks',{area:input.area,question:required(input.question,'Coaching question'),status:'open',replies:[],sources:input.sources||[],previous_id:query.rows('coach_talks').filter(t=>t.area===input.area).at(-1)?.id||null});
 }
 if(type==='coach-reply'){const talk=old('coach_talks');if(talk.status!=='open')throw Error('Coaching talk is closed');return store.save('coach_talks',{id:talk.id,replies:[...(talk.replies||[]),{content:required(input.content,'Reply'),at:new Date().toISOString(),source_id:input.source_id||null}]},talk._hash);}
 if(type==='coach-close'){const talk=old('coach_talks');return store.save('coach_talks',{id:talk.id,status:'closed',closed_at:new Date().toISOString()},talk._hash);}
 if(type==='habit-agree'){
  const talk=store.get('coach_talks',required(input.talk_id,'Talk ID'));if(!talk)throw Error('Coaching talk missing');
  return store.save('habits',{title:required(input.title,'Habit'),agreement:required(input.agreement,'Explicit agreement'),talk_id:talk.id,area:talk.area,status:'agreed',check_at:date(input.check_at,'Next check-in'),observations:[]});
 }
 if(type==='habit-observe'){const h=old('habits');return store.save('habits',{id:h.id,observations:[...(h.observations||[]),{content:required(input.observation,'Observation'),at:new Date().toISOString()}]},h._hash);}
 if(type==='journal-add'){if(store.get('settings','journal')?.enabled===false)throw Error('Journaling is switched off');return store.save('journal',{content:required(input.content,'Journal entry'),source_id:input.source_id||null,at:new Date().toISOString()});}
 if(type==='journal-switch'){if(typeof input.enabled!=='boolean')throw Error('Choose enabled or disabled');return store.save('settings',{id:'journal',enabled:input.enabled});}
 if(type==='health-add'){if(input.value===undefined||input.value===null)throw Error('Health observation value is required');return store.save('health_observations',{metric:required(input.metric,'Health metric'),value:input.value,unit:input.unit||null,observed_at:date(input.observed_at,'Observation time'),source_id:input.source_id||null});}
 if(['memory-confirm','memory-propose'].includes(type)){
  required(input.evidence_quote,'Source quote');
  const subject=memorySubject(domains,input);
   if(type==='memory-confirm')return domains.writeFact({...subject,label:required(input.label,'Fact label'),...memoryCorrection(domains,input,subject),value:required(input.value,'Fact value'),source_type:'conversation',source_id:input.source_id,evidence_quote:input.evidence_quote});
  const fingerprint=hash([input.source_id,subject.subject_type,subject.subject_id,input.label,input.value]);const existing=query.rows('review_queue').find(r=>r.fingerprint===fingerprint);if(existing)return existing;
  return store.save('review_queue',{title:'Remember '+required(input.label,'Fact label'),suggestion_type:'add_claim',payload:{...subject,label:input.label,value:required(input.value,'Fact value'),source_type:'conversation',source_id:input.source_id,evidence_quote:input.evidence_quote},description:input.evidence_quote,status:'pending_review',fingerprint,origin:'conversation'});
 }
 if(type==='routine-change'){const j=old('jobs');if(input.paused!==undefined&&typeof input.paused!=='boolean')throw Error('Pause must be true or false');if(input.calendar&&(!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.calendar.time)||input.calendar.weekdays?.some(d=>!Number.isInteger(d)||d<0||d>6)))throw Error('Calendar needs a valid local time and weekdays');return store.save('jobs',{id:j.id,...(input.paused!==undefined?{paused:input.paused}:{}),...(input.calendar?{calendar:input.calendar,next_run:nextCalendarRun({...j,calendar:input.calendar},store.get('settings','installation')?.timezone||'UTC')}:{})},j._hash);}
 if(type==='forecast-settle'){const f=old('forecasts');required(input.evidence,'Forecast evidence');if(typeof input.observed!=='boolean')throw Error('Forecast observation must be true or false');if(f.status==='settled')return f;return store.save('forecasts',{id:f.id,status:'settled',observed:input.observed,evidence:input.evidence,brier_score:(f.probability-Number(input.observed))**2,settled_at:new Date().toISOString()},f._hash);}
 if(type==='work-allow-local'){
  const item=old('work_items'),note=store.get('notes',required(input.note_id,'Target note ID'));
  if(item.kind!=='local-note'||!note||note.is_trashed||!['awaiting_approval','failed'].includes(item.state))throw Error('Choose a pending local-note task and an existing note');
  return store.save('work_items',{id:item.id,state:'pending',allowed_action:'write-local-note',target_id:note.id,target_hash:note._hash,authorised_at:new Date().toISOString()},item._hash);
 }
 throw Error('Unsupported personal operation: '+type);
}
export function validateConversationOperations(domains,input,operations){
 if(!Array.isArray(operations)||operations.length>10)throw Error('Invalid conversation operations');
 const message=String(input.message||input.messages?.filter(m=>m.role==='user').at(-1)?.content||'');
 // Authorization is checked independently of the model's explanation.
 const intents={
  'goal-add':/\b(?:my goal is|adopt|set|add|remember|create|mein ziel|lege|speichere)\b[\s\S]*(?:goal|ziel)|\b(?:my goal is|mein ziel ist)\b/i,
  'goal-change':/\b(?:change|pause|resume|retire|close|complete|update|ändere|pausiere|beende)\b[\s\S]*(?:goal|ziel)/i,
  'goal-outcome':/\b(?:record|save|log|update|speichere|notiere)\b[\s\S]*(?:outcome|result|progress|ergebnis|fortschritt)/i,
  'obligation-add':/\b(?:remind me|reminder|add an? obligation|add an? deadline|create an? reminder|erinnere mich|erinnerung)\b/i,
  'obligation-complete':/\b(?:complete|completed|close|done|finished|erledigt|abgeschlossen)\b/i,
  'obligation-snooze':/\b(?:snooze|postpone|move|verschiebe)\b/i,
  'coach-open':/\b(?:start|open|begin|starte|beginne)\b[\s\S]*(?:coach|talk|conversation|gespräch)/i,
  'coach-reply':/\b(?:reply|answer|tell|record|said|antwort|notiere)\b/i,
  'coach-close':/\b(?:close|finish|end|beende)\b[\s\S]*(?:talk|coach|conversation|gespräch)/i,
  'habit-agree':/\b(?:i agree|i will|let.s try|agree to|ich stimme|ich werde)\b/i,
  'habit-observe':/\b(?:record|log|track|did|didn.t|did not|skipped|notiere|erledigt|nicht)\b/i,
  'journal-add':/\b(?:journal|diary|notiere|tagebuch)\b/i,
  'journal-switch':/\b(?:enable|disable|turn on|turn off|start|stop|switch|aktiviere|deaktiviere)\b[\s\S]*(?:journal|diary|tagebuch)/i,
  'health-add':/\b(?:record|log|save|notiere|speichere)\b/i,
  'memory-confirm':/\b(?:remember|save this fact|correct|update my|merke|speichere|korrigiere)\b/i,
  'memory-propose':/\b(?:remember|save this fact|merke|speichere)\b/i,
  'routine-change':/\b(?:pause|resume|schedule|change|stop|start|pausiere|ändere)\b/i,
  'forecast-settle':/\b(?:settle|record|resolve|log|notiere)\b[\s\S]*(?:forecast|prediction|prognose)/i,
  'work-allow-local':/\b(?:allow|approve|authori[sz]e|erlaube|genehmige)\b[\s\S]*(?:edit|change|update|write|note|ändern|notiz)/i,
  'work-retry-draft':/\b(?:retry|try again|wiederhole|erneut)\b[\s\S]*(?:draft|work|entwurf|aufgabe)/i,
  'work-record-observation':/\b(?:record|log|save|notiere|speichere)\b[\s\S]*(?:check|review|observation|result|prüfung|ergebnis)/i
 };
 for(const operation of operations){
  const quote=operation.source_quote;
  // A provider-selected substring cannot turn a refusal or hypothetical into permission.
  if(!quote||!message.includes(quote)||!intents[operation.type]?.test(quote)||!intents[operation.type]?.test(message)||/\b(?:do not|don.t|never|must not|should not|nicht|niemals)\s+(?:remember|save|add|create|allow|approve|authori[sz]e|edit|change|write|speichere|erlaube)/i.test(message)||/\b(?:if I|suppose|hypothetically|for example|someone said|quoted|wenn ich|beispielsweise)\b/i.test(message))throw Object.assign(Error('A proposed change needs your explicit request.'),{code:'UNAUTHORIZED_OPERATION',operation_type:operation.type,source_quote_matches:typeof quote==='string'&&message.includes(quote)});
  if(operation.type==='work-allow-local'){
   const note=domains.store.get('notes',operation.note_id),item=domains.store.get('work_items',operation.id);
   if(!note||!item||![note.id,note.title].filter(Boolean).some(name=>message.includes(name))||![item.id,item.title].filter(Boolean).some(name=>message.includes(name)))throw Error('Approval must identify the exact task and target note');
  }
  if(operation.type==='habit-observe'&&operation.answer==='done'&&/\b(?:did not|didn.t|haven.t|have not|not done|skipped|nicht|nein)\b/i.test(message))throw Error('Habit completion contradicts the actual user reply');
  if(['goal-add','goal-change'].includes(operation.type)&&operation.wait_for_report===true&&(!/\b(?:wait|warten|warte)\b[\s\S]*\b(?:report|review|rating|observation|bericht|bewertung|rückmeldung)\b/i.test(message)||/\b(?:do not|don.t|never|stop|nicht)\s+(?:wait|waiting|warten)\b/i.test(message)))throw Error('Waiting for an outcome report needs your explicit request');
  if(['memory-confirm','memory-propose'].includes(operation.type)){
   if(!operation.subject_type)throw Error('Memory must explicitly identify whose fact this is');
   if(!operation.evidence_quote||!message.includes(operation.evidence_quote))throw Error('Memory evidence must occur in the user message');
   const subject=memorySubject(domains,operation);
     if(operation.type==='memory-confirm'){
      memoryCorrection(domains,operation,subject);
      if(/\b(?:correct|correction|replace[sd]?|supersede[sd]?|korrigiere|korrektur|ersetze)\b/i.test(message)&&!operation.replaces_claim_id&&visibleRows(domains.query,'profile_facts').some(f=>f.is_current&&f.show_to_agent&&f.subject_type===subject.subject_type&&(f.subject_id||null)===(subject.subject_id||null)))throw Error('An existing memory correction must identify replaces_claim_id; a new label does not replace the old claim');
     }
   if(subject.subject_type!=='self'){
    const row=domains.store.get(subject.subject_type==='contact'?'contacts':'entities',subject.subject_id);
    if(![row.id,row.name,row.title,...(row.aliases||[])].filter(Boolean).some(name=>message.toLocaleLowerCase().includes(name.toLocaleLowerCase())))throw Error('The request must identify the person or thing whose fact is being saved');
   }
  }
  if(operation.type==='work-record-observation'){
   const item=domains.store.get('work_items',operation.id);
   if(!item||![item.id,item.title].filter(Boolean).some(name=>message.includes(name))||!message.includes(operation.evidence)||operation.value!==undefined&&!message.includes(String(operation.value)))throw Error('A reported check must identify its exact task and supplied evidence');
   if(operation.passed===true&&/\b(?:failed|did not pass|didn.t pass|not passed|nicht bestanden)\b/i.test(message))throw Error('Check success contradicts the actual user report');
  }
 }
 // Every operation is tried, in order, on a copy of the records before any is
 // saved, so one that fails its own checks (a date without its time zone)
 // goes back to the model with the rest. Until 6 October 2026 the goal was
 // created, the reminder after it failed, no reply was saved, and asking
 // again only said "Previous operation needs review".
 const trial=staged(domains,rehearsal(domains.store)),exists={'coach-reply':['coach_talks','id'],'coach-close':['coach_talks','id'],'habit-agree':['coach_talks','talk_id'],'habit-observe':['habits','id']};
 for(const operation of operations){
  if(!outsideRecords(domains,operation)){personalOperation(trial,{...operation});continue;}
  nativeArguments(operation);const [table,field]=exists[operation.type]||[];
  if(table&&!domains.query.rows(table).some(r=>r.id===operation[field]))throw Error('Choose an existing '+(table==='habits'?'habit':'coaching talk'));
 }
}
export function conversationOperations(domains,input,operations){
 if(!Array.isArray(operations)||operations.length>10)throw Error('Invalid conversation operations');
 const message=String(input.message||input.messages?.filter(m=>m.role==='user').at(-1)?.content||'');
 const source=domains.query.rows('conversation_messages').filter(m=>m.role==='user'&&m.conversation_id===input.conversation_id&&m.content===message).at(-1);
 const requestId=input.request_id||source?.id||hash([input.conversation_id,message]);
 const planId='personal-plan-'+hash([input.conversation_id,requestId]);
 const digest=hash(operations),plan=domains.store.get('command_receipts',planId);
 if(plan&&plan.plan_hash!==digest)throw Error('Request retry conflicts with its saved operation plan; reload the original result');
 if(plan?.state==='verified'&&Array.isArray(plan.results))return plan.results;
 validateConversationOperations(domains,input,operations);
 for(const operation of operations){
  if(!operation.source_quote||!message.includes(operation.source_quote))throw Error('Operation needs an exact source quote from the explicit user request');
  if(operation.evidence_quote&&!message.includes(operation.evidence_quote))throw Error('Memory evidence must occur in the user message');
 }
 const sourceId=source?.id||requestId,receipt=i=>'personal-'+hash([input.conversation_id,requestId,i]),outside=operations.map(op=>outsideRecords(domains,op)),results=[];
 // The operations on records, each with its receipt, are saved in one
 // transaction: all of them or none, so a failed request can simply be
 // asked again. The add-ons' file operations follow, one by one with their
 // receipts as before, since no transaction can take a file write back.
 if(outside.some(Boolean)&&!plan)domains.store.save('command_receipts',{id:planId,state:'attempted',source_id:sourceId,plan_hash:digest,operations});
 if(outside.some(o=>!o))domains.store.transaction(view=>{
  const records=staged(domains,view);
  for(const [i,operation] of operations.entries()){
   if(outside[i])continue;const id=receipt(i),previous=view.get('command_receipts',id);
   if(previous){if(previous.state!=='verified')throw Error('Previous operation needs review');results[i]=previous.result;continue;}
   results[i]=personalOperation(records,{...operation,source_id:sourceId});view.save('command_receipts',{id,state:'verified',source_id:sourceId,operation:operation.type,result:results[i]});
  }
  if(!outside.some(Boolean))view.save('command_receipts',{id:planId,state:'verified',source_id:sourceId,plan_hash:digest,operations,results});
 });
 if(!outside.some(Boolean))return results;
 for(const [i,operation] of operations.entries()){
  if(!outside[i])continue;const id=receipt(i),previous=domains.store.get('command_receipts',id);
  if(previous){if(previous.state!=='verified')throw Error('Previous operation needs review');results[i]=previous.result;continue;}
  domains.store.save('command_receipts',{id,state:'attempted',source_id:sourceId,operation:operation.type});
  results[i]=personalOperation(domains,{...operation,source_id:sourceId});
  domains.store.save('command_receipts',{id,state:'verified',source_id:sourceId,operation:operation.type,result:results[i]});
 }
 domains.store.save('command_receipts',{id:planId,state:'verified',plan_hash:digest,results});
 return results;
}
