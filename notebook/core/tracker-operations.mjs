// The tracker operations (D-321), one path for the notebook's chat, MCP and the
// Telegram bot: personalOperation hands these types here. The rules they share
// are in trackers.mjs; this file reads and writes.
import {norm,card,trackers,findTracker,entries,trackerStatus,proposalState,dayOf,whenFor,schemaFor,entryData,holdQuestion,createdReply,instantReply,fmt,unitOf,longDay,entryOn,existingTalk,setUpOnPurpose,entryWords} from './trackers.mjs';
import {now as clockNow,addDays} from '../../third-party/addons/godspeed-coach/lib/clock.mjs';
import {visibleRows} from './visibility.mjs';
import {habitTrackerList,habitOperation,isHabitRef,findHabits} from './habit-trackers.mjs';
import {cycleOperation,cycleCreate} from './cycle-operations.mjs';
import {CYCLE_WORDS} from './cycle.mjs';
import {foodOperation,foodCreate,foodSummary} from './food-operations.mjs';
import {FOOD_WORDS} from './food.mjs';
export const TRACKER_OPERATIONS=['tracker-hold','tracker-create','track','tracker-correct','tracker-list'];
const tz=store=>store.get('settings','installation')?.timezone||'UTC';
// The coaching talk that reads a tracker, by its area's name (coach/<area>/: health, work,
// relationships, or one the person added), or none.
const talkOf=value=>{if(value===undefined||value===null||value==='')return null;if(typeof value!=='string'||!/^[a-z][a-z0-9-]{0,39}$/.test(value))throw Error('Name the coaching talk by its area, such as health, or none');return value;};
// Headaches have their own tracker (D-321, step 3): the headache add-on keeps its rows, with its
// rules for open headaches, pills and pain, so the generic track never writes them.
const HEADACHES='The Headaches tracker is kept by the headache tracker: say it as a headache ("track headache since 6:30, right side") and use the headache operation or the headache-tracker recipe, never track.';
// The food tracker's rows are worked out by its own operation from the food table (D-321 step 5).
const FOOD='The food tracker is kept by the food operation: food {action:"track",items:[{food:<id from food search>,item,grams?,count?,unit?,assumed?}]}, as the food-tracker recipe says; never track.';
const has=input=>input.value!==undefined&&input.value!==null&&input.value!==''||Object.keys(input.data||{}).length>0;
// A new tracker's name is a title, "Belly", whatever case the person or the model wrote it in (the
// third recapture of 12 October 2026: "Start a new tracker called belly"). A name with capitals stays.
const titleOf=value=>{const s=String(value??'').trim();return s&&s===s.toLocaleLowerCase()?s.charAt(0).toLocaleUpperCase()+s.slice(1):s;};
// The person's message, as an assistant passes it (`words`) or the chat quotes it (`source_quote`).
const wordsOf=input=>String(input.words??input.source_quote??'').trim();
export function trackerOperation(domains,raw){
 // The coach's clock: the real time, or GODSPEED_NOW for a rehearsal with a frozen clock.
 const {store,query}=domains,type=raw.type,now=clockNow(),zone=tz(store),assistant=domains.assistant===true;
 // Another day is worked out here from their own words ("on Friday", "gestern"), never by a model
 // (trackers.mjs entryOn). Every path below, habits, the cycle and food included, gets the day.
 const input=['tracker-hold','track'].includes(type)?{...raw,on:entryOn(raw,dayOf(now,zone),{assistant})}:raw;
 if(type==='tracker-hold'){
  const name=titleOf(input.name);if(!name)throw Error('Say what to track');
  // "track period" (and "track Periode", "track cramps") belongs to the cycle tracker (D-321 step 4).
  if(input.specialist==='cycle'||CYCLE_WORDS.test(name))return cycleOperation(domains,{...input,action:'track'});
  // A habit the coach keeps, or the headache tracker's word, is never a new tracker (the order of D-321).
  const habit=findHabits(store,name)[0];if(habit)throw Error(habit.title+' is a habit: track it with its id from tracker-list, and the coach records the day.');
  const existing=findTracker(store,name).candidates;if(existing.some(c=>c.tracker.specialist==='headache'))throw Error(HEADACHES);
  if(existing.some(c=>c.tracker.specialist==='food'))throw Error(FOOD);
  if(existing.length)throw Error('There is already a tracker called '+name+'; track it instead');
  // "track food", "track lunch, ..." belongs to the food tracker (D-321 step 5): its own question, its items.
  if(input.specialist==='food'||FOOD_WORDS.test(name))return foodOperation(domains,{...input,action:'track'});
  // The message that asks is kept with the question, so a yes is a later message (tracker-create).
  if(assistant&&!wordsOf(input))throw Error("Pass the person's own message as words: a new tracker needs their yes in a later message.");
  // "track sauna" names no number, unit or column: something that happened, counted each time
  // and as often as it happens (the design's "a tracker with no number"). Until the bot's
  // rehearsal on 12 October 2026 it became "one number, once a day".
  const happened=!has(input)&&!input.unit&&input.fields===undefined;
  const cadence=input.cadence?(input.cadence==='any'?'any':'daily'):happened?'any':'daily',field_schema=schemaFor({unit:input.unit,fields:happened?[]:input.fields,cadence}),shape={name,field_schema};
  // A tracker with no columns of its own counts each time: "track sauna" is itself the
  // entry, held like a number would be, so the yes counts it (design: nothing he said is lost).
  const counting=!field_schema.some(f=>!['when','note'].includes(f.key));
  // Set up on purpose ("I want to track my sleep: hours, and quality from 1 to 5"), nothing has
  // happened yet: no entry is held, unless they gave one.
  const entry=has(input)||counting&&!setUpOnPurpose(input)?{when:whenFor({on:input.on,at:input.at,cadence},now,zone),data:entryData(shape,input)}:null;
  // An earlier open question for the same name is replaced by this one; it is
  // named here rather than changed (proposalState in trackers.mjs).
  const replaces=store.list('tracker_proposals').filter(o=>norm(o.name)===norm(name)&&proposalState(store,o,now)==='pending').map(o=>o.id);
  // A talk only when it exists (trackers.mjs talkExists): a new mission control has none.
  const words=wordsOf(input);
  const p=store.save('tracker_proposals',{name,cadence,field_schema,talk:existingTalk(store.root,talkOf(input.talk)),entry,replaces,...(words?{words}:{}),created_at:now.toISOString()});
  return {proposal_id:p.id,reply:holdQuestion(p,dayOf(now,zone))};
 }
 if(type==='tracker-create'){
  let p=null;if(input.proposal_id){p=store.get('tracker_proposals',input.proposal_id);if(proposalState(store,p,now)!=='pending')throw Error('That question has expired. Say it again and I will ask once more.');}
  else if(!input.fields&&!input.unit)throw Error('Say which columns the tracker should have');
  if(p?.specialist==='cycle')return cycleCreate(domains,p,input);
  if(p?.specialist==='food')return foodCreate(domains,p,input);
  // Their yes is a message of its own, after the question (the capture run of 12 October 2026: the
  // bot asked and created in one turn, and a first entry was made that nobody said yes to).
  if(p){const said=wordsOf(input);if(assistant&&!said)throw Error("Pass the person's answer as words: only their yes to the question creates the tracker.");if(said&&p.words&&norm(said)===norm(p.words))throw Error('That is the message that asked for the tracker. Ask the question, and create it only when they answer yes.');}
  const name=titleOf(input.name||p?.name);if(!name)throw Error('Say what the tracker is called');
  if(findTracker(store,name).candidates.length)throw Error('There is already a tracker called '+name);
  const cadence=input.cadence?(input.cadence==='any'?'any':'daily'):p?.cadence||'daily';
  // "Yes, but in inches" or "as often as I like" rebuilds the columns from the
  // question's own; the held number stays the number, checked again.
  const asked=p?(p.field_schema||[]).filter(f=>!['when','note'].includes(f.key)).map(({indexable,...f})=>f):undefined;
  const field_schema=schemaFor(input.fields||input.unit||!p?{unit:input.unit,fields:input.fields,cadence}:{fields:asked,cadence});
  const talk=existingTalk(store.root,input.talk!==undefined?talkOf(input.talk):p?.talk??null);
  let held=null;
  // A count held for "track sleep" does not fit columns that take numbers ("yes, with hours and
  // quality"): the tracker starts empty, as one set up on purpose does.
  const fits=p?.entry&&!(!Object.keys(p.entry.data||{}).some(k=>k!=='note')&&field_schema.some(f=>f.type==='number'));
  if(fits){const {note,...data}=p.entry.data;held={when:cadence===p.cadence?p.entry.when:whenFor({on:p.entry.when.slice(0,10),cadence},new Date(p.created_at),zone),data:entryData({name,field_schema},{data,note})};}
  const collection=query.execute({table:'collections',operation:'insert',values:{name,icon:'📈',description:'Tracker',visibility:'personal',field_schema,tracker:{names:[name],cadence,talk,specialist:null,...(p?{proposal_id:p.id}:{})}}}).data[0];
  const entry=held?query.execute({table:'collection_items',operation:'insert',values:{collection_id:collection.id,data:{when:held.when,...held.data}}}).data[0]:null;
  return {collection_id:collection.id,entry_id:entry?.id||null,reply:createdReply(collection,entry,dayOf(now,zone))};
 }
 // A habit's day is the coach's: its own track() on its own file (habit-trackers.mjs).
 if(['track','tracker-correct'].includes(type)&&isHabitRef(store,input.tracker))return habitOperation(store,input,{now,zone,today:dayOf(now,zone),assistant:domains.assistant===true});
 if(type==='track'){
  let c=resolve(store,input.tracker),under=false;if(c.tracker.specialist==='headache')throw Error(HEADACHES);
  if(c.tracker.specialist==='cycle')return cycleOperation(domains,{...input,action:input.data?.ended===true||input.ended===true?'over':'track'});
  if(c.tracker.specialist==='food'){if(Array.isArray(input.items)||input.preset)return foodOperation(domains,{...input,action:'track'});throw Error(FOOD);}
  const word=typeof input.new_name==='string'?input.new_name.trim():'';
  if(word){
   if(findTracker(store,word).candidates.some(o=>o.id!==c.id))throw Error('Another tracker is already called '+word);
   // "track waist 91" landed in Belly: Waist is now another name for it.
   if(![c.name,...(c.tracker.names||[])].some(x=>norm(x)===norm(word)))c=query.execute({table:'collections',operation:'update',values:{tracker:{...c.tracker,names:[...(c.tracker.names||[c.name]),word]}},filters:[['eq','id',c.id]],expected:expectedOf(input,'collections',c.id)}).data[0];
   under=norm(word)!==norm(c.name);
  }
  const cadence=c.tracker.cadence==='any'?'any':'daily',when=whenFor({on:input.on,at:input.at,cadence},now,zone),data=entryData(c,input),all=entries(store,c);
  // A once-a-day tracker keeps one entry a day: a second one that day replaces
  // the first, keeping its note unless a new one is given.
  const same=cadence==='daily'?all.filter(i=>String(i.data?.when).slice(0,10)===when).at(-1):null;
  if(same){
   const entry=query.execute({table:'collection_items',operation:'update',values:{data:{...same.data,...data,when}},filters:[['eq','id',same.id]],expected:expectedOf(input,'collection_items',same.id)}).data[0];
   const said=(when===dayOf(now,zone)?"Today's ":longDay(when)+"'s ")+(oneNumber(c)?describe(c,same):c.name+' entry')+' is now '+describe(c,entry)+'.';
   // Under another name the reply names the tracker it used, so a wrong match shows at once.
   return {collection_id:c.id,entry_id:entry.id,replaced:true,reply:under?'Tracked under '+c.name+': '+said.charAt(0).toLowerCase()+said.slice(1):said};
  }
  const entry=query.execute({table:'collection_items',operation:'insert',values:{collection_id:c.id,data:{when,...data}}}).data[0];
  // Waking a resting tracker needs no write: this entry makes it active.
  const said=instantReply(c,all.filter(i=>String(i.data?.when)<=when),entry,now,zone);
  return {collection_id:c.id,entry_id:entry.id,replaced:false,reply:under?'Tracked under '+c.name+': '+withoutName(c,said):said};
 }
 if(type==='tracker-correct'){
  const c=resolve(store,input.tracker);if(c.tracker.specialist==='headache')throw Error(HEADACHES);
  if(c.tracker.specialist==='food')return foodOperation(domains,{...input,action:'correct',grams:input.data?.grams??input.value});
  const all=entries(store,c);
  // Without an entry id it is the last entry he made or changed.
  const target=input.entry_id?all.find(i=>i.id===input.entry_id):[...all].sort((a,b)=>String(a.updated_at).localeCompare(String(b.updated_at))||String(a.created_at).localeCompare(String(b.created_at))).at(-1);
  if(!target)throw Error(input.entry_id?'That entry is not in '+c.name:c.name+' has no entry yet');
  const day=longDay(String(target.data?.when).slice(0,10)),expected=expectedOf(input,'collection_items',target.id);
  if(input.remove===true){
   query.execute({table:'collection_items',operation:'delete',filters:[['eq','id',target.id]],expected});
   const what=describe(c,target);return {collection_id:c.id,entry_id:target.id,removed:true,reply:'Removed: '+c.name+(what?' '+what:'')+' of '+day+'.'};
  }
  const data=entryData(c,{value:input.value,data:input.data,note:input.note});if(!Object.keys(data).length)throw Error('Say what it should be instead');
  const entry=query.execute({table:'collection_items',operation:'update',values:{data:{...target.data,...data}},filters:[['eq','id',target.id]],expected}).data[0];
  return {collection_id:c.id,entry_id:entry.id,removed:false,reply:'Changed: '+c.name+' on '+day+' is now '+(describe(c,entry)||'as you said')+'.'};
 }
 if(type==='tracker-list'){
  // Read only. What the chat and the bot need to name a tracker and to change an
  // entry: ids, other names, columns, and the current hashes the MCP guard asks for.
  const days=input.days===undefined?0:Number(input.days);if(!Number.isInteger(days)||days<0||days>366)throw Error('Choose a number of days from 0 to 366');
  const talk=input.talk===undefined?null:talkOf(input.talk),today=dayOf(now,zone),from=days?addDays(today,-(days-1)):null;
  const visible=new Set(visibleRows(query,'collections').map(r=>r.id));
  const items=store.list('collection_items'),list=trackers(store).filter(c=>visible.has(c.id)).map(c=>{
   const all=entries(store,c,items),made=[...all].sort((a,b)=>String(a.updated_at).localeCompare(String(b.updated_at))||String(a.created_at).localeCompare(String(b.created_at))).at(-1),todays=all.filter(i=>String(i.data?.when).slice(0,10)===today).at(-1);
   return {id:c.id,name:c.name,names:c.tracker.names||[c.name],cadence:c.tracker.cadence==='any'?'any':'daily',talk:c.tracker.talk||null,specialist:c.tracker.specialist||null,status:trackerStatus(store,c,now,all),hash:c._hash,
    fields:own(c).map(({key,label,type,unit,options,min,max})=>({key,label,type,...(unit?{unit}:{}),...(options?{options}:{}),...(min!==undefined?{min}:{}),...(max!==undefined?{max}:{})})),
    last:made?{id:made.id,when:made.data?.when,data:made.data,hash:made._hash}:null,today:todays?{id:todays.id,hash:todays._hash}:null,
    ...(from?{recent:all.filter(i=>String(i.data?.when).slice(0,10)>=from).map(i=>({id:i.id,when:i.data?.when,data:i.data,hash:i._hash}))}:{}),
    // The food tracker adds its days' totals and the target's last change, the one line its talk hears.
    ...(c.tracker.specialist==='food'?{food:foodSummary(domains,c,{from,today})}:{})};
  }).concat(habitTrackerList(store,{today,from})).filter(t=>!talk||t.talk===talk&&t.status==='active');
  const pending=store.list('tracker_proposals').filter(p=>proposalState(store,p,now)==='pending').map(p=>({id:p.id,name:p.name,created_at:p.created_at,question:holdQuestion(p,today)}));
  return {trackers:list,pending};
 }
 throw Error('Unsupported tracker operation: '+type);
}
// A tracker by its id, or by its name or another name. Two that fit: ask which.
function resolve(store,ref){
 const named=String(ref??'').trim();if(!named)throw Error('Say which tracker');
 const byId=store.get('collections',named);if(card(byId))return byId;
 const {match,candidates}=findTracker(store,named);if(match)return match;
 if(candidates.length)throw Error('Which one: '+candidates.map(c=>c.name).sort().join(' or ')+'?');
 throw Error('No tracker called '+named);
}
// The hash the caller read, for query.execute's own check; over MCP the guard
// asks for it as well (assistant-mutations.mjs reads `expected` the same way).
const expectedOf=(input,table,id)=>{const v=input.expected?.[table+'/'+id]??input.expected?.[id];return typeof v==='string'?{[id]:v}:{};};
const own=c=>(c.field_schema||[]).filter(f=>!['when','note'].includes(f.key));
const oneNumber=c=>{const f=own(c);return f.length===1&&f[0].type==='number'?f[0]:null;};
// An entry in a few words: "92 cm", or "7 hours, quality 4 of 5", or nothing.
function describe(c,entry){
 const one=oneNumber(c);if(one)return fmt(entry.data?.[one.key])+unitOf(one);
 return entryWords(c,entry.data);
}
// "Tracked: Belly 90 cm." under "Tracked under Belly: " reads "90 cm."
const withoutName=(c,reply)=>{const rest=reply.replace(/^Tracked: /,'');return rest.startsWith(c.name+', ')?rest.slice(c.name.length+2):rest.startsWith(c.name+' ')?rest.slice(c.name.length+1):rest;};
