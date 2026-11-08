import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {hash,atomic} from './records/store.mjs';
import {assistantEnvironment} from './assistant-files.mjs';
import {nativeCardRows} from './card-commands.mjs';
import {runCommand} from './child-process.mjs';
import {beatWhile,HEARTBEAT_EVERY} from './supervisor-health.mjs';
import {LEGACY_DEVICE} from './device-id.mjs';
import {starterBorn,adoptedMissionControl} from './starter-workspace.mjs';
import {setHermesTimezone} from './hermes-config.mjs';
import {FLAG,STARTING_ROUTINES,routineFiles,writeRoutineFiles,prepareCheckIn,saveRoutineResults,readMachineRecord,writeMachineRecord,telegramInHermes,chatAppInHermes,routineStatus,ownRoutines,metAt,noteHermesMet,cityFiledFirst,OWN_ROUTINES_RULE} from './starting-routines.mjs';
import {cronOf,cronCalendar,calendarCron,retimeWhat,isTalkGate,isCoachTick,talkArea,moveTalk} from './routine-times.mjs';
import {readNotebookRoutines,rememberNotebookRoutine,enableKind,deliveryFor,journalWanted,journalOnTheClock,JOURNAL_JOB,JOURNAL_SCRIPT,JOURNAL_WHAT,CHAT_TIDY_JOB,CHAT_TIDY_SCRIPT,CHAT_TIDY_SCHEDULE,CHAT_TIDY_WHAT,writeNotebookRoutines,BRIEF_JOB,BRIEF_SCRIPT,isBriefJob,CONNECTION_JOB,CONNECTION_SCRIPT,CONNECTION_WHAT,MAIL_COUNT_JOB,MAIL_COUNT_SCRIPT,MAIL_COUNT_WHAT,WORKOUTS_JOB,WORKOUTS_SCRIPT,WORKOUTS_WHAT,NOTICES_JOB,NOTICES_SCRIPT,NOTICES_WHAT} from './notebook-routines.mjs';
import {holdQueuedNotices} from './notices.mjs';
import {switchable,switchedOn,setRoutineSwitch,switchId} from './routine-switches.mjs';
import {connectionCheckWanted} from './connection-check.mjs';
import {mailCountWanted} from './mail-trackers.mjs';
import {loadSettings as coachSettings,saveSettings as saveCoach} from '../../third-party/addons/godspeed-coach/lib/settings.mjs';
import {rhythmWords} from '../../third-party/addons/godspeed-coach/lib/areas.mjs';
import {moveSettingsDeadlines} from './native-due.mjs';
import {scrubCredentials} from './runtime.mjs';
import {HermesLifecycle} from './hermes-lifecycle.mjs';
import {UPDATE_TRANSACTION_LIMIT} from './hermes-update.mjs';
const skills={'morning-brief':'morning-brief',coaching:'coach','habit-check':'coach',journal:'interstitial-journal',headache:'headache-tracker'};
// Hermes' own record of its jobs, as it wrote it.
export function hermesJobs(home){
 const file=path.join(home,'cron/jobs.json');if(!fs.existsSync(file))return [];
 const data=JSON.parse(fs.readFileSync(file,'utf8')),jobs=Array.isArray(data)?data:data.jobs||[];
 return jobs.filter(j=>j&&typeof j==='object');
}
// A job Hermes holds paused is written as enabled:false, state:'paused' or a paused_at time.
export const pausedJob=job=>job.enabled===false||job.state==='paused'||!!job.paused_at;
// When a routine last ran and how it went is Hermes' own record (last_run_at, last_status,
// last_error); until 8 October 2026 the Routines list showed neither. A daily round that told the
// person it went wrong is shown as failed (starting-routines.mjs, routineStatus).
export function nativeJobs(home,device='local'){
 return hermesJobs(home).map(j=>({id:j.id,title:j.name||j.id,kind:j.skill||j.name||'Hermes task',owner:device,paused:pausedJob(j),state:j.state||j.last_status||'pending',next_run:j.next_run_at,last_run_at:j.last_run_at||null,last_status:j.last_status||null,last_error:typeof j.last_error==='string'?j.last_error.slice(0,500):null,...routineStatus(home,j),schedule:j.schedule_display||null,...(cronCalendar(cronOf(j))&&!isTalkGate(j)&&!isCoachTick(j)?{calendar:cronCalendar(cronOf(j))}:{}),deliver:j.deliver||null,created_at:j.created_at,interval_ms:j.schedule?.seconds?j.schedule.seconds*1000:null,native:true,_hash:hash(j)}));
}
const RETRY_STARTING=3600000;
const SETUP_FAILURES='routine-setup-failures.json',SETUP_NOTICE='routine-setup-failures',RETRY_MINUTES=[1,2,4,8,16,32,60];
const RUN_DIAGNOSTICS='routine-run-diagnostics.json',MAX_RUN_DIAGNOSTICS=20;
const setupFailureFile=store=>path.join(store.state,SETUP_FAILURES);
const runDiagnosticsFile=store=>path.join(store.state,RUN_DIAGNOSTICS);
const readSetupFailures=store=>{try{const saved=JSON.parse(fs.readFileSync(setupFailureFile(store),'utf8'));return saved&&typeof saved==='object'&&saved.steps&&typeof saved.steps==='object'?saved:{steps:{}};}catch{return {steps:{}};}};
const writeSetupFailures=(store,failures)=>atomic(setupFailureFile(store),JSON.stringify(failures,null,2)+'\n');
const readRunDiagnostics=store=>{try{const saved=JSON.parse(fs.readFileSync(runDiagnosticsFile(store),'utf8'));return Array.isArray(saved?.runs)?saved:{runs:[]};}catch{return {runs:[]};}};
const writeRunDiagnostics=(store,diagnostics)=>atomic(runDiagnosticsFile(store),JSON.stringify(diagnostics,null,2)+'\n');
const diagnostic=error=>{const lines=String(error?.stderr||error?.message||'').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').split(/\r?\n/).map(line=>scrubCredentials(line).trimEnd()).filter(Boolean);return lines.slice(-10).join('\n').slice(-2000);};
const errorLine=record=>{const lines=String(record.stderr||'').split(/\r?\n/).map(line=>line.trim()).filter(Boolean),trace=lines.findIndex(line=>/^Traceback \(most recent call last\):$/i.test(line));return (trace>=0?lines.at(-1):lines[0])||'exit code '+(record.exit_code??'unknown');};
const cleanupFailure=(error,cleanup)=>Object.assign(Error(errorLine({stderr:diagnostic(error),exit_code:error?.code})+'; carried routine cleanup failed: '+errorLine({stderr:diagnostic(cleanup),exit_code:cleanup?.code})),{code:error?.code,cause:error});
const setupName=step=>step==='cleanup'?'Nightly cleanup':step==='notice-sender'?'Notice sender':step==='workouts'?'Workouts from Hevy':switchable().find(routine=>routine.key===step)?.name||step;
const setupEffect=step=>step==='notice-sender'?'no notices and no routine switch takes effect':step==='cleanup'?'nightly cleanup does not run':step==='workouts'?'the hourly Workouts import has not taken over':'that routine does not run';
// "05:16": once a day at that time in the owner's timezone.
// The daily connection check runs at 05:00; a morning brief set before 05:30 pulls it half an hour ahead of it
// (a brief at 00:10 is preceded by the check at 23:40 the evening before).
export function connectionCheckTime(briefAt){
 const brief=dailyTime(briefAt);if(!brief)return '05:00';
 const at=brief.hour*60+brief.minute,minutes=at<330?(at-30+1440)%1440:300;
 return dailyTime(Math.floor(minutes/60)+':'+String(minutes%60).padStart(2,'0')).time;
}
export function dailyTime(at){const m=/^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(at||'').trim());return m?{hour:Number(m[1]),minute:Number(m[2]),time:m[1].padStart(2,'0')+':'+m[2]}:null;}
const installedRoutine=(home,root,routine)=>hermesJobs(home).find(job=>job.name===routine.name&&job.script===routine.script&&typeof job.workdir==='string'&&path.resolve(job.workdir)===path.resolve(root));
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
 constructor(store,{executable,home,device=store.device,run=runCommand,records=null,tickLimit=TICK_LIMIT,beatEvery=HEARTBEAT_EVERY,updateLimit=UPDATE_TRANSACTION_LIMIT,now=Date.now,updater=null,lifecycle=new HermesLifecycle()}){
  Object.assign(this,{store,executable,home,device,run,records,tickLimit,beatEvery,updateLimit,now,updater,lifecycle,setupAttempts:new Set()});
  if(records)records.onProgress=()=>this.onProgress?.();
 }
 setWorkouts(addon){this.workouts=addon;}
 workoutsFiles({root=this.store.root,timezone=this.store.get('settings','installation')?.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone}={}){
  const config=this.workouts?.routineConfig?.()||{};
  return routineFiles({root,home:this.home,state:this.store.state,timezone,hermes:this.executable,workouts:config.workouts,workoutsNotebook:config.workouts_notebook});
 }
 // A connected provider reaches the record routines too (/api/provider).
 set executor(value){if(this.records)this.records.executor=value;}
 get executor(){return this.records?.executor||null;}
 routineCommand(args){return {executable:this.executable,args:['cron',...args]};}
 async runRoutineCommand(command,{timeout=120000,onStart,detail=false}={}){const timezone=this.store.get('settings','installation')?.timezone,env=assistantEnvironment({home:this.home,workspace:this.store.root});if(timezone)env.HERMES_TIMEZONE=timezone;const result=await this.run(command.executable,command.args,{cwd:this.store.root,windowsHide:true,shell:false,env,maxBuffer:1024*1024,timeout,onStart});return detail?{...result,command:[command.executable,...command.args]}:result.stdout;}
 async command(args,options={}){return this.runRoutineCommand(this.routineCommand(args),options);}
 saveRunDiagnostic(entry){const diagnostics=readRunDiagnostics(this.store);diagnostics.runs=[...diagnostics.runs,entry].slice(-MAX_RUN_DIAGNOSTICS);writeRunDiagnostics(this.store,diagnostics);}
 updateRunDiagnostic(id,fields){const diagnostics=readRunDiagnostics(this.store),index=diagnostics.runs.findIndex(entry=>entry.id===id);if(index<0)return;diagnostics.runs[index]={...diagnostics.runs[index],...fields};writeRunDiagnostics(this.store,diagnostics);}
 setupNotice(failures,now){
  try{
   const steps=Object.values(failures.steps),notice=this.store.get('notifications',SETUP_NOTICE);
   if(!steps.length){if(notice?.status==='pending')this.store.save('notifications',{id:SETUP_NOTICE,status:'resolved',resolved_at:new Date(now).toISOString()});return;}
   if(notice?.status!=='pending'&&!steps.some(step=>step.attempts>=3))return;
   const detail=steps.map(step=>setupName(step.step)+': '+setupEffect(step.step)+'. '+errorLine(step)+'.').join(' ');
   this.store.save('notifications',{id:SETUP_NOTICE,status:'pending',title:'Some routines could not be set up',body:'Godspeed could not set up '+steps.map(step=>setupName(step.step)).join(', ')+' on this machine. '+detail+' It tries again by itself. Open Settings > Routines.',link:'/dashboard/settings#routines',steps:steps.map(step=>step.step),error:steps.map(errorLine).join('\n')});
  }catch{console.error('Godspeed Mission Control: routine setup notice could not be saved.');}
 }
 async followSetup(step,action,{retry=false}={}){
  const failures=readSetupFailures(this.store),previous=failures.steps[step],now=this.now(),changedExecutable=previous&&previous.executable!==String(this.executable),after=Date.parse(previous?.retry_after||'');
  if(retry&&previous&&this.setupAttempts.has(step)&&!changedExecutable&&Number.isFinite(after)&&after>now)return null;
  try{
   const result=await action();this.setupAttempts.add(step);
   if(previous){delete failures.steps[step];writeSetupFailures(this.store,failures);if(!this.followingSetup)this.setupNotice(failures,now);}
   return result;
  }catch(error){
   this.setupAttempts.add(step);
   const attempts=(previous?.attempts||0)+1,stderr=diagnostic(error),record={step,first_failed_at:previous?.first_failed_at||new Date(now).toISOString(),attempts,exit_code:error?.code??null,stderr,last_failed_at:new Date(now).toISOString(),retry_after:new Date(now+RETRY_MINUTES[Math.min(attempts-1,RETRY_MINUTES.length-1)]*60000).toISOString(),executable:String(this.executable),...(error?.retrySystemdReload?{retry_systemd_reload:true}:{})};
   failures.steps[step]=record;writeSetupFailures(this.store,failures);if(!this.followingSetup)this.setupNotice(failures,now);
   console.error('Godspeed Mission Control: '+setupName(step)+' could not be set up: '+errorLine(record));
   throw error;
  }
 }
 workoutsSetupFailure(){const record=readSetupFailures(this.store).steps.workouts;return record?{reason:errorLine(record),retry_after:record.retry_after}:null;}
 workoutsRoutineStatus(){
  const entry=readNotebookRoutines(this.store).jobs.find(job=>job.key==='workouts');
  const state=entry?(entry.switched_off?'disconnected':hermesJobs(this.home).some(job=>job.id===entry.id)?'scheduled':'removed'):null;
  const failure=this.workoutsSetupFailure();
  if(state)return failure?{state,...failure}:{state};
  if(failure)return {state:'pending',...failure};
  return null;
 }
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
  // The first goal starts the routines other than the nightly cleanup: at the first setup, and when the mission control is still
  // waiting for its first goal (the getting-to-know-you chat filed the city before it). An
  // installation set up before 8 October 2026 is left as it is (startRoutinesNow). Until
  // 17 October 2026 this asked only whether an installation record was there, so a first goal
  // given here after the chat's city started nothing.
  const routines=await this.startRoutines({goal:nativeCardRows(this.store,'goals').find(g=>g.title===goal?.trim())?.id,setup:!old});
  if(this.owns())await this.followCleanup();
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
 queueStarting(action){const next=(this.starting||Promise.resolve()).then(action);this.starting=next.catch(()=>{});return next;}
 startRoutines(options={}){return this.queueStarting(()=>this.startRoutinesNow(options));}
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
  // several machines with routines of its own, gets none of these at once. Since #225 it gets the
  // notice sender (followNoticeSender) and each routine as a switch (followSwitches).
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
   writeRoutineFiles(this.home,this.workoutsFiles({root,timezone}));
   prepareCheckIn(root,{timezone,delivery,goal:serves});
   const cleanup=STARTING_ROUTINES.find(routine=>routine.key==='cleanup'),existing=cleanup&&installedRoutine(this.home,root,cleanup);
   jobs=[...(existing?[{id:existing.id,key:cleanup.key,name:cleanup.name,what:cleanup.what}]:[]),...await this.createStartingRoutines(delivery,existing?STARTING_ROUTINES.filter(routine=>routine!==cleanup):STARTING_ROUTINES)];
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
 followCleanup({retry=false}={}){return this.queueStarting(()=>this.followSetup('cleanup',()=>this.followCleanupNow(),{retry}));}
 async followCleanupNow(){
  const root=this.store.root,routine=STARTING_ROUTINES.find(entry=>entry.key==='cleanup');
  if(!routine||!(starterBorn(root)||adoptedMissionControl(root)))return null;
  const installation=this.store.get('settings','installation'),timezone=installation?.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone;
  writeRoutineFiles(this.home,this.workoutsFiles({root,timezone}));
  const existing=installedRoutine(this.home,root,routine);
  const entry=readNotebookRoutines(this.store).jobs.find(job=>job.key===routine.key);
  if(existing){if(!entry)rememberNotebookRoutine(this.store,{id:existing.id,key:routine.key,name:routine.name,what:routine.what});return existing.id;}
  if(entry)return null;
  const delivery=deliveryFor(installation,{telegram:telegramInHermes(this.home)}),[made]=await this.createStartingRoutines(delivery,[routine]);
  rememberNotebookRoutine(this.store,made);return made.id;
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
  const offered=new Set(here.jobs.map(j=>j.key)),missing=STARTING_ROUTINES.filter(r=>!offered.has(r.key)&&(r.key!=='cleanup'||!installedRoutine(this.home,root,r))&&(!r.needs||fs.existsSync(path.join(root,'skills',r.needs,'SKILL.md'))));
  if(!missing.length)return [];
  writeRoutineFiles(this.home,this.workoutsFiles({root,timezone:installation.timezone}));
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
  // chat. It stays "local" (notebook-routines.mjs, CHAT_TIDY_JOB), and so do the mail counts, which send nothing.
  const ids=new Set([...(created?here.jobs.map(j=>j.id):[]),...mine.jobs.filter(j=>!['chat-tidy','mail-count'].includes(j.key)).map(j=>j.id)]);if(!ids.size)return [];
  const moved=[];
  for(const job of hermesJobs(this.home).filter(j=>ids.has(j.id)&&['local','telegram'].includes(String(j.deliver||''))&&j.deliver!==want)){await this.command(['edit',job.id,'--deliver',want]);moved.push(job.id);}
  if(created&&here.delivery!==want)writeMachineRecord(this.store,{...here,delivery:want});
  if(created||mine.jobs.some(j=>['coach-gate','coach-tick'].includes(j.key)))try{const settings=coachSettings(this.store.root),talk=want==='telegram'?'messenger':'chat';if(settings.talk_delivery!==talk)saveCoach(this.store.root,{...settings,talk_delivery:talk});}catch{}
  return moved;
 }
 // THE NOTICE SENDER OF A MISSION CONTROL NOT MADE FROM THE STARTER (4 November 2026, #225; notebook-routines.mjs).
 // Made once on the machine that runs the routines, and a routine the person removed stays removed.
 // Notices queued before it is made are marked not sent first, and again on every attempt until it is
 // made, so none queued earlier is ever said.
 followNoticeSender({retry=false}={}){return this.followSetup('notice-sender',()=>this.followNoticeSenderNow(),{retry});}
 async followNoticeSenderNow(){
  const root=this.store.root;if(starterBorn(root))return null;
  const entry=readNotebookRoutines(this.store).jobs.find(j=>j.key==='notices'),jobs=hermesJobs(this.home);
  const job=(entry&&jobs.find(j=>j.id===entry.id))||jobs.find(j=>j.name===NOTICES_JOB&&j.script===NOTICES_SCRIPT&&typeof j.workdir==='string'&&path.resolve(j.workdir)===path.resolve(root));
  if(entry&&!job)return null;
  if(job){if(!entry)rememberNotebookRoutine(this.store,{id:job.id,key:'notices',name:NOTICES_JOB,what:NOTICES_WHAT});return job.id;}
  const installation=this.store.get('settings','installation'),timezone=installation?.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone;
  writeRoutineFiles(this.home,this.workoutsFiles({root,timezone}));
  holdQueuedNotices(this.store);
  const before=new Set(jobs.map(j=>j.id));
  await this.command(['create','*/15 * * * *','--no-agent','--name',NOTICES_JOB,'--script',NOTICES_SCRIPT,'--deliver',deliveryFor(installation,{telegram:telegramInHermes(this.home)}),'--failure-deliver','local','--workdir',root]);
  const made=hermesJobs(this.home).find(j=>!before.has(j.id)&&j.name===NOTICES_JOB);
  if(!made)throw Error('Hermes did not keep the routine "'+NOTICES_JOB+'"');
  rememberNotebookRoutine(this.store,{id:made.id,key:'notices',name:NOTICES_JOB,what:NOTICES_WHAT});
  return made.id;
 }
 // Routines wait for their switches only once the notice sender exists, which means the earlier notices are marked.
 switchesReady(){return !starterBorn(this.store.root)&&readNotebookRoutines(this.store).jobs.some(j=>j.key==='notices');}
 // THE SWITCHES OF A MISSION CONTROL NOT MADE FROM THE STARTER (routine-switches.mjs). A starting routine
 // switched on is made as the starter-born start makes it; the journal's check-ins and the connection check
 // are made by their own follow methods. Off pauses the routine and keeps its record; on again resumes it.
 async followSwitches({retry=false}={}){
  if(!this.switchesReady())return [];
  const changed=[],failures=[];
  for(const routine of switchable()){
   try{
   await this.followSetup(routine.key,()=>this.followSwitch(routine,changed),{retry});
   }catch(error){failures.push(error);}
  }
  if(failures.length)throw failures[0];
  return changed;
 }
 async followSwitch(routine,changed){
   const root=this.store.root,on=switchedOn(this.store,routine.key),starting=STARTING_ROUTINES.find(r=>r.key===routine.key);
   let entry=readNotebookRoutines(this.store).jobs.find(j=>j.key===routine.key);
   const jobs=hermesJobs(this.home),job=entry&&jobs.find(j=>j.id===entry.id);
   const forget=()=>{const all=readNotebookRoutines(this.store);writeNotebookRoutines(this.store,{...all,jobs:all.jobs.filter(j=>j.key!==routine.key)});entry=undefined;};
   if(!on){
    if(entry&&!entry.switched_off){
     if(!job)forget();
     else{if(job.enabled!==false)await this.command(['pause',job.id]);rememberNotebookRoutine(this.store,{...entry,switched_off:true});changed.push(job.id);}
    }
    return;
   }
   if(entry?.switched_off){
    if(!job){forget();}
    else{
     const {switched_off,...rest}=entry;
     if(starting){if(job.enabled===false)await this.command(['resume',job.id]);rememberNotebookRoutine(this.store,rest);}
     else rememberNotebookRoutine(this.store,{...rest,paused_by_notebook:true,running_by_notebook:false});
     changed.push(job.id);return;
    }
   }
   if(entry||!starting)return;
   if(starting.needs&&!fs.existsSync(path.join(root,'skills',starting.needs,'SKILL.md')))return;
   const installation=this.store.get('settings','installation'),timezone=installation?.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone,delivery=deliveryFor(installation,{telegram:telegramInHermes(this.home)});
   writeRoutineFiles(this.home,this.workoutsFiles({root,timezone}));
   if(['coach-gate','coach-tick'].includes(routine.key)){
    const first=nativeCardRows(this.store,'goals').filter(g=>g.status==='adopted').sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)))[0];
    prepareCheckIn(root,{timezone,delivery,goal:first?.id||''});
   }
   const [made]=await this.createStartingRoutines(delivery,[starting]);
   rememberNotebookRoutine(this.store,made);changed.push(made.id);
 }
 // THE JOURNAL'S CHECK-INS (notebook-routines.mjs): one routine while the person has any of them
 // switched on, paused when all are off, made again by nothing once the person removed it.
 async followJournal(){
  const root=this.store.root;if(!(starterBorn(root)||this.switchesReady()&&switchedOn(this.store,'journal-tick')))return null;
  const mine=readNotebookRoutines(this.store),entry=mine.jobs.find(j=>j.key==='journal-tick'),jobs=hermesJobs(this.home);
  if(entry?.switched_off)return null;
  const job=(entry&&jobs.find(j=>j.id===entry.id))||jobs.find(j=>[JOURNAL_JOB,'godspeed-journal-tick'].includes(j.name));
  if(!journalWanted(root)){
   if(job&&entry&&job.enabled!==false){await this.command(['pause',job.id]);rememberNotebookRoutine(this.store,{...entry,paused_by_notebook:true});}
   return null;
  }
  // A routine the person removed stays removed: it was made once, and its record says so.
  if(entry&&!job)return null;
  const installation=this.store.get('settings','installation'),timezone=installation?.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone;
  try{journalOnTheClock(root,timezone);}catch{}
  writeRoutineFiles(this.home,this.workoutsFiles({root,timezone}));
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
 // THE DAILY CONNECTION CHECK (4 November 2026, #200; notebook-routines.mjs, core/connection-check.mjs).
 // Made once, only on a machine that made its starting routines (on a mission control not made from the
 // starter: once its switch is on, #225), at 05:00 on the install's clock (earlier when
 // a Morning brief set before 05:30 needs it first; connectionCheckTime). It
 // is made enabled when Telegram or Gmail is connected, a tracker has a mail rule, a phone upload arrived, or another routine is active (its "your routines" source needs no connection), and paused otherwise; the notebook later
 // resumes it only if it paused it itself and one of them has since come about. A routine the
 // person paused or resumed, or removed, is theirs from then on.
 async followConnectionCheck(){
  const root=this.store.root;
  if(!(starterBorn(root)?readMachineRecord(this.store)?.state==='created':this.switchesReady()&&switchedOn(this.store,'connection-check')))return null;
  let entry=readNotebookRoutines(this.store).jobs.find(j=>j.key==='connection-check'),jobs=hermesJobs(this.home);
  if(entry?.switched_off)return null;
  const job=(entry&&jobs.find(j=>j.id===entry.id))||jobs.find(j=>j.name===CONNECTION_JOB&&j.script===CONNECTION_SCRIPT);
  if(entry&&!job)return null;
  const installation=this.store.get('settings','installation'),timezone=installation?.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone,wanted=connectionCheckWanted(this.home,undefined,this.store)||jobs.some(j=>j.id&&!pausedJob(j)&&j.id!==job?.id&&j.script!==CONNECTION_SCRIPT);
  writeRoutineFiles(this.home,this.workoutsFiles({root,timezone}));
  if(job){
   if(!entry)return job.id;
   const current=entry.what===CONNECTION_WHAT?entry:rememberNotebookRoutine(this.store,{...entry,what:CONNECTION_WHAT});
   if(!current.paused_by_notebook){
    // Still running as the notebook left it: it goes off when no connection or active routine wants it. A person's pause ends that ownership.
    if(job.enabled===false&&current.running_by_notebook)rememberNotebookRoutine(this.store,{...current,running_by_notebook:false});
    else if(job.enabled!==false&&current.running_by_notebook&&!wanted){await this.command(['pause',job.id]);rememberNotebookRoutine(this.store,{...current,paused_by_notebook:true,running_by_notebook:false});}
    return job.id;
   }
   const resumed=pausedJob(job);
   if(resumed&&!wanted)return job.id;
   if(resumed)await this.command(['resume',job.id]);
   rememberNotebookRoutine(this.store,{...current,paused_by_notebook:false,running_by_notebook:resumed});
   return job.id;
  }
  const before=new Set(jobs.map(j=>j.id));
  const brief=this.notificationJob('morning-brief'),briefAt=brief&&brief.enabled!==false?cronCalendar(cronOf(brief))?.times?.[0]:null,check=dailyTime(connectionCheckTime(briefAt));
  await this.command(['create',check.minute+' '+check.hour+' * * *','--no-agent','--name',CONNECTION_JOB,'--script',CONNECTION_SCRIPT,'--deliver',deliveryFor(installation,{telegram:telegramInHermes(this.home)}),'--failure-deliver','local','--workdir',root]);
  const made=hermesJobs(this.home).find(j=>!before.has(j.id)&&j.name===CONNECTION_JOB);
  if(!made)throw Error('Hermes did not keep the routine "'+CONNECTION_JOB+'"');
  if(!wanted)try{await this.command(['pause',made.id]);}catch(error){await this.command(['remove',made.id]).catch(()=>{});throw error;}
  rememberNotebookRoutine(this.store,{id:made.id,key:'connection-check',name:CONNECTION_JOB,what:CONNECTION_WHAT,paused_by_notebook:!wanted,running_by_notebook:wanted});
  return made.id;
 }
 // THE MAIL COUNTS (notebook-routines.mjs, core/mail-trackers.mjs): one routine while a tracker has a
 // mail rule, paused when none has, made again by nothing once the person removed it.
 async followMailCount(){
  const root=this.store.root;if(!(starterBorn(root)||this.switchesReady()&&switchedOn(this.store,'mail-count')))return null;
  const mine=readNotebookRoutines(this.store),entry=mine.jobs.find(j=>j.key==='mail-count'),jobs=hermesJobs(this.home);
  if(entry?.switched_off)return null;
  const job=(entry&&jobs.find(j=>j.id===entry.id))||jobs.find(j=>j.name===MAIL_COUNT_JOB&&j.script===MAIL_COUNT_SCRIPT);
  if(!mailCountWanted(this.store)){
   if(job&&entry&&job.enabled!==false){await this.command(['pause',job.id]);rememberNotebookRoutine(this.store,{...entry,paused_by_notebook:true});}
   return null;
  }
  if(entry&&!job)return null;
  const installation=this.store.get('settings','installation'),timezone=installation?.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone;
  writeRoutineFiles(this.home,this.workoutsFiles({root,timezone}));
  if(job){
   if(entry&&job.enabled===false&&entry.paused_by_notebook){await this.command(['resume',job.id]);rememberNotebookRoutine(this.store,{...entry,paused_by_notebook:false});}
   return job.id;
  }
  const before=new Set(jobs.map(j=>j.id));
  await this.command(['create','30 4 * * *','--no-agent','--name',MAIL_COUNT_JOB,'--script',MAIL_COUNT_SCRIPT,'--deliver','local','--failure-deliver','local','--workdir',root]);
  const made=hermesJobs(this.home).find(j=>!before.has(j.id)&&j.name===MAIL_COUNT_JOB);
  if(!made)throw Error('Hermes did not keep the routine "'+MAIL_COUNT_JOB+'"');
  rememberNotebookRoutine(this.store,{id:made.id,key:'mail-count',name:MAIL_COUNT_JOB,what:MAIL_COUNT_WHAT});
  return made.id;
 }
 // A routine that could not be made or resumed is a pending notice for the owner (like a blind watch
 // in procedures.mjs), resolved when a later tick manages; the periodic tick has no caller to throw to.
 async followMailCountVisibly(){
  const id='mail-count-routine',open=()=>this.store.get('notifications',id)?.status==='pending';
  try{
   const done=await this.followMailCount();
   if(open())this.store.save('notifications',{id,status:'resolved',resolved_at:new Date().toISOString()});
   return done;
  }catch(error){
   if(!open())this.store.save('notifications',{id,status:'pending',body:'The daily mail counts could not be scheduled in Hermes, so your mail rules are not counting yet. It tries again on the next check.',error:String(error?.message||error).slice(0,500)});
   throw error;
  }
 }
 // Workouts has a private, add-on-owned key.  A remembered missing job is intentional removal,
 // while switched_off is the explicit Disconnect tombstone and may be cleared only by reconnect.
 async followWorkouts({reconnect=false,retry=false}={}){
  if(this.workoutsFollowing)return this.workoutsFollowing;
  this.workoutsFollowing=this.followSetup('workouts',()=>this.followWorkoutsNow({reconnect}),{retry}).finally(()=>{this.workoutsFollowing=null;});
  return this.workoutsFollowing;
 }
 async followWorkoutsNow({reconnect=false}={}){
  if(!this.workouts)return null;
  if(!this.workouts.hasKey()){
   for(const job of hermesJobs(this.home).filter(job=>job.name===WORKOUTS_JOB&&job.script===WORKOUTS_SCRIPT&&typeof job.workdir==='string'&&path.resolve(job.workdir)===path.resolve(this.store.root)))await this.command(['remove',job.id]);
   return null;
  }
  this.requireOwner('Connect Workouts from Hevy');
  const root=this.store.root,mine=readNotebookRoutines(this.store),entry=mine.jobs.find(j=>j.key==='workouts'),jobs=hermesJobs(this.home);
  if(!starterBorn(root)&&this.switchesReady()&&!switchedOn(this.store,'workouts')){
   // A carried standalone key is prior opt-in; a saved switch-off remains the person's choice.
   if(reconnect||!this.store.get('settings',switchId('workouts')))await setRoutineSwitch(this.store,{key:'workouts',on:true},{workouts:true});
   else return null;
  }
  const matching=jobs.filter(j=>j.name===WORKOUTS_JOB&&j.script===WORKOUTS_SCRIPT&&typeof j.workdir==='string'&&path.resolve(j.workdir)===path.resolve(root));
  if(entry?.switched_off&&!reconnect)return null;
  if(reconnect&&entry?.switched_off){const {switched_off,...rest}=entry;rememberNotebookRoutine(this.store,rest);}
  const current=readNotebookRoutines(this.store).jobs.find(j=>j.key==='workouts');
  if(current&&!matching.some(j=>j.id===current.id)&&!reconnect){
   if(!this.workoutsSetupFailure())return null;
   const routines=readNotebookRoutines(this.store);
   writeNotebookRoutines(this.store,{...routines,jobs:routines.jobs.filter(job=>job.id!==current.id)});
  }
  const minute=Number((await this.workouts.status()).minute);
  if(!Number.isInteger(minute)||minute<1||minute>58)throw Error('Workouts from Hevy has no valid hourly minute yet');
  if(matching.length){
   const keep=current?matching.find(j=>j.id===current.id)||matching[0]:matching[0];
   for(const duplicate of matching.filter(j=>j.id!==keep.id))await this.command(['remove',duplicate.id]);
   if(!current)return this.completeWorkoutsHandover(keep);
   const failure=readSetupFailures(this.store).steps.workouts;
   if(failure)await this.workouts.uninstall({retrySystemdReload:failure.retry_systemd_reload===true});
   else if(keep.enabled===false&&current.paused_by_notebook){await this.command(['resume',keep.id]);rememberNotebookRoutine(this.store,{...current,paused_by_notebook:false,running_by_notebook:true});}
   return keep.id;
  }
  const installation=this.store.get('settings','installation'),before=new Set(jobs.map(j=>j.id));
  writeRoutineFiles(this.home,this.workoutsFiles({root,timezone:installation?.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone}));
  await this.command(['create',minute+' * * * *','--no-agent','--name',WORKOUTS_JOB,'--script',WORKOUTS_SCRIPT,'--deliver','local','--failure-deliver','local','--workdir',root]);
  const made=hermesJobs(this.home).find(j=>!before.has(j.id)&&j.name===WORKOUTS_JOB&&j.script===WORKOUTS_SCRIPT);
  if(!made)throw Error('Hermes did not keep the routine "'+WORKOUTS_JOB+'"');
  return this.completeWorkoutsHandover(made);
 }
 async completeWorkoutsHandover(candidate){
  const started=this.now();
  const routine={id:candidate.id,key:'workouts',name:WORKOUTS_JOB,what:WORKOUTS_WHAT};let remembered=false;
  try{
   await this.runNow(candidate.id);
   const last=(await this.workouts.status()).last_run,at=Date.parse(last?.at||'');
   if(!last?.ok||!Number.isFinite(at)||at<started)throw Error('Workouts from Hevy did not complete its first import');
   // Persisting ownership cannot be allowed to fail after retiring the old timer.
   rememberNotebookRoutine(this.store,routine);remembered=true;
   await this.workouts.uninstall();
   return candidate.id;
  }catch(error){
   if(remembered)throw error;
   try{await this.command(['remove',candidate.id]);}catch(cleanup){throw cleanupFailure(error,cleanup);}
   throw error;
  }
 }
 async disconnectWorkouts(){
  this.requireOwner('Disconnect Workouts from Hevy');
  const mine=readNotebookRoutines(this.store),entry=mine.jobs.find(j=>j.key==='workouts');
  rememberNotebookRoutine(this.store,{...(entry||{id:'workouts-disconnected',key:'workouts',name:WORKOUTS_JOB,what:WORKOUTS_WHAT}),switched_off:true});
  if(!starterBorn(this.store.root))await setRoutineSwitch(this.store,{key:'workouts',on:false},{workouts:true});
  for(const job of hermesJobs(this.home).filter(j=>j.name===WORKOUTS_JOB&&j.script===WORKOUTS_SCRIPT&&typeof j.workdir==='string'&&path.resolve(j.workdir)===path.resolve(this.store.root)))await this.command(['remove',job.id]);
  if(this.workouts)await this.workouts.uninstall();
  const failures=readSetupFailures(this.store);if(failures.steps.workouts){delete failures.steps.workouts;writeSetupFailures(this.store,failures);this.setupNotice(failures,this.now());}
 }
 // THE MORNING BRIEF AS THE NOTEBOOK'S OWN BRIEFING (3 November 2026, #160; notebook-routines.mjs
 // says why). A script routine like the deadline reminders, whose script runs core/briefing.mjs
 // (scripts/morning-brief.mjs) and prints the briefing for Hermes to deliver where this machine's
 // routines deliver. Returns the routine's id, or null when Hermes shows no new routine.
 async makeBrief(schedule,title){
  const root=this.store.root,installation=this.store.get('settings','installation'),timezone=installation?.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone;
  writeRoutineFiles(this.home,this.workoutsFiles({root,timezone}));
  const known=enableKind('morning-brief'),name=title||known.label,delivery=deliveryFor(installation,{telegram:telegramInHermes(this.home)}),before=new Set(hermesJobs(this.home).map(j=>j.id));
  await this.command(['create',schedule,'--no-agent','--name',name,'--script',BRIEF_SCRIPT,'--deliver',delivery,'--failure-deliver','local','--workdir',root]);
  const made=hermesJobs(this.home).find(j=>!before.has(j.id));
  if(!made)return null;
  rememberNotebookRoutine(this.store,{id:made.id,key:'morning-brief',name:made.name||name,skill:'morning-brief',what:known.what});
  return made.id;
 }
 // A Morning brief made the old way, as the morning-brief recipe (an AI job of Hermes), is made
 // again as the script on the next tick: the same time or rhythm, the same delivery, paused if it
 // was paused, and this machine's record of it moves to the new one. Which jobs: one this machine
 // remembers making, and the one the starter recipe itself tells the assistant to make when asked
 // in the chat ("Morning brief", the morning-brief recipe, this mission control's folder); a brief
 // of the owner's under another name or folder stays. Safe to stop anywhere: a script brief that is
 // already there is never made twice; it takes the recipe job's time, delivery and on or off, and
 // only then does the recipe job go. A new one whose delivery or pause could not be set is taken out
 // again, so a paused brief never comes back on and the recipe job stays for the next tick.
 async followBrief(){
  const mine=readNotebookRoutines(this.store),root=path.resolve(this.store.root);
  const all=hermesJobs(this.home);
  const old=all.filter(j=>isBriefJob(j)&&j.script!==BRIEF_SCRIPT&&(mine.jobs.some(e=>e.id===j.id)||(j.name===BRIEF_JOB&&typeof j.workdir==='string'&&path.resolve(j.workdir)===root)));
  if(!old.length)return [];
  const moved=[],done=id=>{const after=readNotebookRoutines(this.store);writeNotebookRoutines(this.store,{...after,jobs:after.jobs.filter(e=>e.id!==id)});};
  let existing=all.find(j=>j.script===BRIEF_SCRIPT&&typeof j.workdir==='string'&&path.resolve(j.workdir)===root)?.id||null;
  for(const job of old){
   const schedule=job.schedule?.kind==='interval'&&Number.isFinite(job.schedule.minutes)?job.schedule.minutes+'m':(job.schedule?.expr||job.schedule_display);
   if(typeof schedule!=='string'||!schedule.trim())continue;
   if(existing){
    // The script brief takes the recipe job's settings, then the recipe job goes.
    const there=hermesJobs(this.home).find(j=>j.id===existing),when=schedule.trim().replace(/^every\s+/,'');
    if(there){
     const theirs=there.schedule?.kind==='interval'&&Number.isFinite(there.schedule.minutes)?there.schedule.minutes+'m':(there.schedule?.expr||there.schedule_display);
     if(String(theirs||'').trim().replace(/^every\s+/,'')!==when)await this.command(['edit',existing,'--schedule',when]);
     if(job.deliver&&job.deliver!==there.deliver)await this.command(['edit',existing,'--deliver',job.deliver]);
     if((job.enabled===false)!==(there.enabled===false))await this.command([job.enabled===false?'pause':'resume',existing]);
    }
    await this.command(['remove',job.id]);done(job.id);continue;
   }
   const id=await this.makeBrief(schedule.trim().replace(/^every\s+/,''),job.name);
   if(!id)continue; // the old one stays until Hermes keeps the new one
   try{
    const made=hermesJobs(this.home).find(j=>j.id===id);
    if(job.deliver&&made&&job.deliver!==made.deliver)await this.command(['edit',id,'--deliver',job.deliver]);
    if(job.enabled===false)await this.command(['pause',id]);
   }catch(error){await this.command(['remove',id]).catch(()=>{});done(id);throw error;}
   await this.command(['remove',job.id]);done(job.id);
   existing=id;moved.push(id);
  }
  return moved;
 }
 // THE NIGHT CHAT TIDY-UP (notebook-routines.mjs): made once, at 01:30 on the install's clock, on a
 // machine that made its starting routines and whose Hermes has a chat app connected; an install
 // without one gets none. A routine the person removed, paused or changed is theirs from then on.
 async followChatTidy(){
  const root=this.store.root;if(!starterBorn(root)||readMachineRecord(this.store)?.state!=='created'||!chatAppInHermes(this.home))return null;
  const entry=readNotebookRoutines(this.store).jobs.find(j=>j.key==='chat-tidy'),jobs=hermesJobs(this.home);
  const job=(entry&&jobs.find(j=>j.id===entry.id))||jobs.find(j=>j.name===CHAT_TIDY_JOB&&j.script===CHAT_TIDY_SCRIPT);
  if(job)return job.id;
  if(entry)return null;
  const installation=this.store.get('settings','installation'),timezone=installation?.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone;
  writeRoutineFiles(this.home,this.workoutsFiles({root,timezone}));
  const before=new Set(jobs.map(j=>j.id));
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
  const jobs=hermesJobs(this.home).filter(j=>skill==='morning-brief'?isBriefJob(j):[j.skill,...(Array.isArray(j.skills)?j.skills:[])].includes(skill));
  return jobs.find(j=>mine.has(j.id))||jobs.find(j=>typeof j.workdir==='string'&&path.resolve(j.workdir)===path.resolve(root))||jobs[0]||null;
 }
 notifications(){
  const read=(skill,fallback)=>{const job=this.notificationJob(skill),calendar=job?cronCalendar(cronOf(job)):null;return {enabled:!!job&&job.enabled!==false,time:calendar?.times?.[0]||fallback.time,...(fallback.day!==undefined?{day:calendar&&calendar.weekdays.length===1?calendar.weekdays[0]:fallback.day}:{})};};
  return {daily:read('morning-brief',{time:'07:00'}),weekly:read('weekly-review',{time:'17:00',day:5}),delivery:deliveryFor(this.store.get('settings','installation'),{telegram:telegramInHermes(this.home)})};
 }
 // The check the notebook made moves ahead of a morning brief set before it; one the person removed stays removed.
 async keepCheckBeforeBrief(briefAt){
  const entry=readNotebookRoutines(this.store).jobs.find(j=>j.key==='connection-check'),job=entry&&hermesJobs(this.home).find(j=>j.id===entry.id);
  if(!job)return;
  const want=connectionCheckTime(briefAt),now=cronCalendar(cronOf(job))?.times?.[0],minutes=t=>{const d=dailyTime(t);return d.hour*60+d.minute;};
  // Only the default time or a time at or after the brief moves; a time the person chose before it stays.
  if(now&&now!==want&&(now==='05:00'||minutes(now)>=minutes(briefAt)))await this.retime(job,{times:[want],weekdays:[0,1,2,3,4,5,6]});
 }
 async setNotifications(input={}){
  this.requireOwner('Change what is sent');
  // A brief still made as the recipe becomes the notebook's own briefing first, so this changes that one.
  if(input.daily)await this.followBrief();
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
    if(key==='daily')await this.keepCheckBeforeBrief(calendar.times[0]);
    continue;
   }
   if(kind==='morning-brief'){await this.makeBrief(calendarCron(calendar));await this.keepCheckBeforeBrief(calendar.times[0]);continue;}
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
  const switched=readNotebookRoutines(this.store).jobs.find(j=>j.id===job.id&&STARTING_ROUTINES.some(r=>r.key===j.key)&&typeof j.what==='string');
  if(switched)rememberNotebookRoutine(this.store,{...switched,what:retimeWhat(switched.what,before.times,after.times)});
  return nativeJobs(this.home,this.device).find(j=>j.id===job.id);
 }
 // After every tick on the machine that runs the routines: the routines' scripts follow the notebook's
 // folders (an upgrade moves them), and a reply that reached nobody becomes a note. On a mission control
 // not made from the starter that is only for the routines the notebook made itself (the notice sender,
 // switched-on routines), never the owner's own jobs.
 afterTick(){
  if(!starterBorn(this.store.root)){
   const made=new Set(readNotebookRoutines(this.store).jobs.map(j=>j.id));if(!made.size)return [];
   const timezone=this.store.get('settings','installation')?.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone;
   writeRoutineFiles(this.home,this.workoutsFiles({root:this.store.root,timezone}));
   return saveRoutineResults(this.store,{home:this.home,jobs:hermesJobs(this.home).filter(j=>made.has(j.id)),messenger:telegramInHermes(this.home)});
  }
  const here=readMachineRecord(this.store),installation=this.store.get('settings','installation');
  if(here?.state==='created'&&installation?.timezone)writeRoutineFiles(this.home,this.workoutsFiles({root:this.store.root,timezone:installation.timezone}));
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
 async tick({raise=false}={}){
  // A notebook still owned by the old shared name is taken over (device-id.mjs).
  if(this.owner()===LEGACY_DEVICE&&this.claimLegacy)try{await this.claimLegacy();}catch{}
  if(!this.owns()){this.onProgress?.();return [];}
  let records=Promise.resolve([]);
  // A setup asking inside a running tick or the cooldown still hears whether the connection check could be made.
  if(this.ticking){if(raise){await this.current?.catch(()=>null);await this.followConnectionCheck();}return records;}
  const now=this.now();if(now-(this.lastTick||0)<60000){this.onProgress?.();if(raise)await this.followConnectionCheck();return records;}
  if(this.updater)await beatWhile(this.updater.tick(this.store.get('settings','installation')?.timezone),()=>this.onProgress?.(),{limitMs:this.updateLimit,every:this.beatEvery}).catch(error=>console.error('Godspeed Mission Control: the Hermes update could not be checked: '+String(error?.message||error)));
  const release=this.lifecycle.acquire('routine tick');if(!release)return records;
  this.ticking=true;this.lastTick=now;
  let failure=null,finish;const failures=[];
  this.current=new Promise(r=>{finish=r;});
  try{
   records=this.records?.tick().catch(()=>[])||Promise.resolve([]);
   await this.startRoutines().catch(()=>null);
   this.followingSetup=true;
   try{
    await this.followCleanup({retry:!raise}).catch(()=>null);
    await this.followNoticeSender({retry:!raise}).catch(()=>null);
    await this.followSwitches({retry:!raise}).catch(()=>null);
   }finally{this.followingSetup=false;this.setupNotice(readSetupFailures(this.store),this.now());}
   await this.addNewStartingRoutines().catch(()=>null);
   await this.followJournal().catch(()=>null);
   await this.followConnectionCheck().catch(e=>{failure=e;failures.push(e);});
   await this.followMailCountVisibly().catch(e=>{failure||=e;});
   await this.followWorkouts({retry:!raise}).catch(e=>{failure||=e;failures.push(e);});
   await this.followChatTidy().catch(e=>{failure=failure||e;failures.push(e);});
   await this.followBrief().catch(()=>null);
   await this.followDelivery().catch(()=>null);
   try{moveSettingsDeadlines(this.store);}catch{}
   await beatWhile(this.command(['tick'],{timeout:this.tickLimit}),()=>this.onProgress?.(),{limitMs:this.tickLimit+60000,every:this.beatEvery});
   try{this.afterTick();}catch{}
  }
  finally{this.ticking=false;finish();release();}
  // The setup that asked for this tick hears that a routine could not be made; the periodic tick logs it (onFailure) and keeps going.
  if(failure){if(raise)throw failure;for(const error of failures)try{this.onFailure?.(error);}catch{}}
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
  const release=this.lifecycle.acquire('routine run');
  if(!release){try{this.saveRunDiagnostic({id:'rejected-'+randomUUID(),at:new Date(this.now()).toISOString(),admitted:false,lifecycle_owner:this.lifecycle.reason,requested_job:id||null});}catch{}throw Error('The assistant is updating or another routine is already running.');}
  const args=id?['run',id]:['tick'],diagnosticId='run-'+randomUUID(),command=this.routineCommand(args);
  try{this.saveRunDiagnostic({id:diagnosticId,at:new Date(this.now()).toISOString(),admitted:true,lifecycle_owner:'routine run',requested_job:id||null,command:[command.executable,...command.args],child:{pid:null,tree:null},exit_status:null,signal:null,stderr:'',run_log:{path:path.join(this.home,'cron','output'),command_output:''}});}
  catch(error){release();throw error;}
  const run=this.runNow(id,{diagnosticId,command});this.running=run;run.catch(error=>{try{this.onFailure?.(error);}catch{}}).finally(()=>{if(this.running===run)this.running=null;release();});
  return {started:true,...(id?{id}:{})};
 }
 recordRunDiagnostic(id,fields){if(!id)return;try{this.updateRunDiagnostic(id,fields);}catch(error){try{this.onFailure?.(error);}catch{}}}
 async runNow(id,{diagnosticId=null,command=null}={}){
  this.requireOwner('Run the routine');
  const runCommand=command||this.routineCommand(id?['run',id]:['tick']),started=child=>this.recordRunDiagnostic(diagnosticId,{child:{pid:child?.pid??null,tree:child?.tree??null}});
  const work=id?(()=>{if(!nativeJobs(this.home,this.device).some(j=>j.id===id))throw Error('Choose an existing Hermes task');return this.runRoutineCommand(runCommand,{timeout:this.tickLimit,onStart:started,detail:true});})():this.runRoutineCommand(runCommand,{timeout:this.tickLimit,onStart:started,detail:true});
  let result;
  try{result=await beatWhile(work,()=>this.onProgress?.(),{limitMs:this.tickLimit+60000,every:this.beatEvery});}
  catch(error){this.recordRunDiagnostic(diagnosticId,{exit_status:error?.code??null,signal:error?.signal??null,stderr:diagnostic(error),run_log:{path:path.join(this.home,'cron','output'),command_output:diagnostic({stderr:error?.stdout})}});throw error;}
  this.recordRunDiagnostic(diagnosticId,{exit_status:result?.code??0,signal:result?.signal??null,stderr:diagnostic({stderr:result?.stderr}),run_log:{path:path.join(this.home,'cron','output'),command_output:diagnostic({stderr:result?.stdout})}});
  try{this.afterTick();}catch{}
  return result?.stdout;
 }
 async control(input,{enable=false}={}){
  if(enable){
   this.requireOwner('Add the routine');
   const known=enableKind(input.kind),skill=known?.skill||skills[input.kind]||input.kind;
   if(!/^[a-z0-9-]+$/.test(skill)||!fs.existsSync(path.join(this.store.root,'skills',skill,'SKILL.md')))throw Error('This mission control does not have the recipe for that routine');
   const running=hermesJobs(this.home).find(j=>!pausedJob(j)&&(input.kind==='morning-brief'?isBriefJob(j):[j.skill,...(Array.isArray(j.skills)?j.skills:[])].includes(skill)));
   if(running)throw Error('"'+(running.name||skill)+'" already runs this. Change its time under Routine times, or pause it under Routines.');
   const daily=dailyTime(input.at);
   if(!daily&&(!Number.isFinite(input.interval_ms)||input.interval_ms<60000))throw Error('Choose a daily time or a routine interval of at least a minute');
   if(input.kind==='morning-brief'){const id=await this.makeBrief(daily?daily.minute+' '+daily.hour+' * * *':Math.ceil(input.interval_ms/60000)+'m',input.title);const rows=nativeJobs(this.home,this.device);return rows.find(j=>j.id===id)||rows.at(-1);}
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
