// ROUTINE TIMES FOR HERMES' ROUTINES (18 October 2026). Settings > Routine times sent a calendar
// time for every routine it listed, and with the original assistant the notebook refused it for
// all of them ("Choose whether to pause an existing Hermes task"), so the six routines a first goal
// starts could not be moved from Settings. A Hermes routine's time is its cron line; this file
// turns that line into the form's calendar and back. The weekly check-in is a coach talk whose own
// day and time live in the coach's area (its Hermes job only looks every 15 minutes whether a talk
// is due), so moving it changes the area; the coach's reminders have no time of their own.
import {findArea,listAreas,setAreaField} from '../../third-party/addons/godspeed-coach/lib/areas.mjs';
import {NOTEBOOK_TALK_JOB,NOTEBOOK_TICK_JOB,TALK_JOB,TICK_JOB} from '../../third-party/addons/godspeed-coach/lib/setup.mjs';

const two=n=>String(n).padStart(2,'0');
const DAY_NAMES=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
export const isTalkGate=job=>[NOTEBOOK_TALK_JOB,TALK_JOB].includes(String(job?.name||job?.title||''));
export const isCoachTick=job=>[NOTEBOOK_TICK_JOB,TICK_JOB].includes(String(job?.name||job?.title||''));
// The cron line Hermes keeps for a job: its schedule's expression, else what it displays.
export const cronOf=job=>String(job?.schedule?.kind==='cron'&&job.schedule.expr||job?.schedule_display||(typeof job?.schedule==='string'?job.schedule:'')||'').trim();

// "30 5 * * *", "0 10,16 * * 1,3,5", "0 9 15 * *" as {times, weekdays, month_day}; null for anything
// else (an interval, every 15 minutes, a range), which has no calendar time to change.
export function cronCalendar(expr){
 const parts=String(expr||'').trim().split(/\s+/);if(parts.length!==5)return null;
 const [minute,hour,dom,month,dow]=parts;
 if(!/^\d{1,2}$/.test(minute)||!/^\d{1,2}(,\d{1,2})*$/.test(hour)||month!=='*')return null;
 const m=Number(minute),hours=hour.split(',').map(Number);if(m>59||hours.some(h=>h>23))return null;
 const times=hours.map(h=>two(h)+':'+two(m));
 if(dom==='*'&&dow==='*')return {times,weekdays:[0,1,2,3,4,5,6],month_day:null};
 if(dom==='*'&&/^[0-7](,[0-7])*$/.test(dow))return {times,weekdays:[...new Set(dow.split(',').map(d=>Number(d)%7))].sort((a,b)=>a-b),month_day:null};
 if(dom==='*'&&dow==='1-5')return {times,weekdays:[1,2,3,4,5],month_day:null};
 if(/^\d{1,2}$/.test(dom)&&Number(dom)>=1&&Number(dom)<=31&&dow==='*')return {times,weekdays:[0,1,2,3,4,5,6],month_day:Number(dom)};
 return null;
}

// The form's calendar as a cron line. Several times share one minute ("10:00 and 16:00"), since one
// cron line has one minute; other times are refused in words the person can act on.
export function calendarCron(calendar){
 const times=[...new Set((Array.isArray(calendar?.times)?calendar.times:[calendar?.time]).map(t=>String(t||'').trim()).filter(Boolean))];
 if(!times.length||times.some(t=>!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)))throw Error('Give a time written like 07:30');
 const minutes=new Set(times.map(t=>t.slice(3)));
 if(minutes.size>1)throw Error('Several times in one day need the same minutes past the hour, like 10:00 and 16:00');
 const hours=[...new Set(times.map(t=>Number(t.slice(0,2))))].sort((a,b)=>a-b),minute=Number(times[0].slice(3));
 const days=calendar?.weekdays===undefined||calendar?.weekdays===null?[0,1,2,3,4,5,6]:calendar.weekdays;
 if(!Array.isArray(days)||!days.length||days.some(d=>!Number.isInteger(d)||d<0||d>6))throw Error('Choose the days as numbers, Sunday 0 through Saturday 6');
 const weekdays=[...new Set(days)].sort((a,b)=>a-b);
 const monthDay=calendar?.month_day===undefined||calendar?.month_day===null||calendar?.month_day===''?null:Number(calendar.month_day);
 if(monthDay!==null&&(!Number.isInteger(monthDay)||monthDay<1||monthDay>31))throw Error('Choose a day of the month from 1 to 31');
 if(monthDay!==null&&weekdays.length!==7)throw Error('A monthly time runs on its day of the month whatever the weekday: leave every weekday chosen');
 return minute+' '+hours.join(',')+' '+(monthDay??'*')+' * '+(weekdays.length===7?'*':weekdays.join(','));
}

// A routine's sentence names its old clock time ("Every morning at 05:30 it picks ..."); moved, it
// names the new one, so the row never says two different times.
export function retimeWhat(what,oldTimes,newTimes){
 if(typeof what!=='string'||!what||!oldTimes?.length)return what;
 const words=list=>list.length<2?list.join(''):list.slice(0,-1).join(', ')+' and '+list.at(-1);
 const escaped=oldTimes.map(t=>t.replace(':','\\:'));
 const pattern=new RegExp(escaped.join('(?:,\\s*| and )'));
 return pattern.test(what)?what.replace(pattern,words(newTimes)):what;
}

// The weekly check-in's own day and time (the coach's area), as the form's calendar; the one area a
// talk gate opens when there is only one, else the weekly check-in's.
export function talkArea(root,slug='weekly-check-in'){
 let areas=[];try{areas=listAreas(root).filter(a=>a.on&&a.rhythm);}catch{}
 return areas.length===1?areas[0]:findArea(root,slug)||null;
}
export function talkCalendar(area){
 if(!area?.rhythm)return null;
 const r=area.rhythm,names={sun:0,mon:1,tue:2,wed:3,thu:4,fri:5,sat:6};
 if(r.kind==='daily')return {times:[area.time],weekdays:[0,1,2,3,4,5,6],month_day:null};
 if(r.kind==='monthly')return {times:[area.time],weekdays:[0,1,2,3,4,5,6],month_day:r.day};
 if(r.kind==='weeks'&&r.every===1)return {times:[area.time],weekdays:[names[r.day]],month_day:null};
 return null;
}
// Moves a talk: one weekday is weekly on that day, every day is daily, a day of the month monthly.
export function moveTalk(area,calendar){
 const times=Array.isArray(calendar?.times)?calendar.times:[calendar?.time];
 if(times.length!==1||!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(times[0])))throw Error('A talk has one time a day, written like 18:00');
 const days=Array.isArray(calendar?.weekdays)?[...new Set(calendar.weekdays)]:[0,1,2,3,4,5,6];
 const monthDay=calendar?.month_day===undefined||calendar?.month_day===null||calendar?.month_day===''?null:Number(calendar.month_day);
 let rhythm;
 if(monthDay!==null){if(!Number.isInteger(monthDay)||monthDay<1||monthDay>28)throw Error('A monthly talk takes a day from 1 to 28');rhythm='monthly '+monthDay;}
 else if(days.length===7)rhythm='daily';
 else if(days.length===1&&Number.isInteger(days[0])&&days[0]>=0&&days[0]<=6)rhythm='weekly '+DAY_NAMES[days[0]];
 else throw Error('A talk is every day, on one weekday, or on one day of the month');
 setAreaField(area,'RHYTHM',rhythm);return setAreaField(area,'TIME',times[0]);
}
