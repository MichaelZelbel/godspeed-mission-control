import {visibleRows} from './visibility.mjs';

// Where the phone (Health Auto Export) and another source both give a day's metric, the value
// written last wins for that day and metric only. A record's updated_at moves only when its value
// changes, so it is when the value was last written. Every other row passes through.
export const PHONE_SOURCE='Health Auto Export';
export function latestPerDayMetric(rows){
 const best=new Map(),key=row=>row.date_precision==='day'&&row.observed_on?row.observed_on+'\n'+row.metric:null;
 for(const row of rows){const k=key(row);if(k===null)continue;const group=best.get(k)||best.set(k,{rows:[],phone:false,other:false}).get(k);group.rows.push(row);group[row.source===PHONE_SOURCE?'phone':'other']=true;}
 const newest=new Map();
 for(const [k,group] of best)if(group.phone&&group.other)newest.set(k,group.rows.reduce((a,b)=>String(b.updated_at)>String(a.updated_at)?b:a));
 return rows.filter(row=>{const k=key(row);return !newest.has(k)||newest.get(k)===row;});
}

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
  const all=visibleRows(query,'health_observations'),current=all.filter(fresh),observations=latestPerDayMetric(current);
  return {observations,has_fresh_measurements:!!observations.length,as_of:new Date(now).toISOString(),timezone,window_days:days,excluded_stale_or_future:all.length-current.length};
 });
}
