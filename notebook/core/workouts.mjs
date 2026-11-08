import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runChild} from './child-process.mjs';
import {scrubCredentials} from './runtime.mjs';
import {stateDir,statePaths} from '../../third-party/addons/godspeed-workouts/lib/paths.mjs';
import {loadSettings} from '../../third-party/addons/godspeed-workouts/lib/settings.mjs';
import {readKey} from '../../third-party/addons/godspeed-workouts/lib/keys.mjs';

const bin=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../third-party/addons/godspeed-workouts/bin/godspeed-workouts.mjs');
const refusal=/Hevy refused that key\. Make a new one at https:\/\/hevy\.com\/settings\?developer \(it needs Hevy Pro\) and try again\./;
const timestamp=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,9})?)?(?:Z|[+-]\d\d:\d\d)$/.test(value)?value:null;
const safeProblem=value=>({name:String(value?.name||'connection').replace(/[^a-z0-9 -]/gi,'').slice(0,80)||'connection',since:timestamp(value?.since)});

// This is deliberately a process boundary.  The carried add-on owns the key and its state; the
// notebook only gives it a submitted key on stdin and projects the few status fields Settings needs.
export class WorkoutsAddon {
 constructor({root,address=()=>null,env=process.env,run=runChild}={}){Object.assign(this,{root,address,env,run});this.paths=statePaths(stateDir({env}));}
 hasKey(){return !!readKey(this.paths);}
 routineConfig(){return {workouts:bin,workouts_notebook:this.address()};}
 async command(args,{key}={}){
  const notebook=this.address(),env={...this.env};
  if(notebook)env.GODSPEED_WORKOUTS_NOTEBOOK=notebook;
  delete env.HEVY_API_KEY;
  return this.run(process.execPath,[bin,...args],{cwd:this.root,env,input:key===undefined?undefined:key+'\n',timeoutMs:120000,maxBytes:256*1024});
 }
 async connect(key){
  const first=!this.hasKey(),args=first?['setup','--godspeed',this.root,'--no-schedule']:['connect'];
  const result=await this.command(args,{key});
  if(result.code){const match=refusal.exec(result.stderr);throw Error(match?match[0]:'Could not connect Workouts from Hevy. Check the key and try again.');}
  return {first};
 }
 async uninstall({retrySystemdReload=false}={}){
  const result=await this.command(['uninstall',...(retrySystemdReload?['--retry-systemd-reload']:[])]);
  if(result.code){const detail=scrubCredentials(String(result.stderr||result.stdout||'')).split(/\r?\n/).map(line=>line.trim()).filter(Boolean)[0],error=Error(detail?'Could not remove the standalone Workouts schedule: '+detail:'Could not remove the standalone Workouts schedule.');if(result.code===2)error.retrySystemdReload=true;throw error;}
 }
 async status({routine=null}={}){
  const saved=this.hasKey();
  let raw={};
  try{const result=await this.command(['status','--json']);if(result.code)throw Error();raw=JSON.parse(result.stdout);}catch{}
  const settings=loadSettings(this.paths),state=raw&&typeof raw.state==='object'?raw.state:{},problems=Object.entries(state.problems||{}).map(([name,value])=>safeProblem({name,...(value&&typeof value==='object'?value:{})}));
  if(timestamp(state.hevy_down_since))problems.push({name:'hevy-not-answering',since:timestamp(state.hevy_down_since)});
  if(timestamp(state.notebook_down_since))problems.push({name:'notebook-not-answering',since:timestamp(state.notebook_down_since)});
  const last=state.last_run&&typeof state.last_run==='object'?{at:timestamp(state.last_run.at),ok:state.last_run.ok===true,summary:state.last_run.ok?['added','changed','removed','kept'].map(k=>Number(state.last_run[k]||0)+' '+k).join(', '):'Could not import workouts'}:null;
  return {available:true,connected:saved&&routine?.state!=='disconnected',rows:Number.isInteger(raw.rows)?raw.rows:0,minute:Number.isInteger(settings.minute)?settings.minute:null,last_run:last,problems,routine};
 }
}
