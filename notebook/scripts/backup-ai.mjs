#!/usr/bin/env node
// THE BACKUP AI FROM TELEGRAM, on the one-click server (22 October 2026, discussion #20).
//
//   backup-ai.mjs telegram-request --dir DIR   what /backupai in Telegram runs (a Hermes quick command,
//                                               no AI involved): asks the container's Telegram runner
//                                               to hand the chat to the setup helper for a few minutes
//   backup-ai.mjs show                          the main AI and the backup, as JSON
//   backup-ai.mjs set                           a backup entry on standard input ({"provider", "model",
//                                               "api_key"?, "base_url"?}) becomes Hermes' fallback chain
//   backup-ai.mjs remove                        no backup any more
//   backup-ai.mjs check                         one short request to the backup alone; exit 1 when it
//                                               did not answer
//
// The mission control is GODSPEED_WORKSPACE (or --workspace), the assistant's home HERMES_HOME (or
// --home). Why the chat is handed over instead of the assistant asking: a key typed into the chat
// would pass through the main AI, and when the main AI is the one that fails, the assistant cannot
// answer at all. The setup helper (docker/rootfs/usr/local/bin/godspeed-telegram-setup, flow backup)
// needs no AI and deletes a key from the chat as soon as it has read it, as the first setup does.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {requestBackupChat,HANDED_OVER} from '../core/backup-request.mjs';
export {requestBackupChat,REQUEST_FILE,FLOW_STATE,REQUEST_MINUTES,HANDED_OVER} from '../core/backup-request.mjs';
// What show, set, remove and check need is loaded only for them: /backupai itself must answer at once.
const notebook=async()=>({...await import('../core/backup-ai.mjs'),...await import('../core/routine-ai.mjs'),...await import('../core/addon-model.mjs')});

function option(args,name,fallback){const at=args.indexOf(name);return at>=0?args[at+1]:fallback;}
async function stdin(){let text='';process.stdin.setEncoding('utf8');for await(const chunk of process.stdin){text+=chunk;if(text.length>100000)throw Error('Too much input');}return text;}

export async function main(args=process.argv.slice(2),{env=process.env,write=text=>process.stdout.write(text),read=stdin,spawnProcess}={}){
 const [command]=args;
 if(command==='telegram-request'){
  const dir=option(args,'--dir',env.GODSPEED_TELEGRAM_DIR);if(!dir)throw Error('Name the Telegram folder with --dir');
  requestBackupChat(dir);write(HANDED_OVER+'\n');return 0;
 }
 const root=option(args,'--workspace',env.GODSPEED_WORKSPACE),home=option(args,'--home',env.HERMES_HOME);
 if(!root||!home)throw Error('Set GODSPEED_WORKSPACE and HERMES_HOME, or name them with --workspace and --home');
 const state=path.join(path.resolve(root),'.godspeed');fs.mkdirSync(state,{recursive:true});
 const json=value=>write(JSON.stringify(value)+'\n');
 const {backupStatus,connectHermesBackup,removeBackupAI,routineAIStatus,writeRecord,readRecord,modelConnection,runHermesHelper}=await notebook();
 if(command==='show'){const main=routineAIStatus({home,state});json({main:{provider:main.provider,model:main.model},...backupStatus({home,state})});return 0;}
 if(command==='set'){
  const entry=JSON.parse(await read());
  if(!entry||typeof entry!=='object'||Array.isArray(entry)||Object.keys(entry).some(k=>!['provider','model','api_key','base_url'].includes(k)))throw Error('A backup names provider and model, and may carry api_key and base_url');
  const status=connectHermesBackup({home,state,entry,via:'telegram'});json({configured:status.configured,backup:status.backup});return 0;
 }
 if(command==='remove'){const status=removeBackupAI({home,state});json({removed:status.removed,configured:status.configured});return 0;}
 if(command==='check'){
  // Through the helper godspeed-model uses, asking the backup by name (assistant-files/addon-model.py).
  // An entry on standard input is tried before it is saved; without one, the saved backup is asked.
  const at=new Date().toISOString(),text=(await read()).trim(),entry=text?JSON.parse(text):null;
  if(entry!==null&&(typeof entry!=='object'||Array.isArray(entry)))throw Error('A backup to try names provider and model');
  try{
   const connection=modelConnection(root);if(connection.kind!=='hermes')throw Error('This mission control has no assistant to keep a backup in');
   const answer=await runHermesHelper({connection,root,spawnProcess,deadline:Date.now()+150000,request:{system:'Reply with the single word ready.',prompt:'Are you there?',timeout_ms:150000,max_tokens:128,route:'backup',...(entry?{entry}:{})}});
   if(!entry)writeRecord(state,{...readRecord(state),backup_check:{at,ok:true}});
   json({ok:true,provider:answer.provider,model:answer.model});return 0;
  }catch(error){
   const message=String(error?.message||error).slice(0,300);
   if(!entry)writeRecord(state,{...readRecord(state),backup_check:{at,ok:false,error:message}});
   json({ok:false,error:message});return 1;
  }
 }
 throw Error('Use backup-ai.mjs telegram-request, show, set, remove or check');
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 main().then(code=>{process.exitCode=code;},error=>{process.stderr.write((error?.message||'The backup AI command failed')+'\n');process.exitCode=1;});
}
