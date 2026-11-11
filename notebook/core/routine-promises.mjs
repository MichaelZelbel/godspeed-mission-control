import fs from 'node:fs';
import path from 'node:path';
import {cronCalendar} from './routine-times.mjs';

// The promise of a routine setup schedules, written beside the person's own in work/promises/ (the
// format is that folder's README, the checker tools/promises.js). Its proof is the stamp the
// routine runner writes after every run that ended well (godspeed_routines.py, stamp): a quiet
// routine and one that never ran then look different.
//
// Never over a promise that is already there, whatever the person did to it: one named for the
// routine, or one that says ROUTINE: <kind>, keeps every byte. A mission control without the
// folder gets nothing at all, not even the folder.

const WEEKDAY_NAMES=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];

// A routine's schedule as a promise's CADENCE and the first word and time of its DUE, or null for a
// schedule no promise can carry (some weekdays only, an interval, a month day past the 28th).
export function promiseDue(schedule){
 const every=String(schedule||'').trim().match(/^\*\/(\d{1,2}) \* \* \* \*$/);
 if(every)return Number(every[1])>=1&&Number(every[1])<=60?{cadence:'daily',when:'daily',time:'00:00'}:null;
 const calendar=cronCalendar(schedule);if(!calendar)return null;
 const time=calendar.times[0];
 if(calendar.month_day!==null)return calendar.month_day<=28&&calendar.weekdays.length===7?{cadence:'monthly',when:String(calendar.month_day),time}:null;
 if(calendar.weekdays.length===7)return {cadence:'daily',when:'daily',time};
 if(calendar.weekdays.length===1)return {cadence:'weekly',when:WEEKDAY_NAMES[calendar.weekdays[0]],time};
 return null;
}

const dayIn=(date,timezone)=>new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
const plain=text=>String(text||'').replace(/\s*\u2014\s*/g,', ').replace(/[\r\n]+/g,' ').trim();
function firstSentence(text){const t=plain(text),m=t.match(/^.*?[.!?](?=\s|$)/),s=m?m[0]:t;return s.length<=200?s:s.slice(0,200).replace(/\s+\S*$/,'');}

// 'written', or why not: 'kept' (a promise for it is there), 'no-folder', 'unsupported'.
export function writeRoutinePromise(root,{kind,name,what,schedule,timezone,now=new Date()}){
 const dir=path.join(root,'work','promises');
 if(!fs.statSync(dir,{throwIfNoEntry:false})?.isDirectory())return 'no-folder';
 const file='routine-'+kind+'.md',claim='ROUTINE: '+kind;
 for(const other of fs.readdirSync(dir).filter(n=>n.endsWith('.md')&&n!=='README.md')){
  if(other===file)return 'kept';
  try{if(fs.readFileSync(path.join(dir,other),'utf8').split(/\r?\n/).some(line=>line.trim()===claim))return 'kept';}catch{}
 }
 const due=promiseDue(schedule);if(!due)return 'unsupported';
 const today=dayIn(now,timezone),tomorrow=dayIn(new Date(now.getTime()+86400000),timezone),title=plain(name);
 const text=['# '+title,'','PROMISE: routine-'+kind,'PROMISED ON: '+today,'WHAT YOU GET: '+firstSentence(what),'CADENCE: '+due.cadence,
  'DUE: '+due.when+' '+due.time+' '+timezone,'GRACE: 12','STARTED: '+tomorrow,
  'RUNS IT: the routine "'+title+'" ('+schedule+'), which setup made on '+today,claim,'PROOF: dates-in routines/ran/'+kind+'.txt',
  '','## Log','- '+today+' written by setup when it made the routine',''].join('\n');
 try{fs.writeFileSync(path.join(dir,file),text,{flag:'wx'});}catch(error){if(error.code==='EEXIST')return 'kept';throw error;}
 return 'written';
}
