// Calendar schedules use the first matching wall-clock minute per local day.
// A missing DST minute runs at the first later minute; an ambiguous minute runs once.
// Until 6 October 2026 this looked at every minute of the next two to six
// weeks (a monthly schedule took almost two seconds, inside the workspace
// lock); now it works a day at a time and looks at single minutes only on a
// day whose clock changes.
export function nextCalendarRun(job,timezone='UTC',after=Date.now()){
 if(!job.calendar)return new Date(after+(job.interval_ms||86400000)).toISOString();
 const {time,weekdays=[0,1,2,3,4,5,6],month_day}=job.calendar;
 if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)||!weekdays.length||weekdays.some(d=>!Number.isInteger(d)||d<0||d>6))throw Error('Invalid calendar schedule');
 if(month_day!==undefined&&(!Number.isInteger(month_day)||month_day<1||month_day>31||new Set(weekdays).size!==7))throw Error('Invalid monthly calendar schedule: choose a day 1 to 31 and every weekday');
 const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 // The wall clock at instant t: its local day and minute, and that clock
 // reading taken as if it were UTC (so reading minus instant is the offset).
 const wall=t=>{const p=Object.fromEntries(formatter.formatToParts(t).map(v=>[v.type,v.value]));return {day:p.year+'-'+p.month+'-'+p.day,minute:p.hour+':'+p.minute,reading:Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day),Number(p.hour),Number(p.minute))};};
 const minute=t=>Math.floor(t/60000)*60000,offset=t=>wall(minute(t)).reading-minute(t);
 const [hour,min]=time.split(':').map(Number),key=(y,m,d)=>String(y).padStart(4,'0')+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0');
 // The first minute of local day y-m-d whose clock reads `time` or later, or null.
 const first=(y,m,d)=>{
  const target=Date.UTC(y,m-1,d,hour,min),day=key(y,m,d),before=offset(target-36*3600000),later=offset(target+36*3600000);
  if(before===later){const t=target-before,w=wall(t);if(w.day===day&&w.minute===time)return t;}
  // The clock changes near this day: every minute where the reading can cross `time`.
  for(let t=minute(target-Math.max(before,later)-3600000),end=target-Math.min(before,later)+3600000;t<=end;t+=60000){const w=wall(t);if(w.day===day&&w.minute>=time)return t;}
  return null;
 };
 // Start before the current local day to remember its first (possibly ambiguous) time.
 const start=wall(minute(after-2*86400000)).reading,limit=(month_day?40:16)+3;
 for(let i=0;i<limit;i++){
  const date=new Date(start+i*86400000),y=date.getUTCFullYear(),m=date.getUTCMonth()+1,d=date.getUTCDate();
  if(!weekdays.includes(date.getUTCDay()))continue;
  if(month_day&&d!==Math.min(month_day,new Date(Date.UTC(y,m,0)).getUTCDate()))continue;
  const t=first(y,m,d);if(t!==null&&t>after)return new Date(t).toISOString();
 }
 throw Error('No next calendar occurrence was found');
}
