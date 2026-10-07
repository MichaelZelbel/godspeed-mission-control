import {visibleRows} from './visibility.mjs';

// A CSV day is a day, not a manufactured precise observation time.
export function currentHealth(query,{now=Date.now(),days=7}={}){
 return query.withSnapshot(()=>{
  const timezone=query.rows('profiles')[0]?.timezone||'UTC';
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
  const oldestDay=new Date(Date.parse(today+'T00:00:00Z')-days*86400000).toISOString().slice(0,10);
  const fresh=row=>{
   if(row.date_precision==='day'&&row.observed_on){const day=String(row.observed_on),parsed=Date.parse(day+'T00:00:00Z');return /^\d{4}-\d{2}-\d{2}$/.test(day)&&Number.isFinite(parsed)&&new Date(parsed).toISOString().slice(0,10)===day&&day<=today&&day>=oldestDay;}
   const at=Date.parse(row.observed_at||row.created_at);
   return Number.isFinite(at)&&at<=now&&at>=now-days*86400000;
  };
  const all=visibleRows(query,'health_observations'),observations=all.filter(fresh);
  return {observations,has_fresh_measurements:!!observations.length,as_of:new Date(now).toISOString(),timezone,window_days:days,excluded_stale_or_future:all.length-observations.length};
 });
}
