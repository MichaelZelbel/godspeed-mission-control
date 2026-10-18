import test from 'node:test';
import assert from 'node:assert/strict';
import {nextCalendarRun} from '../core/jobs/calendar.mjs';
test('calendar respects Berlin weekdays and daylight saving gap without duplicate replay',()=>{
 const job={calendar:{time:'09:00',weekdays:[1,2,3,4,5]}};
 assert.equal(nextCalendarRun(job,'Europe/Berlin',Date.parse('2026-10-23T08:00:00Z')),'2026-10-26T08:00:00.000Z');
 const spring={calendar:{time:'02:30',weekdays:[0]}};
 assert.equal(nextCalendarRun(spring,'Europe/Berlin',Date.parse('2026-03-28T23:00:00Z')),'2026-03-29T01:00:00.000Z');
 const fall={calendar:{time:'02:30',weekdays:[0]}};
 assert.equal(nextCalendarRun(fall,'Europe/Berlin',Date.parse('2026-10-25T00:31:00Z')),'2026-11-01T01:30:00.000Z');
});
test('monthly schedules retain their chosen day across short months and skip a second run in the same month',()=>{
 const job={calendar:{time:'09:00',month_day:31}};
 assert.equal(nextCalendarRun(job,'Europe/Berlin',Date.parse('2026-01-31T08:01:00Z')),'2026-02-28T08:00:00.000Z');
 assert.equal(nextCalendarRun(job,'Europe/Berlin',Date.parse('2026-02-28T08:01:00Z')),'2026-03-31T07:00:00.000Z');
 assert.throws(()=>nextCalendarRun({calendar:{time:'09:00',month_day:32}},'UTC'),/calendar/);
});

// The minute-by-minute search this replaced (until 6 October 2026), kept as
// the reference: the new one must name exactly the same minute.
function reference(job,timezone,after){
 const {time,weekdays=[0,1,2,3,4,5,6],month_day}=job.calendar;
 const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',weekday:'short',hourCycle:'h23'}),seen=new Set(),names=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
 for(let t=Math.floor((after-2*86400000)/60000)*60000;t<after+(month_day?40:16)*86400000;t+=60000){
  const p=Object.fromEntries(formatter.formatToParts(t).map(v=>[v.type,v.value])),day=p.year+'-'+p.month+'-'+p.day;
  if(month_day&&Number(p.day)!==Math.min(month_day,new Date(Date.UTC(Number(p.year),Number(p.month),0)).getUTCDate()))continue;
  if(seen.has(day)||!weekdays.includes(names.indexOf(p.weekday))||p.hour+':'+p.minute<time)continue;
  seen.add(day);if(t>after)return new Date(t).toISOString();
 }
}
test('the day-by-day calendar names the same minute as the minute-by-minute one, across clock changes',()=>{
 // Each zone around a day its clock changes in 2026 (half-hour and 45-minute zones included).
 const cases=[['Europe/Berlin','2026-03-29T00:30:00Z'],['Europe/Berlin','2026-10-25T00:31:00Z'],['America/New_York','2026-03-08T06:59:00Z'],['America/New_York','2026-11-01T05:30:00Z'],['Australia/Sydney','2026-04-04T15:00:00Z'],['Australia/Lord_Howe','2026-10-03T15:10:00Z'],['America/Santiago','2026-04-05T02:00:00Z'],['Pacific/Chatham','2026-04-04T13:00:00Z'],['Asia/Kathmandu','2026-10-06T06:00:00Z'],['UTC','2026-12-31T23:59:00Z']];
 // The reference is slow, so a sample runs here; all 7 times x 3 weekday sets of
 // each case, chained and monthly too, were compared once when it was written.
 const times=['00:30','02:30','23:30'];let compared=0;
 for(const [i,[zone,at]] of cases.entries())for(const [j,time] of times.entries()){
  const after=Date.parse(at),calendar=(i+j)%3===0?{time,weekdays:[0]}:{time};
  const next=nextCalendarRun({calendar},zone,after);assert.equal(next,reference({calendar},zone,after),zone+' '+time+' '+JSON.stringify(calendar)+' after '+at);compared++;
 }
 const calendar={time:'02:30',month_day:31};assert.equal(nextCalendarRun({calendar},'Europe/Berlin',Date.parse('2026-01-31T08:01:00Z')),reference({calendar},'Europe/Berlin',Date.parse('2026-01-31T08:01:00Z')));
 assert.equal(compared,30);
});
test('a monthly schedule is found in milliseconds, not seconds',()=>{
 const started=performance.now();
 for(let i=0;i<20;i++)nextCalendarRun({calendar:{time:'05:16',month_day:31}},'Europe/Berlin',Date.parse('2026-10-31T06:00:00Z'));
 const each=(performance.now()-started)/20;assert.ok(each<100,'a monthly schedule took '+each.toFixed(1)+' ms');
});
