// The cycle tracker's operation (D-321 step 4): `cycle {action,...}`, one path for the notebook's chat,
// MCP and the Telegram bot, on the shared tracker base. The rules and every reply are in cycle.mjs;
// this file reads and writes. Nothing here sends anything to anyone: the heads-up is a line the
// person's own morning brief asks for (`brief`), and only when she switched it on.
import {trackers,entries,proposalState,dayOf,whenFor,toNumber,entryOn,talkExists} from './trackers.mjs';
import {now as clockNow,daysBetween} from '../../third-party/addons/godspeed-coach/lib/clock.mjs';
import {FLOWS,PERIOD_FLOWS,PAIN_WHERE,SYMPTOMS,cycleSchema,cycleCard,cycleState,periods,forecast,lang,setupQuestion,createdReply,dayWords,dayReply,overReply,forecastReply,headsUpLine,declineReply,whyWords,dateWords,days,FIXED_LINE} from './cycle.mjs';

export const CYCLE_ACTIONS=['track','over','forecast','status','brief','heads-up','talk','leave-out','count','decline','delete'];
// A yes to "delete your cycle tracker?" counts for one hour.
export const DELETE_MS=3600000;
const NAMES=['Cycle','Period','Zyklus','Periode','Menstruation'];
const WHY=['outlier','pregnancy','breastfeeding','contraception'];
const tz=store=>store.get('settings','installation')?.timezone||'UTC';
// The hash the caller read, for query.execute's own check (as tracker-operations.mjs).
const expectedOf=(input,table,id)=>{const v=input.expected?.[table+'/'+id]??input.expected?.[id];return typeof v==='string'?{[id]:v}:{};};
const talkOf=value=>{if(value===undefined||value===null||value===''||value===false)return null;if(typeof value!=='string'||!/^[a-z][a-z0-9-]{0,39}$/.test(value))throw Error('Name the coaching talk by its area, such as health, or none');return value;};
export const cycleTracker=store=>trackers(store).find(c=>c.tracker.specialist==='cycle')||null;
const given=v=>v!==undefined&&v!==null&&v!==''&&!(Array.isArray(v)&&!v.length);
// The columns of one day, from the operation's own fields or `data` (the base's track). Every value
// is one of the column's choices; "track period" with nothing else is a period day of no stated amount.
export function dayData(input){
 const src={...(input.data&&typeof input.data==='object'?input.data:{})};for(const k of ['flow','pain','pain_where','symptoms','note'])if(given(input[k]))src[k]=input[k];
 const out={};
 if(given(src.flow)){if(!FLOWS.includes(src.flow)||src.flow==='none')throw Error('Flow is one of: spotting, light, medium, heavy, unspecified');out.flow=src.flow;}
 if(given(src.pain)){const n=toNumber(src.pain);if(!Number.isInteger(n)||n<0||n>3)throw Error('Pain is a whole number from 0 to 3');out.pain=n;}
 const many=(v,options,what)=>{const items=[].concat(v??[]).map(x=>String(x).trim().toLowerCase()).filter(Boolean);for(const x of items)if(!options.includes(x))throw Error(what+' is one of: '+options.join(', '));return [...new Set(items)];};
 const where=many(src.pain_where,PAIN_WHERE,'Where it hurts');if(where.length)out.pain_where=where;
 const syms=many(src.symptoms,SYMPTOMS.map(s=>s.key),'A symptom');if(syms.length)out.symptoms=syms;
 if(given(src.note))out.note=String(src.note).slice(0,500);
 if(!['flow','pain','pain_where','symptoms'].some(k=>k in out))out.flow='unspecified';
 return out;
}
// A second entry on one day joins the first: a new flow, pain or note replaces, places and symptoms add up.
const join=(a,b)=>{const out={...a,...b};for(const k of ['pain_where','symptoms'])if(a[k]||b[k])out[k]=[...new Set([...(a[k]||[]),...(b[k]||[])])];return out;};
const keptOf=entry=>({day:entry.when,period:PERIOD_FLOWS.has(entry.data.flow),symptoms:entry.data.symptoms||[]});
// Whether a morning brief runs here, so switching the heads-up on can say where it will arrive.
const briefOn=query=>{try{return query.rows('jobs').some(j=>!j.paused&&j.enabled!==false&&!['paused','completed'].includes(String(j.state||''))&&/morning[\s_-]*brief/i.test([j.kind,j.name,j.skill,...(Array.isArray(j.skills)?j.skills:[]),j.prompt].filter(Boolean).join(' ')));}catch{return false;}};
const liveDeletion=(store,c,now)=>store.list('tracker_deletions').filter(d=>d.collection_id===c.id&&now-Date.parse(d.created_at)<=DELETE_MS).at(-1)||null;

