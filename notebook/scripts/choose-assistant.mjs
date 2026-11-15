import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {assistantCheck} from '../core/addon-model.mjs';
import {hermesPythons} from '../core/runtime.mjs';

// WHICH HERMES THE NOTEBOOK AND ITS ADD-ONS USE: .godspeed/assistant.json, which the Linux and Mac
// installer (install-native-notebook.sh) writes on every run from the `hermes` it finds first on
// its PATH. Until 26 October 2026 it wrote that one whatever it was. On a server updated as root
// it found root's own launcher of a Hermes another account owns, whose Python could not load
// Hermes as root, in place of the one that worked; nothing checked, and the first sign was an
// add-on failing six hours later with words that pointed at the AI subscription.
//
// Now the one found is checked the way an add-on's connection is (godspeed-model --check: Hermes
// is loaded and its chosen provider and model read, no AI is asked). When its source's venv loads
// but its launcher does not, a private wrapper gives the scheduler, chat and updater that venv.
// Otherwise the one used until now stays when it loads and the found one does not, or when it
// loads through its own Python and the found one does not. When none loads, the installer says so
// and goes on: the update did not cause it and undoing the update would not mend it, and a
// notebook without an AI still keeps the person's notes, so it never fails the update.
export async function chooseAssistant({root,found,home,check=assistantCheck,say=line=>process.stderr.write(line+'\n')}){
  const file=path.join(path.resolve(root),'.godspeed','assistant.json');
  let before=null;
  try{const descriptor=JSON.parse(fs.readFileSync(file,'utf8').replace(/^﻿/,''));if(descriptor?.verified&&typeof descriptor.executable==='string')before=descriptor.executable;}catch{}
  const write=(executable,sourceRoot)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify({verified:true,executable,home,...(sourceRoot?{sourceRoot}:{})}),{mode:0o600});};
  const exists=executable=>{try{return fs.statSync(executable).isFile();}catch{return false;}};
  write(found);
  const now=await check({root,executable:found,home});
  if(now.loads&&now.direct)return found;
  const wrapped=now.loads&&!now.direct?await nativeWrapper({root,found,home,check}):null;
  if(wrapped){write(wrapped.executable,wrapped.sourceRoot);return wrapped.executable;}
  const earlier=before&&before!==found&&exists(before)?await check({root,executable:before,home}):null;
  if(earlier?.loads&&(!now.loads||(earlier.direct&&!now.direct))){
    write(before);
    say(now.loads
      ?`The Hermes found at ${found} does not start with its own Python for this account, so Godspeed keeps using the one at ${before}, which does.`
      :`The Hermes found at ${found} does not load for this account (${now.why}), so Godspeed keeps using the one at ${before}, which does.`);
    return before;
  }
  if(!now.loads)say(`Hermes, the AI program Godspeed uses, does not load for this account at ${found} (${now.why}). Until it does, add-ons and the assistant cannot reach an AI; everything else was installed. Run hermes once as this account to see why.`);
  return found;
}

function shellQuote(value){return '"'+value.replace(/[\\$`"\\]/g,'\\$&')+'"';}
async function nativeWrapper({root,found,home,check}){
  const {source}=hermesPythons({executable:found,home}),entry=path.join(source||'','hermes'),exists=file=>{try{return fs.statSync(file).isFile();}catch{return false;}};
  const venv=source&&['venv','.venv'].map(name=>path.join(source,name,'bin','python3')).find(exists);
  if(!source||!venv||!exists(entry))return null;
  const executable=path.join(path.resolve(root),'.godspeed','native-hermes','hermes'),temporary=executable+'.'+process.pid+'.tmp';
  try{
    fs.mkdirSync(path.dirname(executable),{recursive:true});
    fs.writeFileSync(temporary,'#!/bin/sh\nexec '+shellQuote(venv)+' -I '+shellQuote(entry)+' "$@"\n',{mode:0o700});
    if(spawnSync(temporary,['--version'],{stdio:'ignore',timeout:60000}).status!==0)return null;
    const checked=await check({root,executable:temporary,home});
    if(!checked.loads||!checked.direct)return null;
    fs.renameSync(temporary,executable);
    return {executable,sourceRoot:source};
  }catch{return null;}finally{try{fs.rmSync(temporary,{force:true});}catch{}}
}

// node choose-assistant.mjs <the mission control's folder> <the hermes found>, with HERMES_HOME the
// home the notebook's assistant uses.
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [root,found]=process.argv.slice(2);
  if(!root||!found||!process.env.HERMES_HOME)throw Error('Name the mission control\'s folder and the Hermes found, with HERMES_HOME set');
  await chooseAssistant({root,found,home:process.env.HERMES_HOME});
}
