#!/usr/bin/env node
// THE DAILY CONNECTION CHECK, AS THE ROUTINE RUNS IT (4 November 2026, #200; core/connection-check.mjs and, for the owner's routines, core/routine-check.mjs
// says what it checks and when it speaks). It prints nothing: what it has to say is queued as a notice,
// which the routine's script says in the same run (routine-scripts/godspeed_routines.py, connection_check).
//
//   GODSPEED_WORKSPACE=<mission control> node notebook/scripts/connection-check.mjs [--hermes <path>] [--hermes-source <folder>]
//
// A failure is one fixed sentence, never the error's own text: a git error can carry an address with
// a token in it, and nothing here may put a key in a log.
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Store} from '../core/records/store.mjs';
import {machineDevice} from '../core/device-id.mjs';
import {checkConnections,defaultProbes} from '../core/connection-check.mjs';
import {checkRoutines} from '../core/routine-check.mjs';
import {isServerInstall} from '../core/about.mjs';

const option=name=>{const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:undefined;};
const dayIn=(timezone,env=process.env)=>/^\d{4}-\d{2}-\d{2}$/.test(env.GODSPEED_TODAY||'')?env.GODSPEED_TODAY:new Intl.DateTimeFormat('en-CA',{timeZone:timezone||'UTC',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

// The connections and then the owner's routines (core/routine-check.mjs, #239); each runs even when the other failed, and the first failure is thrown.
export async function runConnectionCheck({root,home=process.env.HERMES_HOME,hermes,hermesSource,env=process.env,probes,jobs}){
 const store=new Store(root,{device:machineDevice(root).id});
 const timezone=store.get('settings','installation')?.timezone||'UTC',day=dayIn(timezone,env);
 const failures=[];let record;
 try{record=await checkConnections({store,day,probes:probes||defaultProbes({store,home,hermes,hermesSource,server:isServerInstall({env})})});}catch(error){failures.push(error);}
 try{checkRoutines({store,home,day,timezone,...(jobs?{jobs}:{})});}catch(error){failures.push(error);}
 if(failures.length)throw failures[0];
 return record;
}

if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
 const root=process.env.GODSPEED_WORKSPACE||process.env.GODSPEED_ROOT;
 if(!root||!process.env.HERMES_HOME){console.error('The daily connection check does not know which mission control to read.');process.exit(2);}
 try{
  await runConnectionCheck({root:path.resolve(root),hermes:option('--hermes'),hermesSource:option('--hermes-source')});
  process.exit(0);
 }catch{
  console.error('The daily connection check stopped before it finished.');
  process.exit(1);
 }
}
