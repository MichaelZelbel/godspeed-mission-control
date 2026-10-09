#!/usr/bin/env node
// The Telegram setup chat's last step on the one-click server (GODSPEED_TG_FINISH, set by
// docker/full-candidate/telegram-runner.mjs). Files the reader's goal and clock the way the
// notebook's own "Start with one goal" does, and makes Telegram the place routines deliver
// to. Reads {"timezone":"Europe/London","goal":"..."} on standard input.
//
// With the argument "connect" it reads {"repository":"https://github.com/<owner>/<name>.git"}
// instead: a Mission Control the reader already has on GitHub, connected the way Settings'
// "Connect record sync" connects it (the same worker and checks, with the GitHub sign-in the
// chat made), and prints {"state":...} of its first round.
import fs from 'node:fs';
import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {NativeScheduler} from '../core/native-scheduler.mjs';
import {machineDevice} from '../core/device-id.mjs';
import {SyncRunner} from '../core/sync/runner.mjs';

const root=process.env.GODSPEED_WORKSPACE;if(!root)throw Error('Set GODSPEED_WORKSPACE to the notebook folder');
const input=JSON.parse(fs.readFileSync(0,'utf8')||'{}');
if(process.argv[2]==='connect'){
  try{
    const status=await new SyncRunner(root).configure(String(input.repository||''));
    // A worker that stopped before it was configured says only that sync did not complete.
    if(!fs.existsSync(path.join(root,'.godspeed','sync-config.json')))throw Error('The repository could not be connected; nothing was changed');
    console.log(JSON.stringify({state:status.state}));process.exit(0);
  }catch(error){console.error(error.message);process.exit(1);}
}
const timezone=typeof input.timezone==='string'&&input.timezone?input.timezone:undefined,goal=String(input.goal||'').trim();
const store=new Store(root,{device:machineDevice(root).id});
// A Mission Control the reader brought in has its goals and settings already: only the chat's
// newer answers, the clock and Telegram, go onto them. Before its first round has brought them
// there is nothing to file onto, and the round brings them.
if(input.joined===true&&!goal){
  const old=store.get('settings','installation');
  if(old)await store.saveAsync('settings',{id:'installation',...(timezone?{timezone}:{}),delivery:'telegram'});
  console.log(old?'Filed the clock; routines deliver to Telegram.':'Nothing to file yet; the settings arrive with the first sync.');
  process.exit(0);
}
const scheduler=new NativeScheduler(store,{executable:process.env.GODSPEED_HERMES||'/opt/hermes/bin/hermes',home:process.env.HERMES_HOME,device:store.device});
await scheduler.configure({goal,timezone,delivery:'telegram'});
// configure keeps an earlier setup's clock and delivery; the chat's answers are newer.
await store.saveAsync('settings',{id:'installation',...(timezone?{timezone}:{}),delivery:'telegram'});
console.log('Filed the goal and the clock; routines deliver to Telegram.');
process.exit(0);
