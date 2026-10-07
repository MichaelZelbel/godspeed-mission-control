import path from 'node:path';import {spawn} from 'node:child_process';import {hash,atomic} from './records/store.mjs';
import {terminateOwnedTree} from './process-tree.mjs';
import {HealthMonitor,STALL_AFTER} from './supervisor-health.mjs';
export const RETRY_AFTER_FAILURES=10*60000;
import {missingRuns} from './missing-runs.mjs';
// Separate from the notebook process: a stopped or unresponsive service cannot
// perform its own missing-run check. This process owns only its direct child.
// (scripts/supervise.mjs starts one; the parts are passed in so they can be tested.)
export class Supervisor{
 constructor({root,server,port=47831,device,env=process.env,spawnProcess=spawn,fetchImpl=fetch,terminate=terminateOwnedTree,missing=missingRuns,setTimer=setTimeout,every=30000,graceMs=90000,exit=code=>{process.exitCode=code;}}){
  Object.assign(this,{root,server,port,device,env,spawnProcess,fetchImpl,terminate,missing,setTimer,every,graceMs,exit});
  this.instance=hash(path.resolve(root)).slice(0,24);this.state=path.join(root,'.godspeed','supervisor.json');
  this.child=null;this.stopping=false;this.restarts=0;this.started=0;this.checking=false;this.shutdown=Promise.resolve();this.missingRuns=[];this.missingError=null;this.monitor=new HealthMonitor();
 }
 // Best-effort: this file is advisory, and the notebook is a non-detached child,
 // so a throw here (a read-only file, a full disk, a scanner holding it for a
 // moment) must never end the supervisor and take the notebook down with it.
 // Until 7 October 2026 one failed write did exactly that on Windows.
 status(value){try{atomic(this.state,JSON.stringify({pid:process.pid,child_pid:this.child?.pid,at:new Date().toISOString(),restarts:this.restarts,health_failures:this.monitor.failures,failure_history:this.monitor.history,missing_runs:this.missingRuns,missing_run_check_error:this.missingError,...value}));}catch(error){console.error('Godspeed Mission Control supervisor: could not write its status file (continuing):',error.message);}}
 start(){this.launch();this.timer=setInterval(()=>{void this.check();},this.every);return this;}
 giveUp(reason){this.status({state:'needs_review',reason});clearInterval(this.timer);this.exit(1);}
 launch(){
  if(this.stopping)return;
  this.started=Date.now();this.monitor.launched();
  const child=this.child=this.spawnProcess(process.execPath,[this.server],{env:this.env,windowsHide:true,shell:false,stdio:'inherit'});
  this.status({state:'starting'});
  // A notebook that could not start, or that stopped, is started again after
  // a growing pause, five times. Until 6 October 2026 only a stop led to a new
  // start: one that failed to start left the supervisor waiting for ever.
  let ended=false;
  const relaunch=async reason=>{
   if(ended)return;ended=true;
   try{await this.shutdown;}catch{return this.giveUp('Owned process shutdown failed');}
   if(this.stopping)return;
   this.monitor.failure(reason);this.restarts++;this.status({state:'recovering',reason});
   if(this.restarts<=5)this.setTimer(()=>this.launch(),Math.min(1000*2**this.restarts,30000));
   // Past five it keeps trying, every ten minutes, and says so. Until 7 October
   // 2026 it stopped for good, and the notebook stayed down until someone saw it.
   else{this.status({state:'needs_review',reason:'Five automatic restarts failed; trying again every ten minutes'});this.setTimer(()=>this.launch(),RETRY_AFTER_FAILURES);}
  };
  child.on('error',error=>{this.status({state:'failed',reason:'Notebook process could not start'});void relaunch('Notebook process could not start: '+error.message);});
  child.on('exit',(code,signal)=>{void relaunch('Notebook stopped: '+(signal||'exit '+code));});
 }
 async check(now=Date.now()){
  if(this.stopping||this.checking||!this.child||now-this.started<this.graceMs)return;
  this.checking=true;
  try{
   try{this.missingRuns=this.missing(this.root,now,this.device);this.missingError=null;}catch{this.missingRuns=[];this.missingError='Saved scheduling evidence could not be read';}
   const response=await this.fetchImpl('http://127.0.0.1:'+this.port+'/health',{signal:AbortSignal.timeout(15000)}),health=await response.json();
   if(!response.ok||health.instance!==this.instance)throw Error('Workspace health check failed');
   if(health.scheduler_heartbeat&&now-Date.parse(health.scheduler_heartbeat)>STALL_AFTER)throw Error('Scheduler heartbeat stopped');
   this.monitor.success(now);if(this.monitor.stablyHealthy(now))this.restarts=0;this.status({state:'healthy'});
  }catch(error){
   // A reply that did not come in time is a slow notebook; a refused connection, one not
   // (or no longer) listening; anything else, one that answered that it is stuck.
   const kind=error?.name==='TimeoutError'||error?.name==='AbortError'?'slow':error?.message==='fetch failed'||error?.cause?.code==='ECONNREFUSED'?'refused':'stuck';
   const decision=this.monitor.failure(error.message,now,kind);this.status({state:decision.restart?'recovering':'checking',reason:error.message});
   if(decision.restart){this.shutdown=this.terminate(this.child);try{await this.shutdown;}catch{this.status({state:'needs_review',reason:'Owned process shutdown failed'});}}
  }finally{this.checking=false;}
 }
 async stop(){
  this.stopping=true;clearInterval(this.timer);this.shutdown=this.terminate(this.child);
  try{await this.shutdown;this.status({state:'stopped'});}catch{this.status({state:'needs_review',reason:'Owned process shutdown failed'});this.exit(1);}
 }
}
