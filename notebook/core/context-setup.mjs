import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {atomic} from './records/store.mjs';
import {IdentityShelf} from './identity-shelf.mjs';
import {setConfigValue} from './hermes-config.mjs';
import {starterBorn} from './starter-workspace.mjs';
import {hermesJobs} from './native-scheduler.mjs';
import {telegramInHermes} from './starting-routines.mjs';

// GETTING TO KNOW THE OWNER, A PART OF ITS OWN (16 October 2026, Michael's idea). The setup was one
// chat: an AI, then the city, a briefing and a goal, all before the assistant could talk. Now the
// technical part ends when an AI is connected and Telegram works, and getting to know the owner is
// a short chat the assistant itself leads, with the context-setup recipe, whenever the owner likes:
// they send the word "context", answer the one invitation sent about ten minutes after the
// technical part, or press "Tell Godspeed about you" on the dashboard.
//
// Its state is this machine's own (.godspeed/context-setup.json, which never travels with the
// folder), like the Telegram that sends the invitation:
//   waiting   the technical part is done and the invitation is planned
//   invited   the invitation went out and was not answered yet
//   started   the chat began
//   done      it ended with something kept; skipped: it ended with nothing, or "Hide" on the card
// The assistant's Hermes plugin godspeed-context (assistant-files/godspeed-context) reads it before
// each turn, because a message a scheduled job delivered is not part of the chat the assistant
// sees next (Hermes mirrors cron deliveries into the chat only when asked, cron.mirror_delivery or
// a job's attach_to_session, and its CLI cannot ask): without it, an "ok" to the invitation would
// reach an assistant that never saw the invitation.
export const CONTEXT_FILE='context-setup.json';
export const INVITE_SCRIPT='godspeed-context-invite.py';
export const INVITE_JOB='Getting to know you';
export const INVITE_MINUTES=10;
export const ABOUT_FILE='what-my-ai-knew.md';
export const ABOUT_HEADING='## In my own words';
// The starter's about-me.md before anybody wrote in it (starter-godspeed/profile/about-me.md).
const TEMPLATE_LINE='(Your work, your situation, what fills your days. Two or three lines.)';
const ACTIVE=['waiting','invited','started'],ENDED=['done','skipped'];
const kit=fileURLToPath(new URL('../../',import.meta.url));

const file=store=>path.join(store.state,CONTEXT_FILE);
export function readContext(store){try{const value=JSON.parse(fs.readFileSync(file(store),'utf8'));return value&&typeof value==='object'?value:null;}catch{return null;}}
export function writeContext(store,patch){const next={...(readContext(store)||{}),...patch,updated_at:new Date().toISOString()};atomic(file(store),JSON.stringify(next,null,2)+'\n');return next;}

// Whether profile/about-me.md says anything yet: the starter's page is a template of placeholders.
export function aboutFilled(root){
  let text;try{text=fs.readFileSync(path.join(root,'profile','about-me.md'),'utf8');}catch{return false;}
  return text.includes(ABOUT_HEADING)||!text.includes(TEMPLATE_LINE);
}

// --- Time zones ------------------------------------------------------------------------------
// The same answers the setup chat understood (godspeed-telegram-setup, find_zone): a zone name,
// a city the zone database names, or a few words it has no city for.
const ZONE_WORDS={germany:'Europe/Berlin',deutschland:'Europe/Berlin',austria:'Europe/Vienna',osterreich:'Europe/Vienna',switzerland:'Europe/Zurich',schweiz:'Europe/Zurich',
  uk:'Europe/London',england:'Europe/London',britain:'Europe/London',munich:'Europe/Berlin',munchen:'Europe/Berlin',hamburg:'Europe/Berlin',cologne:'Europe/Berlin',koln:'Europe/Berlin',
  frankfurt:'Europe/Berlin',dusseldorf:'Europe/Berlin',san_francisco:'America/Los_Angeles',seattle:'America/Los_Angeles',boston:'America/New_York',washington:'America/New_York',
  miami:'America/New_York',dallas:'America/Chicago',austin:'America/Chicago'};
