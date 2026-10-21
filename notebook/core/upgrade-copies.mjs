import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

// The copy of the notebook an installer makes before it updates it. Until 15 October 2026 none
// was ever removed: one server had 35 of them, 7.2 GB, after eight days of updates, and its disk
// was 97% full. From then an installer called this once its update worked (the new notebook
// answers) and the newest three stayed. Since 21 October 2026 only the copy that update made
// stays, as the one way back should something turn out wrong after it, and every older one goes,
// the whole copies earlier versions made too (one computer still had nine, 36 GB). During an
// update, and after one that failed, nothing calls it, so every copy stays.
//
// Only what an installer made is touched, known by its name and its backup.json:
//   20261015-093000-<commit>        the Linux and Mac installer (scripts/install-native-notebook.sh)
//   20261015-093000-123             the Windows setup (kit-bootstrap's windows/setup-full-alpha.ps1)
//   before-update-20261015-093000   the server package (docker/full-candidate/install.sh)
// and, named .partial-<one of those>, what a copy that stopped part-way left (archives.mjs backup,
// update-copy.mjs). Anything else in the folder is left as it is: the nightly backups
// (backup-schedule.mjs, which keeps its own seven), a backup the owner asked for by name, a
// folder of their own. A copy made with Git (update-copy.mjs) keeps its commit with a ref in the
// folder's repository; the ref goes with the copy, and so does one a copy that stopped part-way left.
export const upgradeCopiesKept=1;
const refs='refs/godspeed/update-copies/';
const shapes=[/^(\d{8})-(\d{6})-[0-9a-f]{7,64}$/,/^(\d{8})-(\d{6})-(\d{3})$/,/^before-update-(\d{8})-(\d{6})$/];
// When a copy was made, as digits that sort in time order.
function stampOf(name){
  for(const shape of shapes){const match=shape.exec(name);if(match)return match[1]+match[2]+(match[3]||'000');}
  return null;
}
const isFile=file=>{try{return fs.lstatSync(file).isFile();}catch{return false;}};
// A whole copy: a real folder (never a link) with its manifest, which backup() writes last.
const isCopy=(folder,name)=>{try{return fs.lstatSync(path.join(folder,name)).isDirectory()&&isFile(path.join(folder,name,'backup.json'));}catch{return false;}};
const manifestOf=copy=>{try{return JSON.parse(fs.readFileSync(path.join(copy,'backup.json'),'utf8').replace(/^﻿/,''));}catch{return null;}};
const git=(cwd,args)=>spawnSync('git',['-C',cwd,...args],{encoding:'utf8',windowsHide:true,timeout:60000,env:{...process.env,GIT_TERMINAL_PROMPT:'0'}});
// The repository and ref a copy made with Git keeps its commit in, or null.
function pinOf(copy){
  const manifest=manifestOf(copy);
  if(manifest?.format!==2||typeof manifest.workspace!=='string'||!String(manifest.git?.ref||'').startsWith(refs)||!/^[0-9a-f]{40,64}$/.test(manifest.git?.commit||''))return null;
  return {repository:manifest.workspace,ref:manifest.git.ref,commit:manifest.git.commit};
}

// made: the copy this update just made, by name or by its path in the folder. It always stays,
// and with it the newest others up to keep. Without a whole copy just made nothing is removed.
export function pruneUpgradeCopies(folder,{made,keep=upgradeCopiesKept}={}){
  if(!Number.isInteger(keep)||keep<1)throw Error('Keep at least one copy');
  folder=path.resolve(folder);
  const target=made?path.resolve(folder,made):null;
  if(!target||path.relative(folder,path.dirname(target))!=='')throw Error('Name the copy this update just made, in '+folder+'. Nothing was removed.');
  const madeName=path.basename(target),madeStamp=stampOf(madeName);
  if(!madeStamp||!isCopy(folder,madeName))throw Error('The copy this update just made ('+madeName+') is not a whole update copy in '+folder+'. Nothing was removed.');
  const copies=[],partials=[],ignored=[];
  for(const entry of fs.readdirSync(folder,{withFileTypes:true})){
    const name=entry.name,partial=name.startsWith('.partial-'),stamp=stampOf(partial?name.slice('.partial-'.length):name);
    if(!stamp||!entry.isDirectory())ignored.push(name);
    else if(partial)partials.push({name,stamp});
    else if(isCopy(folder,name))copies.push({name,stamp});
    else ignored.push(name);
  }
  copies.sort((a,b)=>b.stamp.localeCompare(a.stamp)||b.name.localeCompare(a.name));
  const kept=[madeName,...copies.map(copy=>copy.name).filter(name=>name!==madeName)].slice(0,keep);
  // A part-way copy older than the one just made was left by a copy that stopped; a newer one
  // could still be in the making, so it stays.
  const going=[...copies.filter(copy=>!kept.includes(copy.name)),...partials.filter(partial=>partial.stamp<madeStamp)].map(entry=>entry.name);
  const removed=[],failed=[],released=[];
  for(const name of going){
    const pin=pinOf(path.join(folder,name));
    try{fs.rmSync(path.join(folder,name),{recursive:true,force:true,maxRetries:3});removed.push(name);}
    catch(error){failed.push({name,error:String(error.message||error)});continue;}
    // Only while it still names that copy's commit; a ref that cannot go keeps an old commit alive, nothing more.
    if(pin&&git(pin.repository,['update-ref','-d',pin.ref,pin.commit]).status===0)released.push(pin.ref);
  }
  // A copy made with Git that stopped part-way, or was removed by hand, can leave its ref behind:
  // in the repository the copy just made keeps its commit in, every ref of ours that is older
  // than that copy and has no whole copy here of its name goes.
  const pin=pinOf(target);
  if(pin){
    const listed=git(pin.repository,['for-each-ref','--format=%(refname)',refs]);
    for(const ref of listed.status===0?listed.stdout.split(/\r?\n/).filter(Boolean):[]){
      const name=ref.slice(refs.length),stamp=stampOf(name);
      if(ref===pin.ref||!stamp||stamp>=madeStamp||kept.includes(name)||isCopy(folder,name))continue;
      if(git(pin.repository,['update-ref','-d',ref]).status===0)released.push(ref);
    }
  }
  return {folder,keep,made:madeName,kept,removed,failed,released,ignored:ignored.sort()};
}
