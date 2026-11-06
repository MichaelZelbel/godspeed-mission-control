import fs from 'node:fs';
import path from 'node:path';
import {atomic,hash} from './records/store.mjs';
import {hermesJobs,pausedJob} from './native-scheduler.mjs';
import {routineStatus} from './starting-routines.mjs';
import {readNotebookRoutines,CONNECTION_SCRIPT} from './notebook-routines.mjs';
import {cronOf,cronCalendar} from './routine-times.mjs';
import {tellOwner} from './connection-check.mjs';
import {CONNECTION_NOTICE_PREFIX} from './connection-names.mjs';
import {AI_SIGN_IN,scrubCredentials} from './runtime.mjs';

// "YOUR ROUTINES" AS THE DAILY CONNECTION CHECK'S SECOND SOURCE (5 November 2026, #239). A routine
// that stopped running or keeps failing (the morning brief, the coach, the backup) showed only as a
// status in Settings > Routines, and the owner found out days later. Every morning this reads
// Hermes' own jobs list (no call to anything) and tells the owner once, in one message for all of
// them, about each routine that did not run when it was due or whose last two runs failed. A spell
// ends on the routine's first good run; a later failure is told again.
//
// It is not one of connection-check.mjs's probes: a probe answers {set_up, ok, kind} for one
// connection and may become a deadline, and this is per routine and gives the owner no task. It keeps
// its own record, .godspeed/connection-check-routines.json: {routines:{<job id>:{spell}}}. A damaged
// record reads as empty; the worst effect is one extra message.
export const ROUTINES_RECORD_FILE='connection-check-routines.json';
const HOUR=3600000,DAY=24*HOUR;

const time=value=>{const at=Date.parse(value);return Number.isFinite(at)?at:null;};
const all=(count,from=0)=>new Set(Array.from({length:count},(_,index)=>index+from));
const errorWords=text=>{const said=/\bstderr:\s*\n\s*(\S[^\n]*)/.exec(String(text||''));return scrubCredentials((said?said[1]:String(text||'').split(/\r?\n/).find(l=>l.trim())||'').trim()).slice(0,200);};

// The time Hermes gives a late tick before a run counts as missed: half the period, between 2 minutes and 2 hours (Hermes' own catch-up grace).
function slackFor(job,interval=DAY){
 interval=job.schedule?.kind==='interval'&&job.schedule.minutes>0?job.schedule.minutes*60000:interval;
 return Math.min(2*HOUR,Math.max(120000,interval/2));
}
const datePartsFormatters=new Map();
const localParts=(at,timezone)=>{
 let formatter=datePartsFormatters.get(timezone);if(!formatter){formatter=new Intl.DateTimeFormat('en-GB',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});datePartsFormatters.set(timezone,formatter);}
 return Object.fromEntries(formatter.formatToParts(new Date(at)).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
};
function cronSchedule(job){
 const fields=cronOf(job).split(/\s+/);
 if(fields.join(' ')==='*/15 * * * *')return {minutes:new Set([0,15,30,45]),hours:all(24),days:all(31,1),months:all(12,1),weekdays:all(7),seconds:new Set([0]),daysAny:true,weekdaysAny:true};
 const [minute,hour,monthDay,month,weekday,second,...rest]=fields;if(rest.length||!minute||!hour||!monthDay||!month||!weekday||(second!==undefined&&(!/^\d{1,2}$/.test(second)||Number(second)>59)))return null;
 const calendar=cronCalendar([minute,hour,monthDay,month,weekday].join(' '));
 if(calendar){
  const times=calendar.times.map(t=>t.split(':').map(Number)),daysAny=calendar.month_day===null,weekdays=new Set(calendar.weekdays);
  return {minutes:new Set(times.map(([,minute])=>minute)),hours:new Set(times.map(([hour])=>hour)),days:new Set(daysAny?all(31,1):[calendar.month_day]),months:all(12,1),weekdays,seconds:new Set([Number(second||0)]),daysAny,weekdaysAny:weekdays.size===7};
 }
 return null;
}
function cronMinuteDue(schedule,local){
 const weekday=new Date(Date.UTC(local.year,local.month-1,local.day)).getUTCDay(),dayMatches=schedule.days.has(local.day),weekdayMatches=schedule.weekdays.has(weekday);
 const dayDue=schedule.daysAny&&schedule.weekdaysAny||schedule.daysAny?weekdayMatches:schedule.weekdaysAny?dayMatches:dayMatches||weekdayMatches;
 return schedule.minutes.has(local.minute)&&schedule.hours.has(local.hour)&&schedule.months.has(local.month)&&dayDue;
}
function cronGapDays(schedule){
 if(schedule.daysAny)return schedule.weekdaysAny?1:7;
 if(!schedule.weekdaysAny)return 7;
 const day=[...schedule.days][0];return day<=28?31:day+30;
}
function previousCronDue(job,before,timezone){
 const schedule=cronSchedule(job);if(!schedule)return null;
 const seconds=[...schedule.seconds].sort((a,b)=>b-a),gap=cronGapDays(schedule);let days=0,previousDay=null;
 for(let at=Math.floor((before-1)/60000)*60000;;at-=60000){
  const local=localParts(at,timezone),day=`${local.year}-${local.month}-${local.day}`;
  if(day!==previousDay){if(previousDay!==null&&++days>gap)return null;previousDay=day;}
  if(!cronMinuteDue(schedule,local))continue;
  for(const second of seconds){const due=at+second*1000;if(due<before)return due;}
 }
}
function missed(job,{now,day,timezone}){
 if(job.schedule?.kind==='once'||job.state==='completed')return null;
 const dueAt=time(job.next_run_at),ranAt=time(job.last_run_at);
 if(dueAt===null)return null;
 const interval=job.schedule?.kind==='interval'&&job.schedule.minutes>0?job.schedule.minutes*60000:null;
 const expected=interval?(dueAt<=now?dueAt:dueAt-Math.ceil((dueAt-now+1)/interval)*interval):(dueAt<=now?dueAt:previousCronDue(job,Math.min(dueAt,now),timezone));
 const prior=expected===null?null:interval?expected-interval:previousCronDue(job,expected,timezone);
 const createdAt=time(job.created_at);
 if(expected===null||prior===null||now<=expected+slackFor(job,interval||expected-prior))return null;
 if(ranAt===null)return dayOf(job.created_at,timezone)!==day&&createdAt!==null&&createdAt<expected?expected:null;
 return ranAt<expected?expected:null;
}
const dayOf=(value,timezone)=>time(value)===null?null:new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
const when=(value,timezone)=>new Intl.DateTimeFormat('en-GB',{timeZone:timezone,weekday:'long',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));

