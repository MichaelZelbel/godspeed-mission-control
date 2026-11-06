import {visibleRows} from './visibility.mjs';
import {FOOD_TOTAL_COLUMNS,totalsOf} from './food.mjs';
import {PHONE_SUM_METRICS} from './phone-health-columns.mjs';

// Where the phone receiver and another source both give a day's metric, the value
// written last wins for that day and metric only. A record's updated_at moves only when its value
// changes, so it is when the value was last written. Every other row passes through.
export const PHONE_SOURCE='Health Auto Export';
// The phone receiver marks every record it writes (phone-health.mjs, writeDays). The resolver goes by that
// mark, never by the source's name, so a CSV someone labelled 'Health Auto Export' is a CSV.
export const PHONE_VIA='phone-receiver';
export const MANUAL_VIA='manual';
export function latestPerDayMetric(rows){
 const best=new Map(),key=row=>row.date_precision==='day'&&row.observed_on?row.observed_on+'\n'+row.metric:null;
 for(const row of rows){const k=key(row);if(k===null)continue;const group=best.get(k)||best.set(k,{rows:[],phone:false,other:false,manual:false}).get(k);group.rows.push(row);group[row.via===PHONE_VIA?'phone':'other']=true;group.manual||=row.via===MANUAL_VIA;}
 const newest=new Map();
 for(const [k,group] of best)if(group.manual)newest.set(k,group.rows.filter(row=>row.via===MANUAL_VIA).reduce((a,b)=>String(b.updated_at)>String(a.updated_at)?b:a));else if(group.phone&&group.other)newest.set(k,group.rows.reduce((a,b)=>String(b.updated_at)>String(a.updated_at)?b:a));
 return rows.filter(row=>{const k=key(row);return !newest.has(k)||newest.get(k)===row;});
}

const newest=rows=>rows.reduce((a,b)=>String(b.updated_at)>String(a.updated_at)?b:a);
const validDay=day=>/^\d{4}-\d{2}-\d{2}$/.test(day)&&new Date(day+'T00:00:00Z').toISOString().slice(0,10)===day;
const UNKNOWN_STATES=new Set(['may_be_incomplete','not_judged']);

export function unknownHealthColumns(health){
 return (health?.days||[]).flatMap(day=>Object.entries(day.columns||{}).flatMap(([column,value])=>UNKNOWN_STATES.has(value.state)?[{date:day.date,column,...value,...(day.data_until?{data_until:day.data_until}:{})}]:[]));
}

// Unknown phone totals are rendered by code, not interpreted from a model's prose. A model that uses
// health facts identifies their resolved day and column, so the caller can reject an unknown source.
export function healthSafeReply(raw,field,health){
 const unknown=unknownHealthColumns(health);
 if(!unknown.length){
  const value=typeof raw==='string'?raw:raw?.[field];
  if(typeof value!=='string'||!value.trim())throw Error('Assistant returned no '+field);
  return value;
 }
 let reply=raw;
 if(typeof raw==='string'){try{reply=JSON.parse(raw);}catch{throw Error('Assistant must return '+field+' and health_claims while phone health is unknown');}}
 if(!reply||typeof reply!=='object'||Array.isArray(reply)||typeof reply[field]!=='string'||!reply[field].trim()||!Array.isArray(reply.health_claims))throw Error('Assistant must return '+field+' and health_claims while phone health is unknown');
 const columns=new Map((health?.days||[]).flatMap(day=>Object.keys(day.columns||{}).map(column=>[day.date+'\n'+column,day.columns[column]])));
 const unknownKeys=new Set(unknown.map(claim=>claim.date+'\n'+claim.column));
 for(const claim of reply.health_claims){
  if(!claim||typeof claim!=='object'||Array.isArray(claim)||typeof claim.date!=='string'||typeof claim.column!=='string'||!['report','gap_advice','weekly_miss'].includes(claim.use))throw Error('Health claims must name a resolved day, column and use');
  const key=claim.date+'\n'+claim.column;
  if(!columns.has(key))throw Error('Health claim does not name a resolved health column');
  if(unknownKeys.has(key))throw Error('Unknown phone health cannot support '+claim.use.replace('_',' ')+' for '+claim.column+' on '+claim.date);
 }
 return reply[field];
}