// The yes to the setup question (tracker-create with a cycle question).
export function cycleCreate(domains,p,input={}){
 const {store,query}=domains,l=lang(input.language||p.language);
 if(cycleTracker(store))throw Error(l==='de'?'Du hast schon einen Zyklus-Tracker.':'You already have a cycle tracker.');
 const name=p.name||(l==='de'?'Zyklus':'Cycle');
 const collection=query.execute({table:'collections',operation:'insert',values:{name,icon:'🌙',description:l==='de'?'Zyklus-Tracker':'Cycle tracker',visibility:'personal',field_schema:cycleSchema(),tracker:{names:[...new Set([name,...NAMES])],cadence:'daily',talk:null,specialist:'cycle',language:l,proposal_id:p.id,cycle:{heads_up:false,left_out:[],counted:[]}}}}).data[0];
 const entry=p.entry?query.execute({table:'collection_items',operation:'insert',values:{collection_id:collection.id,data:{when:p.entry.when,...p.entry.data}}}).data[0]:null;
 const said=entry?dayWords(l,{periodDay:PERIOD_FLOWS.has(entry.data.flow)?1:null,data:entry.data}):(l==='de'?'dein Zyklus-Tracker ist bereit':'your cycle tracker is ready');
 return {collection_id:collection.id,entry_id:entry?.id||null,language:l,reply:createdReply(l,said)};
}

