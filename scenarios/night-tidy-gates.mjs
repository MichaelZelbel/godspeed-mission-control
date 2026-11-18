#!/usr/bin/env node
// WHY THE NIGHT CHAT TIDY-UP IS, OR IS NOT, MADE ON THIS MACHINE (#721), read from the files the
// notebook's scheduler reads, in the order NativeScheduler.followChatTidy reads them
// (notebook/core/native-scheduler.mjs). On 18 November 2026 update-keeps-everything found no tidy-up
// after an update and kept nothing that could say which of these stopped it; each one returns
// without a word, so the step log is the only place a night's run can say it.
//
//   node night-tidy-gates.mjs --workspace <mission control folder> --home <assistant home>
//
// Prints one JSON object. `outcome` is what the next tick does:
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

export function nightTidyGates({root,home}){
 const store={root,state:path.join(root,'.godspeed')};
 const starter=starterBorn(root),machine=readMachineRecord(store)?.state||'none';
 const telegram=telegramInHermes(home),routed=routedOwnerChats(home);
 const entry=readNotebookRoutines(store).jobs.find(j=>j.key==='chat-tidy')||null;
 let jobs,jobsError=null;
 try{jobs=hermesJobs(home);}catch(error){jobs=[];jobsError=String(error?.message||error);}
 const tidies=jobs.filter(j=>j.name===CHAT_TIDY_JOB).map(j=>({id:j.id,script:j.script||null,workdir:j.workdir||null,enabled:j.enabled!==false}));
 const present=(entry&&jobs.find(j=>j.id===entry.id))||jobs.find(j=>j.name===CHAT_TIDY_JOB&&j.script===CHAT_TIDY_SCRIPT);
 const outcome=!starter?'not-starter':machine!=='created'?'machine-'+machine:!(telegram||routed.length)?'no-chat-app':present?'job-present':entry?'kept-removed':'would-create';
 return {outcome,starter_born:starter,machine_record:machine,telegram_bot_in_env:telegram,routed_owner_chats:routed.length,routing_scope:path.join(home,'sessions'),owner_chat_scopes:ownerChatScopes(home),
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
