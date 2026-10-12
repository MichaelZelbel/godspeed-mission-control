// The headache tracker in the notebook's own chat (D-321, step 2): "track headache since 6:30,
// right side" reaches the headache add-on, the one owner of headaches, through the same command
// /headache already runs (addonCommand). The answer is worked out here from what was saved, as a
// tracker's is, never the model's guess: one line, the one question when a new headache has no
// pain number, and the painkiller-days fact at most once a week, as the headache-tracker recipe asks.
import {addonCommand,headacheLog} from './native-personal.mjs';
import {describe,patterns} from '../../third-party/addons/godspeed-headache/lib/report.mjs';
import {loadSettings} from '../../third-party/addons/godspeed-headache/lib/settings.mjs';
import {localParts} from '../../third-party/addons/godspeed-headache/lib/clock.mjs';
import {now as clockNow} from '../../third-party/addons/godspeed-coach/lib/clock.mjs';
import {longDay} from './trackers.mjs';

export const HEADACHE_ACTIONS=['start','log','set','med','end','cancel'];
const given=v=>v!==undefined&&v!==null&&v!=='';
const medsOf=input=>[].concat(input.meds??[]).map(m=>typeof m==='string'?{med:m}:m).filter(m=>m&&typeof m.med==='string'&&m.med.trim());
// A dose said as a word is written as its number: "one" is 1, "zwei Tabletten" 2 Tabletten (the
// third recapture of 12 October 2026 answered "took ibuprofen one").
const NUMBER_WORDS={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eine:1,einen:1,eins:1,zwei:2,drei:3,vier:4,'fünf':5,sechs:6};
const doseOf=dose=>String(dose).trim().replace(/^\p{L}+(?=\s|$)/u,w=>NUMBER_WORDS[w.toLocaleLowerCase()]!==undefined?String(NUMBER_WORDS[w.toLocaleLowerCase()]):w);
// The command line the add-on is given: his words verbatim, every detail as its own flag.
export function headacheArgs(input){
 const action=input.action;if(!HEADACHE_ACTIONS.includes(action))throw Error('Say what happened to the headache: started, more about it, a pill, over, or a mistake');
 if(action==='log'&&(!given(input.from)||!given(input.to)))throw Error('A headache that is over needs when it started and when it ended');
 if(action==='med'&&!medsOf(input).length)throw Error('Say which medicine was taken');
 const args=[action],flag=(name,value)=>{if(given(value))args.push('--'+name,String(value));};
 flag('at',input.at);flag('from',input.from);flag('to',input.to);flag('pain',input.pain);flag('side',input.side);flag('quality',input.quality);
 for(const x of [].concat(input.symptoms??[]))flag('symptom',x);
 for(const x of [].concat(input.triggers??[]))flag('trigger',x);
 for(const m of medsOf(input))args.push('--med',m.med.trim()+(given(m.dose)?': '+doseOf(m.dose):''));
 flag('taken',input.taken);flag('episode',input.episode);
 const words=String(input.words??input.source_quote??'').trim();if(words)args.push('--words',words);
 args.push('--source',String(input.source_app||'notebook'));
 return args;
}
const OVERUSE=/painkiller day \d+ in 30/;
export function headacheOperation(domains,input){
 const {store,query}=domains,saved=JSON.parse(addonCommand(store,{addon:'headache',args:headacheArgs(input)}).result);
 const settings=loadSettings(store.root),tz=settings.timezone,now=clockNow(),today=localParts(now,tz).date;
 let reply;
 if(saved.cancelled)reply='Removed: that headache is no longer in the Headaches tracker.';
 else if(saved.episode){
  const line=describe(saved.episode,tz,now),day=line.slice(0,10),rest=line.slice(12).replaceAll('; ',', ');
  reply='Tracked: '+(day===today?'':longDay(day)+', ')+rest+'.';
  // One short question, only on a new headache with no number, never twice (the recipe's rule).
  if(input.action==='start'&&!given(input.pain)&&saved.episode.pain_max==null)reply+=' How strong, 1 to 10?';
 }else reply='Tracked: '+medsOf(input).map(m=>m.med.trim()).join(', ')+', no headache open.';
 // The one fact about the pills, at most once in seven days of what this notebook said.
 if(medsOf(input).length){
  const r=patterns(headacheLog(store),settings,now,{days:30}),week=Date.now()-7*86400000;
  const said=(query?.rows('conversation_messages')||[]).some(m=>m.role==='assistant'&&Date.parse(m.created_at)>=week&&OVERUSE.test(String(m.content)));
  if(r.painkiller_days_worst_30>=r.overuse_limit&&!said)reply+=' That is painkiller day '+r.painkiller_days_worst_30+' in 30. On '+r.overuse_limit+' or more days a month, combination painkillers can start causing headaches themselves.';
 }
 return {...saved,reply};
}
