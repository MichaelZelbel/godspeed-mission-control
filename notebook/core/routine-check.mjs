import fs from 'node:fs';
import path from 'node:path';
import {atomic,hash} from './records/store.mjs';
import {hermesJobs,pausedJob} from './native-scheduler.mjs';
import {routineStatus} from './starting-routines.mjs';
import {readNotebookRoutines,CONNECTION_SCRIPT} from './notebook-routines.mjs';
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
// its own record, .godspeed/connection-check-routines.json: {routines:{<job id>:{ok_at, failed_at, spell}}}.
// failed_at is the run of a failure only the status record shows (see twice, below). A damaged record reads as empty; the worst effect is one extra message.
export const ROUTINES_RECORD_FILE='connection-check-routines.json';
const HOUR=3600000,DAY=24*HOUR;

const time=value=>{const at=Date.parse(value);return Number.isFinite(at)?at:null;};
const errorWords=text=>{const said=/\bstderr:\s*\n\s*(\S[^\n]*)/.exec(String(text||''));return scrubCredentials((said?said[1]:String(text||'').split(/\r?\n/).find(l=>l.trim())||'').trim()).slice(0,200);};

// The time Hermes gives a late tick before a run counts as missed: half the period, between 2 minutes and 2 hours (Hermes' own catch-up grace).
function slackFor(job,dueAt){
 const interval=job.schedule?.kind==='interval'&&job.schedule.minutes>0?job.schedule.minutes*60000:(time(job.last_run_at)!==null&&dueAt>time(job.last_run_at)?dueAt-time(job.last_run_at):DAY);
 return Math.min(2*HOUR,Math.max(120000,interval/2));
}
function missed(job,{now,day,timezone}){
 if(job.schedule?.kind==='once'||job.state==='completed')return false;
 const dueAt=time(job.next_run_at),ranAt=time(job.last_run_at);
 if(dueAt===null||now<=dueAt+slackFor(job,dueAt))return false;
 if(ranAt===null)return dayOf(job.created_at,timezone)!==day;
 return ranAt<dueAt;
}
const dayOf=(value,timezone)=>time(value)===null?null:new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
const when=(value,timezone)=>new Intl.DateTimeFormat('en-GB',{timeZone:timezone,weekday:'long',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));

// One routine's turn. `job` carries the status Settings shows. Returns the routine's new record and,
// when the owner is to be told, {words, spell}; the spell is kept only once it is told.
export function routineFinding(job,prev={},{now,day,timezone}){
 const name=job.name||job.id,{error_run:_legacy,...entry}=prev;
 if(pausedJob(job))return {entry,found:null};
 const ranAt=time(job.last_run_at),good=job.last_status==='ok'&&ranAt!==null,errored=job.last_status==='error';
 if(good)entry.ok_at=job.last_run_at;
 if(entry.spell&&good&&ranAt>(time(entry.spell.run)??0))delete entry.spell;
 // Hermes counts the failures it recorded itself. A starting routine's failure is recorded as a good run
 // and shown from its status record (routineStatus), so Hermes' count is 0 and two such failures are
 // known only by this record: the failed run seen at an earlier check, with no good run since.
 const seen=time(entry.failed_at),sidecar=errored&&job.hermes_status!=='error';
 if(good||!sidecar)delete entry.failed_at;
 if(sidecar&&ranAt!==null)entry.failed_at=job.last_run_at;
 const twice=errored&&(sidecar?seen!==null&&ranAt!==null&&seen<ranAt:job.failure_streak>=2);
 if(entry.spell)return {entry,found:null};
 let kind=null;
 if(errored){if(twice&&!AI_SIGN_IN.test(String(job.last_error||'')))kind='failing';}
 else if(missed(job,{now,day,timezone}))kind='missed';
 if(!kind)return {entry,found:null};
 const sentences=[kind==='missed'?`"${name}" did not run when it was due ${when(job.next_run_at,timezone)}.`:`"${name}" failed its last two runs${errorWords(job.last_error)?': '+errorWords(job.last_error):''}.`];
 if(entry.ok_at)sentences.push(`It last ran right ${when(entry.ok_at,timezone)}.`);
 sentences.push(kind==='missed'?'It runs again at its next time.':'It tries again at its next time.');
 return {entry,found:{words:sentences.join(' '),spell:{kind,since:day,run:job.last_run_at||null}}};
}

function readRecord(store){
 try{const data=JSON.parse(fs.readFileSync(path.join(store.state,ROUTINES_RECORD_FILE),'utf8'));if(data&&typeof data.routines==='object'&&data.routines&&!Array.isArray(data.routines))return data.routines;}catch{}
 return {};
}

// Reads the jobs list, tells the owner of everything newly found in one message, and writes the record.
// Throws after writing it when the message could not be queued, so the routine reports the failure and the next run tells it.
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
  catch{failed=true;}
 }
 atomic(path.join(store.state,ROUTINES_RECORD_FILE),JSON.stringify({routines},null,2)+'\n');
 if(failed)throw new Error('The routines notice could not be queued');
 return {routines,told:found.map(f=>f.id)};
}
