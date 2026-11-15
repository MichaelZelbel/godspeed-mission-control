#!/usr/bin/env node
// BACKGROUND WORK TELLS THE OWNER, AS THE ROUTINE SCRIPTS RUN IT (4 November 2026, #198).
//
//   node background-report.mjs say    --godspeed <mission control> --home <Hermes home>   (a notice as JSON on stdin)
//   node background-report.mjs delivered --godspeed <mission control> --home <Hermes home> [--receipts id,id]   (the words Hermes just delivered, on stdin)
//   node background-report.mjs failed --godspeed <mission control> --home <Hermes home>   (a failed scheduled run as JSON on stdin)
//   node background-report.mjs record --godspeed <mission control> --home <Hermes home> --routine <kind> [--delivery telegram|notebook[,...]] [--receipts]   (its words on stdin)
//
// `say` prints the words to deliver for one queued notice, written with the chat's guidance (or its
// plain fallback text) and recorded where the chat reads it; `record` records a routine's own words
// as printed and `delivered` makes the waiting steps a delivery record names answerable once Hermes has delivered it; `failed` keeps a scheduled run's failure note out of the chat and says at most one plain sentence about it (#385); `record --receipts` prints the ids of the records it wrote (a skill job's wrapper hands them back to `delivered --receipts`; otherwise the oldest undelivered record of exactly those words is used). See core/background-reports.mjs. Exit 1 when the notebook cannot be written, or when `record` refuses words that ask the owner to type a code (#191); either way they are not sent.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {CHATS} from '../core/waiting-steps.mjs';
import {Store} from '../core/records/store.mjs';
import {machineDevice} from '../core/device-id.mjs';
import {sayNotice,recordRoutine,delivered,followUpFailed} from '../core/background-reports.mjs';
import {notebookProvider} from './morning-brief.mjs';

const option=(argv,name)=>{const i=argv.indexOf('--'+name);return i>=0?argv[i+1]:undefined;};

export async function main(argv,stdin){
 const [command]=argv,root=option(argv,'godspeed'),home=option(argv,'home');
 if(!root||!home||!['say','record','delivered','failed'].includes(command))throw Error('Usage: background-report.mjs say|record|delivered|failed --godspeed <root> --home <Hermes home>');
 const store=new Store(root,{device:machineDevice(root).id});
 if(command==='say'){
  let provider=null;try{provider=notebookProvider(store);}catch{}
  return (await sayNotice(store,{notice:JSON.parse(stdin),home,provider})).text;
 }
 if(command==='failed'){
  let provider=null;try{provider=notebookProvider(store);}catch{}
  await followUpFailed(store,{...JSON.parse(stdin),home,provider});
  return '';
 }
 if(command==='delivered'){
  const receipts=option(argv,'receipts')?.split(',').filter(Boolean)||[];
  delivered(store,stdin.trim(),receipts);
  return '';
 }
 const routine=option(argv,'routine');
 if(!routine)throw Error('Say which routine the words are from (--routine)');
 const delivery=option(argv,'delivery')?.split(',');
 if(delivery&&!delivery.every(d=>CHATS.includes(d)))throw Error('--delivery is telegram or notebook');
 const receipts=await recordRoutine(store,{routine,text:stdin.trim(),home,delivery});
 return argv.includes('--receipts')?receipts.join(','):'';
}

if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
 try{
  const text=await main(process.argv.slice(2),fs.readFileSync(0,'utf8'));
  if(text)process.stdout.write(text+'\n');
  process.exit(0);
 }catch(error){
  console.error(String(error?.message||error).split('\n')[0].slice(0,400));
  process.exit(1);
 }
}
