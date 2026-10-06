import fs from 'node:fs';
import path from 'node:path';
import { atomic, hash, retrying, Store } from './records/store.mjs';
import {durable,durableRoots,durableFiles,recordsFolder,legacyRecordsFolder} from './file-policy.mjs';
const reserve=256*1024*1024;
function existingParent(target){
  let current=path.resolve(target);
  while(!fs.existsSync(current)){const parent=path.dirname(current);if(parent===current)throw Error('Archive storage location does not exist');current=parent;}
  if(!fs.statSync(current).isDirectory())throw Error('Archive storage location must be a directory');
  return fs.realpathSync(current);
}
function requireSpace(destination,bytes,count,operation){
  const filesystem=existingParent(destination),capacity=fs.statfsSync(filesystem,{bigint:true});
  // Logical bytes count each copied pathname, including hard links. Transactions
  // retain staged bytes while publishing a second copy; allow metadata and writes.
  const needed=BigInt(bytes)+BigInt(count)*16384n+1048576n+BigInt(Math.max(reserve,Math.ceil(bytes*0.05)));
  const available=capacity.bavail*capacity.bsize;
  if(available<needed){const gib=value=>(Number(value)/(1024**3)).toFixed(2);throw Error(`${operation} needs ${gib(needed)} GB free, but only ${gib(available)} GB is available. Free at least ${gib(needed-available)} GB on ${filesystem} or choose storage with more space. Existing backups are unchanged.`);}
}
// Where a backup's file is restored to: a backup made before 2026-10-05 holds
// records/, which is notebook/ now.
function restoredName(source){
  const legacy=!fs.existsSync(path.join(source,recordsFolder))&&fs.existsSync(path.join(source,legacyRecordsFolder));
  return name=>legacy?name.replace(new RegExp('^'+legacyRecordsFolder+'/'),recordsFolder+'/'):name;
}
function restoreSpace(source,destination){
  const manifest=JSON.parse(fs.readFileSync(path.join(source,'backup.json'),'utf8'));
  if(manifest.format!==1||!Array.isArray(manifest.files))throw Error('Backup integrity manifest required');
  // Walk the same durable paths as Store.restore as well as the media copy.
  // Counting actual files also covers extra source files absent from the manifest.
  let bytes=0,count=0;const as=restoredName(source);
  for(const name of files(source)){
    const copies=name.startsWith('media/')?1:(durable(as(name))||/^conflicts\/[\w-]+\.json$/.test(name)?2:0);
    if(copies){bytes+=fs.statSync(path.join(source,name)).size*copies;count+=copies;}
  }
  requireSpace(destination,bytes,count,'Restoring a separate copy');
}
function files(root,prefix=''){
  return fs.readdirSync(path.join(root,prefix),{withFileTypes:true}).flatMap(e=>{
    if(e.isSymbolicLink())throw new Error('Archive cannot follow symbolic links');
    const name=path.posix.join(prefix,e.name);return e.isDirectory()?files(root,name):[name];
  });
}
// A backup is built under a .partial- name beside its destination and renamed
// to it once complete, so one that fails part-way leaves nothing behind. Until
// 6 October 2026 a failing scheduled backup left a partial copy every ten
// minutes, which nothing counted or removed until the disk was full.
export const partialOf=destination=>path.join(path.dirname(destination),'.partial-'+path.basename(destination));
export function backup(store,mediaRoot,destination){
  let bytes=0,count=0;
  for(const root of [...durableRoots,...durableFiles,'conflicts']){
    const target=path.join(store.root,root);if(!fs.existsSync(target))continue;
    const names=fs.lstatSync(target).isDirectory()?files(target):[''];
    for(const name of names){const file=path.join(target,name);if(fs.lstatSync(file).isSymbolicLink())throw Error('Archive cannot follow symbolic links');bytes+=fs.statSync(file).size;count++;}
  }
  if(fs.existsSync(mediaRoot))for(const name of files(mediaRoot)){bytes+=fs.statSync(path.join(mediaRoot,name)).size;count++;}
  requireSpace(destination,bytes,count,'Creating a backup');
  if(fs.existsSync(destination))throw new Error('Backup destination already exists');
  const partial=partialOf(destination);fs.rmSync(partial,{recursive:true,force:true});
  try{
    store.backup(partial,{finalize:()=>{
    const captured=JSON.parse(fs.readFileSync(path.join(partial,'backup.json'),'utf8'));
    if(fs.existsSync(mediaRoot))fs.cpSync(mediaRoot,path.join(partial,'media'),{recursive:true});
    // User-state archives carry knowledge and media, never device credentials.
    const entries=files(partial).filter(n=>n!=='backup.json').map(name=>({path:name,sha256:hash(fs.readFileSync(path.join(partial,name)))}));
    atomic(path.join(partial,'backup.json'),JSON.stringify({...captured,files:entries},null,2));
    }});
    retrying(()=>fs.renameSync(partial,destination),5000);
  }catch(error){try{fs.rmSync(partial,{recursive:true,force:true});}catch{}throw error;}
  return destination;
}
export function restore(store,mediaRoot,source,{deviceConfig=false}={}){
  const manifest=JSON.parse(fs.readFileSync(path.join(source,'backup.json'),'utf8'));
  if(manifest.format!==1||!Array.isArray(manifest.files))throw new Error('Backup integrity manifest required');
  for(const entry of manifest.files){
    const target=path.resolve(source,entry.path);
    if(!target.startsWith(path.resolve(source)+path.sep)||hash(fs.readFileSync(target))!==entry.sha256)throw new Error('Backup integrity mismatch');
  }
  // Only read: the backup itself is never written (Store.inspect).
  const verified=Store.inspect(source);if(verified.problems.length||verified.records.size!==manifest.records)throw new Error('Backup reference validation failed');
  if(fs.existsSync(mediaRoot)&&fs.readdirSync(mediaRoot).length)throw new Error('Restore requires empty media storage');
  if(deviceConfig&&fs.existsSync(path.join(source,'device-config')))for(const name of fs.readdirSync(path.join(source,'device-config')))if(fs.existsSync(path.join(store.state,name)))throw new Error('Restore device settings only to an unconfigured candidate');
  const count=store.restore(source);
  if(fs.existsSync(path.join(source,'media')))fs.cpSync(path.join(source,'media'),mediaRoot,{recursive:true});
  if(deviceConfig&&fs.existsSync(path.join(source,'device-config')))for(const name of fs.readdirSync(path.join(source,'device-config')))fs.cpSync(path.join(source,'device-config',name),path.join(store.state,name),{recursive:true});
  return count;
}
export function restoreSeparateCopy(store,source){
  const destination=path.join(store.state,'restored-copies',Date.now()+'-'+hash(source+Math.random()).slice(0,12)),workspace=path.join(destination,'workspace'),media=path.join(destination,'media');
  restoreSpace(source,destination);
  const target=new Store(workspace,{device:store.device}),records=restore(target,media,source),manifest=JSON.parse(fs.readFileSync(path.join(source,'backup.json'),'utf8')),as=restoredName(source);
  let compared=0;const excluded=[];
  for(const entry of manifest.files){
    const name=as(entry.path);
    if(!name.startsWith('media/')&&!durable(name)&&!/^conflicts\/[\w-]+\.json$/.test(name)){excluded.push(entry.path);continue;}
    const file=name.startsWith('media/')?path.join(media,name.slice(6)):path.join(workspace,name);
    if(hash(fs.readFileSync(file))!==entry.sha256)throw Error('Restored copy differs from the verified backup');compared++;
  }
  const result={verified:true,workspace,media,records,compared_files:compared,excluded_files:excluded,source,at:new Date().toISOString()};
  atomic(path.join(destination,'verification.json'),JSON.stringify(result,null,2));return result;
}
