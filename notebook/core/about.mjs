// What Settings, About shows (18 October 2026). The README and the food tracker sent readers to
// "Settings, About" for the food table's licence, and the guide sent them to a file on disk for
// their release code, while the routed Settings page had no About section at all.
//
// The version and name are the product's one version and name (version.mjs), as the health address shows them.
import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {BLS,OFF_ATTRIBUTION,tableStatus} from './food-table.mjs';
import {PRODUCT,VERSION} from './version.mjs';

// The product folder this notebook runs from (the one holding notebook/).
export const productRoot=fileURLToPath(new URL('../../',import.meta.url));

const commit=/^[0-9a-f]{40}$/;
const day=value=>{const text=String(value||'');return Number.isFinite(Date.parse(text))?text:null;};
// The release this copy is, as the installer that put it here recorded it, and nothing guessed:
// - Windows: the setup unpacks the product into <app>\payload\kit and keeps candidate-manifest.json
//   beside it (kitCommit, kitCommittedAt; kit-bootstrap windows/build-full-alpha.ps1).
// - Mac and Linux: install-native-notebook.sh puts each release in
//   .godspeed/integrated-runtime/versions/<commit>, a Git copy of that commit.
// - The one-line server: its image carries GODSPEED_REVISION, the commit it was built from
//   (docker/full-candidate/Dockerfile).
// A copy no installer made (a developer's checkout) has none, and says so.
export function installedRelease({root=productRoot,env=process.env}={}){
  const own=path.resolve(root);
  try{
    const manifest=JSON.parse(fs.readFileSync(path.join(own,'..','candidate-manifest.json'),'utf8').replace(/^﻿/,''));
    const code=String(manifest.kitCommit||'').toLowerCase();
    if(commit.test(code))return {code,date:day(manifest.kitCommittedAt),installed_by:'windows'};
  }catch{}
  const name=path.basename(own).toLowerCase();
  if(commit.test(name)&&path.basename(path.dirname(own))==='versions')return {code:name,date:null,installed_by:'computer',git:own};
  const revision=String(env.GODSPEED_REVISION||'').trim().toLowerCase();
  if(commit.test(revision))return {code:revision,date:null,installed_by:'server'};
  return null;
}
// The day of a Mac or Linux release, from its own Git copy; asked once, and never longer than
// three seconds. Without Git or the copy the release simply shows no date.
const dates=new Map();
function commitDate(folder,code){
  if(!dates.has(folder))dates.set(folder,new Promise(resolve=>{
    // Only the copy's own history: without its .git, Git would look in the folders around it.
    if(!fs.existsSync(path.join(folder,'.git')))return resolve(null);
    try{execFile('git',['-C',folder,'log','-1','--format=%cI',code],{timeout:3000,windowsHide:true},(error,out)=>resolve(error?null:day(String(out).trim())));}
    catch{resolve(null);}
  }));
  return dates.get(folder);
}

// Everything the About section shows. Paths are this machine's (on a server, the server's).
export async function about({store,mediaRoot,device,root=productRoot,env=process.env}){
  const release=installedRelease({root,env});
  if(release?.git){release.date=await commitDate(release.git,release.code);delete release.git;}
  const food=tableStatus(store.state);
  return {
    name:PRODUCT,
    version:VERSION,
    release,
    on:device==='vps'?'server':'computer',
    folders:{workspace:store.root,notes:store.recordsRoot,media:mediaRoot,backups:path.join(store.state,'backups')},
    food:{
      installed:food.installed,notice:food.notice,downloaded_at:food.source?.downloaded_at||null,
      table:'Bundeslebensmittelschlüssel (BLS) '+BLS.version,publisher:BLS.publisher,licence:BLS.licence,licence_url:BLS.licenceUrl,
      citation:BLS.citation,source_url:'https://www.blsdb.de',packaged:OFF_ATTRIBUTION,
    },
  };
}
