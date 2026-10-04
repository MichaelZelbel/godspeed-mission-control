import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {hash,atomic} from './records/store.mjs';
import {addArea,findArea,listAreas} from '../../third-party/addons/godspeed-coach/lib/areas.mjs';
import {openTalk,readTalk,talkDates,addSaid,setTalkState,setFollowUp,talkDue} from '../../third-party/addons/godspeed-coach/lib/talks.mjs';
import {dueTick} from '../../third-party/addons/godspeed-coach/lib/tick.mjs';
import {dueMessages} from '../../third-party/addons/godspeed-journal/lib/tick.mjs';
import {checkRecord} from '../../third-party/addons/godspeed-journal/lib/evidence.mjs';
import {listHabits,addHabit,track} from '../../third-party/addons/godspeed-coach/lib/habits.mjs';
import {loadSettings as coachSettings,saveSettings as saveCoach} from '../../third-party/addons/godspeed-coach/lib/settings.mjs';
import {localParts} from '../../third-party/addons/godspeed-coach/lib/clock.mjs';
import {brief} from '../../third-party/addons/godspeed-coach/lib/brief.mjs';
import {setHead,parseDoc,appendToSection} from '../../third-party/addons/godspeed-coach/lib/header.mjs';
import {parseAuto} from '../../third-party/addons/godspeed-coach/lib/auto.mjs';
import {localPath} from './local-path.mjs';
import {readEntries,writeEntry} from '../../third-party/addons/godspeed-journal/lib/store.mjs';
import {loadSettings as journalSettings,saveSettings as saveJournal} from '../../third-party/addons/godspeed-journal/lib/settings.mjs';
import {readEntries as headacheEntries} from '../../third-party/addons/godspeed-headache/lib/store.mjs';
import {episodesFrom} from '../../third-party/addons/godspeed-headache/lib/episodes.mjs';
import {visibleRows} from './visibility.mjs';
import {currentHealth} from './health-inputs.mjs';
import {loadSettings as headacheSettings,saveSettings as saveHeadache} from '../../third-party/addons/godspeed-headache/lib/settings.mjs';
const iso=()=>new Date().toISOString();
export function nativeRows(store,type){
 if(['health_episodes','medications'].includes(type)){const data=episodesFrom(headacheEntries(store.root));if(type==='health_episodes')return data.episodes.map(e=>({...e,id:'headache-'+e.id,uid:hash(e.id),native_file:'routines/headache',onset_at:e.start,created_at:e.start,type,_hash:hash(e)}));return [...data.loose,...data.episodes.flatMap(e=>e.meds)].map(m=>({...m,id:'medication-'+hash(m),uid:hash(m),taken_at:m.taken,created_at:m.taken,type,_hash:hash(m)}));}
 if(type==='coach_talks')return listAreas(store.root).flatMap(area=>talkDates(area).map(day=>{const talk=readTalk(area,day),content=fs.readFileSync(talk.file,'utf8');return {id:'talk-'+area.slug+'-'+day,uid:hash(talk.file).slice(0,32),area:area.slug,native_file:path.relative(store.root,talk.file).replaceAll('\\','/'),question:talk.sections['The opening']||'',replies:(talk.sections['What you said']||'').split('\n').filter(Boolean).map(content=>({content})),sources:talk.sections['What was read']||'',status:talk.state==='opened'?'open':'closed',created_at:talk.opened||day+'T00:00:00Z',_hash:hash(content),type};}));
 if(type==='habits')return listHabits(store.root).map(h=>({id:'habit-'+h.area+'-'+h.slug,uid:hash(h.file).slice(0,32),native_file:path.relative(store.root,h.file).replaceAll('\\','/'),title:h.title,area:h.area,status:h.status,agreement:h.agreed,talk_id:h.agreed.match(/\[talk:(.+?)\]/)?.[1]||null,check_at:parseDoc(fs.readFileSync(h.file,'utf8')).head['CHECK-AT']||null,observations:Object.entries(h.log).map(([at,o])=>({at,content:o.words,answer:o.answer})),_hash:hash(fs.readFileSync(h.file)),created_at:h.started+'T00:00:00Z',type}));
 if(type==='journal')return readEntries(store.root,journalSettings(store.root),{days:3650}).map(e=>({id:'journal-'+hash(e),uid:hash(e).slice(0,32),...e,content:e.words,created_at:e.at,type}));
 return [];
}
function rememberFile(store,file){if(fs.existsSync(file)){const content=fs.readFileSync(file);atomic(path.join(store.root,'coach','history',hash(file)+'-'+hash(content)+'.txt'),content);}}
export function nativeOperation(store,input){
 const timezone=store.get('settings','installation')?.timezone||'UTC',day=localParts(new Date(),timezone).date;
 if(input.type==='coach-open'){
  let area=findArea(store.root,input.area);if(!area)area=addArea(store.root,{slug:input.area,title:input.area,rhythm:'weekly sunday',time:'19:00',starts:day,limits:input.limits||[],preparation:input.preparation||''});
  const previous=nativeRows(store,'coach_talks').find(t=>t.area===input.area&&t.status==='open');if(previous)return previous;
  const today=nativeRows(store,'coach_talks').find(t=>t.area===input.area&&t.id.endsWith(day));if(today)throw Error('Today\'s coaching conversation is already closed; the next conversation opens on another day');
  const settings=coachSettings(store.root);if(settings.timezone!==timezone)saveCoach(store.root,{...settings,timezone,git_sync:'off'});
  openTalk(area,day,{opening:input.question,read:typeof input.sources==='string'?input.sources:JSON.stringify(input.sources||{})});return nativeRows(store,'coach_talks').find(t=>t.area===area.slug&&t.id.endsWith(day));
 }
 if(['coach-reply','coach-close'].includes(input.type)){
  const talk=nativeRows(store,'coach_talks').find(t=>t.id===input.id);if(!talk)throw Error('Native coaching talk missing');if(input.expected&&input.expected!==talk._hash)throw Error('Coaching talk changed; reload before saving');
  const area=findArea(store.root,talk.area),ymd=talk.id.slice(-10);rememberFile(store,path.join(store.root,talk.native_file));
  if(input.type==='coach-reply'){if(talk.status!=='open')throw Error('Coaching talk is closed');addSaid(area,ymd,input.content);}else setTalkState(area,ymd,'held');return nativeRows(store,'coach_talks').find(t=>t.id===talk.id);
 }
 if(input.type==='habit-agree'){
  if(input.auto&&!parseAuto(input.auto))throw Error('Automatic habit evidence needs a numeric measurement comparison');
  const talk=nativeRows(store,'coach_talks').find(t=>t.id===input.talk_id);if(!talk)throw Error('Coaching talk missing');
  const habit=addHabit(store.root,{area:talk.area,title:input.title,doneMeans:input.done_means||input.title,days:input.days||'daily',auto:input.auto||'',agreed:input.agreement+' [talk:'+talk.id+']'},day,coachSettings(store.root).max_habits);
  atomic(habit.file,setHead(fs.readFileSync(habit.file,'utf8'),'CHECK-AT',input.check_at));
  return nativeRows(store,'habits').find(h=>h.id==='habit-'+habit.area+'-'+habit.slug);
 }
 if(input.type==='habit-observe'){
  if(!['done','no','skip'].includes(input.answer))throw Error('Habit observation needs an explicit done, no or skip answer');
  const row=nativeRows(store,'habits').find(h=>h.id===input.id);if(!row)throw Error('Habit missing');const habit=listHabits(store.root).find(h=>h.file===path.join(store.root,row.native_file)),observed=input.observation_day||day;if(!/^\d{4}-\d{2}-\d{2}$/.test(observed)||observed>day)throw Error('Habit observation needs a real current or previous day');rememberFile(store,habit.file);track(habit,observed,input.answer,'conversation',input.observation);return nativeRows(store,'habits').find(h=>h.id===row.id);
 }
 if(input.type==='journal-add'){
  const settings=journalSettings(store.root);if(settings.capture_enabled===false)throw Error('Journaling is switched off');const updated={...settings,timezone,git_sync:'off'};saveJournal(store.root,updated);writeEntry(store.root,updated,{kind:'note',words:input.content,source:input.source_id||'notebook'});return nativeRows(store,'journal').at(-1);
 }
 if(input.type==='journal-switch'){const settings=journalSettings(store.root);saveJournal(store.root,{...settings,capture_enabled:input.enabled});return {enabled:input.enabled};}
 return null;
}
export function addonCommand(store,{addon,args}){
 if(!['coach','journal','headache'].includes(addon)||!Array.isArray(args)||args.some(a=>typeof a!=='string'||a.length>20000)||args.some(a=>['--godspeed','--evidence-script'].includes(a)))throw Error('Invalid personal command');
 const allowed=addon==='headache'?['help','start','end','set','med','cancel','list','show','patterns','daily','context','config']:addon==='coach'?['help','areas','show','area','brief','talk','habit','habits','context','config']:['help','start','define','note','done','drop','reopen','check','status','context','report','week','words','open','met','config'];
 if(!allowed.includes(args[0]))throw Error('This personal command is not available through the notebook');
 if(args.some(a=>/^(?:evidence[.]script|--hook|--command|--script)$/.test(a)))throw Error('Executable hooks require a separately reviewed installation');
 const autoIndex=args.indexOf('--auto');if(autoIndex!==-1&&!parseAuto(args[autoIndex+1]))throw Error('Automatic habit evidence needs a numeric measurement comparison');
 const timezone=store.get('settings','installation')?.timezone||'UTC',load=addon==='headache'?headacheSettings:addon==='coach'?coachSettings:journalSettings,save=addon==='headache'?saveHeadache:addon==='coach'?saveCoach:saveJournal,settings=load(store.root);if(settings.timezone!==timezone)save(store.root,{...settings,timezone});
 if(addon==='coach'&&settings.daily_table)localPath(store.root,settings.daily_table);
 if(args[0]==='config'&&args[1]==='set'&&args[2]==='daily_table'&&args[3])localPath(store.root,args[3]);
 if(addon==='journal'&&settings.evidence?.script&&args[0]==='check')throw Error('Executable journal evidence requires a separately reviewed installation');
 fs.mkdirSync(path.join(store.root,'observations'),{recursive:true});
 if(!fs.existsSync(path.join(store.root,'AGENTS.md')))atomic(path.join(store.root,'AGENTS.md'),'# Personal workspace\n\nKeep durable state in user files. Outward actions require exact approval.\n');
 const script=fileURLToPath(new URL('../../third-party/addons/godspeed-'+addon+'/bin/godspeed-'+addon+'.mjs',import.meta.url));
 const run=spawnSync(process.execPath,[script,...args,'--godspeed',store.root,'--json'],{cwd:store.root,windowsHide:true,shell:false,timeout:15000,encoding:'utf8',env:{...process.env,GODSPEED_COACH_APP:path.join(store.state,'coach-app'),GODSPEED_JOURNAL_APP:path.join(store.state,'journal-app'),GODSPEED_COACH_GIT_SYNC:'off',GODSPEED_JOURNAL_GIT_SYNC:'off',GODSPEED_HEADACHE_GIT_SYNC:'off'}});
 if(run.status!==0)throw Error('Personal command failed: '+String(run.stderr||'No result').slice(0,300));return {result:run.stdout.trim()};
}
export function nativeCoachContext(store,area){const a=findArea(store.root,area);if(!a)return null;return brief(store.root,coachSettings(store.root),a,localParts(new Date(),coachSettings(store.root).timezone).date);}
export function dueCoachAreas(store,now=new Date()){return listAreas(store.root).filter(a=>talkDue(a,now,store.get('settings','installation')?.timezone||'UTC')).map(a=>a.slug);}
export function ensureNativeSchedules(store,addon){
 const owner=store.get('settings','installation')?.owner||store.device;
 for(const kind of addon==='coach'?['coach-tick','coach-cycle']:['journal-tick'])if(!store.get('jobs',kind))store.save('jobs',{id:kind,kind,owner,paused:false,next_run:new Date().toISOString(),interval_ms:900000,state:'pending'});
}
export function retainHabitReview(store,habit,question,sources){
 return store.withLock(()=>{
  const current=nativeRows(store,'habits').find(h=>h.id===habit.id);if(!current||current._hash!==habit._hash)throw Error('Habit changed during its review');
  const file=path.join(store.root,current.native_file),previous=fs.readFileSync(file,'utf8'),text=appendToSection(previous,'Reviews',JSON.stringify({at:iso(),question,sources}));
  const note=store.prepare('notes',{title:'Review '+current.title,content:question,source_app:'habit-check',habit_ids:[current.id],observation_day:localParts(new Date(),store.get('settings','installation')?.timezone||'UTC').date});store.commit([note],{files:[{file:current.native_file,text},{file:'coach/history/'+hash(file)+'-'+hash(previous)+'.txt',text:previous}]});return note;
 });
}
export function nativeTick(store,addon,now=new Date(),query){
 let messages=[],writes=[];
 const timezone=store.get('settings','installation')?.timezone||'UTC';
 if(addon==='coach'){
  const settings={...coachSettings(store.root),timezone},table={};for(const observation of (query?currentHealth(query,{now:now.getTime()}).observations:store.list('health_observations').filter(r=>r.ai_visibility!=='hidden'&&!r.is_sensitive&&Date.parse(r.observed_at)<=now.getTime()&&Date.parse(r.observed_at)>=now.getTime()-7*86400000)).sort((a,b)=>a.observed_at.localeCompare(b.observed_at))){const day=observation.observed_on||localParts(new Date(observation.observed_at),timezone).date;(table[day]||={date:day})[observation.metric.replaceAll(' ','_')]=String(observation.value);}({messages,writes}=dueTick(store.root,settings,now,table));
 }else{
  const settings={...journalSettings(store.root),timezone};if(settings.capture_enabled===false)return {verified:true,silent:true};
  // The integrated worker reads record evidence. Executable evidence hooks are
  // not enabled by model-generated configuration.
  const es=readEntries(store.root,settings,{days:8,until:now}),checked=checkRecord(store.root,{...settings,evidence:{script:''}},es,now);
  for(const c of checked.closes)writeEntry(store.root,settings,c,now);
  const due=dueMessages(readEntries(store.root,settings,{days:8,until:now}),settings,now,checked.verdicts);messages=due.messages;writes=due.records;
 }
 const occurrence=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(now),identity=message=>'native-'+hash([addon,occurrence,message]);
 const fresh=messages.filter(message=>!store.get('notifications',identity(message)));
 const habitIds=writes.filter(w=>w.kind==='asked').map(w=>'habit-'+w.habit.area+'-'+w.habit.slug);
 let note;if(fresh.length){note=store.save('notes',{title:addon==='coach'?'From your coach':'Your journal check-in',content:fresh.join('\n\n'),source_app:addon+'-tick',habit_ids:habitIds,observation_day:localParts(now,timezone).date});for(const message of fresh)store.save('notifications',{id:identity(message),record_id:note.id,status:'ready',occurrence});}
 store.withLock(()=>{
  if(addon==='coach')for(const w of writes){
   if(w.habit)rememberFile(store,w.habit.file);else if(w.area)rememberFile(store,path.join(w.area.dir,'talks',w.ymd+'.md'));
   if(w.kind==='asked')track(w.habit,w.ymd,'asked','tick','');else if(w.kind==='auto')track(w.habit,w.ymd,'done','data',w.words);else if(w.kind==='follow-up')setFollowUp(w.area,w.ymd,w.at);else if(w.kind==='not-held')setTalkState(w.area,w.ymd,'not-held');
  }else for(const r of writes)writeEntry(store.root,{...journalSettings(store.root),timezone},{source:'tick',...r},now);
 });
 return {verified:true,silent:!fresh.length,...(note?{record_id:note.id,delivery:'notebook'}:{})};
}
