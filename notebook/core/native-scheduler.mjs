import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {hash} from './records/store.mjs';
import {assistantEnvironment} from './assistant-files.mjs';
import {nativeCardRows} from './card-commands.mjs';
const execute=promisify(execFile);
const skills={'goal-decision':'next-action','goal-work':'work-item','morning-brief':'morning-brief',coaching:'coach','habit-check':'coach',journal:'interstitial-journal',headache:'headache-tracker'};
export function nativeJobs(home,device='local'){
 const file=path.join(home,'cron/jobs.json');if(!fs.existsSync(file))return [];
 const data=JSON.parse(fs.readFileSync(file,'utf8')),jobs=Array.isArray(data)?data:data.jobs||[];
 return jobs.map(j=>({id:j.id,title:j.name||j.id,kind:j.skill||j.name||'Hermes task',owner:device,paused:j.enabled===false,state:j.state||j.last_status||'pending',next_run:j.next_run_at,created_at:j.created_at,interval_ms:j.schedule?.seconds?j.schedule.seconds*1000:null,native:true,_hash:hash(j)}));
}
// The notebook edits Hermes schedules; it never runs a second scheduler.
export class NativeScheduler{
 constructor(store,{executable,home,device=store.device,run=execute}){Object.assign(this,{store,executable,home,device,run});}
 async command(args){const result=await this.run(this.executable,['cron',...args],{cwd:this.store.root,windowsHide:true,shell:false,env:assistantEnvironment({home:this.home,workspace:this.store.root}),maxBuffer:1024*1024});return result.stdout;}
 async configure({goal,timezone,owner=this.device,delivery='notebook'}){
  timezone||=Intl.DateTimeFormat().resolvedOptions().timeZone;new Intl.DateTimeFormat('en',{timeZone:timezone});
  const old=this.store.get('settings','installation');
  if(!old&&!goal?.trim())throw Error('Name one goal to start');
  await this.store.saveAsync('settings',{id:'installation',owner,timezone,delivery,...old});
  if(goal?.trim()&&!nativeCardRows(this.store,'goals').some(g=>g.title===goal.trim())){
   const script=new URL('../../tools/goals.js',import.meta.url);
   await this.run(process.execPath,[fileURLToPath(script),'file','--kind','outcome','--status','adopted','--title',goal.trim(),'--source','Notebook setup, '+new Date().toISOString(),'--godspeed',this.store.root],{cwd:this.store.root,windowsHide:true,env:assistantEnvironment({home:this.home,workspace:this.store.root})});
  }
  return {configured:true,preserved:!!old,firstWorkPending:false,scheduler:'hermes'};
 }
 async transfer(owner){const old=this.store.get('settings','installation');if(!old)throw Error('Complete setup first');await this.store.saveAsync('settings',{id:old.id,owner});}
 async tick(){if(this.ticking||Date.now()-(this.lastTick||0)<60000)return [];this.ticking=true;this.lastTick=Date.now();try{await this.command(['tick']);return [];}finally{this.ticking=false;}}
 async runNow(id){if(id){if(!nativeJobs(this.home,this.device).some(j=>j.id===id))throw Error('Choose an existing Hermes task');return this.command(['run',id]);}return this.command(['tick']);}
 async control(input,{enable=false}={}){
  if(enable){
   const skill=skills[input.kind]||input.kind;
   if(!/^[a-z0-9-]+$/.test(skill)||!fs.existsSync(path.join(this.store.root,'skills',skill,'SKILL.md')))throw Error('Choose an installed Godspeed skill');
   if(!Number.isFinite(input.interval_ms)||input.interval_ms<60000)throw Error('Choose a routine interval of at least a minute');
   const delivery=this.store.get('settings','installation')?.delivery==='telegram'?'telegram':'local';
   await this.command(['create',Math.ceil(input.interval_ms/60000)+'m','Follow the '+skill+' skill in this Godspeed workspace.','--name',input.title||skill,'--skill',skill,'--workdir',this.store.root,'--deliver',delivery]);
   return nativeJobs(this.home,this.device).at(-1);
  }
  if(typeof input.paused!=='boolean'||!nativeJobs(this.home,this.device).some(j=>j.id===input.id))throw Error('Choose whether to pause an existing Hermes task');
  await this.command([input.paused?'pause':'resume',input.id]);return nativeJobs(this.home,this.device).find(j=>j.id===input.id);
 }
}