const REGIONS=['Europe','America','Asia','Africa','Australia','Pacific','Atlantic','Indian'];
const zones=()=>{try{return Intl.supportedValuesOf('timeZone');}catch{return [];}};
export const validZone=zone=>{try{return !!zone&&typeof zone==='string'&&/\//.test(zone)&&!!new Intl.DateTimeFormat('en',{timeZone:zone});}catch{return false;}};
export function findZone(text){
  const t=String(text||'').trim();if(!t||t.length>80)return null;
  if(/^[A-Za-z]+(\/[A-Za-z0-9_+-]+){1,2}$/.test(t)&&validZone(t))return t;
  const key=t.toLowerCase().replace(/ä/g,'a').replace(/ö/g,'o').replace(/ü/g,'u').replace(/ß/g,'s').replace(/[\s-]+/g,'_');
  if(ZONE_WORDS[key])return ZONE_WORDS[key];
  return zones().find(z=>{const parts=z.split('/');return REGIONS.includes(parts[0])&&parts.at(-1).toLowerCase()===key;})||null;
}
export const cityOf=zone=>String(zone||'').split('/').at(-1).replace(/_/g,' ');
// Hermes' own clock, set even when one is set already: the owner's answer is newer than any.
export function setHermesZone(home,zone){
  const config=home&&path.join(home,'config.yaml');if(!config||!fs.existsSync(config))return false;
  const text=fs.readFileSync(config,'utf8'),next=setConfigValue(text,['timezone'],JSON.stringify(zone));
  if(next!==text){atomic(config,next);if(process.platform!=='win32')fs.chmodSync(config,0o600);}
  return true;
}
// The owner's zone for everything: the notebook's clock (the routines run on it, HERMES_TIMEZONE in
// every tick) and Hermes' own (a reminder asked for in the chat). from: browser or answer.
export async function setTimezone(store,{zone,city,from='answer',home=process.env.HERMES_HOME}={}){
  const found=zone&&validZone(zone)?zone:findZone(city||zone);
  if(!found)return {found:false,city:String(city||zone||'').slice(0,60)};
  const old=store.get('settings','installation');
  await store.saveAsync('settings',{id:'installation',...(old?{}:{owner:store.device,delivery:telegramInHermes(home||'')?'telegram':'notebook'}),timezone:found});
  try{setHermesZone(home,found);}catch{}
  writeContext(store,{timezone:found,timezone_from:from});
  return {found:true,zone:found,city:cityOf(found)};
}

// --- What they told about themselves -----------------------------------------------------------
// Kept where the assistant reads it before it helps (profile/about-me.md, the starter's AGENTS.md
// "Who I am"), through the page Godspeed's brain's own way of changing a profile page, so it has its
// earlier version and Undo there. A few sentences go on that page whole; a longer text, like the
// book's briefing, stays in its own file at the top of the folder and the page names it. The setup
// chat's last step (telegram-setup-finish.mjs) and the assistant (the context_setup tool) both
// keep it here.
export async function keepAbout(store,{text,name}={}){
  let words=String(text??'').replace(/^﻿/,'').replace(/\r\n?/g,'\n').trim();
  if(name){
    if(!/^[A-Za-z0-9._ -]+\.(md|txt|markdown)$/.test(name)||name.startsWith('.'))return {kept:false,why:'not a file at the top of the folder'};
    if(!words){try{words=fs.readFileSync(path.join(store.root,name),'utf8').replace(/^﻿/,'').replace(/\r\n?/g,'\n').trim();}catch{return {kept:false,why:'the file is missing'};}}
  }
  if(!words)return {kept:false,why:'nothing to keep'};
  const long=[...words].length>1500||/^#{1,6}\s/m.test(words);
  if(long&&!name){
    // A long text told in the chat gets a file of its own, under the book's name when that is free.
    name=ABOUT_FILE;const day=new Date().toISOString().slice(0,10);
    for(let n=1;fs.existsSync(path.join(store.root,name));n++)name='what-my-ai-knew-'+day+(n>1?'-'+n:'')+'.md';
    atomic(path.join(store.root,name),words+'\n');
  }
  const shelf=new IdentityShelf(store),page=shelf.read('profile:about-me'),body=page.fields.text.replace(/\n+$/,'');
  if(body.includes(words)||name&&body.includes('`'+name+'`'))return {kept:true,page:'already',file:name||null};
  const said=long?'What I told you about myself when I set you up is in the file `'+name+'` at the top of my mission control. Read it before you help me.':words;
  await shelf.save('profile:about-me',{text:body+'\n\n'+ABOUT_HEADING+'\n\n'+said+'\n'},{expected_hash:page.hash});
  return {kept:true,page:long?'pointer':'whole',file:long?name:null};
}

// --- The chat's own state ---------------------------------------------------------------------
// The technical part is done (telegram-setup-finish.mjs, a first Mission Control only). A setup that
// is run again after a restart never sends them back to the start of a chat they began.
export function beginContext(store,{ownerName,timezone,timezoneFrom,inviteAt}={}){
  const old=readContext(store);if(old&&old.state!=='waiting')return old;
  return writeContext(store,{state:'waiting',owner_name:ownerName||old?.owner_name||null,...(timezone?{timezone,timezone_from:timezoneFrom||'browser'}:{}),
    created_at:old?.created_at||new Date().toISOString(),...(inviteAt?{invite_at:inviteAt}:{})});
}
export function markContext(store,action){
  const old=readContext(store)||{},at=new Date().toISOString();
  if(action==='start')return ENDED.includes(old.state)?writeContext(store,{state:'started',started_at:at,again:true}):writeContext(store,{state:'started',started_at:old.started_at||at});
  if(action==='done')return writeContext(store,{state:'done',finished_at:at});
  if(action==='skip')return writeContext(store,{state:old.state==='done'?'done':'skipped',finished_at:at});
  throw Error('Choose start, done or skip');
}
// What the assistant needs before it asks anything: so it never asks again for what it knows.
export function contextStatus(store,{goals=[]}={}){
  const ctx=readContext(store)||{},installation=store.get('settings','installation'),zone=installation?.timezone||null;
  return {state:ctx.state||'not-started',owner_name:ctx.owner_name||null,
    timezone:{zone,city:zone?cityOf(zone):null,from:ctx.timezone_from||null},
    about:{told:aboutFilled(store.root)},
    goals:goals.filter(g=>!g.removed_at&&['adopted','active','provisional'].includes(g.status||'adopted')).map(g=>g.title).filter(Boolean),
    where:'They see and change what you learned on the notebook page "Godspeed\'s brain", under "What it knows about you"; their goals are in Settings, under "Your goals and follow-through".'};
}
// The dashboard's card: while the chat is planned, waiting for an answer or under way; and on a
// mission control made from the starter whose about-me page nobody wrote in yet, which also reaches
// a notebook set up without Telegram. "Hide" and an ended chat take it away.
export function showCard(store){
  const state=readContext(store)?.state;
  if(ACTIVE.includes(state))return true;
  if(ENDED.includes(state))return false;
  return starterBorn(store.root)&&!aboutFilled(store.root);
}

// --- The one invitation -----------------------------------------------------------------------
export function invitation(name){
  return 'Hi'+(name?' '+name:'')+', me again. Shall we take five minutes so I get to know you? Three things: where you live, a little '+
    'about you, and what you would like my help with first.\n\nNo rush: answer whenever you like, today or next week. Just reply when '+
    'you are ready, or send context.';
}
// Run by the one-shot job when it is due: the text to deliver, once, and only while nobody began.
export function inviteNow(store){
  const ctx=readContext(store);if(ctx?.state!=='waiting')return '';
  const text=invitation(ctx.owner_name);
  writeContext(store,{state:'invited',invited_at:new Date().toISOString(),invitation:text});
  return text;
}
// The job: one Hermes routine at a fixed moment (an ISO time is "once" in every Hermes; a bare
// "10m" became a repeating interval in later versions), whose script prints the invitation or
// nothing. Hermes delivers what it prints to Telegram, and nothing when it prints nothing. It is
// ticked like every routine here, by the notebook's own scheduler, so no new program runs for it.
export function inviteScript({root,node=process.execPath}){
  return '# Written by the Godspeed Mission Control notebook (core/context-setup.mjs): the one invitation to\n'+
    '# the getting-to-know-you chat. Prints it once, or nothing when that chat already began.\n'+
    'import os, subprocess, sys\n'+
    'r = subprocess.run(['+JSON.stringify(node)+', '+JSON.stringify(path.join(kit,'notebook','scripts','context-setup.mjs'))+', "invite"],\n'+
    '                   capture_output=True, text=True, timeout=120, env=dict(os.environ, GODSPEED_WORKSPACE='+JSON.stringify(root)+'))\n'+
    'sys.stdout.write(r.stdout)\n';
}
export async function scheduleInvite(scheduler,{store,home,at=new Date(Date.now()+INVITE_MINUTES*60000),node=process.execPath}={}){
  if(!home)return {scheduled:false,why:'no assistant home'};
  if(hermesJobs(home).some(j=>j.name===INVITE_JOB))return {scheduled:false,why:'planned already'};
  atomic(path.join(home,'scripts',INVITE_SCRIPT),inviteScript({root:store.root,node}));
  const when=new Date(at).toISOString().replace(/\.\d{3}Z$/,'+00:00');
  await scheduler.command(['create',when,'--no-agent','--script',INVITE_SCRIPT,'--name',INVITE_JOB,'--deliver','telegram','--failure-deliver','local','--workdir',store.root]);
  writeContext(store,{invite_at:when});
  return {scheduled:true,at:when};
}