export function cycleOperation(domains,raw){
 const {store,query}=domains,now=clockNow(),zone=tz(store),today=dayOf(now,zone);
 // Her day words ("yesterday", "on Friday") are worked out in code (trackers.mjs entryOn).
 const action=raw.action||'track',input={...raw,on:entryOn(raw,today,{entry:['track','over'].includes(action)})};
 if(!CYCLE_ACTIONS.includes(action))throw Error('A cycle action is one of: '+CYCLE_ACTIONS.join(', '));
 const c=cycleTracker(store),l=lang(input.language||c?.tracker.language),rows=()=>c?entries(store,c):[];
 const none=l==='de'?'Du hast noch keinen Zyklus-Tracker. Sag am ersten Tag deiner Periode "track Periode", dann frage ich, ob ich einen anlegen soll.':'You have no cycle tracker yet. Say "track period" on the first day of your period and I will ask whether to start one.';
 const setCard=(cycle={},extra={})=>query.execute({table:'collections',operation:'update',values:{tracker:{...c.tracker,...extra,cycle:{...cycleCard(c.tracker),...cycle}}},filters:[['eq','id',c.id]],expected:expectedOf(input,'collections',c.id)}).data[0];

 if(action==='track'&&!c){
  // No tracker yet: the held first day and the setup question, once (the base's hold).
  const entry={when:whenFor({on:input.on,cadence:'daily'},now,zone),data:dayData(input)};
  const replaces=store.list('tracker_proposals').filter(o=>o.specialist==='cycle'&&proposalState(store,o,now)==='pending').map(o=>o.id);
  const p=store.save('tracker_proposals',{name:l==='de'?'Zyklus':'Cycle',cadence:'daily',field_schema:cycleSchema(),talk:null,specialist:'cycle',language:l,entry,replaces,created_at:now.toISOString()});
  return {proposal_id:p.id,language:l,reply:setupQuestion(l,keptOf(entry),today)};
 }
 if(['track','over'].includes(action)){
  if(!c)return {language:l,reply:none};
  const when=whenFor({on:input.on,cadence:'daily'},now,zone),all=rows(),same=all.filter(i=>String(i.data?.when).slice(0,10)===when).at(-1),before=periods(all);
  let data;
  if(action==='over'){
   const p=before.filter(x=>x.start<=when).at(-1);
   if(!p||daysBetween(p.last,when)>7)return {language:l,reply:l==='de'?'Es ist keine Periode offen, die enden könnte.':'There is no open period to end.'};
   if(p.over&&p.over<=when&&p.last<=p.over)return {language:l,reply:l==='de'?'Diese Periode ist schon beendet: '+days(l,p.length)+' ab dem '+dateWords(l,p.start)+'.':'That period has already ended: '+days(l,p.length)+' from '+dateWords(l,p.start)+'.'};
   data=same?{...same.data,ended:true}:{flow:'none',ended:true};
  }else data=same?join(same.data,dayData(input)):dayData(input);
  const entry=same?query.execute({table:'collection_items',operation:'update',values:{data:{...data,when}},filters:[['eq','id',same.id]],expected:expectedOf(input,'collection_items',same.id)}).data[0]
   :query.execute({table:'collection_items',operation:'insert',values:{collection_id:c.id,data:{when,...data}}}).data[0];
  const after=periods(rows()),p=after.filter(x=>x.start<=when).at(-1);
  if(action==='over')return {collection_id:c.id,entry_id:entry.id,replaced:!!same,language:l,reply:overReply(l,p.length)};
  const periodDay=PERIOD_FLOWS.has(entry.data.flow)&&p&&when<=p.end?daysBetween(p.start,when)+1:null;
  // A new start completes a cycle: its length, and the one question about an unusual one, once.
  const fresh=p&&p.start===when&&!before.some(x=>x.start===when),prev=fresh?after[after.indexOf(p)-1]:null;
  return {collection_id:c.id,entry_id:entry.id,replaced:!!same,language:l,reply:dayReply(l,{day:when,today,periodDay,data:entry.data,lastCycle:prev?daysBetween(prev.start,when):null})};
 }
 if(action==='decline')return {language:l,reply:declineReply(l)};
 if(action==='forecast'){
  if(!c)return {language:l,reply:none+' '+FIXED_LINE[l]};
  const f=forecast(cycleState(rows(),c.tracker,today),today);
  return {language:l,forecast:f,reply:forecastReply(l,f,today)};
 }
 if(action==='brief')return {line:c?headsUpLine(cycleState(rows(),c.tracker,today),today):null};
 if(action==='status'){
  // What the chat and the bot need to act: ids and current hashes, the open period, the cycles and
  // what counts, the open questions. Read only.
  const proposals=store.list('tracker_proposals').filter(p=>p.specialist==='cycle'&&proposalState(store,p,now)==='pending').map(p=>({id:p.id,question:setupQuestion(lang(p.language),keptOf(p.entry),today)}));
  if(!c)return {tracker:null,proposals};
  const all=rows(),state=cycleState(all,c.tracker,today),f=forecast(state,today),last=state.periods.at(-1);
  const todays=all.filter(i=>String(i.data?.when).slice(0,10)===today).at(-1),made=[...all].sort((a,b)=>String(a.updated_at).localeCompare(String(b.updated_at))).at(-1);
  const open=last&&(!last.over||last.last>last.over)&&daysBetween(last.last,today)<=3?{start:last.start,day:daysBetween(last.start,today)+1}:null;
  const deletion=liveDeletion(store,c,now);
  return {tracker:{id:c.id,hash:c._hash,name:c.name,language:state.card.language,talk:c.tracker.talk||null,heads_up:state.card.heads_up},
   today:todays?{id:todays.id,hash:todays._hash,data:todays.data}:null,last:made?{id:made.id,hash:made._hash,when:made.data?.when,data:made.data}:null,
   period:open,cycles:state.cycles.slice(-7).map(({start,length,status,why})=>({start,length,status,why})),
   forecast:f.kind==='window'?{kind:'window',from:f.from,to:f.to,likely:f.likely}:{kind:f.kind},
   deletion:deletion?{request_id:deletion.id}:null,proposals};
 }
 if(!c)return {language:l,reply:none};
 if(action==='heads-up'){
  if(typeof input.enabled!=='boolean')throw Error('Say whether to switch the heads-up on or off');
  setCard({heads_up:input.enabled});
  if(!input.enabled)return {language:l,heads_up:false,reply:l==='de'?'Erledigt: keine Vorwarnung mehr in deinem Morgenbriefing.':'Done: no more heads-up in your morning brief.'};
  const f=forecast(cycleState(rows(),c.tracker,today),today);
  let reply=l==='de'?'Erledigt: Zwei Tage vor deinem nächsten Vorhersage-Fenster steht eine Zeile dazu in deinem Morgenbriefing. Sonst erfährt es niemand.':'Done: two days before your next forecast window, your morning brief will carry one line about it. Nobody else is told.';
  if(f.kind!=='window')reply+=l==='de'?' Das beginnt, sobald ich eine Vorhersage geben kann.':' That starts once I can forecast.';
  if(!briefOn(query))reply+=l==='de'?' Dein Morgenbriefing ist noch nicht eingeschaltet; die Zeile kommt, sobald es läuft.':' Your morning brief is not switched on yet; the line arrives once it is.';
  return {language:l,heads_up:true,reply};
 }
 if(action==='talk'){
  const talk=talkOf(input.talk);
  // Only a talk that exists can read it; nothing is changed for one that does not (trackers.mjs talkExists).
  if(talk&&!talkExists(store.root,talk))return {language:l,talk:null,changed:false,reply:l==='de'?'Es gibt noch kein Gespräch "'+talk+'". Sag, wann es stattfinden soll, dann kann es ab da deinen Zyklus-Tracker lesen.':'There is no '+talk.replaceAll('-',' ')+' talk yet. Say when it should happen, and from then on it can read your cycle tracker.'};
  setCard({},{talk});
  return {language:l,talk,reply:talk?(l==='de'?'Erledigt: Dein Gespräch "'+talk+'" darf jetzt deinen Zyklus-Tracker lesen.':'Done: your '+talk.replaceAll('-',' ')+' talk may now read your cycle tracker.'):(l==='de'?'Erledigt: Kein Gespräch liest deinen Zyklus-Tracker.':'Done: no talk reads your cycle tracker.')};
 }
 if(['leave-out','count'].includes(action)){
  const state=cycleState(rows(),c.tracker,today),marks=cycleCard(c.tracker),why=action==='leave-out'?(input.why||'outlier'):null;
  if(why&&!WHY.includes(why))throw Error('Leave a cycle out for: '+WHY.join(', '));
  // Which cycle: the one she names by its start; else the unusual one waiting for her answer, or,
  // for pregnancy, breastfeeding or contraception, the cycle she is in now.
  const pending=state.cycles.filter(x=>x.status==='pending').at(-1),start=input.start||(why&&why!=='outlier'?state.open?.start:pending?.start||state.cycles.filter(x=>x.status==='left_out'&&x.why==='outlier').at(-1)?.start);
  const cy=state.cycles.find(x=>x.start===start),isOpen=state.open?.start===start;
  if(!start||!cy&&!isOpen)throw Error(l==='de'?'Welcher Zyklus? Nenne den Tag, an dem er begann.':'Which cycle? Say the day it began.');
  if(why==='outlier'&&!cy)throw Error(l==='de'?'Ein Zyklus ohne Ende hat noch keine Länge.':'A cycle that has not ended has no length yet.');
  const left_out=[...marks.left_out.filter(m=>m.start!==start),...(why?[{start,why}]:[])],counted=action==='count'?[...new Set([...marks.counted,start])]:marks.counted.filter(d=>d!==start);
  setCard({left_out,counted});
  const named=dateWords(l,start)+(cy?' ('+days(l,cy.length)+')':'');
  if(action==='count')return {language:l,start,reply:l==='de'?'Erledigt: Der Zyklus ab dem '+named+' zählt wieder für die Vorhersage.':'Done: the cycle from '+named+' counts in the forecast again.'};
  return {language:l,start,reply:l==='de'?'Erledigt: Der Zyklus ab dem '+named+' bleibt bei der Vorhersage draußen'+(why==='outlier'?'.':' ('+whyWords(l,why)+').'):'Done: the cycle from '+named+' is left out of the forecast'+(why==='outlier'?'.':' ('+whyWords(l,why)+').')};
 }
 if(action==='delete'){
  // Deleted only after one yes, and then nothing of it stays in the notebook (decision 9 of the
  // plan): the rows, the tracker, its questions and this request go as purge tombstones. Over MCP
  // the yes passes back the `expected` hashes the question gave, as every assistant change does.
  const items=rows(),questions=store.list('tracker_proposals').filter(p=>p.specialist==='cycle'),requests=store.list('tracker_deletions').filter(d=>d.collection_id===c.id);
  if(!input.confirm){
   const saved=store.save('tracker_deletions',{collection_id:c.id,rows:items.length,language:l,created_at:now.toISOString()}),d=store.get('tracker_deletions',saved.id);
   const expected=Object.fromEntries([c,...items,...questions,...requests,d].map(r=>[r.type+'/'+r.id,r._hash]));
   return {request_id:d.id,language:l,expected,reply:l==='de'?'Deinen Zyklus-Tracker und seine '+days(l,items.length)+' löschen? Sag ja, dann lösche ich ihn.':'Delete your cycle tracker and its '+days(l,items.length)+'? Say yes to delete it.'};
  }
  const d=store.get('tracker_deletions',input.confirm);
  if(!d||d.removed_at||d.collection_id!==c.id||!(now-Date.parse(d.created_at)<=DELETE_MS))throw Error(l==='de'?'Diese Frage ist abgelaufen. Sag noch einmal "lösche meinen Zyklus-Tracker", dann frage ich neu.':'That question has expired. Say "delete my cycle tracker" again and I will ask once more.');
  const doomed=[...items,c,...questions,...requests];
  store.withLock(()=>store.commit(doomed.map(r=>store.purgeRecord(store.get(r.type,r.id)))));
  return {collection_id:c.id,removed:true,deleted:items.length,language:l,reply:l==='de'?'Gelöscht: Dein Zyklus-Tracker und seine '+days(l,items.length)+' sind aus deinem Notizbuch verschwunden. Was bleibt: deine Nachrichten und meine Antworten im Chatverlauf und ältere Kopien in deinem privaten Backup-Verlauf.':'Deleted: your cycle tracker and its '+days(l,items.length)+' are gone from your notebook. What remains: your messages and my replies in your chat history, and older copies in your private backup history.'};
 }
 throw Error('Unsupported cycle action: '+action);
}
