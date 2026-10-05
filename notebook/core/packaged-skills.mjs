import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {hash,atomic} from './records/store.mjs';
const normalized=bytes=>{const text=bytes.toString('utf8');return hash(!text.includes('\0')&&Buffer.from(text,'utf8').equals(bytes)?text.replaceAll('\r',''):bytes);};
// In an adopted mission control the owner's skills are the originals the
// packaged recipes were made from, so the owner's copy wins: a skill folder the
// package never installed is left alone, and an edit the owner made is kept
// instead of becoming a conflict that stops synchronization.
export function installSkillTree(store,source,target,{adopted=false}={}){
 const knownFile=fileURLToPath(new URL('../data/recipe-revisions.json',import.meta.url)),known=fs.existsSync(knownFile)?JSON.parse(fs.readFileSync(knownFile)):{};
 const ledger=path.join(store.state,'packaged-skills.json'),previous=fs.existsSync(ledger)?JSON.parse(fs.readFileSync(ledger)):{};let updated=0,conflicts=0;
 if(adopted&&fs.existsSync(target)){
  const installed=dir=>fs.readdirSync(dir,{withFileTypes:true}).some(entry=>!entry.name.startsWith('.')&&(entry.isDirectory()?installed(path.join(dir,entry.name)):previous[hash(path.join(target,path.relative(source,path.join(dir,entry.name))))]!==undefined));
  // A skill whose SKILL.md is not what this package last put there is the
  // owner's, whatever the ledger still remembers from before the folder was
  // adopted. A server workspace that began as a starter carried the ledger of
  // its own first install into the owner's repository, and every start then
  // added the package's helpers to the owner's skills (2026-10-05).
  const skill=path.join(target,'SKILL.md'),owners=fs.existsSync(skill)&&previous[hash(skill)]!==normalized(fs.readFileSync(skill));
  if(owners||!installed(source))return {updated,conflicts,kept:true};
 }
 function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){if(entry.name.startsWith('.'))continue;const file=path.join(dir,entry.name);if(entry.isSymbolicLink())throw Error('Packaged skills must not contain symbolic links');if(entry.isDirectory()){walk(file);continue;}
  const relative=path.relative(source,file),dest=path.join(target,relative),bytes=fs.readFileSync(file),digest=normalized(bytes),key=hash(dest),old=fs.existsSync(dest)?fs.readFileSync(dest):null;
  if(old&&normalized(old)!==digest&&previous[key]!==normalized(old)&&!(known[path.basename(target)+'/'+relative.replaceAll('\\','/')]||[]).includes(normalized(old))){
   if(adopted)continue;
   const incoming=path.join(store.root,'skills/package-updates',path.basename(target),digest,relative);atomic(incoming,bytes);conflicts++;const id='skill-upgrade-'+hash([dest,digest]);
   const within=dest.startsWith(store.root+path.sep),conflict={id,kind:within?'git':'assistant-skill',path:within?path.relative(store.root,dest).replaceAll('\\','/'):null,title:'Review edited '+path.basename(target)+' skill',local:old.toString('utf8'),remote:bytes.toString('utf8'),target:within?undefined:dest,at:new Date().toISOString()};
   const conflictFile=path.join(store.root,'conflicts',id+'.json');if(!fs.existsSync(conflictFile))atomic(conflictFile,JSON.stringify(conflict,null,2));continue;
  }
  if(!old||normalized(old)!==digest){if(old)atomic(path.join(store.root,'skills/package-history',path.basename(target),normalized(old),relative),old);atomic(dest,bytes);updated++;}previous[key]=digest;
 }}walk(source);atomic(ledger,JSON.stringify(previous));return {updated,conflicts};
}
