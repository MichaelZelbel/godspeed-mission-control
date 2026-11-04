#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {machineDevice} from '../core/device-id.mjs';
import {openStep,pressStep,ASKER_KINDS,answerChosen,heard,quietMessage,readStep,CHATS} from '../core/waiting-steps.mjs';

// The one way to ask the owner for a yes (core/waiting-steps.mjs). A refusal reads as one plain line.
const fail=error=>{process.stderr.write('Error: '+(error?.message||String(error))+'\n'+(process.env.GODSPEED_DEBUG?String(error?.stack||'')+'\n':''));process.exit(1);};
process.on('uncaughtException',fail);process.on('unhandledRejection',fail);
const HELP=`godspeed-step: ask your owner for a yes, and read the answer.

  open --about "..." --question "..." --yes "..." --no "..." --by ${ASKER_KINDS.map(kind=>kind+':<name>').join('|')} [--chat telegram|notebook] [--job <routine id>]
      Opens a waiting step and prints {"id","message"}. Each text is one plain line without a code.
      --about says what this is about for someone who saw none of the work, --yes and --no say what
      happens. A step asked in the notebook is put into the notebook chat for you. A step asked in
      Telegram is sent by the one who tells your owner: hand the step's id to the notice, or say "message"
      in your reply to your owner. Until that message has gone out, a plain yes cannot reach the step.
  get <id>
      Prints the step with status waiting, yes or no.
  heard --chat telegram|notebook
      Only the chat plugin uses this: the owner's words on standard input.
  answer <id> --chat telegram|notebook
      Only the assistant, right after its owner chose a step you asked about in words.
  press <id> yes|no [--language en|de]
      Only the Telegram buttons use this: a press on a waiting step's own message.
`;
const args=process.argv.slice(2),option=name=>{const at=args.indexOf(name);return at<0?undefined:args[at+1];};
const root=option('--godspeed')||process.env.GODSPEED_WORKSPACE,verb=args[0];
if(!verb||verb==='help'||verb==='--help'){process.stdout.write(HELP);process.exit(0);}
if(!root)throw Error('Say which mission control folder: --godspeed <folder>.');
const scheduled=Boolean(process.env.GODSPEED_SCHEDULED_RUN),print=value=>process.stdout.write(JSON.stringify(value,null,2)+'\n');
const chatOption=()=>{const chat=option('--chat');if(!CHATS.includes(chat))throw Error('Say which chat: --chat telegram or --chat notebook.');return chat;};
const stateDir=path.join(root,'.godspeed');
if(verb==='heard'){
 const chat=chatOption();
 if(scheduled){print({kind:'none'});process.exit(0);}
 const words=fs.readFileSync(0,'utf8');
 if(fs.existsSync(stateDir)&&quietMessage(stateDir,{chat,words})){print({kind:'none'});process.exit(0);}
 const store=new Store(root,{device:machineDevice(root).id});
 const {kind,context}=heard(store,{chat,words});print({kind,...(context?{context}:{})});process.exit(0);
}
const store=new Store(root,{device:machineDevice(root).id});
if(verb==='open'){
 const installation=store.get('settings','installation');
 print(openStep(store,{about:option('--about'),question:option('--question'),yes:option('--yes'),no:option('--no'),by:option('--by'),job:option('--job'),
  chat:option('--chat')||(installation?.delivery==='telegram'?'telegram':'notebook')}));
}else if(verb==='get'){
 const record=store.get('approvals',args[1]);if(!record)throw Error('That step does not exist.');print(readStep(record));
}else if(verb==='answer'){
 const done=answerChosen(store,{chat:chatOption(),id:args[1],scheduled});print({status:done.step.status,already:done.already});
}else if(verb==='press'){
 const done=pressStep(store,{id:args[1],answer:args[2],language:option('--language'),scheduled});
 print({reply:done.reply,changed:done.changed});process.exit(done.changed?0:2);
}else throw Error('Unknown verb. '+HELP);
