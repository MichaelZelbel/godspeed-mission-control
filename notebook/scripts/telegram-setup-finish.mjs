#!/usr/bin/env node
// The Telegram setup chat's last step on the one-click server (GODSPEED_TG_FINISH, set by
// docker/full-candidate/telegram-runner.mjs). Files the reader's goal and clock the way the
// notebook's own "Start with one goal" does, and makes Telegram the place routines deliver
// to. Reads {"timezone":"Europe/London","goal":"...","about":"what-my-ai-knew.md"} on standard
// input. The goal may be empty (Skip in the chat, since 16 October 2026); "about" names the
// file at the top of the folder that holds what the reader told the chat about themselves.
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
import {IdentityShelf} from '../core/identity-shelf.mjs';
import {setHermesTimezone} from '../core/hermes-config.mjs';
import {starterBorn} from '../core/starter-workspace.mjs';

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
const home=process.env.HERMES_HOME,scheduler=new NativeScheduler(store,{executable:process.env.GODSPEED_HERMES||'/opt/hermes/bin/hermes',home,device:store.device});
await fileAbout(String(input.about||''));
if(goal){
  await scheduler.configure({goal,timezone,delivery:'telegram'});
  // configure keeps an earlier setup's clock and delivery; the chat's answers are newer.
  await store.saveAsync('settings',{id:'installation',...(timezone?{timezone}:{}),delivery:'telegram'});
  console.log('Filed the goal and the clock; routines deliver to Telegram.');
  process.exit(0);
}
// No goal yet (Skip in the chat). configure wants one, so until 16 October 2026 a Skip here would
// have stopped the chat with "Name one goal to start". The clock and Telegram are filed as
// configure files them, and the starting routines are marked as waiting for a goal
// (startRoutinesNow), so the first goal told later, in the chat or in Settings, starts them. An
// installation without that mark is one set up before, which the routines leave alone.
const old=store.get('settings','installation');
await store.saveAsync('settings',{id:'installation',owner:store.device,...old,...(timezone?{timezone}:{}),delivery:'telegram'});
if(!old&&home&&starterBorn(root))try{setHermesTimezone(home,timezone);}catch{}
await scheduler.startRoutines({setup:!old});
console.log('Filed the clock; routines deliver to Telegram, and the first goal starts them.');
process.exit(0);

// What the reader told the chat about themselves, typed or the book's what-my-ai-knew.md sent as
// a file, is kept at the top of the folder by the chat. The assistant reads profile/about-me.md
// before it helps (the starter's AGENTS.md, "Who I am"), and nothing read the file at the top, so
// until 16 October 2026 the chat's "I keep it" kept it where no assistant looked. Now about-me.md
// carries it: a few sentences in full, a longer text as a pointer to the file. The change goes
// through the Identity page's own way of changing a profile page, so it shows there with its
// earlier version and Undo. It never stops the setup: the file itself stays either way.
async function fileAbout(name){
  if(!/^[A-Za-z0-9._ -]+\.(md|txt|markdown)$/.test(name)||name.startsWith('.'))return;
  let text;try{text=fs.readFileSync(path.join(root,name),'utf8').replace(/^﻿/,'').replace(/\r\n?/g,'\n').trim();}catch{return;}
  if(!text)return;
  try{
    const shelf=new IdentityShelf(store),page=shelf.read('profile:about-me'),body=page.fields.text.replace(/\n+$/,'');
    if(body.includes(text)||body.includes('`'+name+'`'))return;   // filed already (Try again)
    const words=[...text].length<=1500&&!/^#{1,6}\s/m.test(text)?text:'What I told you about myself when I set you up is in the file `'+name+'` at the top of my mission control. Read it before you help me.';
    await shelf.save('profile:about-me',{text:body+'\n\n## In my own words\n\n'+words+'\n'},{expected_hash:page.hash});
  }catch(error){console.error('What you told me about yourself is kept in '+name+', but could not be added to profile/about-me.md: '+String(error.message).split('\n')[0]);}
}
