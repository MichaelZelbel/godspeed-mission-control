#!/usr/bin/env node
// THE MORNING BRIEF, AS THE ROUTINE RUNS IT (3 November 2026, #160).
//
// On every install line the assistant (Hermes) runs the routines, and until this change its
// "Morning brief" routine was the starter morning-brief recipe: an AI wrote brief/<day>.md from the
// recipe's instructions, and the notebook's own briefing (core/briefing.mjs) never ran. That
// briefing is the one that carries the Charm Challenge line word for word (#134) and cuts a sentence
// that breaks one of the person's writing rules instead of losing the whole briefing (#138), so
// neither reached a real install. The routine is now a script (core/notebook-routines.mjs,
// BRIEF_SCRIPT; core/routine-scripts/godspeed_routines.py, brief), and the script runs this: the
// notebook's own briefing, saved in the notebook as "Your morning briefing", and its text printed,
// which Hermes delivers the way the routine delivers (Telegram when connected, else the notebook).
// A briefing the notebook keeps silent prints nothing, which is Hermes' silence; one that cannot be
// written (no AI, a draft its checks refuse twice) fails the run in one sentence.
//
//   GODSPEED_WORKSPACE=<mission control> node notebook/scripts/morning-brief.mjs
//
// The AI is the notebook's own: the one connected in Settings (.godspeed/provider.json), else the
// assistant the notebook was wired to (assistant.json), as the notebook's server chooses it.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {machineDevice} from '../core/device-id.mjs';
import {briefing} from '../core/briefing.mjs';
import {modelProvider,hermesProvider} from '../core/runtime.mjs';

const readJson=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8').replace(/^﻿/,''));}catch{return null;}};

// The notebook server's own order (server/main.mjs): the AI connected in Settings, then the assistant.
export function notebookProvider(store,env=process.env){
 const saved=readJson(path.join(store.state,'provider.json'));
 if(saved?.url&&saved?.key&&saved?.model)return modelProvider(saved);
 const descriptor=readJson(env.GODSPEED_ASSISTANT_CONFIG||path.join(store.state,'assistant.json'));
 if(descriptor?.verified)return hermesProvider({executable:descriptor.executable,home:descriptor.home,cwd:store.root,sourceRoot:descriptor.sourceRoot});
 return null;
}

// The notebook server's own query (server/main.mjs): with the original assistant, goals, forecasts
// and work are the assistant's cards (goals/, forecasts/, work/), and the notebook's own repair items
// beside them. Until #163 this script read the notebook's goal records instead, so on an install
// whose goals are cards the briefing found none.
export function notebookQuery(store,env=process.env){
 const query=new QueryService(store);
 if(env.GODSPEED_ORIGINAL_RUNTIME==='on'){
  const descriptor=readJson(env.GODSPEED_ASSISTANT_CONFIG||path.join(store.state,'assistant.json'));
  if(descriptor?.verified&&descriptor.home)query.nativeHermesHome=descriptor.home;
 }
 return query;
}

// The briefing, and the words to deliver: the saved note's, or '' when the briefing stays silent.
export async function runMorningBrief({root,provider=null,env=process.env}){
 const store=new Store(root,{device:machineDevice(root).id}),query=notebookQuery(store,env);
 const ai=provider||notebookProvider(store,env);
 if(!ai)throw Error('The morning brief has no AI to write with: connect one in Settings, Your AI.');
 const result=await briefing({id:'morning-brief',kind:'morning-brief'},{store,query,provider:ai});
 const note=result.record_id?store.get('notes',result.record_id):null;
 return {result,text:note?String(note.content||'').trim():''};
}

if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
 const root=process.env.GODSPEED_WORKSPACE||process.env.GODSPEED_ROOT;
 if(!root){console.error('The morning brief does not know which mission control to read (GODSPEED_WORKSPACE).');process.exit(2);}
 try{
  const {text}=await runMorningBrief({root});
  if(text)process.stdout.write(text+'\n');
  process.exit(0);
 }catch(error){
  // One plain sentence: the routine's script shows it as the run's last line in Settings > Routines.
  console.error(String(error?.message||error).split('\n')[0].slice(0,400));
  process.exit(1);
 }
}
