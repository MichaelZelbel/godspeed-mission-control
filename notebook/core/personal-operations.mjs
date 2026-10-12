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
import {localParts,addDays,zonedToUtc,now as clockNow} from '../../third-party/addons/godspeed-coach/lib/clock.mjs';
import {trackerOperation,TRACKER_OPERATIONS} from './tracker-operations.mjs';
import {proposalState,card,findTracker} from './trackers.mjs';
import {isHabitRef} from './habit-trackers.mjs';
import {headacheOperation,headacheArgs} from './headache-operation.mjs';
import {cycleOperation,cycleTracker,DELETE_MS} from './cycle-operations.mjs';
import {foodOperation,foodTracker} from './food-operations.mjs';
import {mealOf} from './food.mjs';
import {CYCLE_WORDS,PERIOD_WORDS,OVER_WORDS,FLOW_WORDS,WHERE_WORDS,SYMPTOMS} from './cycle.mjs';
import {nextCalendarRun} from './jobs/calendar.mjs';
import {resumeChanges} from './jobs/routine-control.mjs';
import {readTable} from '../../third-party/addons/godspeed-coach/lib/auto.mjs';
import {localPath} from './local-path.mjs';
import {visibleRows} from './visibility.mjs';
import {checkOutboundURL} from './outbound-fetch.mjs';
export const operationContract=`Return JSON {reply,language,notes_created?:[{title,content}],operations?:[{type,source_quote,...fields}]}. language is the two-letter code of the language the user's current message is written in (en, de, ...); write reply in that language. Use an operation only when the user's current message explicitly requests that change. source_quote must be exact user words requesting it, never a note quote. Supported operations:
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
tracker-hold {name,unit?,cadence?:daily|any,fields?:[{label,type:number|text|boolean,unit?,min?,max?}],talk?:<coaching area that reads it, such as health>,value?,data?,note?,on?:YYYY-MM-DD or his own day words ("Friday", "yesterday"),at?:HH:MM}: the user says "track <something>" and no supplied tracker has that name or clearly means it, or asks to set up a tracker ("I want to track my sleep: hours, and quality from 1 to 5": one tracker with every column he named in fields, a range as min and max). It asks once; it creates nothing. Something that happened, with no number ("track sauna"), is only {name}: it counts each time.
tracker-create {proposal_id?,name?,unit?,cadence?,fields?,talk?}: the user says yes to a supplied pending tracker question (pass its proposal_id; carry any change he asked for, such as another name or unit), or explicitly asks to set up a tracker with its columns.
track {tracker,value?,data?,note?,on?,at?,new_name?}: the user tracks something a supplied tracker records. tracker is its id; a tracker with several columns takes data by their keys. When he used a new word for an existing tracker, pass it as new_name. Another day: on is his own day words ("Friday", "yesterday") or YYYY-MM-DD; a weekday is the most recent one, worked out by the operation.
tracker-correct {tracker,entry_id?,value?,data?,remove?:boolean}: the user corrects or removes an entry ("that was 91, not 92", "delete the last belly"). Without entry_id it is his most recent entry in that tracker.
Never invent a tracker; never create one without his yes. Relay the operation's reply as the answer.
A message that starts with "track" goes, in this order: the name of a supplied habit tracker (specialist habit) is track {tracker:<its id>,answer?:done|no|skip}; a headache, a pill or a pain level is headache; the period, the cycle or a cycle symptom ("track period", "track Periode", "track cramps") is cycle; food, a meal or something she ate or drank ("track food, ...", "track lunch, ...", "track usual breakfast") is food; a supplied tracker's name or other name is track; only a name nothing supplied has is tracker-hold.
cycle {action:track|over|forecast|leave-out|count|heads-up|talk|decline|delete,flow?:spotting|light|medium|heavy|unspecified,pain?:0-3,pain_where?:[belly|back|head],symptoms?:[cramps|headache|bloating|breast tenderness|acne|low mood|irritable|low energy|poor sleep|cravings|digestion|discharge],note?,on?:YYYY-MM-DD,start?:YYYY-MM-DD,why?:outlier|pregnancy|breastfeeding|contraception,enabled?:boolean,talk?,confirm?,language}: her period and cycle; personal.cycle is her cycle tracker (null: none yet). track is a day ("track period, heavy, cramps 2"; a headache named as one of the day's symptoms is a symptom here): flow is the amount she said, unspecified when she says she has her period without an amount, left out for a day of symptoms only; with no cycle tracker it asks its setup question, and her yes is tracker-create with that question's id. "period over" is over. "when is my next period?" is forecast. Her answer to "Leave this one out of the forecast?": yes is leave-out, no is count. A cycle affected by pregnancy, breastfeeding or starting or stopping hormonal contraception is leave-out with why and start (the day it began; without start, the cycle she is in now). "tell me two days before my period" is heads-up {enabled:true}, stopping it {enabled:false}. "my health talk may read my cycle" is talk {talk:"health"}. "delete my cycle tracker" is delete; her yes to that question is delete {confirm:<personal.cycle.deletion.request_id>}. A question about a fertile window, ovulation, safe days, conceiving or avoiding pregnancy, contraception or a diagnosis is decline: never answer it yourself. Pass language. Relay the operation's reply as the answer.
food {action:track|answer|remember|correct|today|target|settings|talk|search|status,items?:[{food,item,grams?,count?,unit?,assumed?}],meal?:breakfast|lunch|dinner|snack|none,preset?,question?,grams?,name?,entry_id?,remove?,totals?,sex?:female|male,age?,height_cm?,weight_kg?,activity?:sedentary|light|moderate|very|extra,goal?:lose|keep|gain,numbers?,eating_disorder?,pregnant?,breastfeeding?,talk?,on?:YYYY-MM-DD,at?:HH:MM,language}: what she eats; personal.food is her food tracker (null: none yet) with its open questions, and personal.food.candidates the food table's matches for her words, each with its id. track is a meal: one item per food, food is a candidate's id (choose the plain food she means; when none fits, ask her and write nothing), item her word for it, grams only when she said a weight, count and unit when she said pieces or a container ("half a pack": count 0.5, unit "pack"), and for a piece of a standard size or a food with no amount you may add your typical weight as grams with assumed:true; never assume the size of a pack, bowl, plate, glass or can: leave grams out and code asks her once. With no food tracker it asks its setup question; her yes is tracker-create with that question's id, with answers:[{grams}] when she gave the asked amounts in the same message, and eating_disorder:true when she says she has or had one. Her answer to an amount question is answer {grams} (the size of the whole pack, bowl or glass, or the grams of the item). "remember this as my usual lunch" is remember {name:"lunch"}; "track usual lunch" is track {preset:"lunch"}. "the eggs were three" is correct {item:"eggs",count:3}; "delete the eggs" is correct {item:"eggs",remove:true}. "what did I eat today?" is today, with totals:true when she asks for calories or totals. "set my food target" is target with what she said about herself (never guess her age, height, weight, activity or goal). "stop showing calories" is settings {numbers:false}; "show calories again" {numbers:true}; pregnancy, breastfeeding or an eating disorder she mentions go in settings or target as true. Pass language. Every number in the answer is the operation's: relay its reply as the answer, word for word.
headache {action:start|log|set|med|end|cancel,at?,from?,to?,pain?,side?,quality?,symptoms?:[word],triggers?:[word],meds?:[{med,dose?}],taken?,episode?}: a headache or migraine, with or without "track". start: one going on now (at: when it began, as he said it: HH:MM, "yesterday HH:MM" or -30m); log: one already over (from and to); set: more about one (pain, side, what it feels like, a symptom, a trigger he named, a corrected time); med: a pill or other medicine; end: it is over (at, if he said when); cancel: it was a mistake. The open headaches are in personal.headache with their ids; without episode it is the open one. Pain is only a number he gave; never guess a trigger; never do clock sums.
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
// A habit's day is written to the coach's own file, as habit-observe writes it (habit-trackers.mjs).
const habitTrack=(domains,op)=>['track','tracker-correct'].includes(op.type)&&isHabitRef(domains.store,op.tracker);
// A headache is written by the headache add-on into its tracker's files (headache-operation.mjs).
const outsideRecords=(domains,op)=>NATIVE.includes(op.type)||op.type==='headache'||habitTrack(domains,op)||op.type==='routine-change'&&!!domains.nativeScheduler||process.env.GODSPEED_ORIGINAL_RUNTIME==='on'&&['goal-add','goal-change','goal-outcome','forecast-settle'].includes(op.type)||['obligation-complete','obligation-snooze'].includes(op.type)&&dueRows(domains.store).some(d=>d.id===op.id);
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
 // A key the owner gave another program (domains.delegated, set by mcp.mjs) acts
 // within its scopes and never as the owner: it does not run a work item's
 // check, give a radar verdict, allow a file or note change, or approve. The
 // owner and the installation's own assistant keep those (card-commands.mjs).
 const delegated=domains.delegated===true;
 if(delegated&&(type==='work-allow-local'||type==='radar-command'&&['verdict','allow'].includes(input.args?.[0])))throw Error('Approving work and giving a radar verdict stay with the owner. Tell them what you recommend instead.');
 if(type==='routine-change'&&domains.nativeScheduler)return domains.nativeScheduler.control(input);
 if(process.env.GODSPEED_ORIGINAL_RUNTIME==='on'&&['goal-add','goal-change','goal-outcome','forecast-settle'].includes(type)){
  let card='goals',args;
  if(type==='goal-add')args=['file','--kind','outcome','--status',input.status||'adopted','--title',required(input.title,'Goal'),'--measure',input.measure||'','--source','Notebook request, '+new Date().toISOString()];
  else {const table=type==='forecast-settle'?'forecasts':'goals',item=query.rows(table).find(r=>r.id===input.id);if(!item)throw Error('Choose an existing '+table+' item');
   if(type==='goal-change'){const fields={title:'TITLE',measure:'MEASURE',status:'STATUS'};args=['change',item.id,'--set',Object.entries(fields).filter(([k])=>input[k]!==undefined).map(([k,f])=>f+'='+required(input[k],f)).join(';'),'--why',required(input.reason,'Reason')];}
   else if(type==='goal-outcome')args=['progress',item.id,'--evidence',required(input.evidence,'Evidence')];
   else {card='forecast';args=['resolve',item.id,'--outcome',input.observed?'yes':'no','--evidence',required(input.evidence,'Evidence')];}
  }
  const result=cardCommand(store,{card,args},{delegated});return type==='goal-add'?query.rows('goals').find(r=>r.title===input.title):query.rows(card==='goals'?'goals':'forecasts').find(r=>r.id===input.id)||result;
 }
 if(type==='addon-command'){const result=addonCommand(store,input);if(input.addon!=='headache')ensureNativeSchedules(store,input.addon);return result;}
 if(type==='card-command')return cardCommand(store,input,{delegated});
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
  // Never an address on this server or its network (6 October 2026: an actions key watched an internal one).
  const title=required(input.title,'Watch topic'),url=checkOutboundURL(required(input.url,'Source address'));if(url.protocol!=='https:'&&process.env.GODSPEED_OUTBOUND_ALLOW_LOCAL!=='1')throw Error('Use an HTTPS source');
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
 // Trackers (D-321): collections with a tracker card, in tracker-operations.mjs.
 if(TRACKER_OPERATIONS.includes(type))return trackerOperation(domains,input);
 // Headaches: the headache add-on, the one owner of the Headaches tracker (headache-operation.mjs).
 if(type==='headache')return headacheOperation(domains,input);
 // The cycle tracker: a specialist on the tracker base (cycle-operations.mjs).
 if(type==='cycle')return cycleOperation(domains,input);
 // The food tracker: a specialist on the tracker base (food-operations.mjs).
 if(type==='food')return foodOperation(domains,input);
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
 // A resume passes the same review guard as the routine controls (resumeChanges).
 if(type==='routine-change'){const j=old('jobs');if(input.paused!==undefined&&typeof input.paused!=='boolean')throw Error('Pause must be true or false');if(input.calendar&&(!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.calendar.time)||input.calendar.weekdays?.some(d=>!Number.isInteger(d)||d<0||d>6)))throw Error('Calendar needs a valid local time and weekdays');const settings=store.get('settings','installation')||{};return store.save('jobs',{id:j.id,...(input.paused!==undefined?{paused:input.paused}:{}),...(input.calendar?{calendar:input.calendar,next_run:nextCalendarRun({...j,calendar:input.calendar},settings.timezone||'UTC')}:{}),...(input.paused===false?resumeChanges(store,settings,j):{})},j._hash);}
 if(type==='forecast-settle'){const f=old('forecasts');required(input.evidence,'Forecast evidence');if(typeof input.observed!=='boolean')throw Error('Forecast observation must be true or false');if(f.status==='settled')return f;return store.save('forecasts',{id:f.id,status:'settled',observed:input.observed,evidence:input.evidence,brier_score:(f.probability-Number(input.observed))**2,settled_at:new Date().toISOString()},f._hash);}
 if(type==='work-allow-local'){
  const item=old('work_items'),note=store.get('notes',required(input.note_id,'Target note ID'));
  if(item.kind!=='local-note'||!note||note.is_trashed||!['awaiting_approval','failed'].includes(item.state))throw Error('Choose a pending local-note task and an existing note');
  return store.save('work_items',{id:item.id,state:'pending',allowed_action:'write-local-note',target_id:note.id,target_hash:note._hash,authorised_at:new Date().toISOString()},item._hash);
 }
 // Named by its type. The capture runs of 12 October 2026 saw a model send {"action":"tracker-list"}: taking that
 // as the type (3dfd733), or a refusal that showed the fix (e944ca8), let it skip the recipe, and without the
 // recipe it named trackers in lower case, retyped replies and missed another name. So the refusal sends it
 // to the recipe, as the first refusal did when every session read it (c043bf7).
 if(type===undefined||type===null||type==='')throw Error('This call names no operation. Read the recipe for this message first (skill_view: the tracker recipe for a message that starts with "track"), then call as it says');
 throw Error('Unsupported personal operation: '+type);
}
// What a cycle operation writes must be what she said (D-321 step 4), as a headache's must: a flow,
// a pain, a place and a symptom in her own words; "over", the heads-up on or off, a talk, a reason
// to leave a cycle out, and a deletion said in words; a yes only to a deletion question still open.
const PAIN_WORDS=[/(?<!\p{L})(?:zero|null|none|kein)(?!\p{L})/iu,/(?<!\p{L})(?:one|eins|ein)(?!\p{L})/iu,/(?<!\p{L})(?:two|zwei)(?!\p{L})/iu,/(?<!\p{L})(?:three|drei)(?!\p{L})/iu];
function cycleChecks(domains,message,op){
 const lower=message.toLocaleLowerCase(),has=words=>words.some(w=>lower.includes(w)),given=v=>v!==undefined&&v!==null&&v!==''&&!(Array.isArray(v)&&!v.length),action=op.action;
 if(action==='track'){
  const symptoms=[].concat(op.symptoms??[]),where=[].concat(op.pain_where??[]);
  if(given(op.flow)&&op.flow!=='unspecified'&&!has(FLOW_WORDS[op.flow]||[String(op.flow)]))throw Error('A tracked flow must be the flow you said');
  if((op.flow==='unspecified'||!given(op.flow)&&!symptoms.length&&!given(op.pain)&&!where.length)&&!PERIOD_WORDS.test(message))throw Error('Say that you have your period, or which symptom');
  if(given(op.pain)){const n=Number(String(op.pain).replace(',','.')),digits=(message.match(/\d+(?:[.,]\d+)?/g)||[]).some(x=>Number(x.replace(',','.'))===n),word=Number.isInteger(n)&&n>=0&&n<=3&&PAIN_WORDS[n].test(message);if(!digits&&!word)throw Error('A pain level must be a number you said');}
  for(const w of where)if(!has(WHERE_WORDS[w]||[String(w)]))throw Error('Where it hurts must be a place you said');
  for(const x of symptoms){const known=SYMPTOMS.find(s=>s.key===x);if(!has(known?known.words:[String(x).toLowerCase()]))throw Error('A symptom must be a symptom you named');}
 }
 if(action==='over'&&!OVER_WORDS.test(message))throw Error('Say that your period is over');
 if(action==='heads-up'){
  const off=/(?<!\p{L})(?:stop|off|no more|don.t|do not|nicht mehr|keine|aus|aufhören|abschalten|ausschalten|abstellen)(?!\p{L})/iu.test(message);
  if(!/heads.?up|tell me|let me know|remind|warn|before|vorher|bescheid|sag mir|erinner|vorwarn/iu.test(message)||typeof op.enabled!=='boolean'||op.enabled===off)throw Error('Say whether to switch the heads-up on or off');
 }
 if(action==='talk'&&!/(?<!\p{L})(?:talk|gespräch|coach)/iu.test(message))throw Error('Say which talk may read your cycle');
 if(action==='leave-out'){
  const said={outlier:/(?<!\p{L})(?:yes|yeah|yep|sure|ok(?:ay)?|ja|jo|klar|leave|out|skip|ignore|weglassen|weg|raus|nicht zählen|don.t count|not count)(?!\p{L})/iu,pregnancy:/pregnan|schwanger/iu,breastfeeding:/breastfeed|nursing|stillen|stille/iu,contraception:/(?<!\p{L})(?:pill|pille|contracept\p{L}*|birth control|verhüt\p{L}*|hormon\p{L}*|spirale|iud|ring|implant\p{L}*|patch|pflaster)(?!\p{L})/iu}[op.why||'outlier'];
  if(!said||!said.test(message))throw Error('Say why that cycle should be left out');
 }
 if(action==='count'&&!/(?<!\p{L})(?:count|include|keep|zähl\p{L}*|behalten|mitzählen|no|nein|nope)(?!\p{L})/iu.test(message))throw Error('Say that the cycle should count');
 if(action==='delete'){
  if(op.confirm){const d=domains.store.get('tracker_deletions',String(op.confirm));if(!/^\s*(?:yes|yeah|yep|sure|ok(?:ay)?|ja|jo|klar|do it|go ahead|mach(?: das)?|lösch\p{L}*)(?!\p{L})/iu.test(message)||!d||d.removed_at||!(clockNow()-Date.parse(d.created_at)<=DELETE_MS))throw Error('That question has expired. Say "delete my cycle tracker" again and I will ask once more.');}
  else if(!/(?<!\p{L})(?:delete|remove|lösch\p{L}*|entfern\p{L}*)/iu.test(message)||!/(?<!\p{L})(?:cycle|period|tracker|zyklus|periode)/iu.test(message))throw Error('Say that you want your cycle tracker deleted');
 }
}
// What the food tracker writes must be what she said (D-321 step 5): every item a food she named, grams
// and counts she said (a typical weight only when marked assumed), a unit and a meal she said; the
// target's facts about her in her own words; the settings in words. A barcode is looked up by the chat
// itself before the model answers, never by an operation here.
const COUNT_WORDS=[[0.5,/(?<!\p{L})(?:half|halbe?[nrs]?)(?!\p{L})|½|0[.,]5/iu],[1,/./],[2,/(?<!\p{L})(?:two|zwei|both|beide|a couple)(?!\p{L})/iu],[3,/(?<!\p{L})(?:three|drei)(?!\p{L})/iu],[4,/(?<!\p{L})(?:four|vier)(?!\p{L})/iu],[5,/(?<!\p{L})(?:five|fünf)(?!\p{L})/iu],[6,/(?<!\p{L})(?:six|sechs)(?!\p{L})/iu],[7,/(?<!\p{L})(?:seven|sieben)(?!\p{L})/iu],[8,/(?<!\p{L})(?:eight|acht)(?!\p{L})/iu],[9,/(?<!\p{L})(?:nine|neun)(?!\p{L})/iu],[10,/(?<!\p{L})(?:ten|zehn)(?!\p{L})/iu]];
function foodChecks(domains,message,op){
 const lower=message.toLocaleLowerCase(),action=op.action||'track';
 const named=text=>String(text??'').toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w=>w.length>=3).some(w=>lower.includes(w.slice(0,4)));
 const number=v=>[String(v),String(v).replace('.',',')].some(x=>new RegExp('(?<![\\d.,])'+x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?!\\d|[.,]\\d)').test(message));
 const counted=n=>number(n)||COUNT_WORDS.some(([v,re])=>v===Number(n)&&re.test(message));
 if(['barcode','product'].includes(action))throw Error('The notebook\'s chat looks a barcode up by itself; use the food it found.');
 if(action==='track'){
  if(op.preset!==undefined&&!named(String(op.preset).replace(/usual|my/gi,'')||op.preset))throw Error('A saved meal must be one you named');
  for(const it of [].concat(op.items??[])){
   if(!it||typeof it!=='object')throw Error('Give each food as an item');
   const product=String(it.food||'').startsWith('off:')&&lower.includes(String(it.food).slice(4));
   if(!named(it.item)&&!product)throw Error('A tracked food must be one you named');
   if(it.grams!==undefined&&it.grams!==null&&it.assumed!==true&&!number(it.grams))throw Error('An amount must be one you said; a typical weight is marked as assumed');
   if(it.count!==undefined&&it.count!==null&&!counted(it.count))throw Error('A count must be one you said');
   if(it.unit&&!named(it.unit))throw Error('A pack, bowl or slice must be one you said');
  }
  if(op.meal&&op.meal!=='none'&&mealOf(message)!==op.meal)throw Error('A meal must be the one you named');
 }
 if(action==='answer'){for(const a of [].concat(op.answers??(op.grams!==undefined?[{grams:op.grams}]:[])))if(!number(a?.grams))throw Error('An amount must be one you said');}
 if(action==='remember'&&(!/(?<!\p{L})(?:remember|save|keep|merk\p{L}*|speicher\p{L}*)/iu.test(message)||!named(String(op.name||'').replace(/usual|my/gi,'')||op.name)))throw Error('Say what to remember the meal as');
 if(action==='correct'){
  if(op.item!==undefined&&!named(op.item))throw Error('A corrected food must be one you named');
  if(op.grams!==undefined&&!number(op.grams))throw Error('An amount must be one you said');
  if(op.count!==undefined&&!counted(op.count))throw Error('A count must be one you said');
  if(op.remove===true&&!/(?<!\p{L})(?:delete|remove|drop|undo|lösch\p{L}*|entfern\p{L}*|streich\p{L}*)/iu.test(message))throw Error('Say that you want it removed');
 }
 if(action==='target'){
  const said={sex:{female:/(?<!\p{L})(?:female|woman|women|frau|weiblich)(?!\p{L})/iu,male:/(?<!\p{L})(?:male|man|men|mann|männlich)(?!\p{L})/iu},
   activity:{sedentary:/sit|sedentary|desk|inactive|kaum|wenig/iu,light:/light|leicht|a little|bisschen/iu,moderate:/moderat|mäßig|medium|mittel|some sport|regular/iu,very:/very|sehr|daily sport|täglich/iu,extra:/extrem|extreme|athlet|hard training|physical job|körperlich/iu},
   goal:{lose:/lose|loss|abnehm|leaner|weniger|cut/iu,keep:/keep|maintain|halten|stay|gleich/iu,gain:/gain|zunehm|build|bulk|mehr/iu}};
  if(op.sex!==undefined&&!said.sex[op.sex]?.test(message))throw Error('Say which the formula should count you as');
  for(const k of ['age','height_cm','weight_kg'])if(op[k]!==undefined&&!number(op[k]))throw Error('Your '+(k==='age'?'age':k==='height_cm'?'height':'weight')+' must be one you said');
  if(op.activity!==undefined&&!said.activity[op.activity]?.test(message))throw Error('Say how active you are');
  if(op.goal!==undefined&&!said.goal[op.goal]?.test(message))throw Error('Say whether you want to lose, keep or gain weight');
  const facts=['sex','age','height_cm','weight_kg','activity','goal','off','pregnant','breastfeeding','eating_disorder'].some(k=>op[k]!==undefined);
  if(!facts&&!/(?<!\p{L})(?:target|goal|ziel|calories|kalorien|kcal)/iu.test(message))throw Error('Say that you want a food target');
 }
 const flags={pregnant:/pregnan|schwanger/iu,breastfeeding:/breastfeed|nursing|stille|stillen/iu,eating_disorder:/eating disorder|essstörung|anorex|bulimi|binge|magersucht|ess-brech/iu};
 for(const [k,re] of Object.entries(flags))if(op[k]===true&&!re.test(message))throw Error('Say that yourself first');
 if(action==='settings'&&op.numbers!==undefined){
  const off=/(?<!\p{L})(?:stop|don.t|do not|no more|hide|without|nicht mehr|keine|ohne|aus|ausblenden)(?!\p{L})/iu.test(message),about=/calor|kalor|kcal|number|zahl/iu.test(message);
  if(!about||op.numbers===off)throw Error('Say whether to show the calories or not');
 }
 if(action==='talk'&&!/(?<!\p{L})(?:talk|gespräch|coach)/iu.test(message))throw Error('Say which talk may read your food tracker');
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
  'work-record-observation':/\b(?:record|log|save|notiere|speichere)\b[\s\S]*(?:check|review|observation|result|prüfung|ergebnis)/i,
  // "track" is the spoken word, never "log" (D-261, D-321).
  'tracker-hold':/\btrack(?:e|en|ing)?\b/i,
  // A yes may follow the answer to the one question asked with it ("250 g, and yes", D-321 step 5).
  'tracker-create':/^\s*(?:yes|yeah|yep|yup|sure|ok(?:ay)?|go ahead|do it|start it|ja|jo|klar|mach(?: das)?)\b|(?:,|\band\b|\bund\b)\s*(?:yes|yeah|yep|sure|ok(?:ay)?|ja|klar)\b|\b(?:i want to track|start tracking|new tracker|make a tracker|create a tracker|ich will .* tracken)\b/i,
  'track':/\btrack(?:e|ed|en)?\b/i,
  'tracker-correct':/\b(?:that was|it was|not \d|change|correct|fix|delete|remove|lösche|korrigiere|war)\b/i,
  // A headache, a pill or a pain level, with "track" or without (D-321: the tracker hands it on).
  'headache':/(?<!\p{L})(?:track|headache|migraine|kopfschmerz|kopfweh|migräne|pill|tablet|painkiller|schmerzmittel|ibuprofen|aspirin|paracetamol|thomapyrin|took|genommen|pain|schmerz)/iu,
  // The period and the cycle (D-321 step 4); what each action may write is checked below (cycleChecks).
  // What she eats (D-321 step 5): a meal, an amount, a preset, a correction, the day, the target, the
  // settings; what each action may write is checked below (foodChecks).
  'food':/(?<!\p{L})(?:track|food|meal|ate|eat|eaten|had|breakfast|lunch|dinner|supper|snack|essen|gegessen|frühstück|mittag|abend|calor|kalor|kcal|target|ziel|remember|merk|speicher|usual|wie immer|today|heute|what|was|were|war|delete|remove|lösch|entfern|show|zeig|stop|pregnan|schwanger|breastfeed|still|eating disorder|essstörung|talk|gespräch|yes|ja|\d)/iu,
  'cycle':/(?<!\p{L})(?:track|period|periode|regel|menstru|cycle|zyklus|cramp|krampf|krämpf|spotting|schmier|blut|bleed|pms|fertil|fruchtbar|ovulat|eisprung|pregnan|schwanger|still|breastfeed|pill|pille|contracept|verhüt|diagnos|delete|lösch|remove|entfern|heads|tell me|sag mir|bescheid|erinner|remind|warn|vorwarn|leave|weg|count|zähl|yes|ja|no|nein|over|vorbei|when|wann|next|nächste|talk|gespräch|ended|aufgehört)/iu
 };
 // What each operation does, in the words a person uses. A request that says
 // not to do that ("Don't remind me", "Please don't pause", "Erinnere mich
 // nicht") never authorises it; "Don't forget to remind me" still asks.
 // Until 7 October 2026 only a few verbs counted as refused (remember, save,
 // add...), and "Don't remind me to call Anna" made the reminder.
 const verbs={'goal-add':'set|add|adopt|create|remember|lege|speichere','goal-change':'change|pause|resume|retire|close|complete|update|ändere|pausiere|beende','goal-outcome':'record|save|log|update|speichere|notiere',
  'obligation-add':'remind|add|create|set|erinnere','obligation-complete':'complete|close|finish|mark|erledige|schließe','obligation-snooze':'snooze|postpone|move|delay|verschiebe',
  'coach-open':'start|open|begin|starte|beginne|öffne','coach-reply':'reply|answer|tell|record|antworte|notiere','coach-close':'close|finish|end|beende|schließe',
  'habit-agree':'agree|try|commit|stimme','habit-observe':'record|log|track|notiere','journal-add':'journal|write|record|log|notiere|schreibe','journal-switch':'enable|disable|turn|start|stop|switch|aktiviere|deaktiviere',
  'health-add':'record|log|save|track|notiere|speichere','memory-confirm':'remember|save|correct|update|merke|speichere|korrigiere','memory-propose':'remember|save|merke|speichere',
  'routine-change':'pause|resume|schedule|change|stop|start|move|pausiere|ändere|verschiebe','forecast-settle':'settle|record|resolve|log|notiere',
  'work-allow-local':'allow|approve|authori[sz]e|erlaube|genehmige','work-retry-draft':'retry|try|redo|wiederhole','work-record-observation':'record|log|save|notiere|speichere',
  'tracker-hold':'track|tracke','tracker-create':'track|create|start|make','track':'track|tracke','tracker-correct':'change|correct|fix|delete|remove|lösche|korrigiere','headache':'track|tracke|log|record|save|note|notiere|speichere','cycle':'track|tracke|delete|remove|lösche','food':'track|tracke|remember|save|merke|speichere|delete|remove|lösche|set|change'};
 const refuses=type=>{const v=verbs[type];if(!v)return false;
  return new RegExp("(?<!\\p{L})(?:do not|don.t|dont|never|must not|should not|niemals)(?!\\s+forget)\\s+(?:[\\p{L}']+\\s+){0,2}?(?:"+v+")",'iu').test(message)||new RegExp("(?<!\\p{L})(?:"+v+")\\p{L}*\\s+(?:(?:mich|mir|das|es|dies|ihn|sie|uns)\\s+)?nicht(?!\\p{L})",'iu').test(message);};
 for(const operation of operations){
  const quote=operation.source_quote;
  // A provider-selected substring cannot turn a refusal or hypothetical into permission.
  if(!quote||!message.includes(quote)||!intents[operation.type]?.test(quote)||!intents[operation.type]?.test(message)||refuses(operation.type)||/\b(?:do not|don.t|never|must not|should not|nicht|niemals)\s+(?:remember|save|add|create|allow|approve|authori[sz]e|edit|change|write|speichere|erlaube)/i.test(message)||/\b(?:if I|suppose|hypothetically|for example|someone said|quoted|wenn ich|beispielsweise)\b/i.test(message))throw Object.assign(Error('A proposed change needs your explicit request.'),{code:'UNAUTHORIZED_OPERATION',operation_type:operation.type,source_quote_matches:typeof quote==='string'&&message.includes(quote)});
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
  if(['track','tracker-correct'].includes(operation.type)){
   // Only an existing tracker, by its id or one of its names; an ordinary
   // collection of the same name is never one (trackers.mjs).
   if(!card(domains.store.get('collections',String(operation.tracker??'')))&&!findTracker(domains.store,operation.tracker).candidates.length&&!isHabitRef(domains.store,operation.tracker))throw Error('No tracker called '+operation.tracker);
   // A habit tracked as done while he says it was not, as habit-observe refuses it.
   if(habitTrack(domains,operation)&&(operation.answer??(operation.type==='track'?'done':undefined))==='done'&&/\b(?:did not|didn.t|haven.t|have not|not done|skipped|nicht|nein)\b/i.test(message))throw Error('Habit completion contradicts the actual user reply');
   if(operation.type==='track'&&typeof operation.new_name==='string'&&operation.new_name.trim()&&!message.toLocaleLowerCase().includes(operation.new_name.trim().toLocaleLowerCase()))throw Error('A new name must be one you used');
  }
  // A cycle day, its end, an answer about a cycle or a deletion must be what she said (cycleChecks).
  const cycle=cycleTracker(domains.store);
  const kept=foodTracker(domains.store);
  if(operation.type==='food')foodChecks(domains,message,operation);
  else if(operation.type==='track'&&kept&&(operation.tracker===kept.id||findTracker(domains.store,operation.tracker).match?.id===kept.id))foodChecks(domains,message,{...operation,action:'track'});
  if(operation.type==='tracker-create'&&operation.proposal_id&&domains.store.get('tracker_proposals',String(operation.proposal_id))?.specialist==='food')foodChecks(domains,message,{action:'answer',answers:operation.answers??[],...(operation.eating_disorder!==undefined?{eating_disorder:operation.eating_disorder}:{})});
  if(operation.type==='cycle')cycleChecks(domains,message,{...operation,action:operation.action||'track'});
  else if(operation.type==='tracker-hold'&&(operation.specialist==='cycle'||CYCLE_WORDS.test(String(operation.name||''))))cycleChecks(domains,message,{...operation,...(operation.data||{}),action:'track'});
  else if(operation.type==='track'&&cycle&&(operation.tracker===cycle.id||findTracker(domains.store,operation.tracker).match?.id===cycle.id))cycleChecks(domains,message,{...operation,...(operation.data||{}),action:operation.data?.ended===true||operation.ended===true?'over':'track'});
  if(['tracker-hold','track','tracker-correct','cycle','food'].includes(operation.type)){
   // The number saved must be a number he said, as a number of its own (a 9 is
   // not in "92"); "92,5" may arrive as 92.5.
   const said=v=>v===undefined||v===null||v===''||[String(v),String(v).replace('.',',')].some(x=>new RegExp('(?<![\\d.,])'+x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?!\\d|[.,]\\d)').test(message));
   if(!said(operation.value)||Object.values(operation.data||{}).some(v=>typeof v==='number'&&!said(v)))throw Error('A tracked value must be one you said');
   // Another day needs his word for it.
   if(operation.on&&!/\b(?:yesterday|gestern|vorgestern|today|heute|tomorrow|morgen|on \w+|am \w+|last \w+|letzten? \w+|\d{1,2}[./]\d{1,2}|\d{4}-\d\d-\d\d|\d{1,2}(?:st|nd|rd|th)?\s+[a-z]+|monday|tuesday|wednesday|thursday|friday|saturday|sunday|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/i.test(message))throw Error('Say which day if it was not today');
  }
  if(operation.type==='headache'){
   // What the headache tracker saves must be what he said (its recipe's rules, checked here):
   // a pain he gave as a number, digits or a word ("drei von zehn"); a time only when he named
   // one; every trigger, symptom and medicine in his own words (a medicine may be his usual one
   // when he only says "a pill").
   headacheArgs(operation);
   const lower=message.toLocaleLowerCase(),NUMBERS=['zero|null|kein','one|eins|einer?','two|zwei','three|drei','four|vier','five|fünf','six|sechs','seven|sieben','eight|acht','nine|neun','ten|zehn'];
   const pain=operation.pain;
   if(pain!==undefined&&pain!==null&&pain!==''){const n=Number(String(pain).replace(',','.')),digits=[String(pain),String(n),String(n).replace('.',',')].some(x=>new RegExp('(?<![\\d.,])'+x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?![\\d]|[.,]\\d)').test(message)),word=Number.isInteger(n)&&n>=0&&n<=10&&new RegExp('(?<!\\p{L})(?:'+NUMBERS[n]+')(?!\\p{L})','iu').test(message);if(!digits&&!word)throw Error('A pain level must be a number you said');}
   for(const key of ['at','from','to','taken'])if(operation[key]!==undefined&&operation[key]!==null&&!/^(?:now|jetzt)$/i.test(String(operation[key]).trim())&&!/\d|(?<!\p{L})(?:now|jetzt|ago|vor|since|seit|until|till|bis|um|at|from|von|morning|morgens?|noon|mittags?|afternoon|nachmittags?|evening|abends?|night|nachts?|yesterday|gestern|halb|viertel|o.clock|uhr|hour|stunde|minute)(?!\p{L})/iu.test(message))throw Error('Say when, if it was not now');
   const named=text=>String(text??'').toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w=>w.length>=4).some(w=>lower.includes(w.slice(0,5)));
   for(const key of ['triggers','symptoms'])for(const x of [].concat(operation[key]??[]))if(!named(x))throw Error('A '+(key==='triggers'?'trigger':'symptom')+' must be one you named');
   for(const m of [].concat(operation.meds??[]))if(!named(typeof m==='string'?m:m?.med)&&!/(?<!\p{L})(?:pill|tablet|tablette|painkiller|schmerzmittel|schmerztablette|medicine|medikament)/iu.test(message))throw Error('A medicine must be one you named');
  }
  if(operation.type==='tracker-create'&&operation.proposal_id&&proposalState(domains.store,domains.store.get('tracker_proposals',operation.proposal_id),clockNow())!=='pending')throw Error('That question has expired. Say it again and I will ask once more.');
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
// Which request this is, so a retry of it never runs twice and a new one always runs: its request
// id; else the user message with these words saved after the conversation's last answer (the one
// the caller saved for this request); else the words and that last answer. Until 12 October 2026
// it was the last message with these words, or the words alone, so the same words in one
// conversation were one request forever: "track walk to work" on Tuesday replayed Monday's result
// and wrote nothing (D-321). The same words before any answer was saved are still the same request.
export function requestIdentity(query,input,message){
 const mine=query.rows('conversation_messages').filter(m=>m.conversation_id===input.conversation_id).sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at))||String(a.id).localeCompare(String(b.id)));
 const answered=mine.filter(m=>m.role==='assistant').at(-1);
 const source=mine.filter(m=>m.role==='user'&&m.content===message&&(!answered||String(m.created_at)>=String(answered.created_at))).at(-1);
 return {source,requestId:input.request_id||source?.id||hash([input.conversation_id,message,answered?.id||null])};
}
export function conversationOperations(domains,input,operations){
 if(!Array.isArray(operations)||operations.length>10)throw Error('Invalid conversation operations');
 const message=String(input.message||input.messages?.filter(m=>m.role==='user').at(-1)?.content||'');
 const {source,requestId}=requestIdentity(domains.query,input,message);
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
