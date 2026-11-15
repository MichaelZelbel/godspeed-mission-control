import fs from 'node:fs';
import path from 'node:path';
import {hash} from './records/store.mjs';

// THE SKILLS THE OWNER ASKED THEIR ASSISTANT TO SAVE, BROUGHT HOME (27 October 2026).
//
// Hermes creates a new skill in its own home unless skills.create_dir names another folder, and
// until this was written Godspeed never set it: "Save this as a skill called check-my-email" wrote
// <hermes home>/skills/check-my-email/SKILL.md, which is not in the owner's files, not in their
// private GitHub copy, not on their other computers and not in the Skills part of Godspeed's brain.
// wire-assistant.mjs now sets create_dir to the mission control's skills/ on every wiring, and
// calls moveSavedSkills below so the skills an install already saved in the Hermes home come over
// on the next update, with every file of their folders.
//
// MOVING THE OWNER'S FILES IS THE CAREFUL PART, so this is deliberately shy:
//   - only a folder one level down that holds its own SKILL.md, never a link, never a dotted name
//     (Hermes' own .hub, .archive, .curator_* and the rest live there too);
//   - never one of Hermes' bundled skills (skills/.bundled_manifest), one installed from Hermes'
//     hub (skills/.hub/lock.json) or one this mission control's own package put there
//     (.godspeed/packaged-skills.json, which is keyed by the hash of each file's full path);
//   - a marker file that exists but cannot be read stops the whole move, because without it a
//     bundled skill cannot be told from the owner's, and moving the wrong thing is the harm;
//   - a name already in the mission control's skills/ is never overwritten: it stays where it is
//     and is named to the caller, which says so on standard error;
//   - nothing is deleted anywhere until a copy of everything that will move is written to
//     .godspeed/backups/ AND read back byte for byte.
// A skill that moved is gone from the Hermes home, so the next wiring finds nothing to move and
// makes no second copy. A name is never changed on the way: the folder keeps the name the owner
// gave it, however long (identity-shelf.mjs holds only a name someone changes on the page to its
// 60 characters).

// The copy kept before the move goes in .godspeed/backups/, the install's usual backup place, under
// a name neither pruning there removes: upgrade-copies.mjs knows only 20261027-093000-<commit>,
// 20261027-093000-123 and before-update-20261027-093000 (and .partial- of those) and ignores
// everything else; backup-schedule.mjs keeps only all-digit names.
export const SAVED_COPY_PREFIX='skills-from-the-assistant';

const realDirectory=at=>{try{return fs.lstatSync(at).isDirectory();}catch{return false;}};
const realFile=at=>{try{return fs.lstatSync(at).isFile();}catch{return false;}};
// A stamp that sorts in time order and matches none of the pruned shapes once the prefix is on it.
export const copyStamp=(at=new Date())=>at.toISOString().replace(/[-:T]/g,'').replace(/\..*$/,'').replace(/^(\d{8})(\d{6})$/,'$1-$2');

// Hermes' own bundled skills: one "name:hash" per line of skills/.bundled_manifest.
function bundledNames(folder){
 const file=path.join(folder,'.bundled_manifest');
 if(!fs.existsSync(file))return [];
 return fs.readFileSync(file,'utf8').split(/\r?\n/).map(line=>line.trim()).filter(Boolean).filter(line=>!line.startsWith('#')).map(line=>line.split(':')[0].trim()).filter(Boolean);
}
// Skills installed from Hermes' hub: the keys of skills/.hub/lock.json `installed`, and the folder
// each one went into (install_path is "creative/ascii-art" for a hub skill under a category).
function hubNames(folder){
 const file=path.join(folder,'.hub','lock.json');
 if(!fs.existsSync(file))return [];
 const lock=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'')),installed=lock&&typeof lock==='object'?lock.installed||{}:{};
 const names=[];
 for(const [name,entry] of Object.entries(installed)){
  names.push(name);
  const where=String(entry?.install_path||'').replaceAll('\\','/').split('/').filter(Boolean)[0];
  if(where)names.push(where);
 }
 return names;
}

// THE SKILLS THE OWNER MADE, by name, in the Hermes home's skills/.
// home: the Hermes home. state: the mission control's .godspeed/. packaged: the skill names this
// wiring just installed there itself (the ledger covers the rest).
export function savedByTheUser({home,state,packaged=[]}){
 const folder=path.join(home,'skills');
 if(!realDirectory(folder))return [];
 const theirs=new Set([...bundledNames(folder),...hubNames(folder),...packaged]);
 let ledger={};
 const ledgerFile=path.join(state,'packaged-skills.json');
 if(fs.existsSync(ledgerFile))ledger=JSON.parse(fs.readFileSync(ledgerFile,'utf8').replace(/^\uFEFF/,''))||{};
 const names=[];
 for(const entry of fs.readdirSync(folder,{withFileTypes:true})){
  const name=entry.name;
  if(name.startsWith('.')||!entry.isDirectory()||entry.isSymbolicLink())continue;
  if(!realDirectory(path.join(folder,name))||!realFile(path.join(folder,name,'SKILL.md')))continue;
  if(theirs.has(name))continue;
  if(ledger[hash(path.join(folder,name,'SKILL.md'))]!==undefined)continue;
  names.push(name);
 }
 return names.sort();
}

