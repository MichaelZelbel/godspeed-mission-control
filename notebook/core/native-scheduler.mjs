import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {hash} from './records/store.mjs';
import {assistantEnvironment} from './assistant-files.mjs';
import {nativeCardRows} from './card-commands.mjs';
import {runCommand} from './child-process.mjs';
import {beatWhile,HEARTBEAT_EVERY} from './supervisor-health.mjs';
import {LEGACY_DEVICE} from './device-id.mjs';
import {starterBorn} from './starter-workspace.mjs';
import {setHermesTimezone} from './hermes-config.mjs';
import {FLAG,STARTING_ROUTINES,routineFiles,writeRoutineFiles,prepareCheckIn,saveRoutineResults,readMachineRecord,writeMachineRecord,telegramInHermes,routineStatus,ownRoutines,metAt,noteHermesMet,cityFiledFirst,OWN_ROUTINES_RULE} from './starting-routines.mjs';
import {cronOf,cronCalendar,calendarCron,retimeWhat,isTalkGate,isCoachTick,talkArea,moveTalk} from './routine-times.mjs';
import {readNotebookRoutines,rememberNotebookRoutine,enableKind,deliveryFor,journalWanted,journalOnTheClock,JOURNAL_JOB,JOURNAL_SCRIPT,JOURNAL_WHAT,CHAT_TIDY_JOB,CHAT_TIDY_SCRIPT,CHAT_TIDY_SCHEDULE,CHAT_TIDY_WHAT} from './notebook-routines.mjs';
import {loadSettings as coachSettings,saveSettings as saveCoach} from '../../third-party/addons/godspeed-coach/lib/settings.mjs';
import {rhythmWords} from '../../third-party/addons/godspeed-coach/lib/areas.mjs';
import {moveSettingsDeadlines} from './native-due.mjs';
const skills={'morning-brief':'morning-brief',coaching:'coach','habit-check':'coach',journal:'interstitial-journal',headache:'headache-tracker'};
// Hermes' own record of its jobs, as it wrote it.
export function hermesJobs(home){
 const file=path.join(home,'cron/jobs.json');if(!fs.existsSync(file))return [];
 const data=JSON.parse(fs.readFileSync(file,'utf8')),jobs=Array.isArray(data)?data:data.jobs||[];
 return jobs.filter(j=>j&&typeof j==='object');
}
// When a routine last ran and how it went is Hermes' own record (last_run_at, last_status,
// last_error); until 8 October 2026 the Routines list showed neither. A daily round that told the
// person it went wrong is shown as failed (starting-routines.mjs, routineStatus).
export function nativeJobs(home,device='local'){
 return hermesJobs(home).map(j=>({id:j.id,title:j.name||j.id,kind:j.skill||j.name||'Hermes task',owner:device,paused:j.enabled===false,state:j.state||j.last_status||'pending',next_run:j.next_run_at,last_run_at:j.last_run_at||null,last_status:j.last_status||null,last_error:typeof j.last_error==='string'?j.last_error.slice(0,500):null,...routineStatus(home,j),schedule:j.schedule_display||null,...(cronCalendar(cronOf(j))&&!isTalkGate(j)&&!isCoachTick(j)?{calendar:cronCalendar(cronOf(j))}:{}),deliver:j.deliver||null,created_at:j.created_at,interval_ms:j.schedule?.seconds?j.schedule.seconds*1000:null,native:true,_hash:hash(j)}));
}
const RETRY_STARTING=3600000;
// "05:16": once a day at that time in the owner's timezone.
export function dailyTime(at){const m=/^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(at||'').trim());return m?{hour:Number(m[1]),minute:Number(m[2]),time:m[1].padStart(2,'0')+':'+m[2]}:null;}
// `hermes cron tick` runs every due job to the end before it returns (and has
// already moved each job's next run on, so a killed run is lost for the day).
// Hermes stops a job that goes quiet for ten minutes and gives a job's own
// script 9000 seconds (cron.script_timeout_seconds, hermes-config.mjs; the nightly goal research is
// the longest script, up to 8100 seconds), so a tick gets two hours and forty-five minutes; past
// that it is stopped with all it started, and its heartbeat stops with it.
export const TICK_LIMIT=(2*60+45)*60000;
// The notebook edits Hermes schedules; it never runs a second scheduler. The
// notebook's own record routines that Hermes has no job for (the watch sweep,
// radar preparation and application) run beside it in `records`.
export class NativeScheduler{
 // Until 6 October 2026 these record routines never ran with the original
 // assistant: a watch topic was never read again, and radar work stayed
 // "preparing" for ever. They run on the machine that runs the routines.
 static recordKinds=['watch','domain-watch','radar-prepare','radar-work'];
 constructor(store,{executable,home,device=store.device,run=runCommand,records=null,tickLimit=TICK_LIMIT,beatEvery=HEARTBEAT_EVERY}){
  Object.assign(this,{store,executable,home,device,run,records,tickLimit,beatEvery});
  if(records)records.onProgress=()=>this.onProgress?.();
 }
 // A connected provider reaches the record routines too (/api/provider).
 set executor(value){if(this.records)this.records.executor=value;}
 get executor(){return this.records?.executor||null;}
 async command(args,{timeout=120000}={}){const timezone=this.store.get('settings','installation')?.timezone,env=assistantEnvironment({home:this.home,workspace:this.store.root});if(timezone)env.HERMES_TIMEZONE=timezone;const result=await this.run(this.executable,['cron',...args],{cwd:this.store.root,windowsHide:true,shell:false,env,maxBuffer:1024*1024,timeout});return result.stdout;}
 async configure({goal,timezone,owner=this.device,delivery='notebook'}){
  timezone||=Intl.DateTimeFormat().resolvedOptions().timeZone;new Intl.DateTimeFormat('en',{timeZone:timezone});
  const old=this.store.get('settings','installation');
  if(!old&&!goal?.trim())throw Error('Name one goal to start');
  await this.store.saveAsync('settings',{id:'installation',owner,timezone,delivery,...old});
  // A first setup sets Hermes' clock to the reader's zone, routines or not (hermes-config.mjs).
  if(!old&&starterBorn(this.store.root))try{setHermesTimezone(this.home,timezone);}catch{}
  if(goal?.trim()&&!nativeCardRows(this.store,'goals').some(g=>g.title===goal.trim())){
   const script=new URL('../../tools/goals.js',import.meta.url);
   await this.run(process.execPath,[fileURLToPath(script),'file','--kind','outcome','--status','adopted','--title',goal.trim(),'--source','Notebook setup, '+new Date().toISOString(),'--godspeed',this.store.root],{cwd:this.store.root,windowsHide:true,env:assistantEnvironment({home:this.home,workspace:this.store.root}),timeout:120000});
  }
  // The first goal starts the routines: at the first setup, and when the mission control is still
  // waiting for its first goal (the getting-to-know-you chat filed the city before it). An
  // installation set up before 8 October 2026 is left as it is (startRoutinesNow). Until
  // 17 October 2026 this asked only whether an installation record was there, so a first goal
  // given here after the chat's city started nothing.
  const routines=await this.startRoutines({goal:nativeCardRows(this.store,'goals').find(g=>g.title===goal?.trim())?.id,setup:!old});
  return {configured:true,preserved:!!old,firstWorkPending:false,scheduler:'hermes',...(routines?{routines}:{})};
 }
 // The starting routines (starting-routines.mjs), made once per machine that runs them: at the
 // first setup; when the goal was told in the chat and filed there, the first time a tick finds an
 // adopted goal; and when another machine becomes the one that runs the routines (a server joined
 // later), since Hermes' routines live in each machine's own Hermes and are never copied. One at a
 // time: a setup and a tick never make them twice.
 //
 // Two records. The mission control's own, in its settings (it travels with the folder): its first
 // goal started the routines, or why not. This machine's own, beside its Hermes (it never
 // travels): this Hermes got them, or why not; a reader who removes one does not get it back.
 startRoutines(options={}){const next=(this.starting||Promise.resolve()).then(()=>this.startRoutinesNow(options));this.starting=next.catch(()=>{});return next;}
 async startRoutinesNow({goal=null,setup=false}={}){
  const root=this.store.root,flag=this.store.get('settings',FLAG),here=readMachineRecord(this.store),now=Date.now();
  let installation=this.store.get('settings','installation');
  // A skip decided before 17 October 2026 counted every job in Hermes as the reader's own,
  // Godspeed's own invitation, a morning brief and a chat reminder included (ownRoutines). It is
  // looked at once more under today's rule, and what that decides stays.
  const again=here?.state==='skipped'&&here.rule!==OWN_ROUTINES_RULE&&!(flag?.state==='skipped'&&flag.rule===OWN_ROUTINES_RULE);
  // Once per machine, whatever became of it.
  if(here&&here.state!=='pending'&&!again)return null;
  if(here?.retry_after&&Date.parse(here.retry_after)>now)return null;
  // The mission control's first machine already had routines of its own: none were started.
  if(flag?.state==='skipped'&&!again)return null;
  // A mission control set up before 8 October 2026, with no record of starting routines, is left
  // alone; one whose installation record the getting-to-know-you chat's city wrote is new.
  const waiting=!flag&&!!installation&&cityFiledFirst(this.store,installation);
  if(!flag&&installation&&!setup&&!waiting)return null;
  // Never for a mission control not made from the starter: the owner's adopted one, live on
  // several machines with routines of its own, gets nothing new.
  if(!starterBorn(root))return null;
  // When this mission control came to this machine, written once (starting-routines.mjs, metAt).
  try{noteHermesMet(this.store,{home:this.home,now});}catch{}
  const adopted=nativeCardRows(this.store,'goals').filter(g=>g.status==='adopted').sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)));
  const serves=goal||flag?.goal||adopted[0]?.id||null,at=new Date(now).toISOString();
  const record=fields=>this.store.saveAsync('settings',{id:FLAG,goal:serves,...fields});
  if(!adopted.length){if((setup||waiting)&&!flag)await record({state:'pending',requested_at:at});return null;}
  // Routines live in the Hermes of the machine that runs them; another machine makes them there.
  if(installation?.owner&&installation.owner!==this.device){if(!flag)await record({state:'pending',requested_at:at});return {state:'pending',owner:installation.owner};}
  const theirs=ownRoutines(hermesJobs(this.home),{root,since:metAt(this.store)});
  if(theirs.length){
   const because=theirs.map(j=>({id:j.id,name:j.name||null}));
   writeMachineRecord(this.store,{state:'skipped',device:this.device,reason:'This machine\'s Hermes already had routines of its own',rule:OWN_ROUTINES_RULE,because,decided_at:here?.decided_at||at,...(again?{looked_again_at:at}:{})});
   if(!flag||flag.state==='pending'||again&&flag.state==='skipped')await record({state:'skipped',reason:'Hermes already had routines of its own',rule:OWN_ROUTINES_RULE,decided_at:flag?.decided_at||at});
   return {state:'skipped'};
  }
  // A skip the old rule decided, undone: its reason no longer holds.
  const unskip=again&&flag?.state==='skipped'?{reason:null,rule:null,decided_at:null}:null;
  // The goal was told in the chat before any setup: this machine runs the routines, on its own
  // clock.
  if(!installation)installation=await this.store.saveAsync('settings',{id:'installation',owner:this.device,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,delivery:'notebook'});
  const timezone=installation.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone,delivery=deliveryFor(installation,{telegram:telegramInHermes(this.home)});
  let jobs;
  // Hermes' own clock in the reader's zone too, so a routine asked for in the chat ("every
  // weekday at seven") is read on their clock; a zone already chosen stays.
  try{setHermesTimezone(this.home,timezone);}catch{}
  try{
   writeRoutineFiles(this.home,routineFiles({root,home:this.home,state:this.store.state,timezone,hermes:this.executable}));
   prepareCheckIn(root,{timezone,delivery,goal:serves});
   jobs=await this.createStartingRoutines(delivery);
  }catch(error){
   const message=String(error?.message||error).slice(0,300);
   writeMachineRecord(this.store,{state:'pending',device:this.device,error:message,retry_after:new Date(now+RETRY_STARTING).toISOString()});
   if(!flag||unskip)await record({state:'pending',requested_at:at,...unskip});
   return {state:'pending',error:message};
  }
  writeMachineRecord(this.store,{state:'created',device:this.device,created_at:at,timezone,delivery,jobs});
  if(flag?.state!=='created')await record({state:'created',first_device:this.device,created_at:at,...unskip});
  return {state:'created',jobs};
 }
 async createStartingRoutines(delivery,routines=STARTING_ROUTINES){
  const made=[];
  try{
   for(const routine of routines){
    const before=new Set(hermesJobs(this.home).map(j=>j.id));
    await this.command(['create',routine.schedule,...(routine.prompt?[routine.prompt]:['--no-agent']),'--name',routine.name,'--script',routine.script,'--deliver',delivery,'--failure-deliver','local','--workdir',this.store.root]);
    const job=hermesJobs(this.home).find(j=>!before.has(j.id)&&j.name===routine.name);
    if(!job)throw Error('Hermes did not keep the routine "'+routine.name+'"');
    made.push({id:job.id,key:routine.key,name:routine.name,what:routine.what});
   }
  }catch(error){for(const job of made)await this.command(['remove',job.id]).catch(()=>{});throw error;}
  return made;
 }
 // A routine added to the starting routines after a machine got its first ones (the nightly goal
 // research, 13 October 2026) is made once on that machine too, when it is not in the machine's
 // record of what it was offered: a routine the reader removed was offered, so it stays removed.
 // A routine that needs a recipe waits until the mission control has it.
 async addNewStartingRoutines(){
  const root=this.store.root,here=readMachineRecord(this.store),installation=this.store.get('settings','installation');
  if(here?.state!=='created'||!Array.isArray(here.jobs)||!installation?.timezone||!starterBorn(root))return [];
  const offered=new Set(here.jobs.map(j=>j.key)),missing=STARTING_ROUTINES.filter(r=>!offered.has(r.key)&&(!r.needs||fs.existsSync(path.join(root,'skills',r.needs,'SKILL.md'))));
  if(!missing.length)return [];
  writeRoutineFiles(this.home,routineFiles({root,home:this.home,state:this.store.state,timezone:installation.timezone,hermes:this.executable}));
  const made=await this.createStartingRoutines(here.delivery||'local',missing);
  writeMachineRecord(this.store,{...here,jobs:[...here.jobs,...made]});
  return made;
 }
 // WHERE THIS MACHINE'S ROUTINES DELIVER, FOLLOWED (18 October 2026, notebook-routines.mjs
 // deliveryFor). The starting routines and the routines the notebook made are moved to Telegram once
 // this machine's Hermes has a bot, and back when "Keep results here" is pressed; a routine made in
 // the chat answers where it was asked and is left alone, and so is one delivering anywhere else.
 // The weekly check-in waits in the chat without a messenger and is sent with one.
 async followDelivery(){
  const installation=this.store.get('settings','installation'),want=deliveryFor(installation,{telegram:telegramInHermes(this.home)});
  const here=readMachineRecord(this.store),mine=readNotebookRoutines(this.store),created=here?.state==='created'&&Array.isArray(here.jobs);
  // The night chat tidy-up is the one routine whose results are never delivered: its output is its
  // log, and it exists only where a chat app is connected, which is where this would send it to the
  // chat. It stays "local" (notebook-routines.mjs, CHAT_TIDY_JOB).
  const ids=new Set([...(created?here.jobs.map(j=>j.id):[]),...mine.jobs.filter(j=>j.key!=='chat-tidy').map(j=>j.id)]);if(!ids.size)return [];
  const moved=[];
  for(const job of hermesJobs(this.home).filter(j=>ids.has(j.id)&&['local','telegram'].includes(String(j.deliver||''))&&j.deliver!==want)){await this.command(['edit',job.id,'--deliver',want]);moved.push(job.id);}
  if(created&&here.delivery!==want)writeMachineRecord(this.store,{...here,delivery:want});
  if(created)try{const settings=coachSettings(this.store.root),talk=want==='telegram'?'messenger':'chat';if(settings.talk_delivery!==talk)saveCoach(this.store.root,{...settings,talk_delivery:talk});}catch{}
  return moved;
 }
 // THE JOURNAL'S CHECK-INS (notebook-routines.mjs): one routine while the person has any of them
 // switched on, paused when all are off, made again by nothing once the person removed it.
 async followJournal(){
  const root=this.store.root;if(!starterBorn(root))return null;
  const mine=readNotebookRoutines(this.store),entry=mine.jobs.find(j=>j.key==='journal-tick'),jobs=hermesJobs(this.home);
  const job=(entry&&jobs.find(j=>j.id===entry.id))||jobs.find(j=>[JOURNAL_JOB,'godspeed-journal-tick'].includes(j.name));
  if(!journalWanted(root)){
   if(job&&entry&&job.enabled!==false){await this.command(['pause',job.id]);rememberNotebookRoutine(this.store,{...entry,paused_by_notebook:true});}
   return null;
  }
  // A routine the person removed stays removed: it was made once, and its record says so.
  if(entry&&!job)return null;
  const installation=this.store.get('settings','installation'),timezone=installation?.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone;
  try{journalOnTheClock(root,timezone);}catch{}
  writeRoutineFiles(this.home,routineFiles({root,home:this.home,state:this.store.state,timezone,hermes:this.executable}));
  if(job){
   if(entry&&job.enabled===false&&entry.paused_by_notebook){await this.command(['resume',job.id]);rememberNotebookRoutine(this.store,{...entry,paused_by_notebook:false});}
   return job.id;
  }
  const delivery=deliveryFor(installation,{telegram:telegramInHermes(this.home)}),before=new Set(jobs.map(j=>j.id));
  await this.command(['create','*/15 * * * *','--no-agent','--name',JOURNAL_JOB,'--script',JOURNAL_SCRIPT,'--deliver',delivery,'--failure-deliver','local','--workdir',root]);
  const made=hermesJobs(this.home).find(j=>!before.has(j.id)&&j.name===JOURNAL_JOB);
  if(!made)throw Error('Hermes did not keep the routine "'+JOURNAL_JOB+'"');
  rememberNotebookRoutine(this.store,{id:made.id,key:'journal-tick',name:JOURNAL_JOB,what:JOURNAL_WHAT});
  return made.id;
 }
 // THE NIGHT CHAT TIDY-UP (notebook-routines.mjs): one routine on every install whose Hermes has a
 // chat app connected, because that is where a chat grows long enough that summarising it in front
 // of a message makes the person wait minutes for an answer. It is made once: a second wiring, a
 // restart or an update finds it by the id this machine remembers or by its name and makes no
 // second one, and a routine the person removed stays removed, as the journal's does. Nothing on a
 // mission control not made from the starter (the owner's adopted one, live on several machines,
 // with routines of its own).
 async followChatTidy(){
  const root=this.store.root;if(!starterBorn(root)||!telegramInHermes(this.home))return null;
  const mine=readNotebookRoutines(this.store),entry=mine.jobs.find(j=>j.key==='chat-tidy'),jobs=hermesJobs(this.home);
  const job=(entry&&jobs.find(j=>j.id===entry.id))||jobs.find(j=>j.name===CHAT_TIDY_JOB);
  if(job){if(!entry)rememberNotebookRoutine(this.store,{id:job.id,key:'chat-tidy',name:CHAT_TIDY_JOB,what:CHAT_TIDY_WHAT});return job.id;}
  // A routine the person removed stays removed: it was made once, and its record says so.
  if(entry)return null;
  const installation=this.store.get('settings','installation'),timezone=installation?.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone;
  // 01:30 is read on Hermes' own clock, which is the install's zone (a zone already chosen stays).
  try{setHermesTimezone(this.home,timezone);}catch{}
  writeRoutineFiles(this.home,routineFiles({root,home:this.home,state:this.store.state,timezone,hermes:this.executable}));
  const before=new Set(jobs.map(j=>j.id));
  // Nothing is delivered: its output is its log, and a failed run reaches the Routines list.
  await this.command(['create',CHAT_TIDY_SCHEDULE,'--no-agent','--name',CHAT_TIDY_JOB,'--script',CHAT_TIDY_SCRIPT,'--deliver','local','--failure-deliver','local','--workdir',root]);
  const made=hermesJobs(this.home).find(j=>!before.has(j.id)&&j.name===CHAT_TIDY_JOB);
  if(!made)throw Error('Hermes did not keep the routine "'+CHAT_TIDY_JOB+'"');
  rememberNotebookRoutine(this.store,{id:made.id,key:'chat-tidy',name:CHAT_TIDY_JOB,what:CHAT_TIDY_WHAT});
  return made.id;
 }
 // SETTINGS > NOTIFICATIONS (18 October 2026). Its switches came from the hosted notebook (a daily
 // digest by email, stale action items, contact follow-ups, patterns, a Friday reminder) and nothing
 // read them, so they sent nothing. Now they are the two messages a person would switch there,
 // read from and written to the routines that send them: the morning brief, a summary of the day
 // at the time chosen, and the weekly review, on the day and time chosen. On makes the routine or
 // resumes it at that time; off pauses it. Where they arrive is Routine delivery's.
 // {daily:{enabled,time}, weekly:{enabled,day,time}}, day 0 (Sunday) to 6.
 notificationJob(skill){
  const mine=new Set(readNotebookRoutines(this.store).jobs.map(j=>j.id)),root=this.store.root;
  const jobs=hermesJobs(this.home).filter(j=>[j.skill,...(Array.isArray(j.skills)?j.skills:[])].includes(skill));
  return jobs.find(j=>mine.has(j.id))||jobs.find(j=>typeof j.workdir==='string'&&path.resolve(j.workdir)===path.resolve(root))||jobs[0]||null;
 }
 notifications(){
  const read=(skill,fallback)=>{const job=this.notificationJob(skill),calendar=job?cronCalendar(cronOf(job)):null;return {enabled:!!job&&job.enabled!==false,time:calendar?.times?.[0]||fallback.time,...(fallback.day!==undefined?{day:calendar&&calendar.weekdays.length===1?calendar.weekdays[0]:fallback.day}:{})};};
  return {daily:read('morning-brief',{time:'07:00'}),weekly:read('weekly-review',{time:'17:00',day:5}),delivery:deliveryFor(this.store.get('settings','installation'),{telegram:telegramInHermes(this.home)})};
 }
 async setNotifications(input={}){
  this.requireOwner('Change what is sent');
  for(const [key,skill,kind] of [['daily','morning-brief','morning-brief'],['weekly','weekly-review','review']]){
   const want=input[key];if(!want||typeof want.enabled!=='boolean')continue;
   const time=String(want.time||(key==='daily'?'07:00':'17:00'));if(!dailyTime(time))throw Error('Give a time written like 07:30');
   const day=key==='weekly'?Number(want.day??5):null;if(key==='weekly'&&!(Number.isInteger(day)&&day>=0&&day<=6))throw Error('Choose a day of the week');
   const calendar={times:[dailyTime(time).time],weekdays:key==='weekly'?[day]:[0,1,2,3,4,5,6]},job=this.notificationJob(skill);
   if(!want.enabled){if(job&&job.enabled!==false)await this.command(['pause',job.id]);continue;}
   if(!fs.existsSync(path.join(this.store.root,'skills',skill,'SKILL.md')))throw Error('This mission control does not have the recipe for '+(key==='daily'?'the morning brief':'the weekly review'));
   if(job){
    const before=cronCalendar(cronOf(job));if(!before||calendarCron(before)!==calendarCron(calendar))await this.retime(job,calendar);
    if(job.enabled===false)await this.command(['resume',job.id]);
    continue;
   }
   const known=enableKind(kind),delivery=deliveryFor(this.store.get('settings','installation'),{telegram:telegramInHermes(this.home)}),before=new Set(hermesJobs(this.home).map(j=>j.id));
   await this.command(['create',calendarCron(calendar),'Follow the '+skill+' recipe for this mission control.','--name',known.label,'--skill',skill,'--workdir',this.store.root,'--deliver',delivery]);
   const made=hermesJobs(this.home).find(j=>!before.has(j.id));
   if(made)rememberNotebookRoutine(this.store,{id:made.id,key:kind,name:made.name||known.label,skill,what:known.what});
  }
  return this.notifications();
 }
 // ROUTINE TIMES (routine-times.mjs): a Hermes routine gets its new cron line, and its sentence names
 // the new time; the weekly check-in moves its talk; the coach's reminders have no time to move.
 async retime(job,calendar){
  if(isCoachTick(job))throw Error('This routine has no time of its own: every 15 minutes it looks whether a reminder or a habit question is due.');
  if(isTalkGate(job)){
   const area=talkArea(this.store.root);if(!area)throw Error('There is no talk to move yet.');
   const moved=moveTalk(area,calendar),here=readMachineRecord(this.store);
   if(here?.jobs?.some(j=>j.id===job.id))writeMachineRecord(this.store,{...here,jobs:here.jobs.map(j=>j.id===job.id&&typeof j.what==='string'?{...j,what:j.what.replace(/(?:every day|(?:Sun|Mon|Tues|Wednes|Thurs|Fri|Satur)days|every (?:Sun|Mon|Tues|Wednes|Thurs|Fri|Satur)day|on the \d+\w* of every month) at \d\d:\d\d/,rhythmWords(moved))}:j)});
   return nativeJobs(this.home,this.device).find(j=>j.id===job.id);
  }
  const before=cronCalendar(cronOf(job));if(!before)throw Error('This routine runs on a rhythm, not at a time of day. Ask in the chat to change it.');
  const expr=calendarCron(calendar),after=cronCalendar(expr);
  await this.command(['edit',job.id,'--schedule',expr]);
  const here=readMachineRecord(this.store);
  if(here?.jobs?.some(j=>j.id===job.id))writeMachineRecord(this.store,{...here,jobs:here.jobs.map(j=>j.id===job.id?{...j,what:retimeWhat(j.what,before.times,after.times)}:j)});
  return nativeJobs(this.home,this.device).find(j=>j.id===job.id);
 }
 // After every tick on the machine that runs the routines of a starter-born mission control: the
 // starting routines' scripts follow the notebook's folders (an upgrade moves them), and a reply
 // that reached nobody becomes a note.
 afterTick(){
  if(!starterBorn(this.store.root))return [];
  const here=readMachineRecord(this.store),installation=this.store.get('settings','installation');
  if(here?.state==='created'&&installation?.timezone)writeRoutineFiles(this.home,routineFiles({root:this.store.root,home:this.home,state:this.store.state,timezone:installation.timezone,hermes:this.executable}));
  return saveRoutineResults(this.store,{home:this.home,jobs:hermesJobs(this.home),messenger:telegramInHermes(this.home)});
 }
 // The notebook's record routines move with the owner; Hermes' own routines
 // live in each machine's Hermes and stay where they were made. A machine that
 // becomes the one that runs the routines gets the starting routines in its
 // own Hermes, if it has none (startRoutinesNow; its every tick checks too).
 async transfer(owner){if(!this.store.get('settings','installation'))throw Error('Complete setup first');await this.store.withLockAsync(()=>{const current=this.store.get('settings','installation');this.store.commit([this.store.prepare('settings',{owner},current),...this.store.list('jobs').filter(j=>j.owner!==owner).map(j=>this.store.prepare('jobs',{owner},j))]);});if(owner===this.device)this.startRoutines().catch(()=>null);}
 // onProgress is what the health check reads as "the server is alive". A
 // deliberately skipped tick is alive, and so is a tick inside its time limit
 // (beatWhile); a tick past its limit is not reported, so a wedged scheduler
 // is still caught and restarted.
 // Only the machine the owner chose runs routines; until 6 October 2026 every
 // machine with the assistant ticked them, so a routine could run twice.
 owner(){return this.store.get('settings','installation')?.owner||null;}
 owns(){const owner=this.owner();return !owner||owner===this.device;}
 async tick(){
  // A notebook still owned by the old shared name is taken over (device-id.mjs).
  if(this.owner()===LEGACY_DEVICE&&this.claimLegacy)try{await this.claimLegacy();}catch{}
  if(!this.owns()){this.onProgress?.();return [];}
  const records=this.records?.tick().catch(()=>[])||Promise.resolve([]);
  if(this.ticking)return records;
  if(Date.now()-(this.lastTick||0)<60000){this.onProgress?.();return records;}
  this.ticking=true;this.lastTick=Date.now();
  try{
   await this.startRoutines().catch(()=>null);
   await this.addNewStartingRoutines().catch(()=>null);
   await this.followJournal().catch(()=>null);
   await this.followChatTidy().catch(()=>null);
   await this.followDelivery().catch(()=>null);
   try{moveSettingsDeadlines(this.store);}catch{}
   await beatWhile(this.command(['tick'],{timeout:this.tickLimit}),()=>this.onProgress?.(),{limitMs:this.tickLimit+60000,every:this.beatEvery});
   try{this.afterTick();}catch{}
  }
  finally{this.ticking=false;}
  return records;
 }
 // A routine lives in the Hermes of the machine that runs routines; added or
 // run on another machine it would sit in that machine's Hermes and never run
 // (or run beside the owner's). Until 6 October 2026 nothing said so.
 requireOwner(action){if(!this.owns())throw Error('Routines run on the machine named '+this.owner()+'. '+action+' there, or choose this machine to run the routines.');}
 // "Run now" from the notebook answers at once and the run goes on in the background (until
 // 9 October 2026 the request waited for the whole run, and a routine that runs a model for
 // minutes outlived the caller: Node's fetch gave up after 300 seconds). A wrong id or a machine
 // that does not run the routines is still said at once. The run's result reaches the person the
 // way a scheduled one does, and Settings > Routines shows it when it ends.
 startRun(id){
  this.requireOwner('Run the routine');
  if(id&&!nativeJobs(this.home,this.device).some(j=>j.id===id))throw Error('Choose an existing Hermes task');
  const run=this.runNow(id);this.running=run;run.catch(()=>{}).finally(()=>{if(this.running===run)this.running=null;});
  return {started:true,...(id?{id}:{})};
 }
 async runNow(id){
  this.requireOwner('Run the routine');
  const work=id?(()=>{if(!nativeJobs(this.home,this.device).some(j=>j.id===id))throw Error('Choose an existing Hermes task');return this.command(['run',id],{timeout:this.tickLimit});})():this.command(['tick'],{timeout:this.tickLimit});
  const result=await beatWhile(work,()=>this.onProgress?.(),{limitMs:this.tickLimit+60000,every:this.beatEvery});
  try{this.afterTick();}catch{}
  return result;
 }
 async control(input,{enable=false}={}){
  if(enable){
   this.requireOwner('Add the routine');
   const known=enableKind(input.kind),skill=known?.skill||skills[input.kind]||input.kind;
   if(!/^[a-z0-9-]+$/.test(skill)||!fs.existsSync(path.join(this.store.root,'skills',skill,'SKILL.md')))throw Error('This mission control does not have the recipe for that routine');
   const running=hermesJobs(this.home).find(j=>j.enabled!==false&&[j.skill,...(Array.isArray(j.skills)?j.skills:[])].includes(skill));
   if(running)throw Error('"'+(running.name||skill)+'" already runs this. Change its time under Routine times, or pause it under Routines.');
   const daily=dailyTime(input.at);
   if(!daily&&(!Number.isFinite(input.interval_ms)||input.interval_ms<60000))throw Error('Choose a daily time or a routine interval of at least a minute');
   const delivery=deliveryFor(this.store.get('settings','installation'),{telegram:telegramInHermes(this.home)}),before=new Set(hermesJobs(this.home).map(j=>j.id));
   await this.command(['create',daily?daily.minute+' '+daily.hour+' * * *':Math.ceil(input.interval_ms/60000)+'m','Follow the '+skill+' recipe for this mission control.','--name',input.title||known?.label||skill,'--skill',skill,'--workdir',this.store.root,'--deliver',delivery]);
   const made=hermesJobs(this.home).find(j=>!before.has(j.id));
   if(made)rememberNotebookRoutine(this.store,{id:made.id,key:input.kind,name:made.name||input.title||known?.label||skill,skill,what:known?.what||null});
   return made?nativeJobs(this.home,this.device).find(j=>j.id===made.id):nativeJobs(this.home,this.device).at(-1);
  }
  // A Hermes routine given a calendar time moves (retime); with a pause or resume as well, that too.
  const timed=input?.calendar&&typeof input.id==='string'?hermesJobs(this.home).find(j=>j.id===input.id):null;
  if(timed){
   this.requireOwner('Change the routine');
   const row=await this.retime(timed,input.calendar);
   if(typeof input.paused==='boolean'&&input.paused!==(row?.paused===true))await this.command([input.paused?'pause':'resume',input.id]);
   return nativeJobs(this.home,this.device).find(j=>j.id===input.id);
  }
  // A notebook record routine is paused and resumed through its own guarded
  // control, which keeps an uncertain delivery from being resumed.
  if(this.records&&typeof input?.id==='string'&&!nativeJobs(this.home,this.device).some(j=>j.id===input.id)&&this.store.get('jobs',input.id)){const {controlRoutine}=await import('./jobs/routine-control.mjs');return controlRoutine(this.store,{id:input.id,paused:input.paused});}
  if(typeof input.paused!=='boolean'||!nativeJobs(this.home,this.device).some(j=>j.id===input.id))throw Error('Choose whether to pause an existing Hermes task');
  await this.command([input.paused?'pause':'resume',input.id]);return nativeJobs(this.home,this.device).find(j=>j.id===input.id);
 }
}