// One routine's turn. `job` carries the status Settings shows. Returns the routine's new record and,
// when the owner is to be told, {words, spell}; the spell is kept only once it is told.
export function routineFinding(job,prev={},{now,day,timezone}){
 const name=job.name||job.id,{error_run:_legacy,ok_at:_oldOk,failed_at:_oldFailure,...entry}=prev;
 if(pausedJob(job))return {entry,found:null};
 const ranAt=time(job.last_run_at),good=job.last_status==='ok'&&ranAt!==null,errored=job.last_status==='error';
 if(entry.spell&&good&&ranAt>(time(entry.spell.run)??0))delete entry.spell;
 // Hermes counts failures it recorded itself. Starting routines instead keep their actual consecutive
 // failures in the status sidecar, so two runs between daily checks still count as two.
 const twice=errored&&job.failure_streak>=2;
 if(entry.spell)return {entry,found:null};
 let kind=null,missedAt=null;
 if(errored){if(twice&&!AI_SIGN_IN.test(String(job.last_error||'')))kind='failing';}
 else if((missedAt=missed(job,{now,day,timezone}))!==null)kind='missed';
 if(!kind)return {entry,found:null};
 const sentences=[kind==='missed'?`"${name}" did not run when it was due ${when(missedAt,timezone)}.`:`"${name}" failed its last two runs${errorWords(job.last_error)?': '+errorWords(job.last_error):''}.`];
 sentences.push(kind==='missed'?'It runs again at its next time.':'It tries again at its next time.');
 return {entry,found:{words:sentences.join(' '),spell:{kind,since:day,run:job.last_run_at||null}}};
}

function readRecord(store){
 try{const data=JSON.parse(fs.readFileSync(path.join(store.state,ROUTINES_RECORD_FILE),'utf8'));if(data&&typeof data.routines==='object'&&data.routines&&!Array.isArray(data.routines))return data.routines;}catch{}
 return {};
}

// Reads the jobs list, tells the owner of everything newly found in one message, and writes the record.
// Throws after writing it when the message could not be queued; a routine found this time keeps the entry it had before, so the next run finds it again and tells it.
export function checkRoutines({store,home,day,timezone,now=()=>new Date(),jobs=hermesJobs(home)}){
 const before=readRecord(store),routines={},found=[],own=readNotebookRoutines(store).jobs.find(j=>j.key==='connection-check')?.id;
 for(const job of jobs){
  if(!job.id||job.id===own||job.script===CONNECTION_SCRIPT)continue;
  const shown={...job,hermes_status:job.last_status,...routineStatus(home,job)};
  const result=routineFinding(shown,before[job.id],{now:now().getTime(),day,timezone});
  routines[job.id]=result.entry;
  if(result.found)found.push({id:job.id,...result.found});
 }
 let failed=false;
 if(found.length){
  const sentences=found.map(f=>f.words),text=found.length>1?'Some of your routines did not run right: '+sentences.join(' '):sentences[0];
  const id=`${CONNECTION_NOTICE_PREFIX}routines-${day}-${hash(found.map(f=>f.id+f.spell.since+f.spell.run).sort().join('|')).slice(0,12)}`;
  try{tellOwner(store,{id,text,about:'Routines of yours that did not run right',facts:sentences});for(const f of found)routines[f.id].spell=f.spell;}
  catch{failed=true;for(const f of found){if(before[f.id]){const {error_run:_legacy,ok_at:_oldOk,failed_at:_oldFailure,...prior}=before[f.id];routines[f.id]=prior;}else delete routines[f.id];}}
 }
 atomic(path.join(store.state,ROUTINES_RECORD_FILE),JSON.stringify({routines},null,2)+'\n');
 if(failed)throw new Error('The routines notice could not be queued');
 return {routines,told:found.map(f=>f.id)};
}
