// Trackers (Mission Control's work/plans/2026-10-11-trackers-design.md, D-321).
// A tracker is an ordinary collection with a `tracker` card: {names, cadence:
// daily|any, talk, specialist}. Its entries are collection items whose primary
// field `when` holds the day ("2026-10-11") or, for any-number trackers, the day
// and minute ("2026-10-11 06:30"). Resting and the 24-hour hold are worked out
// when read, never by a job: nothing here may message anyone.
import fs from 'node:fs';
import path from 'node:path';
import {localParts,addDays,daysBetween} from '../../third-party/addons/godspeed-coach/lib/clock.mjs';
import {setupQuestion,lang,PERIOD_FLOWS} from './cycle.mjs';
import {setupQuestion as foodQuestion,questionText as foodAmounts,lang as foodLang} from './food.mjs';
export const HOLD_MS=86400000,REST_DAYS=30;
const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
const WEEKDAYS=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
// A talk is a coaching area by its own name (coach/<area>/), as the person named it.
const talkWords=talk=>talk==='work-money'?'work and money':String(talk).replaceAll('-',' ');
// Whether that talk exists: an area folder with an area.md that has a talk rhythm. A new mission
// control has no health talk, and an area made for a habit alone has RHYTHM none (the coach's
// areas.mjs), so a tracker is given to a talk, and the reply names it, only when the talk is
// there (the capture run of 12 October 2026 promised "Your health talk will read it." on a mission
// control that had none). Read from the file, so the notebook needs no coach code to answer.
export function talkExists(root,talk){
 if(!root||typeof talk!=='string'||!/^[a-z][a-z0-9-]{0,39}$/.test(talk))return false;
 let text='';try{text=fs.readFileSync(path.join(root,'coach',talk,'area.md'),'utf8');}catch{return false;}
 const rhythm=(text.replace(/\r/g,'').split('\n\n')[0].match(/^RHYTHM:[ \t]*(.*)$/m)?.[1]||'').trim().toLowerCase();
 return !!rhythm&&rhythm!=='none';
}
// The talk a new tracker is given: the one named, when it exists; otherwise none.
export const existingTalk=(root,talk)=>talk&&talkExists(root,talk)?talk:null;
// Day words, worked out in code (the capture run of 12 October 2026: "track belly 94 on Friday"
// became the coming Friday and was refused as a future day). A weekday means the most recent one
// before today, in English or German; today's own weekday name means today only when they say
// "today" too. Yesterday, the day before, today. Nothing else is guessed.
const EN_DAYS=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'],DE_DAYS=['sonntag','montag','dienstag','mittwoch','donnerstag','freitag','samstag'];
const WEEKDAY_WORDS=/(?<!\p{L})(?:(sunday|monday|tuesday|wednesday|thursday|friday|saturday)|(sonntag|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonnabend)(?:s|abend|morgen|mittag|nachmittag|nacht)?)(?!\p{L})/giu;
const BEFORE_YESTERDAY=/(?<!\p{L})(?:(?:the\s+)?day\s+before\s+yesterday|vorgestern)(?!\p{L})/giu;
const YESTERDAY=/(?<!\p{L})(?:yesterday|gestern)(?!\p{L})/iu;
const TODAY=/(?<!\p{L})(?:today|tonight|this\s+(?:morning|afternoon|evening)|heute)(?!\p{L})/iu;
// A date or a count of days or weeks they said: then the day is the one the caller worked out
// from it, and their weekday is not second-guessed ("Friday the 2nd", "two weeks ago Friday").
const MONTH='(?:january|jan\\.?|february|feb\\.?|march|mar\\.?|april|apr\\.?|may|june|jun\\.?|july|jul\\.?|august|aug\\.?|september|sept?\\.?|october|oct\\.?|november|nov\\.?|december|dec\\.?|januar|februar|märz|mai|juni|juli|oktober|dezember)(?!\\p{L})';
const EXPLICIT_DAY=new RegExp('\\d{4}-\\d\\d-\\d\\d|(?<!\\d)\\d{1,2}\\.\\d{1,2}\\.|(?<!\\d)\\d{1,2}(?:st|nd|rd|th|\\.)?\\s+(?:of\\s+)?'+MONTH+'|(?<!\\p{L})'+MONTH+'\\s+\\d{1,2}(?!\\d)|(?<!\\p{L})the\\s+\\d{1,2}(?:st|nd|rd|th)(?!\\p{L})|(?<!\\p{L})(?:ago|weeks?|wochen?|vor\\s+\\S+\\s+tagen)(?!\\p{L})','iu');
const weekdayIndex=ymd=>new Date(ymd+'T12:00:00Z').getUTCDay();
// Every day the words name, as YYYY-MM-DD, seen from today.
export function dayMentions(text,today){
 const out=[],said=String(text??'').replace(BEFORE_YESTERDAY,()=>{out.push(addDays(today,-2));return ' ';}),withToday=TODAY.test(said);
 if(YESTERDAY.test(said))out.push(addDays(today,-1));
 if(withToday)out.push(today);
 for(const m of said.matchAll(WEEKDAY_WORDS)){
  const name=(m[1]||m[2]).toLowerCase(),index=m[1]?EN_DAYS.indexOf(name):name==='sonnabend'?6:DE_DAYS.indexOf(name);
  let back=(weekdayIndex(today)-index+7)%7;if(!back&&!withToday)back=7;
  out.push(addDays(today,-back));
 }
 return [...new Set(out)];
}
// `on` as given: a date, or the person's own day words ("Friday", "yesterday", "am Freitag").
export function resolveOn(on,today){
 const s=String(on).trim();if(/^\d{4}-\d\d-\d\d$/.test(s))return s;
 const days=dayMentions(s,today);
 if(days.length===1)return days[0];
 if(days.length>1)throw Error('Say one day');
 throw Error('Give the day as YYYY-MM-DD, or in their own words: today, yesterday or a weekday such as Friday');
}
// A date they said, or a count back ("two weeks ago", "vor drei Tagen", "last week"): another day
// than today, which only the caller can turn into a date.
const ANOTHER_DAY=new RegExp('\\d{4}-\\d\\d-\\d\\d|(?<!\\d)\\d{1,2}\\.\\d{1,2}\\.|(?<!\\d)\\d{1,2}(?:st|nd|rd|th|\\.)?\\s+(?:of\\s+)?'+MONTH+'|(?<!\\p{L})'+MONTH+'\\s+\\d{1,2}(?!\\d)|(?<!\\p{L})the\\s+\\d{1,2}(?:st|nd|rd|th)(?!\\p{L})|(?<!\\p{L})(?:ago|last\\s+week|letzte\\s+woche|vor\\s+\\S+\\s+(?:tagen|wochen))(?!\\p{L})','iu');
// A day as their own words name it, for a refusal the assistant acts on: "yesterday", "Friday".
const dayWord=(day,today)=>daysBetween(day,today)===1?'yesterday':daysBetween(day,today)===2?'the day before yesterday':WEEKDAYS[new Date(dayMs(day)).getUTCDay()];
const askOn=(day,today,given)=>'Their message names '+dayWord(day,today)+' ('+longDay(day)+')'+(given?', not '+given:'')+'. Pass "on":"'+dayWord(day,today)+'" when the entry is for that day, or "on":"today" when it is for today, and send the call again';
// The day an entry is for, YYYY-MM-DD, or undefined for today. `on` in their own words is worked out
// here and kept. Every other answer is checked against their message (`words`, or the chat's quote of
// it): a date that differs from the one day their words name is refused, and so is a missing `on`
// when their words name another day (the capture runs of 12 October 2026: the bot sent the coming
// Friday as a date, and then left the day out). The refusal names the day and how to pass it, so no
// model's calendar sums decide it. A date they said themselves ("Friday the 2nd") stands.
// `entry`: the call writes an entry, so a missing day is checked too.
export function entryOn({on,words,source_quote},today,{assistant=false,entry=true}={}){
 const text=String(words??source_quote??'').trim(),own=EXPLICIT_DAY.test(text),said=text?dayMentions(text,today):[];
 if(on===undefined||on===null||on===''){
  if(!entry)return undefined;
  // A message that also holds a date of its own ("remind me on 2099-01-01") may name that day for
  // something else; then the caller's choice stands.
  const other=said.filter(d=>d!==today);
  if(!other.length||ANOTHER_DAY.test(text))return undefined;
  if(other.length===1)throw Error(askOn(other[0],today));
  throw Error('Their message names another day than today. Pass it as "on", in their own words ("on":"Friday", "on":"yesterday"), or "on":"today" when the entry is for today, and send the call again');
 }
 const given=String(on).trim();
 // Their own day words: worked out here, and that is the day.
 if(!/^\d{4}-\d\d-\d\d$/.test(given))return resolveOn(given,today);
 if(!text){
  if(assistant&&given!==today)throw Error('Pass their message as words with another day, or their own day words as on (such as "on":"Friday"), so the day is worked out from what they said');
  return given;
 }
 if(!own&&said.length===1&&said[0]!==given)throw Error(askOn(said[0],today,given));
 return given;
}
// "I want to track my sleep: hours, and quality from 1 to 5": a tracker set up on purpose holds
// no entry, since nothing has happened yet. "track sauna" holds the one it names.
const SETUP=/(?<!\p{L})(?:i\s+(?:want|would\s+like|'d\s+like|wanna)\s+to\s+(?:start\s+)?track|start\s+tracking|set\s+up\s+(?:a\s+)?tracker|new\s+tracker|make\s+a\s+tracker|create\s+a\s+tracker|ich\s+(?:will|möchte|würde\s+gerne?)(?:\s+\S+)*?\s+tracken)(?!\p{L})/iu;
export const setUpOnPurpose=input=>input.setup===true||SETUP.test(String(input.words??input.source_quote??''));
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
 if(!p||p.removed_at)return 'missing';
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
 const today=dayOf(now,tz),day=on?resolveOn(on,today):today;
 // A day that does not exist ("2026-02-30") is refused, not rolled into March.
 if(!/^\d{4}-\d\d-\d\d$/.test(day)||!Number.isFinite(dayMs(day))||new Date(dayMs(day)).toISOString().slice(0,10)!==day)throw Error('Choose a calendar day');
 if(day>today)throw Error('A tracker records what happened; '+day+' is in the future. A weekday they named is the most recent one: pass their own words as on (such as "on":"Friday") and the day is worked out for you');
 if(day<addDays(today,-366))throw Error('That day is more than a year back; add it in the notebook table instead');
 if(cadence!=='any')return day;
 // localParts names the local hour and minute `hm` (the coach's clock.mjs).
 const time=at||localParts(now,tz).hm;if(!/^\d\d:\d\d$/.test(time||''))throw Error('Choose a time as HH:MM');return day+' '+time;
}
// A column as an assistant gives it: a label ("Hours", "Quality"), a type, and for a number its unit
// and the range it takes ("quality from 1 to 5": min 1, max 5). The key is made from the label when
// none is given; until 12 October 2026 a column without one was refused, and the bot's yes to a
// sleep tracker with two columns failed on it.
const keyOf=label=>String(label??'').normalize('NFKD').replace(/[̀-ͯ]/g,'').replace(/ß/g,'ss').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^[_0-9]+|_+$/g,'').slice(0,40);
function column(f){
 if(!f||typeof f!=='object')throw Error('Give each column as {label, type}');
 const label=String(f.label??'').trim()||String(f.key??'').replace(/_/g,' ').trim(),key=f.key===undefined||f.key===null||f.key===''?keyOf(label):String(f.key);
 if(!/^[a-z][a-z0-9_]{0,39}$/.test(key)||['when','note'].includes(key))throw Error('A tracker column needs a short name, such as "hours"');
 const out={...f,key,label:label?label.charAt(0).toUpperCase()+label.slice(1):key};
 for(const end of ['min','max'])if(out[end]!==undefined&&out[end]!==null){out[end]=toNumber(out[end]);if(out.type!=='number')throw Error('Only a number column has a range');}
 if(out.min!==undefined&&out.max!==undefined&&out.min>out.max)throw Error(out.label+' needs a range from the smaller number to the larger');
 return out;
}
export function schemaFor({unit,fields,cadence}){
 const own=(fields??[{key:'value',label:unit||'Value',type:'number',...(unit?{unit}:{})}]).map(column);
 if(new Set(own.map(f=>f.key)).size!==own.length)throw Error('Give each column its own name');
 return [{key:'when',label:cadence==='any'?'When':'Day',type:cadence==='any'?'datetime':'date',primary:true},...own.map(f=>({...f,indexable:true})),{key:'note',label:'Note',type:'text'}];
}
// A column in the words a person uses: "hours", "quality from 1 to 5", "weight in kg".
export function columnWords(f){
 const name=String(f.label||f.key).toLowerCase(),unit=f.unit&&String(f.unit).toLowerCase()!==name?' in '+f.unit:'';
 return name+unit+(f.min!==undefined&&f.max!==undefined?' from '+fmt(f.min)+' to '+fmt(f.max):'');
}
const listWords=items=>items.length<2?items.join(''):items.slice(0,-1).join(', ')+' and '+items.at(-1);
// One value of a column for a reply: "7 hours", "quality 4 of 5", "mood calm".
export function valueWords(f,v){
 if(f.type==='number'){const n=fmt(toNumber(v));if(f.unit)return n+' '+f.unit;return String(f.label||f.key).toLowerCase()+' '+n+(f.max!==undefined&&(f.min===undefined||f.min<=1)?' of '+fmt(f.max):'');}
 if(f.type==='boolean')return String(f.label||f.key).toLowerCase()+' '+(v===true||v==='true'?'yes':'no');
 return String(f.label||f.key).toLowerCase()+' '+v;
}
const own=c=>(c.field_schema||[]).filter(f=>!['when','note'].includes(f.key));
// A column with choices takes only its choices (the cycle tracker's flow and symptoms).
function choice(f,v){
 if(!Array.isArray(f.options)||!['select','multiselect'].includes(f.type))return v;
 const items=f.type==='multiselect'?[].concat(v??[]):[v];
 for(const x of items)if(!f.options.includes(x))throw Error(f.label+' is one of: '+f.options.join(', '));
 return f.type==='multiselect'?[...new Set(items)]:v;
}
export function entryData(c,{value,data,note}){
 const fields=own(c),out={};
 if(value!==undefined&&value!==null&&value!==''){const f=fields.length===1?fields[0]:null;if(!f)throw Error('Say which column '+value+' belongs to');out[f.key]=f.type==='number'?toNumber(value):value;}
 for(const [k,v] of Object.entries(data||{})){const f=fields.find(x=>x.key===k);if(!f)throw Error('No column "'+k+'" in '+c.name+'; its columns are '+fields.map(x=>x.key).join(', '));out[k]=f.type==='number'?toNumber(v):choice(f,v);}
 // A number column with a range takes only that range ("quality from 1 to 5").
 for(const f of fields)if(f.type==='number'&&out[f.key]!==undefined&&(f.min!==undefined&&out[f.key]<f.min||f.max!==undefined&&out[f.key]>f.max))throw Error(f.label+' is '+(f.min!==undefined&&f.max!==undefined?'from '+fmt(f.min)+' to '+fmt(f.max):f.min!==undefined?'at least '+fmt(f.min):'at most '+fmt(f.max)));
 if(fields.some(f=>f.type==='number')&&!fields.some(f=>out[f.key]!==undefined))throw Error('Say the value for '+c.name);
 if(note)out.note=String(note);return out;
}
export const fmt=n=>String(Math.round(n*100)/100);
export const unitOf=f=>f?.unit?' '+f.unit:'';
export const longDay=day=>{const d=new Date(dayMs(day));return d.getUTCDate()+' '+MONTHS[d.getUTCMonth()];};
const sinceDay=(day,today)=>{const gap=(dayMs(today)-dayMs(day))/86400000;return gap>0&&gap<7?WEEKDAYS[new Date(dayMs(day)).getUTCDay()]:longDay(day);};
const ordinal=n=>n+(n%100>=11&&n%100<=13?'th':['th','st','nd','rd'][n%10]||'th');
export function holdQuestion(p,today){
 // The cycle tracker asks its own question, the design's words (cycle.mjs).
 if(p.specialist==='cycle')return setupQuestion(lang(p.language),p.entry?{day:p.entry.when,period:PERIOD_FLOWS.has(p.entry.data?.flow),symptoms:p.entry.data?.symptoms||[]}:null,today);
 // The food tracker asks its own question, with the one about an unclear amount (food.mjs).
 if(p.specialist==='food')return foodQuestion(foodLang(p.language),{questions:foodAmounts(foodLang(p.language),p.unclear||[]),kept:!!p.meal?.items?.length});
 const fields=(p.field_schema||[]).filter(f=>!['when','note'].includes(f.key)),one=fields.length===1&&fields[0].type==='number'?fields[0]:null;
 const shape=one?'one number'+(one.unit?' in '+one.unit:'')+(one.min!==undefined&&one.max!==undefined?' from '+fmt(one.min)+' to '+fmt(one.max):''):fields.length?'with '+listWords(fields.map(columnWords)):'counting each time';
 const kept=p.entry?(one&&p.entry.data[one.key]!==undefined?" I've kept the "+fmt(p.entry.data[one.key])+' for ':" I've kept this one for ")+(p.entry.when.slice(0,10)===today?'today':longDay(p.entry.when.slice(0,10)))+'.':'';
 return 'Start a new tracker called '+p.name+', '+shape+', '+(p.cadence==='any'?'as often as you like':'once a day')+'?'+kept;
}
// The day of an entry that is not today, as a reply says it: "yesterday", "on Friday", "on 2 October".
const pastWords=(day,today)=>{const gap=daysBetween(day,today);return gap===1?'yesterday':gap>1&&gap<7?'on '+WEEKDAYS[new Date(dayMs(day)).getUTCDay()]:'on '+longDay(day);};
const onDay=(entry,today)=>{const day=String(entry?.data?.when??'').slice(0,10);return day&&day!==today?' '+pastWords(day,today):'';};
export function createdReply(c,entry,today){
 const fields=own(c),one=fields.length===1&&fields[0].type==='number'?fields[0]:null,talk=c.tracker?.talk?' Your '+talkWords(c.tracker.talk)+' talk will read it.':'';
 const say='"track '+norm(c.name)+'"'+(one?' and the number':fields.length>1?' with its '+listWords(fields.map(f=>String(f.label||f.key).toLowerCase())):'');
 if(!entry)return c.name+' is ready. Say '+say+'.'+talk;
 const day=today?onDay(entry,today):'',what=one?' '+fmt(entry.data[one.key])+unitOf(one):fields.length>1?', '+entryWords(c,entry.data):'';
 return 'Tracked: '+c.name+(one?what+day:day+what)+'. From now on just say '+say+'.'+talk;
}
// An entry of several columns in a few words: "7 hours, quality 4 of 5".
export const entryWords=(c,data)=>own(c).filter(f=>data?.[f.key]!==undefined&&data?.[f.key]!=='').map(f=>valueWords(f,data[f.key])).join(', ');
export function instantReply(c,before,entry,now,tz){
 const fields=own(c),numbers=fields.filter(f=>f.type==='number'),today=dayOf(now,tz),day=onDay(entry,today);
 if(fields.length===1&&numbers.length===1){const f=numbers[0],v=entry.data[f.key],prev=[...before].reverse().find(i=>Number.isFinite(Number(i.data?.[f.key])));
  if(!prev)return 'Tracked: '+c.name+' '+fmt(v)+unitOf(f)+day+'.';
  const d=v-Number(prev.data[f.key]),when=sinceDay(String(prev.data.when).slice(0,10),today);
  return 'Tracked: '+fmt(v)+unitOf(f)+day+', '+(Math.abs(d)<0.005?'the same as on '+when:(d<0?'down ':'up ')+fmt(Math.abs(d))+' since '+when)+'.';}
 if(!numbers.length&&fields.every(f=>f.type!=='text'||!entry.data[f.key])){const month=String(entry.data.when).slice(0,7),n=[...before,entry].filter(i=>String(i.data?.when).startsWith(month)).length;return 'Tracked: '+c.name+day+', '+ordinal(n)+' time this month.';}
 return 'Tracked: '+c.name+day+', '+entryWords(c,entry.data)+'.';
}