// A CSV day is a day, not a manufactured precise observation time.
export function currentHealth(query,{now=Date.now(),days=7}={}){
 return query.withSnapshot(()=>{
  const timezone=query.rows('settings').find(row=>row.id==='installation')?.timezone||'UTC';
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
  const oldestDay=new Date(Date.parse(today+'T00:00:00Z')-days*86400000).toISOString().slice(0,10);
  const fresh=row=>{
   if(row.date_precision==='day'&&row.observed_on){const day=String(row.observed_on),parsed=Date.parse(day+'T00:00:00Z');return /^\d{4}-\d{2}-\d{2}$/.test(day)&&Number.isFinite(parsed)&&new Date(parsed).toISOString().slice(0,10)===day&&day<=today&&day>=oldestDay;}
   const at=Date.parse(row.observed_at||row.created_at);
   return Number.isFinite(at)&&at<=now&&at>=now-days*86400000;
  };
  const all=visibleRows(query,'health_observations'),current=all.filter(fresh),observations=latestPerDayMetric(current);
  const healthByDay=new Map(),phoneUntil=new Map();
  for(const row of observations){
   const day=row.date_precision==='day'&&validDay(row.observed_on)?row.observed_on:null;if(!day)continue;
   const metrics=healthByDay.get(day)||healthByDay.set(day,new Map()).get(day),rows=metrics.get(row.metric)||metrics.set(row.metric,[]).get(row.metric);rows.push(row);
   if(row.via===PHONE_VIA&&typeof row.data_until==='string'&&(!phoneUntil.has(day)||row.data_until>phoneUntil.get(day)))phoneUntil.set(day,row.data_until);
  }
  const foodByDay=new Map(),foodCollections=new Set(visibleRows(query,'collections').filter(row=>row.tracker?.specialist==='food').map(row=>row.id));
  for(const row of visibleRows(query,'collection_items')){
   if(!foodCollections.has(row.collection_id))continue;const day=String(row.data?.when||'').slice(0,10);
   if(validDay(day)&&day>=oldestDay&&day<=today)(foodByDay.get(day)||foodByDay.set(day,[]).get(day)).push(row);
  }
  const dayKeys=new Set([...healthByDay.keys(),...foodByDay.keys()]);
  const state=[...dayKeys].sort().map(date=>{
   const columns={},metrics=healthByDay.get(date),food=foodByDay.get(date);
   for(const metric of [...new Set([...Object.values(PHONE_SUM_METRICS),...(metrics?.keys()||[])])]){
    const rows=metrics?.get(metric)||[],manual=rows.filter(row=>row.via===MANUAL_VIA);
    if(manual.length){const row=newest(manual);columns[metric]={value:row.value,source:'manual',state:'settled'};continue;}
    if(food&&Object.hasOwn(FOOD_TOTAL_COLUMNS,metric)){const totals=totalsOf(food);columns[metric]={value:totals[FOOD_TOTAL_COLUMNS[metric]],source:'food_tracker',state:'settled'};continue;}
    if(!rows.length)continue;
    const row=newest(rows);
    if(row.via===PHONE_VIA){const data_until=phoneUntil.get(date),status=date===today?'not_judged':data_until>'21:00:00'?'complete':'may_be_incomplete';columns[metric]={value:row.value,source:'phone',state:status};}
    else columns[metric]={value:row.value,source:'legacy',state:'legacy'};
   }
   const incomplete=Object.values(PHONE_SUM_METRICS).filter(metric=>columns[metric]?.state==='may_be_incomplete');
   return {date,...(phoneUntil.has(date)?{data_until:phoneUntil.get(date)}:{}),columns,may_be_incomplete_columns:incomplete};
  });
  return {observations,days:state,has_fresh_measurements:!!observations.length||!!state.length,as_of:new Date(now).toISOString(),timezone,window_days:days,excluded_stale_or_future:all.length-current.length};
 });
}
