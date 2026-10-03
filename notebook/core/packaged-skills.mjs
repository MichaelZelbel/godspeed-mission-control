import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {hash,atomic} from './records/store.mjs';
const normalized=bytes=>{const text=bytes.toString('utf8');return hash(!text.includes('\0')&&Buffer.from(text,'utf8').equals(bytes)?text.replaceAll('\r',''):bytes);};
export function installSkillTree(store,source,target){
 const knownFile=fileURLToPath(new URL('../data/recipe-revisions.json',import.meta.url)),known=fs.existsSync(knownFile)?JSON.parse(fs.readFileSync(knownFile)):{};
 const ledger=path.join(store.state,'packaged-skills.json'),previous=fs.existsSync(ledger)?JSON.parse(fs.readFileSync(ledger)):{};let updated=0,conflicts=0;
 function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){if(entry.name.startsWith('.'))continue;const file=path.join(dir,entry.name);if(entry.isSymbolicLink())throw Error('Packaged skills must not contain symbolic links');if(entry.isDirectory()){walk(file);continue;}
  const relative=path.relative(source,file),dest=path.join(target,relative),bytes=fs.readFileSync(file),digest=normalized(bytes),key=hash(dest),old=fs.existsSync(dest)?fs.readFileSync(dest):null;
  if(old&&normalized(old)!==digest&&previous[key]!==normalized(old)&&!(known[path.basename(target)+'/'+relative.replaceAll('\\','/')]||[]).includes(normalized(old))){
   const incoming=path.join(store.root,'skills/package-updates',path.basename(target),digest,relative);atomic(incoming,bytes);conflicts++;const id='skill-upgrade-'+hash([dest,digest]);
   const within=dest.startsWith(store.root+path.sep),conflict={id,kind:within?'git':'assistant-skill',path:within?path.relative(store.root,dest).replaceAll('\\','/'):null,title:'Review edited '+path.basename(target)+' skill',local:old.toString('utf8'),remote:bytes.toString('utf8'),target:within?undefined:dest,at:new Date().toISOString()};
   const conflictFile=path.join(store.root,'conflicts',id+'.json');if(!fs.existsSync(conflictFile))atomic(conflictFile,JSON.stringify(conflict,null,2));continue;
  }
  if(!old||normalized(old)!==digest){if(old)atomic(path.join(store.root,'skills/package-history',path.basename(target),normalized(old),relative),old);atomic(dest,bytes);updated++;}previous[key]=digest;
 }}walk(source);atomic(ledger,JSON.stringify(previous));return {updated,conflicts};
}
