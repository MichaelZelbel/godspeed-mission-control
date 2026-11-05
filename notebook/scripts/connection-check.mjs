#!/usr/bin/env node
// THE DAILY CONNECTION CHECK, AS THE ROUTINE RUNS IT (4 November 2026, #200; core/connection-check.mjs
// says what it checks and when it speaks). It prints nothing: what it has to say is queued as a notice,
// which the routine's script says in the same run (routine-scripts/godspeed_routines.py, connection_check).
//
//   GODSPEED_WORKSPACE=<mission control> node notebook/scripts/connection-check.mjs [--hermes <path>] [--hermes-source <folder>] [--server]
//
// A failure is one fixed sentence, never the error's own text: a git error can carry an address with
// a token in it, and nothing here may put a key in a log.
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Store} from '../core/records/store.mjs';
import {machineDevice} from '../core/device-id.mjs';
import {checkConnections,defaultProbes} from '../core/connection-check.mjs';

const option=name=>{const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:undefined;};
const dayIn=(timezone,env=process.env)=>/^\d{4}-\d{2}-\d{2}$/.test(env.GODSPEED_TODAY||'')?env.GODSPEED_TODAY:new Intl.DateTimeFormat('en-CA',{timeZone:timezone||'UTC',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

export async function runConnectionCheck({root,home=process.env.HERMES_HOME,hermes,hermesSource,server=false,env=process.env,probes}){
 const store=new Store(root,{device:machineDevice(root).id});
 const day=dayIn(store.get('settings','installation')?.timezone,env);
 return checkConnections({store,day,probes:probes||defaultProbes({store,home,hermes,hermesSource,server})});
}

if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
 const root=process.env.GODSPEED_WORKSPACE||process.env.GODSPEED_ROOT;
 if(!root||!process.env.HERMES_HOME){console.error('The daily connection check does not know which mission control to read.');process.exit(2);}
 try{
  await runConnectionCheck({root:path.resolve(root),hermes:option('--hermes'),hermesSource:option('--hermes-source'),server:process.argv.includes('--server')});
  process.exit(0);
 }catch{
  console.error('The daily connection check stopped before it finished.');
  process.exit(1);
 }
}
