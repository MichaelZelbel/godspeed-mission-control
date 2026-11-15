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

// Made from this starter, which is what a reader's installation is: its operating manual, at least
// one of the starter's own rules, and the two recipes the daily round runs. An adopted mission
// control (the owner's own, often live on several machines) is never one, and neither is a folder
// that only looks empty. Only a starter-born mission control gets the routines a first goal starts.
export function starterBorn(root, starter=defaultStarter) {
  if(adoptedMissionControl(root,starter)||!fs.existsSync(path.join(root,'AGENTS.md')))return false;
  const starterRules=fs.existsSync(path.join(starter,'rules'))?fs.readdirSync(path.join(starter,'rules')):[];
  return starterRules.some(name=>fs.existsSync(path.join(root,'rules',name)))&&['next-action','work-item'].every(skill=>fs.existsSync(path.join(root,'skills',skill,'SKILL.md')));
}

// Version 2 extends the complete main-branch starter. Existing user files win.
export function installStarter(root, starter=defaultStarter) {
  // Rules and profile are what the owner told their mission control. In an
  // adopted one the starter's example rules would join the owner's own and be
  // compiled into every session, so those folders are left alone, and so are
  // its skills: the owner's own recipes are what the starter's were made from,
  // and a starter recipe they replaced (the starter morning brief) would sit
  // beside theirs and answer the same requests. Packaged recipes still add
  // skills the owner does not have. A starter-made folder still gets a deleted
  // starter file back.
  const owned=adoptedMissionControl(root,starter)?new Set(['rules','profile','skills'].map(n=>path.join(starter,n))):new Set();
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

// Lines the starter's manual gained after readers had installed it. A new folder gets each with the
// starter's AGENTS.md; a reader's existing manual is never replaced, so each is added there once:
// below the manual's own bullet that starts with `after` when that is there, else at the end. Only a
// starter-born mission control is touched (an adopted one is its owner's own manual), and a note in
// the machine's own state folder (never synced) means it is added once and never again, even if its
// owner deletes it.
function addManualLine(root,state,starter,{line,flag,present,after}){
  const manual=path.join(root,'AGENTS.md'),note=path.join(state,flag);
  if(!fs.existsSync(manual)||fs.existsSync(note)||!starterBorn(root,starter))return false;
  const mark=()=>{fs.mkdirSync(state,{recursive:true});fs.writeFileSync(note,new Date().toISOString()+'\n');};
  let text=fs.readFileSync(manual,'utf8');
  if(text.includes(present)){mark();return false;}
  const eol=text.includes('\r\n')?'\r\n':'\n',lines=text.split(/\r?\n/);
  const at=lines.findIndex(l=>l.startsWith(after));
  if(at>=0){let end=at+1;while(end<lines.length&&/^ {2}\S/.test(lines[end]))end++;lines.splice(end,0,line);text=lines.join(eol);}
  else text=text.replace(/\s*$/,'')+eol+eol+line+eol;
  // Hermes drops the middle of a manual past 20,000 characters, so a manual this line would push
  // over that is left as it is (and asked again on the next update, in case it got shorter).
  if([...text].length>=20000)return false;
  fs.writeFileSync(manual,text);mark();return true;
}

// Since 12 October 2026: the assistant looks in the conversation archive before it says it does not remember.
export const ARCHIVE_LINE='- When you cannot recall an earlier conversation, run `mc-prompt-archive search <words>` before saying you don\'t know.';
export const addArchiveLine=(root,state=path.join(root,'.godspeed'),starter=defaultStarter)=>
  addManualLine(root,state,starter,{line:ARCHIVE_LINE,flag:'archive-line-added',present:'mc-prompt-archive search',after:'- **Never load `prompts/`.**'});

// Since 11 November 2026 (#191): a yes from background work is asked in words, never with a code to type.
export const STEP_LINE='- **Never ask me to type a code.** For my yes, follow `skills/ask-for-a-yes/SKILL.md`.';
export const addStepLine=(root,state=path.join(root,'.godspeed'),starter=defaultStarter)=>
  addManualLine(root,state,starter,{line:STEP_LINE,flag:'step-line-added',present:'skills/ask-for-a-yes/',after:'- **Ask in your reply, then wait.**'});
