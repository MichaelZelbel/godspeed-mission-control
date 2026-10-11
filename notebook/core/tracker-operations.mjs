// The tracker operations (D-321), one path for the notebook's chat, MCP and the
// Telegram bot: personalOperation hands these types here. The rules they share
// are in trackers.mjs; this file reads and writes.
import {norm,findTracker,proposalState,dayOf,whenFor,schemaFor,entryData,holdQuestion,createdReply} from './trackers.mjs';
import {now as clockNow} from '../../third-party/addons/godspeed-coach/lib/clock.mjs';
export const TRACKER_OPERATIONS=['tracker-hold','tracker-create','track','tracker-correct','tracker-list'];
const tz=store=>store.get('settings','installation')?.timezone||'UTC';
const TALKS=['health','work-money','relationships'];
const talkOf=value=>{if(value===undefined||value===null||value==='')return null;if(!TALKS.includes(value))throw Error('Choose the health, work-money or relationships talk, or none');return value;};
const has=input=>input.value!==undefined&&input.value!==null&&input.value!==''||Object.keys(input.data||{}).length>0;
export function trackerOperation(domains,input){
 // The coach's clock: the real time, or GODSPEED_NOW for a rehearsal with a frozen clock.
 const {store,query}=domains,type=input.type,now=clockNow(),zone=tz(store);
 if(type==='tracker-hold'){
  const name=String(input.name||'').trim();if(!name)throw Error('Say what to track');
  if(findTracker(store,name).candidates.length)throw Error('There is already a tracker called '+name+'; track it instead');
  const cadence=input.cadence==='any'?'any':'daily',field_schema=schemaFor({unit:input.unit,fields:input.fields,cadence}),shape={name,field_schema};
  const entry=has(input)?{when:whenFor({on:input.on,at:input.at,cadence},now,zone),data:entryData(shape,input)}:null;
  // An earlier open question for the same name is replaced by this one; it is
  // named here rather than changed (proposalState in trackers.mjs).
  const replaces=store.list('tracker_proposals').filter(o=>norm(o.name)===norm(name)&&proposalState(store,o,now)==='pending').map(o=>o.id);
  const p=store.save('tracker_proposals',{name,cadence,field_schema,talk:talkOf(input.talk),entry,replaces,created_at:now.toISOString()});
  return {proposal_id:p.id,reply:holdQuestion(p,dayOf(now,zone))};
 }
 if(type==='tracker-create'){
  let p=null;if(input.proposal_id){p=store.get('tracker_proposals',input.proposal_id);if(proposalState(store,p,now)!=='pending')throw Error('That question has expired. Say it again and I will ask once more.');}
  else if(!input.fields&&!input.unit)throw Error('Say which columns the tracker should have');
  const name=String(input.name||p?.name||'').trim();if(!name)throw Error('Say what the tracker is called');
  if(findTracker(store,name).candidates.length)throw Error('There is already a tracker called '+name);
  const cadence=input.cadence?(input.cadence==='any'?'any':'daily'):p?.cadence||'daily';
  // "Yes, but in inches" or "as often as I like" rebuilds the columns from the
  // question's own; the held number stays the number, checked again.
  const asked=p?(p.field_schema||[]).filter(f=>!['when','note'].includes(f.key)).map(({indexable,...f})=>f):undefined;
  const field_schema=schemaFor(input.fields||input.unit||!p?{unit:input.unit,fields:input.fields,cadence}:{fields:asked,cadence});
  const talk=input.talk!==undefined?talkOf(input.talk):p?.talk??null;
  let held=null;
  if(p?.entry){const {note,...data}=p.entry.data;held={when:cadence===p.cadence?p.entry.when:whenFor({on:p.entry.when.slice(0,10),cadence},new Date(p.created_at),zone),data:entryData({name,field_schema},{data,note})};}
  const collection=query.execute({table:'collections',operation:'insert',values:{name,icon:'📈',description:'Tracker',visibility:'personal',field_schema,tracker:{names:[name],cadence,talk,specialist:null,...(p?{proposal_id:p.id}:{})}}}).data[0];
  const entry=held?query.execute({table:'collection_items',operation:'insert',values:{collection_id:collection.id,data:{when:held.when,...held.data}}}).data[0]:null;
  return {collection_id:collection.id,entry_id:entry?.id||null,reply:createdReply(collection,entry)};
 }
 throw Error('Unsupported tracker operation: '+type);
}
