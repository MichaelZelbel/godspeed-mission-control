#!/usr/bin/env node
// WHY THE NIGHT CHAT TIDY-UP IS, OR IS NOT, MADE ON THIS MACHINE (#721), read from the files the
// notebook's scheduler reads, in the order NativeScheduler.followChatTidy reads them
// (notebook/core/native-scheduler.mjs). On 18 November 2026 update-keeps-everything found no tidy-up
// after an update and kept nothing that could say which of these stopped it; each one returns
// without a word, so the step log is the only place a night's run can say it.
//
//   node night-tidy-gates.mjs --workspace <mission control folder> --home <assistant home>
//
// Prints one JSON object. `outcome` is what followChatTidy does if the tick reaches it: the tick
// itself returns first when this machine does not own the notebook, and every gate after that
// returns without a word, so the step log is the only place a night's run can say it:
//   not-owner          this machine is not the one the owner chose to run the routines
//   not-starter        the mission control was not made from the starter, so no routines are made
//   machine-<state>    this machine's record of its starting routines is not "created" (or "none")
//   no-chat-app        no Telegram bot in the home's .env and no owner chat in its routing table
//   job-present        Hermes has the tidy-up (the remembered one, or one by its name and script)
//   kept-removed       the notebook remembers making it and Hermes no longer has it: read as the
//                      person's removal, so it is not made again
//   would-create       the next tick asks Hermes to create it
// Nothing secret is printed: of the .env only whether it names a Telegram bot.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {starterBorn} from '../notebook/core/starter-workspace.mjs';
import {LEGACY_DEVICE} from '../notebook/core/device-id.mjs';
import {readMachineRecord,telegramInHermes,routedOwnerChats,OWNER_CHAT_KEY,OWNER_CHAT_KEY_LIKE} from '../notebook/core/starting-routines.mjs';
import {readNotebookRoutines,CHAT_TIDY_JOB,CHAT_TIDY_SCRIPT} from '../notebook/core/notebook-routines.mjs';
import {hermesJobs} from '../notebook/core/native-scheduler.mjs';

// The scopes the routing table keys an owner's chat under, whatever the scope: a chat routed under
// another spelling of the home than the scheduler's own is a chat the scheduler does not see.
function ownerChatScopes(home){
 const file=path.join(home,'state.db');if(!fs.existsSync(file))return [];
 let db;
 try{
  db=new DatabaseSync(file,{readOnly:true});
  return [...new Set(db.prepare('select scope, session_key from gateway_routing where session_key like ?').all(OWNER_CHAT_KEY_LIKE).filter(row=>OWNER_CHAT_KEY.test(row.session_key)).map(row=>row.scope))];
 }catch{return [];}finally{try{db?.close();}catch{}}
}

// The machine's own name, the way the notebook server names itself (device-id.mjs): GODSPEED_DEVICE
// first, then the .godspeed/device.json the notebook wrote on its first start. The gates never write
// one: a machine with neither has not started its notebook yet. `env` is where GODSPEED_DEVICE is
// read from, the process's own by default: on a real machine that is what the scheduler reads too,
// and the tests pass an empty one so what they say does not depend on the machine the tests run on.
function deviceOf(root,env=process.env){
 const named=String(env.GODSPEED_DEVICE||'').trim();
 if(named&&named!==LEGACY_DEVICE)return named;
 try{
  const read=JSON.parse(fs.readFileSync(path.join(root,'.godspeed','device.json'),'utf8')).id;
  return typeof read==='string'&&/^[a-z0-9][a-z0-9-]{0,39}$/.test(read)&&read!==LEGACY_DEVICE?read:null;
 }catch{return null;}
}
// The machine the owner chose to run the routines, from the notebook's installation record.
function installationOwner(root){
 for(const folder of ['notebook','records']){
  try{
   const record=JSON.parse(fs.readFileSync(path.join(root,folder,'_system','settings','installation.json'),'utf8'));
   if(record&&!record.removed_at&&typeof record.owner==='string'&&record.owner)return record.owner;
  }catch{}
 }
 return null;
}

export function nightTidyGates({root,home,env=process.env}){
 const store={root,state:path.join(root,'.godspeed')};
 const starter=starterBorn(root),machine=readMachineRecord(store)?.state||'none';
 const device=deviceOf(root,env),owner=installationOwner(root),owns=owner==null||owner===device;
 const telegram=telegramInHermes(home),routed=routedOwnerChats(home);
 const entry=readNotebookRoutines(store).jobs.find(j=>j.key==='chat-tidy')||null;
 let jobs,jobsError=null;
 try{jobs=hermesJobs(home);}catch(error){jobs=[];jobsError=String(error?.message||error);}
 const tidies=jobs.filter(j=>j.name===CHAT_TIDY_JOB).map(j=>({id:j.id,script:j.script||null,workdir:j.workdir||null,enabled:j.enabled!==false}));
 const present=(entry&&jobs.find(j=>j.id===entry.id))||jobs.find(j=>j.name===CHAT_TIDY_JOB&&j.script===CHAT_TIDY_SCRIPT);
 const outcome=!owns?'not-owner':!starter?'not-starter':machine!=='created'?'machine-'+machine:!(telegram||routed.length)?'no-chat-app':present?'job-present':entry?'kept-removed':'would-create';
 return {outcome,owns,device,installation_owner:owner,starter_born:starter,machine_record:machine,telegram_bot_in_env:telegram,routed_owner_chats:routed.length,routing_scope:path.join(home,'sessions'),owner_chat_scopes:ownerChatScopes(home),
  remembered:entry&&{id:entry.id,switched_off:!!entry.switched_off},remembered_job_in_hermes:!!(entry&&jobs.some(j=>j.id===entry.id)),
  tidy_jobs:tidies,hermes_jobs:jobs.length,...(jobsError?{hermes_jobs_unreadable:jobsError}:{})};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const argv=process.argv.slice(2),option=name=>{const i=argv.indexOf('--'+name);return i<0?null:argv[i+1];};
 const root=option('workspace'),home=option('home');
 if(!root||!home){process.stderr.write('usage: node night-tidy-gates.mjs --workspace <folder> --home <assistant home>\n');process.exit(2);}
 if(!fs.existsSync(root)){process.stderr.write('There is no mission control at '+root+'.\n');process.exit(1);}
 process.stdout.write(JSON.stringify(nightTidyGates({root:path.resolve(root),home}))+'\n');
}
