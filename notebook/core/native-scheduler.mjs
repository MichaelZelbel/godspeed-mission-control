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
import {FLAG,STARTING_ROUTINES,routineFiles,writeRoutineFiles,prepareCheckIn,saveRoutineResults,readMachineRecord,writeMachineRecord,telegramInHermes} from './starting-routines.mjs';
const skills={'goal-decision':'next-action','goal-work':'work-item','morning-brief':'morning-brief',coaching:'coach','habit-check':'coach',journal:'interstitial-journal',headache:'headache-tracker'};
// Hermes' own record of its jobs, as it wrote it.
export function hermesJobs(home){
 const file=path.join(home,'cron/jobs.json');if(!fs.existsSync(file))return [];
 const data=JSON.parse(fs.readFileSync(file,'utf8')),jobs=Array.isArray(data)?data:data.jobs||[];
 return jobs.filter(j=>j&&typeof j==='object');
}
// When a routine last ran and how it went is Hermes' own record (last_run_at, last_status,
// last_error); until 8 October 2026 the Routines list showed neither.
export function nativeJobs(home,device='local'){
 return hermesJobs(home).map(j=>({id:j.id,title:j.name||j.id,kind:j.skill||j.name||'Hermes task',owner:device,paused:j.enabled===false,state:j.state||j.last_status||'pending',next_run:j.next_run_at,last_run_at:j.last_run_at||null,last_status:j.last_status||null,last_error:typeof j.last_error==='string'?j.last_error.slice(0,500):null,schedule:j.schedule_display||null,deliver:j.deliver||null,created_at:j.created_at,interval_ms:j.schedule?.seconds?j.schedule.seconds*1000:null,native:true,_hash:hash(j)}));
}
const RETRY_STARTING=3600000;
// "05:16": once a day at that time in the owner's timezone.
export function dailyTime(at){const m=/^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(at||'').trim());return m?{hour:Number(m[1]),minute:Number(m[2]),time:m[1].padStart(2,'0')+':'+m[2]}:null;}
// `hermes cron tick` runs every due job to the end before it returns (and has
// already moved each job's next run on, so a killed run is lost for the day).
// Hermes stops a job that goes quiet for ten minutes and gives a job's own
// script an hour, so a tick gets two hours; past that it is stopped with all
// it started, and its heartbeat stops with it.
export const TICK_LIMIT=2*3600000;
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
  // The first goal starts the routines, on the first setup only: an installation set up before
  // is left as it is.
  const routines=old?null:await this.startRoutines({goal:nativeCardRows(this.store,'goals').find(g=>g.title===goal?.trim())?.id,setup:true});
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
  // Once per machine, whatever became of it.
  if(here&&here.state!=='pending')return null;
  if(here?.retry_after&&Date.parse(here.retry_after)>now)return null;
  // The mission control's first machine already had routines of its own: none were started.
  if(flag?.state==='skipped')return null;
  // A mission control set up before, with no record of starting routines, is left alone.
  if(!flag&&installation&&!setup)return null;
  // Never for a mission control not made from the starter: the owner's adopted one, live on
  // several machines with routines of its own, gets nothing new.
  if(!starterBorn(root))return null;
  const adopted=nativeCardRows(this.store,'goals').filter(g=>g.status==='adopted').sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)));
  const serves=goal||flag?.goal||adopted[0]?.id||null,at=new Date(now).toISOString();
  const record=fields=>this.store.saveAsync('settings',{id:FLAG,goal:serves,...fields});
  if(!adopted.length){if(setup&&!flag)await record({state:'pending',requested_at:at});return null;}
  // Routines live in the Hermes of the machine that runs them; another machine makes them there.
  if(installation?.owner&&installation.owner!==this.device){if(!flag)await record({state:'pending',requested_at:at});return {state:'pending',owner:installation.owner};}
  if(hermesJobs(this.home).length){
   writeMachineRecord(this.store,{state:'skipped',device:this.device,reason:'This machine\'s Hermes already had routines of its own',decided_at:at});
   if(!flag||flag.state==='pending')await record({state:'skipped',reason:'Hermes already had routines of its own',decided_at:at});
   return {state:'skipped'};
  }
  // The goal was told in the chat before any setup: this machine runs the routines, on its own
  // clock.
  if(!installation)installation=await this.store.saveAsync('settings',{id:'installation',owner:this.device,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,delivery:'notebook'});
  const timezone=installation.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone,delivery=installation.delivery==='telegram'||telegramInHermes(this.home)?'telegram':'local';
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
   if(!flag)await record({state:'pending',requested_at:at});
   return {state:'pending',error:message};
  }
  writeMachineRecord(this.store,{state:'created',device:this.device,created_at:at,timezone,delivery,jobs});
  if(flag?.state!=='created')await record({state:'created',first_device:this.device,created_at:at});
  return {state:'created',jobs};
 }
 async createStartingRoutines(delivery){
  const made=[];
  try{
   for(const routine of STARTING_ROUTINES){
    const before=new Set(hermesJobs(this.home).map(j=>j.id));
    await this.command(['create',routine.schedule,...(routine.prompt?[routine.prompt]:['--no-agent']),'--name',routine.name,'--script',routine.script,'--deliver',delivery,'--failure-deliver','local','--workdir',this.store.root]);
    const job=hermesJobs(this.home).find(j=>!before.has(j.id)&&j.name===routine.name);
    if(!job)throw Error('Hermes did not keep the routine "'+routine.name+'"');
    made.push({id:job.id,key:routine.key,name:routine.name,what:routine.what});
   }
  }catch(error){for(const job of made)await this.command(['remove',job.id]).catch(()=>{});throw error;}
  return made;
 }
 // After every tick on the machine that runs the routines of a starter-born mission control: the
 // starting routines' scripts follow the notebook's folders (an upgrade moves them), and a reply
 // that reached nobody becomes a note.
 afterTick(){
  if(!starterBorn(this.store.root))return [];
  const here=readMachineRecord(this.store),installation=this.store.get('settings','installation');
  if(here?.state==='created'&&installation?.timezone)writeRoutineFiles(this.home,routineFiles({root:this.store.root,home:this.home,state:this.store.state,timezone:installation.timezone,hermes:this.executable}));
  return saveRoutineResults(this.store,{home:this.home,jobs:hermesJobs(this.home),messenger:installation?.delivery==='telegram'||telegramInHermes(this.home)});
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
   const skill=skills[input.kind]||input.kind;
   if(!/^[a-z0-9-]+$/.test(skill)||!fs.existsSync(path.join(this.store.root,'skills',skill,'SKILL.md')))throw Error('Choose an installed Godspeed skill');
   const daily=dailyTime(input.at);
   if(!daily&&(!Number.isFinite(input.interval_ms)||input.interval_ms<60000))throw Error('Choose a daily time or a routine interval of at least a minute');
   const delivery=this.store.get('settings','installation')?.delivery==='telegram'?'telegram':'local';
   await this.command(['create',daily?daily.minute+' '+daily.hour+' * * *':Math.ceil(input.interval_ms/60000)+'m','Follow the '+skill+' skill in this Godspeed workspace.','--name',input.title||skill,'--skill',skill,'--workdir',this.store.root,'--deliver',delivery]);
   return nativeJobs(this.home,this.device).at(-1);
  }
  // A notebook record routine is paused and resumed through its own guarded
  // control, which keeps an uncertain delivery from being resumed.
  if(this.records&&typeof input?.id==='string'&&!nativeJobs(this.home,this.device).some(j=>j.id===input.id)&&this.store.get('jobs',input.id)){const {controlRoutine}=await import('./jobs/routine-control.mjs');return controlRoutine(this.store,{id:input.id,paused:input.paused});}
  if(typeof input.paused!=='boolean'||!nativeJobs(this.home,this.device).some(j=>j.id===input.id))throw Error('Choose whether to pause an existing Hermes task');
  await this.command([input.paused?'pause':'resume',input.id]);return nativeJobs(this.home,this.device).find(j=>j.id===input.id);
 }
}
