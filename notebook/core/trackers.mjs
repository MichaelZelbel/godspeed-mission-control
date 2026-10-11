// Trackers (Mission Control's work/plans/2026-10-11-trackers-design.md, D-321).
// A tracker is an ordinary collection with a `tracker` card: {names, cadence:
// daily|any, talk, specialist}. Its entries are collection items whose primary
// field `when` holds the day ("2026-10-11") or, for any-number trackers, the day
// and minute ("2026-10-11 06:30"). Resting and the 24-hour hold are worked out
// when read, never by a job: nothing here may message anyone.
import {localParts,addDays} from '../../third-party/addons/godspeed-coach/lib/clock.mjs';
export const HOLD_MS=86400000,REST_DAYS=30;
const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
const WEEKDAYS=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
// A talk is a coaching area by its own name (coach/<area>/), as the person named it.
const talkWords=talk=>talk==='work-money'?'work and money':String(talk).replaceAll('-',' ');
export const norm=s=>String(s??'').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,' ').trim();
export const card=c=>c&&!c.removed_at&&c.tracker&&typeof c.tracker==='object'?c.tracker:null;
export const trackers=store=>store.list('collections').filter(card);
// Only a collection with a card is ever a tracker: an ordinary "Belly" or
// "Movies & TV" collection is never matched and never changed.
export function findTracker(store,name){const n=norm(name),candidates=trackers(store).filter(c=>[c.name,...(c.tracker.names||[])].some(x=>norm(x)===n));return {match:candidates.length===1?candidates[0]:null,candidates};}
// A held first entry ("track belly 92" for a tracker that does not exist yet) is
// a tracker_proposals record, written once and never changed: over MCP an
// assistant may change an existing record only with its current hash, and the
// "yes" that answers it names none. So what became of it is read here, from what
// was written after it: a tracker made from it (its card names it), a newer
// question for the same name that replaced it, its 24 hours, or a tracker of
// that name made another way.
export function proposalState(store,p,now=new Date()){
 if(!p)return 'missing';
 const all=trackers(store);if(all.some(c=>c.tracker.proposal_id===p.id))return 'created';
 if(store.list('tracker_proposals').some(o=>o.id!==p.id&&(o.replaces||[]).includes(p.id)))return 'dropped';
 if(!(now-Date.parse(p.created_at)<=HOLD_MS))return 'expired';
 if(all.some(c=>[c.name,...(c.tracker.names||[])].some(x=>norm(x)===norm(p.name))))return 'dropped';
 return 'pending';
}
// `items` lets a caller that reads many trackers list the notebook's items once.
export const entries=(store,c,items=store.list('collection_items'))=>items.filter(i=>i.collection_id===c.id).sort((a,b)=>String(a.data?.when).localeCompare(String(b.data?.when))||String(a.created_at).localeCompare(String(b.created_at)));
const dayMs=day=>Date.parse(day+'T00:00:00Z');
export function trackerStatus(store,c,now=new Date(),its=entries(store,c)){const last=its.at(-1),day=String(last?.data?.when||c.created_at||'').slice(0,10);return (now-dayMs(day))/86400000>REST_DAYS?'resting':'active';}
// "92,5" is how a German keyboard, and German dictation, writes 92.5.
export function toNumber(value){const n=typeof value==='number'?value:Number(String(value??'').trim().replace(/^(-?\d+),(\d+)$/,'$1.$2'));if(String(value??'').trim()===''||!Number.isFinite(n))throw Error('Expected a number, got "'+value+'"');return n;}
export const dayOf=(now,tz)=>localParts(now,tz).date;
export function whenFor({on,at,cadence},now,tz){
 const today=dayOf(now,tz),day=on||today;
 // A day that does not exist ("2026-02-30") is refused, not rolled into March.
 if(!/^\d{4}-\d\d-\d\d$/.test(day)||!Number.isFinite(dayMs(day))||new Date(dayMs(day)).toISOString().slice(0,10)!==day)throw Error('Choose a calendar day');
 if(day>today)throw Error('A tracker records what happened; '+day+' is in the future');
 if(day<addDays(today,-366))throw Error('That day is more than a year back; add it in the notebook table instead');
 if(cadence!=='any')return day;
 // localParts names the local hour and minute `hm` (the coach's clock.mjs).
 const time=at||localParts(now,tz).hm;if(!/^\d\d:\d\d$/.test(time||''))throw Error('Choose a time as HH:MM');return day+' '+time;
}
export function schemaFor({unit,fields,cadence}){
 const own=fields??[{key:'value',label:unit||'Value',type:'number',...(unit?{unit}:{})}];
 for(const f of own)if(!/^[a-z][a-z0-9_]{0,39}$/.test(f.key||'')||['when','note'].includes(f.key))throw Error('A tracker column needs a short lowercase key');
 return [{key:'when',label:cadence==='any'?'When':'Day',type:cadence==='any'?'datetime':'date',primary:true},...own.map(f=>({...f,indexable:true})),{key:'note',label:'Note',type:'text'}];
}
const own=c=>(c.field_schema||[]).filter(f=>!['when','note'].includes(f.key));
export function entryData(c,{value,data,note}){
 const fields=own(c),out={};
 if(value!==undefined&&value!==null&&value!==''){const f=fields.length===1?fields[0]:null;if(!f)throw Error('Say which column '+value+' belongs to');out[f.key]=f.type==='number'?toNumber(value):value;}
 for(const [k,v] of Object.entries(data||{})){const f=fields.find(x=>x.key===k);if(!f)throw Error('No column "'+k+'" in '+c.name);out[k]=f.type==='number'?toNumber(v):v;}
 if(fields.some(f=>f.type==='number')&&!fields.some(f=>out[f.key]!==undefined))throw Error('Say the value for '+c.name);
 if(note)out.note=String(note);return out;
}
export const fmt=n=>String(Math.round(n*100)/100);
export const unitOf=f=>f?.unit?' '+f.unit:'';
export const longDay=day=>{const d=new Date(dayMs(day));return d.getUTCDate()+' '+MONTHS[d.getUTCMonth()];};
const sinceDay=(day,today)=>{const gap=(dayMs(today)-dayMs(day))/86400000;return gap>0&&gap<7?WEEKDAYS[new Date(dayMs(day)).getUTCDay()]:longDay(day);};
const ordinal=n=>n+(n%100>=11&&n%100<=13?'th':['th','st','nd','rd'][n%10]||'th');
export function holdQuestion(p,today){
 const fields=(p.field_schema||[]).filter(f=>!['when','note'].includes(f.key)),one=fields.length===1&&fields[0].type==='number'?fields[0]:null;
 const shape=one?'one number'+(one.unit?' in '+one.unit:''):fields.length?'with '+fields.map(f=>f.label).join(', '):'counting each time';
 const kept=p.entry?(one&&p.entry.data[one.key]!==undefined?" I've kept the "+fmt(p.entry.data[one.key])+' for ':" I've kept this entry for ")+(p.entry.when.slice(0,10)===today?'today':longDay(p.entry.when.slice(0,10)))+'.':'';
 return 'Start a new tracker called '+p.name+', '+shape+', '+(p.cadence==='any'?'as often as you like':'once a day')+'?'+kept;
}
export function createdReply(c,entry){
 const fields=own(c),one=fields.length===1&&fields[0].type==='number'?fields[0]:null,say='"track '+norm(c.name)+'"'+(one?' and the number':''),talk=c.tracker?.talk?' Your '+talkWords(c.tracker.talk)+' talk will read it.':'';
 if(!entry)return c.name+' is ready. Say '+say+'.'+talk;
 return 'Tracked: '+c.name+(one?' '+fmt(entry.data[one.key])+unitOf(one):'')+'. From now on just say '+say+'.'+talk;
}
export function instantReply(c,before,entry,now,tz){
 const fields=own(c),numbers=fields.filter(f=>f.type==='number'),today=dayOf(now,tz);
 if(fields.length===1&&numbers.length===1){const f=numbers[0],v=entry.data[f.key],prev=[...before].reverse().find(i=>Number.isFinite(Number(i.data?.[f.key])));
  if(!prev)return 'Tracked: '+c.name+' '+fmt(v)+unitOf(f)+'.';
  const d=v-Number(prev.data[f.key]),when=sinceDay(String(prev.data.when).slice(0,10),today);
  return 'Tracked: '+fmt(v)+unitOf(f)+', '+(Math.abs(d)<0.005?'the same as on '+when:(d<0?'down ':'up ')+fmt(Math.abs(d))+' since '+when)+'.';}
 if(!numbers.length&&fields.every(f=>f.type!=='text'||!entry.data[f.key])){const month=String(entry.data.when).slice(0,7),n=[...before,entry].filter(i=>String(i.data?.when).startsWith(month)).length;return 'Tracked: '+c.name+', '+ordinal(n)+' time this month.';}
 return 'Tracked: '+c.name+', '+fields.filter(f=>entry.data[f.key]!==undefined).map(f=>f.label+' '+(f.type==='number'?fmt(entry.data[f.key]):entry.data[f.key])).join(', ')+'.';
}
