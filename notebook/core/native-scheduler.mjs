import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {hash} from './records/store.mjs';
import {assistantEnvironment} from './assistant-files.mjs';
import {nativeCardRows} from './card-commands.mjs';
import {runCommand} from './child-process.mjs';
import {beatWhile,HEARTBEAT_EVERY} from './supervisor-health.mjs';
const skills={'goal-decision':'next-action','goal-work':'work-item','morning-brief':'morning-brief',coaching:'coach','habit-check':'coach',journal:'interstitial-journal',headache:'headache-tracker'};
export function nativeJobs(home,device='local'){
 const file=path.join(home,'cron/jobs.json');if(!fs.existsSync(file))return [];
 const data=JSON.parse(fs.readFileSync(file,'utf8')),jobs=Array.isArray(data)?data:data.jobs||[];
 return jobs.map(j=>({id:j.id,title:j.name||j.id,kind:j.skill||j.name||'Hermes task',owner:device,paused:j.enabled===false,state:j.state||j.last_status||'pending',next_run:j.next_run_at,created_at:j.created_at,interval_ms:j.schedule?.seconds?j.schedule.seconds*1000:null,native:true,_hash:hash(j)}));
}
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
  if(goal?.trim()&&!nativeCardRows(this.store,'goals').some(g=>g.title===goal.trim())){
   const script=new URL('../../tools/goals.js',import.meta.url);
   await this.run(process.execPath,[fileURLToPath(script),'file','--kind','outcome','--status','adopted','--title',goal.trim(),'--source','Notebook setup, '+new Date().toISOString(),'--godspeed',this.store.root],{cwd:this.store.root,windowsHide:true,env:assistantEnvironment({home:this.home,workspace:this.store.root}),timeout:120000});
  }
  return {configured:true,preserved:!!old,firstWorkPending:false,scheduler:'hermes'};
 }
 // The notebook's record routines move with the owner; Hermes' own routines
 // live in each machine's Hermes and stay where they were made.
 async transfer(owner){if(!this.store.get('settings','installation'))throw Error('Complete setup first');await this.store.withLockAsync(()=>{const current=this.store.get('settings','installation');this.store.commit([this.store.prepare('settings',{owner},current),...this.store.list('jobs').filter(j=>j.owner!==owner).map(j=>this.store.prepare('jobs',{owner},j))]);});}
 // onProgress is what the health check reads as "the server is alive". A
 // deliberately skipped tick is alive, and so is a tick inside its time limit
 // (beatWhile); a tick past its limit is not reported, so a wedged scheduler
 // is still caught and restarted.
 // Only the machine the owner chose runs routines; until 6 October 2026 every
 // machine with the assistant ticked them, so a routine could run twice.
 owner(){return this.store.get('settings','installation')?.owner||null;}
 owns(){const owner=this.owner();return !owner||owner===this.device;}
 async tick(){
  if(!this.owns()){this.onProgress?.();return [];}
  const records=this.records?.tick().catch(()=>[])||Promise.resolve([]);
  if(this.ticking)return records;
  if(Date.now()-(this.lastTick||0)<60000){this.onProgress?.();return records;}
  this.ticking=true;this.lastTick=Date.now();
  try{await beatWhile(this.command(['tick'],{timeout:this.tickLimit}),()=>this.onProgress?.(),{limitMs:this.tickLimit+60000,every:this.beatEvery});}
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
  return beatWhile(work,()=>this.onProgress?.(),{limitMs:this.tickLimit+60000,every:this.beatEvery});
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
