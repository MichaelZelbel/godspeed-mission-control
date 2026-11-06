import fs from 'node:fs';
import path from 'node:path';
import {atomic,hash} from './records/store.mjs';
import {hermesJobs,pausedJob} from './native-scheduler.mjs';
import {routineStatus} from './starting-routines.mjs';
import {readNotebookRoutines,CONNECTION_SCRIPT} from './notebook-routines.mjs';
import {cronOf} from './routine-times.mjs';
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
// its own record, .godspeed/connection-check-routines.json: {routines:{<job id>:{failed_at, spell}}}.
// failed_at is the run of a failure only the status record shows (see twice, below). A damaged record reads as empty; the worst effect is one extra message.
export const ROUTINES_RECORD_FILE='connection-check-routines.json';
const HOUR=3600000,DAY=24*HOUR;

const time=value=>{const at=Date.parse(value);return Number.isFinite(at)?at:null;};
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
const CRON_NAMES={month:{jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12},weekday:{sun:0,mon:1,tue:2,wed:3,thu:4,fri:5,sat:6}};
function cronPart(words,min,max,names={}){
 const values=new Set(),number=value=>{const named=names[String(value).toLowerCase()];const n=named===undefined?Number(value):named;return Number.isInteger(n)&&n>=min&&n<=max?n:null;};
 for(const word of words.split(',')){
  const [range,by='1',...rest]=word.split('/'),step=Number(by);if(rest.length||!Number.isInteger(step)||step<1) return null;
  let start=min,end=max;
  if(range!=='*'){
   const [first,last,...more]=range.split('-');if(more.length)return null;
   start=number(first);end=last===undefined?start:number(last);if(start===null||end===null||end<start)return null;
  }
  for(let n=start;n<=end;n+=step)values.add(n);
 }
 return values;
}
function cronSchedule(job){
 const [minute,hour,monthDay,month,weekday,second,...rest]=cronOf(job).trim().split(/\s+/);if(rest.length||!minute||!hour||!monthDay||!month||!weekday)return null;
 const fields=[[minute,0,59],[hour,0,23],[monthDay,1,31],[month,1,12,CRON_NAMES.month],[weekday,0,7,CRON_NAMES.weekday],[second||'0',0,59]].map(([words,min,max,names])=>cronPart(words==='?'?'*':words,min,max,names));
 if(fields.some(f=>f===null))return null;
 const [minutes,hours,days,months,weekdays,seconds]=fields;if(weekdays.has(7)){weekdays.delete(7);weekdays.add(0);}
 const daysAny=days.size===31,weekdaysAny=weekdays.size===7;
 // Missed-run checks recognize the calendar forms Settings and the starting routines create: every
 // month, every day or one day of the month, and optional weekdays. Other Hermes cron forms stay
 // quiet for missed runs; their recorded failures are still checked below.
 if(months.size!==12||!daysAny&&days.size!==1)return null;
 return {minutes,hours,days,months,weekdays,seconds,daysAny,weekdaysAny};
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
 const name=job.name||job.id,{error_run:_legacy,ok_at:_oldOk,...entry}=prev;
 if(pausedJob(job))return {entry,found:null};
 const ranAt=time(job.last_run_at),good=job.last_status==='ok'&&ranAt!==null,errored=job.last_status==='error';
 if(entry.spell&&good&&ranAt>(time(entry.spell.run)??0))delete entry.spell;
 // Hermes counts the failures it recorded itself. A starting routine's failure is recorded as a good run
 // and shown from its status record (routineStatus), so Hermes' count is 0 and two such failures are
 // known only by this record: the failed run seen at an earlier check, with no good run since.
 const seen=time(entry.failed_at),sidecar=errored&&job.hermes_status!=='error';
 if(good||!sidecar)delete entry.failed_at;
 if(sidecar&&ranAt!==null)entry.failed_at=job.last_run_at;
 const twice=errored&&(sidecar?seen!==null&&ranAt!==null&&seen<ranAt:job.failure_streak>=2);
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
  catch{failed=true;for(const f of found){if(before[f.id]){const {error_run:_legacy,ok_at:_oldOk,...prior}=before[f.id];routines[f.id]=prior;}else delete routines[f.id];}}
 }
 atomic(path.join(store.state,ROUTINES_RECORD_FILE),JSON.stringify({routines},null,2)+'\n');
 if(failed)throw new Error('The routines notice could not be queued');
 return {routines,told:found.map(f=>f.id)};
}
