// Pictures and PDFs travel with the private GitHub copy. Until 2.0.0-beta.24
// they were kept only in the media root (.godspeed/media or
// GODSPEED_MEDIA_ROOT), which never leaves the computer, so a server move on
// 13 November 2026 lost 43 files whose notes had travelled. The media root
// stays as it is; the notebook also keeps a copy of each item of 50 MB or less
// in notebook/_media/, which sync commits like a page: the file, named by its
// content hash, and its mapping. Every read looks there first, then in the
// media root.
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {hash,retrying,syncFolder} from './records/store.mjs';
import {mediaFileName} from './media-names.mjs';
import {recordsFolder} from './file-policy.mjs';

// Sync uploads nothing larger: it is FileSync's largeFile.
export const CARRY_LIMIT=50*1024*1024;
export const CARRIED_FOLDER='_media';
export const carriedRoot=store=>path.join(store.recordsRoot,CARRIED_FOLDER);
// "md" and "json" are never kept: a file named <hash>.md would be read as a
// notebook page, and .mapping.json names the mappings.
const KNOWN_EXTENSIONS=new Set(['png','jpg','jpeg','gif','webp','heic','heif','bmp','tif','tiff','svg','pdf','mp3','m4a','wav','ogg','oga','opus','webm','mp4','mov','m4v','txt','csv','log','xml','html','yaml','yml','rtf','doc','docx','xls','xlsx','ppt','pptx','odt','ods','odp','epub','zip']);
const SHA=/^[a-f0-9]{64}$/;
export const carriedNamePattern=/^[a-f0-9]{64}(\.[a-z0-9]{1,5})?$/;
// A stored name comes only from the content hash and a known extension,
// never from the name the person gave the file.
export function carriedName(sha256,original){
  if(!SHA.test(String(sha256)))throw new Error('Invalid media content hash');
  const base=String(original??'').split(/[\\/]/).pop(),dot=base.lastIndexOf('.'),extension=dot>0?base.slice(dot+1).toLowerCase():'';
  return sha256+(KNOWN_EXTENSIONS.has(extension)?'.'+extension:'');
}
// A carried file as sync sees it: notebook/_media/<name> with a stored name.
export function isCarriedPath(name){
  const folder=recordsFolder+'/'+CARRIED_FOLDER+'/';
  return name.startsWith(folder)&&carriedNamePattern.test(name.slice(folder.length));
}
const mappingName=original=>hash(original)+'.mapping.json';
const readJson=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}};
// A carried mapping arrives from another computer, so it counts only when it
// names the path asked for and a well-formed hash; its `file` is never used.
function readCarried(carried,original){
  const m=carried?readJson(path.join(carried,mappingName(original))):null;
  return m&&m.path===original&&SHA.test(String(m.sha256))?m:null;
}
const readRoot=(mediaRoot,original)=>readJson(path.join(mediaRoot,mappingName(original)));
// Written beside its target under a dot name, which neither sync mode
// commits, and then renamed: the media timer writes here without the
// workspace lock, while a sync round may be adding the folder.
function writeWhole(file,data){
  const dir=path.dirname(file);fs.mkdirSync(dir,{recursive:true});
  const tmp=path.join(dir,'.'+path.basename(file)+'.'+randomUUID()+'.tmp'),fd=fs.openSync(tmp,'wx');
  try{
    try{fs.writeFileSync(fd,data);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    retrying(()=>fs.renameSync(tmp,file));
  }catch(error){try{fs.unlinkSync(tmp);}catch{}throw error;}
  syncFolder(dir);
}
// The carried mapping: the media root's own fields in one order, without
// removal_review, which is one computer's own decision, so two computers write
// the same bytes for the same item.
function writeMapping(carried,m){
  const text=JSON.stringify({path:m.path,file:carriedName(m.sha256,m.path),sha256:m.sha256,size:m.size,contentType:m.contentType,
    ...(m.extractedText?{extractedText:m.extractedText}:{}),...(m.removed_at?{removed_at:m.removed_at}:{})},null,2)+'\n',file=path.join(carried,mappingName(m.path));
  let old=null;try{old=fs.readFileSync(file,'utf8');}catch{}
  if(old===text)return 0;
  writeWhole(file,text);return 1;
}

// The item saved under `original`: its mapping, the file to read and whether
// it was removed, or null. The carried copy decides; the media root's removal
// still counts for the same content, so an item removed on a computer that has
// not carried it yet stays removed.
export function findMedia({mediaRoot,carried},original){
  const own=readCarried(carried,original),root=readRoot(mediaRoot,original);
  if(!own&&!root)return null;
  const same=!!root&&(!own||root.sha256===own.sha256),removed=!!(own?.removed_at||(same&&root.removed_at));
  const ownFile=own&&path.join(carried,carriedName(own.sha256,own.path));
  const file=ownFile&&fs.existsSync(ownFile)?ownFile:same?path.join(mediaRoot,mediaFileName(root.file)):ownFile;
  return {mapping:own||root,file,removed};
}
// Keeps a copy of an item in the notebook. Returns the number of files written.
// Content too large to carry retires an older carried copy at the same path,
// so it is not served in place of the new content and the item counts as kept
// on this computer only.
export function keepMedia(carried,mapping,data){
  if(data.length>CARRY_LIMIT){fs.rmSync(path.join(carried,mappingName(mapping.path)),{force:true});return 0;}
  const file=path.join(carried,carriedName(mapping.sha256,mapping.path));let written=0;
  if(!fs.existsSync(file)){writeWhole(file,data);written++;}
  return written+writeMapping(carried,mapping);
}
export function removeCarried(carried,original,at){
  const own=readCarried(carried,original);
  if(own&&!own.removed_at)writeMapping(carried,{...own,removed_at:at});
  return !!own;
}
// Copies every item in the media root that is not yet carried, and a removal
// made before it was. Nothing in the media root changes. It keeps no record of
// having run: what a backup restore, an import or a paired computer puts in
// the media root later is carried the same way, and a run with nothing to do
// copies nothing.
export function carryMedia({mediaRoot,carried}){
  let copied=0,names=[];try{names=fs.readdirSync(mediaRoot).filter(n=>n.endsWith('.mapping.json'));}catch{}
  for(const name of names){
    const root=readJson(path.join(mediaRoot,name));if(!root||typeof root.path!=='string'||!SHA.test(String(root.sha256)))continue;
    const own=readCarried(carried,root.path);
    if(root.removed_at){if(own&&!own.removed_at&&own.sha256===root.sha256)copied+=writeMapping(carried,{...own,removed_at:root.removed_at});continue;}
    if(own&&(own.removed_at||own.sha256!==root.sha256||fs.existsSync(path.join(carried,carriedName(own.sha256,own.path)))))continue;
    let file;try{file=path.join(mediaRoot,mediaFileName(root.file));if(fs.statSync(file).size>CARRY_LIMIT)continue;}catch{continue;}
    const data=fs.readFileSync(file);if(hash(data)!==root.sha256)continue;
    copied+=keepMedia(carried,own||root,data);
  }
  return {copied};
}
// The items too large to carry, which stay on this computer only.
export function keptHere({mediaRoot,carried}){
  let names=[];try{names=fs.readdirSync(mediaRoot).filter(n=>n.endsWith('.mapping.json'));}catch{}
  return names.map(name=>readJson(path.join(mediaRoot,name))).filter(m=>m&&typeof m.path==='string'&&!m.removed_at&&m.size>CARRY_LIMIT&&!readCarried(carried,m.path)).map(m=>({path:m.path,size:m.size}));
}
