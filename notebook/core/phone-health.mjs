import fs from 'node:fs';import path from 'node:path';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {hash,atomic} from './records/store.mjs';
import {healthFeedId} from './health-feed-id.mjs';
import {PHONE_SOURCE} from './health-inputs.mjs';
import {addDays,zonedToUtc,now as clockNow} from '../../third-party/addons/godspeed-coach/lib/clock.mjs';

// A phone's health data (issue #214, 4 November 2026). The iPhone app Health Auto Export posts its
// data to a server notebook every hour; this keeps each upload as one line in a per-machine file
// and turns the days it touches into the same `health_observations` day records the CSV feed
// writes (personal-operations.mjs, `health-import-csv`). The receiver and `health import FOLDER`
// share buildDays and writeDays, so one folder of old lines builds the days the phone would have.
export const SOURCE=PHONE_SOURCE;
export const KEEP_DAYS=30;
export const BODY_LIMIT=20*1024*1024;

// The secrets and the raw uploads live in the state folder: it is outside the durable roots
// (file-policy.mjs), so neither is ever synced, indexed or backed up.
export const tokenFile=state=>path.join(state,'ingest-token');
export const rawFolder=state=>path.join(state,'health-uploads');

function writeToken(state,token){const file=tokenFile(state);atomic(file,token);fs.chmodSync(file,0o600);return token;}
export function ensureToken(state){
 try{const token=fs.readFileSync(tokenFile(state),'utf8').trim();if(token)return token;}catch(error){if(error.code!=='ENOENT')throw error;}
 return writeToken(state,randomBytes(32).toString('base64url'));
}
export const renewToken=state=>writeToken(state,randomBytes(32).toString('base64url'));
const digest=text=>createHash('sha256').update(String(text)).digest();
export function tokenMatches(state,presented){
 if(!presented)return false;
 let token;try{token=fs.readFileSync(tokenFile(state),'utf8').trim();}catch{return false;}
 return !!token&&timingSafeEqual(digest(token),digest(presented));
}

