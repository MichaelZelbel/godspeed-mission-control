import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const defaultStarter=fileURLToPath(new URL('../../starter-godspeed/',import.meta.url));

// A mission control that was not made from this starter (it has an operating
// manual and a rules folder holding none of the starter's rules) is adopted,
// not installed: it is the owner's own, often cloned to other machines.
export function adoptedMissionControl(root, starter=defaultStarter) {
  const rules=path.join(root,'rules'),starterRules=fs.existsSync(path.join(starter,'rules'))?fs.readdirSync(path.join(starter,'rules')):[];
  return fs.existsSync(path.join(root,'AGENTS.md'))&&fs.existsSync(rules)&&!starterRules.some(name=>fs.existsSync(path.join(rules,name)));
}

// Version 2 extends the complete main-branch starter. Existing user files win.
export function installStarter(root, starter=defaultStarter) {
  // Rules and profile are what the owner told their mission control. In an
  // adopted one the starter's example rules would join the owner's own and be
  // compiled into every session, so those two folders are left alone. A
  // starter-made folder still gets a deleted starter file back.
  const owned=adoptedMissionControl(root,starter)?new Set(['rules','profile'].map(n=>path.join(starter,n))):new Set();
  const copyMissing=(source,destination)=>{
    if(owned.has(source))return;
    const stat=fs.lstatSync(source);
    if(stat.isSymbolicLink()){
      if(!fs.existsSync(destination))fs.symlinkSync(fs.readlinkSync(source),destination);
    }else if(stat.isDirectory()){
      if(fs.existsSync(destination)&&!fs.statSync(destination).isDirectory())throw Error('Starter folder conflicts with an existing file: '+destination);
      fs.mkdirSync(destination,{recursive:true});
      for(const name of fs.readdirSync(source))copyMissing(path.join(source,name),path.join(destination,name));
    }else if(!fs.existsSync(destination))fs.copyFileSync(source,destination,fs.constants.COPYFILE_EXCL);
  };
  copyMissing(starter,root);
}
