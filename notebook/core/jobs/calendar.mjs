// Calendar schedules use the first matching wall-clock minute per local day.
// A missing DST minute runs at the first later minute; an ambiguous minute runs once.
export function nextCalendarRun(job,timezone='UTC',after=Date.now()){
 if(!job.calendar)return new Date(after+(job.interval_ms||86400000)).toISOString();
 const {time,weekdays=[0,1,2,3,4,5,6]}=job.calendar;
 if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)||!weekdays.length||weekdays.some(d=>!Number.isInteger(d)||d<0||d>6))throw Error('Invalid calendar schedule');
 const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',weekday:'short',hourCycle:'h23'}),seen=new Set(),names=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
 // Start before the current local day to remember its first (possibly ambiguous) time.
 for(let t=Math.floor((after-2*86400000)/60000)*60000;t<after+16*86400000;t+=60000){
  const p=Object.fromEntries(formatter.formatToParts(t).map(v=>[v.type,v.value])),day=p.year+'-'+p.month+'-'+p.day;
  if(seen.has(day)||!weekdays.includes(names.indexOf(p.weekday))||p.hour+':'+p.minute<time)continue;
  seen.add(day);if(t>after)return new Date(t).toISOString();
 }
 throw Error('No next calendar occurrence was found');
}
