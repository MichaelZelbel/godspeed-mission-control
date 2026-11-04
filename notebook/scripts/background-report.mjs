#!/usr/bin/env node
// BACKGROUND WORK TELLS THE OWNER, AS THE ROUTINE SCRIPTS RUN IT (4 November 2026, #198).
//
//   node background-report.mjs say    --godspeed <mission control> --home <Hermes home>   (a notice as JSON on stdin)
//   node background-report.mjs record --godspeed <mission control> --home <Hermes home> --routine <kind>   (its words on stdin)
//
// `say` prints the words to deliver for one queued notice, written with the chat's guidance (or its
// plain fallback text) and recorded where the chat reads it; `record` records a routine's own words
// as printed. See core/background-reports.mjs. Exit 1 only when the notebook cannot be written.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {Store} from '../core/records/store.mjs';
import {machineDevice} from '../core/device-id.mjs';
import {sayNotice,recordRoutine} from '../core/background-reports.mjs';
import {notebookProvider} from './morning-brief.mjs';

const option=(argv,name)=>{const i=argv.indexOf('--'+name);return i>=0?argv[i+1]:undefined;};

export async function main(argv,stdin){
 const [command]=argv,root=option(argv,'godspeed'),home=option(argv,'home');
 if(!root||!home||!['say','record'].includes(command))throw Error('Usage: background-report.mjs say|record --godspeed <root> --home <Hermes home>');
 const store=new Store(root,{device:machineDevice(root).id});
 if(command==='say'){
  let provider=null;try{provider=notebookProvider(store);}catch{}
  return (await sayNotice(store,{notice:JSON.parse(stdin),home,provider})).text;
 }
 const routine=option(argv,'routine');
 if(!routine)throw Error('Say which routine the words are from (--routine)');
 await recordRoutine(store,{routine,text:stdin.trim(),home});
 return '';
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
