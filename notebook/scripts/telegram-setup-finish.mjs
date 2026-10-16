#!/usr/bin/env node
// The Telegram setup chat's last step on the one-click server (GODSPEED_TG_FINISH, set by
// docker/full-candidate/telegram-runner.mjs). Since 16 October 2026 that chat is the technical part
// only (an AI and Telegram), and getting to know the owner is a chat of its own afterwards
// (core/context-setup.mjs). This files the owner's clock, from their browser's time zone when the
// setup page knew it, makes Telegram the place routines deliver to, marks the getting-to-know-you
// chat as waiting and plans its one invitation, about ten minutes later. Reads on standard input:
//   {"timezone":"Europe/Vienna","timezone_from":"browser","owner_name":"Anna","joined":false}
// A setup begun by an earlier version may also hand on what that one asked in the chat: "goal",
// and "about" (the file at the top of the folder that holds what they told about themselves).
// Both are filed as before, and the getting-to-know-you chat then skips them.
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
import {setHermesTimezone} from '../core/hermes-config.mjs';
import {starterBorn} from '../core/starter-workspace.mjs';
import {keepAbout,beginContext,scheduleInvite,validZone} from '../core/context-setup.mjs';

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
const told=typeof input.timezone==='string'&&validZone(input.timezone)?input.timezone:undefined,goal=String(input.goal||'').trim();
const store=new Store(root,{device:machineDevice(root).id});
// A Mission Control the reader brought in has its goals and settings already: only the chat's
// newer answers, the clock and Telegram, go onto them. Before its first round has brought them
// there is nothing to file onto, and the round brings them. It knows its owner already, so there
// is no getting-to-know-you chat for it.
if(input.joined===true&&!goal){
  const old=store.get('settings','installation');
  if(old)await store.saveAsync('settings',{id:'installation',...(told?{timezone:told}:{}),delivery:'telegram'});
  console.log(old?'Filed the clock; routines deliver to Telegram.':'Nothing to file yet; the settings arrive with the first sync.');
  process.exit(0);
}
const home=process.env.HERMES_HOME,scheduler=new NativeScheduler(store,{executable:process.env.GODSPEED_HERMES||'/opt/hermes/bin/hermes',home,device:store.device});
// What an earlier version's chat was told about them is filed where the assistant reads it; it
// never stops the setup, and the file itself stays either way.
if(input.about)try{await keepAbout(store,{name:String(input.about)});}catch(error){console.error('What you told me about yourself is kept in '+input.about+', but could not be added to profile/about-me.md: '+String(error.message).split('\n')[0]);}
// The clock: the browser's zone, or the answer an earlier version's chat got; without either, the
// server's own until the owner names a city in the getting-to-know-you chat.
const timezone=told||Intl.DateTimeFormat().resolvedOptions().timeZone;
if(goal){
  await scheduler.configure({goal,timezone,delivery:'telegram'});
  // configure keeps an earlier setup's clock and delivery; the chat's answers are newer.
  await store.saveAsync('settings',{id:'installation',...(told?{timezone:told}:{}),delivery:'telegram'});
}else{
  // No goal yet: the routines wait for the first one, told later in the chat or in Settings (until
  // 16 October 2026 configure wanted a goal and refused with "Name one goal to start"). An
  // installation without that mark is one set up before, which the routines leave alone.
  const old=store.get('settings','installation');
  await store.saveAsync('settings',{id:'installation',owner:store.device,...old,...(told||!old?.timezone?{timezone}:{}),delivery:'telegram'});
  if(!old&&told&&home&&starterBorn(root))try{setHermesTimezone(home,told);}catch{}
  await scheduler.startRoutines({setup:!old});
}
// The getting-to-know-you chat (core/context-setup.mjs): waiting, with its one invitation planned.
const ctx=beginContext(store,{ownerName:input.owner_name,timezone:told,timezoneFrom:input.timezone_from==='answer'?'answer':'browser'});
let planned='';
if(ctx.state==='waiting'&&input.invite!==false)try{const r=await scheduleInvite(scheduler,{store,home});planned=r.scheduled?' The invitation to tell me about yourself goes out at '+r.at+'.':'';}
catch(error){console.error('The invitation to tell me about yourself was not planned ('+String(error.message).split('\n')[0]+'); the word context still starts it.');}
console.log((goal?'Filed the goal and the clock':'Filed the clock')+'; routines deliver to Telegram.'+planned);
process.exit(0);