// Every regular file of a folder, as paths relative to it.
function filesUnder(folder,within=''){
 const out=[];
 for(const entry of fs.readdirSync(path.join(folder,within),{withFileTypes:true})){
  const relative=within?within+'/'+entry.name:entry.name;
  if(entry.isSymbolicLink())continue;
  if(entry.isDirectory())out.push(...filesUnder(folder,relative));
  else if(entry.isFile())out.push(relative);
 }
 return out.sort();
}
// The copy is only a copy once it reads back the same: every file of the source is there, byte for
// byte. Nothing is deleted before this says yes.
function sameTree(source,copy){
 const files=filesUnder(source);
 if(!files.length)throw Error('there was nothing to copy in '+source);
 for(const relative of files){
  const there=path.join(copy,...relative.split('/'));
  if(!realFile(there))throw Error(relative+' is missing from the copy');
  if(!fs.readFileSync(path.join(source,...relative.split('/'))).equals(fs.readFileSync(there)))throw Error(relative+' did not come through the copy unchanged');
 }
 return files.length;
}

// MOVES THEM. Returns what happened and the lines for the person reading the update:
//   {moved:[name], kept:[{name,at}], copy:<folder|null>, error:<text|null>, lines:[text]}
// It never throws for anything it can say instead: a wiring must finish.
export function moveSavedSkills({home,root,state,packaged=[],now=new Date()}){
 const result={moved:[],kept:[],copy:null,error:null,lines:[]};
 const from=path.join(home,'skills'),into=path.join(root,'skills');
 if(!realDirectory(from))return result;
 // The bot's Hermes home lies inside the mission control; if its skills folder ever is the
 // mission control's own, there is nothing to move.
 try{if(fs.realpathSync(from)===fs.realpathSync(into))return result;}catch{}
 let candidates;
 try{candidates=savedByTheUser({home,state,packaged});}
 catch(error){
  result.error='The skills your assistant saved in its own folder were left there: '+from+' could not be read ('+(error.message||error)+').';
  result.lines.push(result.error);return result;
 }
 if(!candidates.length)return result;
 const taken=[],moving=[];
 for(const name of candidates)(fs.existsSync(path.join(into,name))?taken:moving).push(name);
 for(const name of taken){
  result.kept.push({name,at:path.join(from,name)});
  result.lines.push('The skill "'+name+'" stays in your assistant\'s own folder ('+path.join(from,name)+'): a skill of that name is already in your mission control ('+path.join(into,name)+').');
 }
 if(!moving.length)return result;
 // The copy first, all of it, checked.
 const backups=path.join(state,'backups');
 let copy=path.join(backups,SAVED_COPY_PREFIX+'-'+copyStamp(now));
 try{
  fs.mkdirSync(backups,{recursive:true});
  for(let n=2;fs.existsSync(copy);n++)copy=path.join(backups,SAVED_COPY_PREFIX+'-'+copyStamp(now)+'-'+n);
  fs.mkdirSync(copy,{recursive:true});
  for(const name of moving){fs.cpSync(path.join(from,name),path.join(copy,name),{recursive:true,dereference:true});sameTree(path.join(from,name),path.join(copy,name));}
 }catch(error){
  result.error='The skills your assistant saved in its own folder were not moved, because no copy of them could be kept first in '+copy+': '+(error.message||error)+'. They are still in '+from+' and nothing was deleted.';
  result.lines.push(result.error);return result;
 }
 result.copy=copy;
 fs.mkdirSync(into,{recursive:true});
 for(const name of moving){
  const source=path.join(from,name),target=path.join(into,name);
  try{
   try{fs.renameSync(source,target);}
   // The Hermes home can be on another volume, and Windows refuses a rename a virus scanner holds.
   catch(error){
    if(!['EXDEV','EPERM','EACCES','EBUSY'].includes(error.code))throw error;
    fs.cpSync(source,target,{recursive:true,dereference:true});sameTree(source,target);fs.rmSync(source,{recursive:true,force:true,maxRetries:3});
   }
   if(!realFile(path.join(target,'SKILL.md')))throw Error('its SKILL.md is not in '+target+' afterwards');
   if(fs.existsSync(source))throw Error('it is still in '+source+' afterwards');
   result.moved.push(name);
  }catch(error){
   // Every skill is moved on its own, so one that cannot be is said and the rest still come over.
   const text='The skill "'+name+'" could not be moved out of your assistant\'s own folder ('+source+'): '+(error.message||error)+'. A copy of it is in '+copy+'.';
   result.error=result.error?result.error+' '+text:text;result.lines.push(text);
  }
 }
 if(result.moved.length)result.lines.push('Moved into your mission control\'s skills folder, where they are yours and are saved with it: '+result.moved.map(name=>'"'+name+'"').join(', ')+'. A copy of them as they were is in '+copy+'.');
 return result;
}