// "2026-10-25 02:30:00.250 +0200" as a moment. Compared as text it is wrong across the repeated
// hour when daylight saving ends: 02:30 +0200 is earlier than 02:10 +0100.
const INSTANT=/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/;
export function instantOf(text){
 const m=INSTANT.exec(String(text||'').trim());if(!m)return NaN;
 const [,y,mo,d,h,mi,s='0',fraction='',zone='Z']=m;let offset=0;
 if(zone!=='Z'){const digits=zone.slice(1).replace(':','');offset=(zone[0]==='-'?-1:1)*(Number(digits.slice(0,2))*60+Number(digits.slice(2)));}
 return Date.UTC(+y,+mo-1,+d,+h,+mi,+s)+(fraction?Number(fraction)*1000:0)-offset*60000;
}
// A date without a time sorts before any moment.
const when=text=>{const t=instantOf(text);return Number.isNaN(t)?-Infinity:t;};
const dayOf=text=>{const day=String(text??'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(day)&&new Date(day+'T00:00:00Z').toISOString().slice(0,10)===day?day:null;};
const utcDay=date=>date.toISOString().slice(0,10);

const rawFile=(state,day)=>path.join(rawFolder(state),day+'.jsonl');
export function appendRaw(state,upload){
 const folder=rawFolder(state),file=rawFile(state,utcDay(new Date(instantOf(upload.received_at))));
 fs.mkdirSync(folder,{recursive:true,mode:0o700});fs.chmodSync(folder,0o700);
 const size=fs.existsSync(file)?fs.statSync(file).size:0;
 fs.appendFileSync(file,JSON.stringify({received_at:upload.received_at,data:upload.data})+'\n',{mode:0o600});fs.chmodSync(file,0o600);
 // Takes this line back out of the file: only valid while nothing else has appended (under the store lock).
 return ()=>{if(size)fs.truncateSync(file,size);else fs.rmSync(file,{force:true});};
}
const rawDays=state=>{try{return fs.readdirSync(rawFolder(state)).map(name=>/^(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(name)?.[1]).filter(Boolean);}catch(error){if(error.code==='ENOENT')return [];throw error;}};
export function pruneRaw(state,now=clockNow()){
 const oldest=addDays(utcDay(now),-KEEP_DAYS);let removed=0;
 for(const day of rawDays(state))if(day<oldest){fs.rmSync(rawFile(state,day),{force:true});removed++;}
 return removed;
}
// A line damaged by hand is skipped: the file is the machine's own.
export function readRaw(state,fromDay){
 const lines=[];
 for(const day of rawDays(state).filter(d=>d>=fromDay).sort())for(const text of fs.readFileSync(rawFile(state,day),'utf8').split('\n')){
  if(!text)continue;let line;try{line=JSON.parse(text);}catch{continue;}
  if(Number.isFinite(instantOf(line?.received_at))&&line.data&&typeof line.data==='object')lines.push({received_at:line.received_at,data:line.data});
 }
 return inReceiveOrder(lines);
}
const inReceiveOrder=lines=>lines.map((line,at)=>({line,at,when:instantOf(line.received_at)})).sort((a,b)=>a.when-b.when||a.at-b.at).map(x=>x.line);

const SUMS={step_count:'steps',walking_running_distance:'distance_km',active_energy:'active_kcal',basal_energy_burned:'basal_kcal',dietary_energy:'food_kcal',protein:'protein_g',carbohydrates:'carbs_g',total_fat:'fat_g',flights_climbed:'flights'};
const LAST={weight_body_mass:'weight_kg',body_fat_percentage:'body_fat_pct',lean_body_mass:'lean_kg',waist_circumference:'waist_cm'};
const RUNS=new Set(['running','outdoor running','indoor running','run','outdoor run','indoor run']);
const WALK_PACE=9;
const round=n=>Math.round(n*100)/100;
const number=value=>{const n=typeof value==='string'&&value.trim()===''?NaN:Number(value);return Number.isFinite(n)?n:null;};
const hhmm=text=>/^\d{2}:\d{2}$/.test(String(text).slice(11,16))?String(text).slice(11,16):null;

function minutesOf(duration){
 if(duration&&typeof duration==='object'){
  const qty=number(duration.qty);if(qty===null)return 0;const units=String(duration.units||'min').toLowerCase();
  return /^s(ec)?/.test(units)?qty/60:/^h/.test(units)?qty*60:qty;
 }
 return (number(duration)??0)/60;
}
function kilometresOf(distance){
 const qty=number(distance?.qty);if(qty===null)return 0;
 return String(distance.units||'km').toLowerCase()==='m'?qty/1000:qty;
}

// The points of every upload, each once per (metric name, date text, source): a later upload's copy
// replaces an earlier one. `at` is the arrival order, which settles two points of one instant.
function pointsOf(uploads){
 const seen=new Map();let at=0;
 for(const {data} of uploads)for(const metric of Array.isArray(data?.metrics)?data.metrics:[])for(const point of Array.isArray(metric?.data)?metric.data:[]){
  const day=dayOf(point?.date);if(!day)continue;
  seen.set(JSON.stringify([metric.name,point.date,point.source]),{name:metric.name,units:metric.units,point,day,instant:when(point.date),at:at++});
 }
 return [...seen.values()];
}
// A workout sent again (same id or same start) counts once, as the copy received last.
function workoutsOf(uploads){
 let kept=[];
 for(const {data} of uploads)for(const workout of Array.isArray(data?.workouts)?data.workouts:[]){
  if(!workout||!dayOf(workout.start))continue;
  kept=kept.filter(old=>!(workout.id!==undefined&&old.id===workout.id)&&old.start!==workout.start);kept.push(workout);
 }
 return kept;
}
const later=(a,b)=>b.instant>a.instant||b.instant===a.instant&&b.at>a.at?b:a;

// uploads: [{received_at,data}] in receive order. Returns Map(day -> Map(metric -> value)).
export function buildDays(uploads){
 const days=new Map(),put=(day,metric,value)=>{if(!days.has(day))days.set(day,new Map());days.get(day).set(metric,typeof value==='number'?round(value):value);};
 const groups=new Map();
 for(const p of pointsOf(uploads)){const key=p.name+'\n'+p.day;(groups.get(key)||groups.set(key,[]).get(key)).push(p);}
 for(const group of groups.values()){
  const {name,day}=group[0];
  if(SUMS[name]){
   let sum=0,any=false;
   for(const p of group){const qty=number(p.point.qty);if(qty===null)continue;any=true;sum+=String(p.units).toLowerCase()==='kj'?qty/4.184:qty;}
   if(any)put(day,SUMS[name],sum);
  }else if(LAST[name]){
   const winner=group.filter(p=>number(p.point.qty)!==null).reduce((a,b)=>a?later(a,b):b,null);
   if(winner)put(day,LAST[name],number(winner.point.qty));
  }
 }
 // Sleep: the day's longest structured record, else the day's largest plain total.
 for(const [key,group] of groups){
  if(!key.startsWith('sleep_analysis\n'))continue;const day=group[0].day;
  const records=group.filter(p=>number(p.point.totalSleep)!==null).sort((a,b)=>number(b.point.totalSleep)-number(a.point.totalSleep)||b.at-a.at);
  if(records.length){
   const {point}=records[0];
   for(const [field,metric] of [['inBed','sleep_in_bed_h'],['totalSleep','sleep_total_h'],['deep','sleep_deep_h'],['rem','sleep_rem_h']])if(number(point[field])!==null)put(day,metric,number(point[field]));
   if(hhmm(point.sleepStart))put(day,'sleep_start',hhmm(point.sleepStart));if(hhmm(point.sleepEnd))put(day,'sleep_end',hhmm(point.sleepEnd));
  }else{
   const quantities=group.map(p=>number(p.point.qty)).filter(q=>q!==null);if(quantities.length)put(day,'sleep_total_h',Math.max(...quantities));
  }
 }
 const totals=new Map();
 for(const workout of workoutsOf(uploads).sort((a,b)=>(when(a.start)>when(b.start))-(when(a.start)<when(b.start)))){
  const day=dayOf(workout.start),minutes=minutesOf(workout.duration),km=kilometresOf(workout.distance),sum=totals.get(day)||totals.set(day,{}).get(day);
  const add=(metric,value)=>{sum[metric]=(sum[metric]||0)+value;};
  if(RUNS.has(String(workout.name).trim().toLowerCase())){
   const walk=km>0&&minutes/km>=WALK_PACE;add(walk?'walk_km':'run_km',km);add(walk?'walk_min':'run_min',minutes);
  }else{add('workout_min',minutes);(sum.types||=[]);if(!sum.types.includes(workout.name))sum.types.push(workout.name);}
 }
 for(const [day,{types,...numbers}] of totals){for(const [metric,value] of Object.entries(numbers))put(day,metric,value);if(types)put(day,'workout_types',types.join('+'));}
 return days;
}

// Writes the built days as day records. A day whose raw files may be gone (a point dated D reaches
// the notebook in a file of UTC day D-1 or later, and those still exist for the last KEEP_DAYS-1
// days) keeps the records it has: a rebuild may add a metric there, never change or lose one.
// Call under store.withLock.
export function writeDays(store,built,{now=clockNow()}={}){
 const timezone=store.get('settings','installation')?.timezone||'UTC',oldestCovered=addDays(utcDay(now),-(KEEP_DAYS-1)),rows=[];
 for(const [day,metrics] of [...built].sort()){
  for(const [metric,value] of metrics){
   const id=healthFeedId(SOURCE,day,metric),previous=store.get('health_observations',id);
   if(previous&&(day<oldestCovered||!previous.removed_at&&previous.value===value&&previous.date_precision==='day'))continue;
   rows.push(store.prepare('health_observations',{id,metric,value,source:SOURCE,observed_on:day,date_precision:'day',observed_at:zonedToUtc(day,'00:00',timezone).toISOString()},previous));
  }
 }
 if(rows.length)store.commit(rows);
 return {written:rows.length};
}

export function touchedDays(data){
 const days=new Set();
 for(const metric of Array.isArray(data?.metrics)?data.metrics:[])for(const point of Array.isArray(metric?.data)?metric.data:[]){const day=dayOf(point?.date);if(day)days.add(day);}
 for(const workout of Array.isArray(data?.workouts)?data.workouts:[]){const day=dayOf(workout?.start);if(day)days.add(day);}
 return [...days].sort();
}

// The days an upload touches, rebuilt from the raw files that can carry them: day D reaches the
// notebook on UTC day D-1 at the earliest, so older files are not read.
function rebuild(store,touched,{now}){
 if(!touched.length)return {days:[],written:0};
 const wanted=new Set(touched),built=buildDays(readRaw(store.state,addDays(touched[0],-1)));
 for(const day of [...built.keys()])if(!wanted.has(day))built.delete(day);
 return {days:touched,...writeDays(store,built,{now})};
}

export function acceptUpload(store,data,{now=clockNow()}={}){
 return store.withLock(()=>{
  const undo=appendRaw(store.state,{received_at:now.toISOString(),data});
  // An upload that could not become day records is not kept either, so the phone's retry is the only copy.
  try{pruneRaw(store.state,now);return rebuild(store,touchedDays(data),{now});}catch(error){
   try{undo();}catch(rollback){throw Object.assign(error,{retained:true,rollbackMessage:rollback.message});}
   throw error;
  }
 });
}

// One-time import of another receiver's lines: {received_at, remote, data}, one JSON per line.
// `remote` is dropped here and never stored. Lines within the window join the raw files, so the
// next phone upload for the same day rebuilds it with them.
export function importFolder(store,folder,{now=clockNow()}={}){
 const lines=[];let total=0,skipped=0;
 for(const name of fs.readdirSync(folder).sort().filter(n=>/\.(jsonl|ndjson|json)$/.test(n)))for(const text of fs.readFileSync(path.join(folder,name),'utf8').split('\n')){
  if(!text.trim())continue;total++;let line;try{line=JSON.parse(text);}catch{skipped++;continue;}
  if(!Number.isFinite(instantOf(line?.received_at))||!line.data||typeof line.data!=='object'||Array.isArray(line.data)){skipped++;continue;}
  lines.push({received_at:line.received_at,data:line.data});
 }
 return store.withLock(()=>{
  const oldest=addDays(utcDay(now),-KEEP_DAYS),pool=new Map(readRaw(store.state,'0000-00-00').map(l=>[JSON.stringify(l),l]));
  for(const line of lines){
   const key=JSON.stringify(line);if(pool.has(key))continue;
   pool.set(key,line);if(utcDay(new Date(instantOf(line.received_at)))>=oldest)appendRaw(store.state,line);
  }
  const touched=[...new Set(lines.flatMap(l=>touchedDays(l.data)))].sort(),wanted=new Set(touched),built=buildDays(inReceiveOrder([...pool.values()]));
  for(const day of [...built.keys()])if(!wanted.has(day))built.delete(day);
  return {lines:total,skipped,days:touched.length,...writeDays(store,built,{now})};
 });
}
