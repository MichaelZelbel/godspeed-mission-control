import fs from 'node:fs';
import path from 'node:path';
import {atomic,decode,hash,safe} from './records/store.mjs';
import {durable,isRecordPath} from './file-policy.mjs';

function retained(store,id){
  safe(id);const file=path.join(store.root,'conflicts',id+'.json');
  return {file,conflict:JSON.parse(fs.readFileSync(file,'utf8'))};
}
// A review of a copy: a second file with the identity of a record (a page
// duplicated in Obsidian that the owner's Git brought). It is about that
// file alone. Until 7 October 2026 the identity led to the original, so
// keeping this machine's version (no copy) removed the original note, and
// taking the other version wrote the copy over it.
const isCopy=conflict=>conflict.kind==='git'&&(!!conflict.copy_of||conflict.reason==='Duplicate UUID');
// The record a saved file conflict is about, found by the uid in any of its
// versions: its file may have been renamed since the conflict was saved.
function conflictRecord(store,conflict){
  if(conflict.kind!=='git'||conflict.encoding==='base64'||!isRecordPath(conflict.path)||isCopy(conflict))return null;
  store.scan();
  for(const text of [conflict.local,conflict.remote,conflict.base]){
    if(typeof text!=='string')continue;
    let uid;try{uid=decode(text,conflict.path).uid;}catch{continue;}
    const key=store.keyOfUid?.get(uid);if(key)return store.records.get(key);
  }
  return null;
}
const isRecord=(bytes,file)=>{if(!bytes)return false;try{decode(bytes.toString('utf8'),file);return true;}catch{return false;}};
function targetFor(store,conflict,assistantPath){
  let target,allowed;
  if(conflict.kind==='assistant-skill'){
    const descriptor=JSON.parse(fs.readFileSync(assistantPath,'utf8').replace(/^\uFEFF/,''));
    allowed=path.resolve(descriptor.home,'skills');target=path.resolve(conflict.target);
  }else if(conflict.kind==='git'){
    if(!durable(conflict.path))throw Error('Conflict target is not durable state');
    const record=conflictRecord(store,conflict);
    allowed=store.root;target=record?store.file(record):path.resolve(store.root,conflict.path);
  }else if(conflict.kind==='stale-write'){
    const record=store.get(conflict.type,conflict.record_id);
    if(!record)throw Error('The current record is missing; retain the conflict for review');
    allowed=store.root;target=store.file(record);
  }else throw Error('Unsupported saved conflict');
  if(!target.startsWith(allowed+path.sep))throw Error('Conflict target is outside its workspace');
  const existing=fs.existsSync(target)?target:path.dirname(target);
  const realExisting=fs.realpathSync(existing),realAllowed=fs.realpathSync(allowed);
  if(realExisting!==realAllowed&&!realExisting.startsWith(realAllowed+path.sep))throw Error('Conflict target crosses a linked folder');
  if(fs.existsSync(target)&&fs.lstatSync(target).isSymbolicLink())throw Error('Conflict target is a linked file');
  return target;
}
export function conflictView(store,id,{assistantPath}={}){
  const {conflict}=retained(store,id),target=targetFor(store,conflict,assistantPath);
  const bytes=fs.existsSync(target)?fs.readFileSync(target):null;
  const binary=bytes&&(bytes.includes(0)||!Buffer.from(bytes.toString('utf8')).equals(bytes));
  return {...conflict,current_hash:bytes?hash(bytes):null,current_encoding:binary?'base64':'utf8',current:bytes?bytes.toString(binary?'base64':'utf8'):null};
}
export function resolveSavedConflict(store,{id,choice,text,expected_hash},{assistantPath,legacyLocalCheck=false}={}){
  return store.withLock(()=>{
    const {file,conflict}=retained(store,id);if(conflict.resolved_at)return conflict;
    if(!['current','local','remote','merged'].includes(choice))throw Error('Choose the current version, a retained version or a merged edit');
    const target=targetFor(store,conflict,assistantPath),before=fs.existsSync(target)?fs.readFileSync(target):null,currentHash=before?hash(before):null;
    if(expected_hash===undefined){
      if(!legacyLocalCheck||choice==='current')throw Error('Reload the current version before resolving this conflict');
      const original=conflict.encoding==='base64'?Buffer.from(conflict.local||'','base64'):Buffer.from(conflict.local||'');
      const same=before&&(before.equals(original)||conflict.encoding!=='base64'&&before.toString('utf8').replaceAll('\r\n','\n')===original.toString('utf8').replaceAll('\r\n','\n'));
      if(!same)throw Error('This file changed again; reload and compare its current version');
    }else if(expected_hash!==currentHash)throw Error('This file changed again; reload and compare its current version');
    if(choice==='current'&&!before)throw Error('The current file is missing; retain the conflict for review');
    let selected=choice==='current'?before:choice==='merged'?text:conflict[choice];
    // A retained version that is missing is a removal (the file was deleted on
    // one of the machines), and choosing it removes the file here too: a
    // record becomes a tombstone, as the notebook's remove makes one, so
    // references to it stay valid and the removal reaches every machine.
    // Until 6 October 2026 a removal could not be chosen at all.
    const removal=(selected===null||selected===undefined)&&conflict.kind==='git'&&['local','remote'].includes(choice)&&Object.hasOwn(conflict,choice);
    if(!removal&&(selected===null||selected===undefined))throw Error('A missing retained version cannot replace a saved file');
    // A copy cannot be taken as it is: two files with one identity stop every save.
    if(isCopy(conflict)&&['remote','merged'].includes(choice))throw Error('This page is a copy of '+(conflict.copy_of||'another page')+' with the same identity, so it cannot be taken as it is. Keep this machine\'s version, and delete the copy on the machine that made it.');
    if(!removal&&choice!=='current'&&conflict.encoding==='base64'){
      if(choice==='merged')throw Error('Choose a retained binary version; text merging is unavailable for binary files');
      selected=Buffer.from(selected,'base64');if(hash(selected)!==conflict.digests?.[choice])throw Error('Retained binary conflict version failed its integrity check');
    }
    // Save the actual version reviewed as well as both older edits. A choice
    // of current is an acknowledgement and never rewrites that file.
    const resolved={...conflict,resolved_at:new Date().toISOString(),choice,reviewed_hash:currentHash,reviewed_encoding:before&&(before.includes(0)||!Buffer.from(before.toString('utf8')).equals(before))?'base64':'utf8'};
    resolved.reviewed_current=before?before.toString(resolved.reviewed_encoding):null;
    // Keeping this machine's version of a copy changes no record: a copy here
    // is only its own file, deleted when there is none on this machine's side.
    if(isCopy(conflict)){if(removal&&before)store.publishFiles([{file:conflict.path,delete:true}]);}
    else if(removal){
      const record=before&&isRecordPath(conflict.path)&&isRecord(before,target)?decode(before.toString('utf8'),target):null;
      if(record?.type==='moments')throw Error('Events are append-only; add a correction event');
      if(record)store.commit([store.prepare(record.type,{removed_at:record.removed_at||new Date().toISOString()},store.get(record.type,record.id))]);
      else if(before)store.publishFiles([{file:conflict.path,delete:true}]);
    }else if(choice!=='current'){
      if(conflict.kind==='stale-write'){
        const value=typeof selected==='string'?JSON.parse(selected):selected;
        const current=store.get(conflict.type,conflict.record_id);
        if(value.id!==conflict.record_id||value.uid!==current.uid)throw Error('A merged edit must keep the original record identity');
        if(conflict.type==='moments')throw Error('Events are append-only; add a correction event');
        store.commit([store.prepare(conflict.type,value,current)]);
      }else if(conflict.kind==='git'&&isRecordPath(conflict.path)&&isRecord(before,target)){
        const value=decode(Buffer.isBuffer(selected)?selected.toString('utf8'):selected,target),current=decode(before.toString('utf8'),target);
        if(value.id!==current.id||value.uid!==current.uid||value.type!==current.type)throw Error('A merged edit must keep the original record identity');
        if(current.type==='moments')throw Error('Events are append-only; add a correction event');
        store.commit([store.prepare(current.type,value,store.get(current.type,current.id))]);
      }else{
        if(typeof selected!=='string'&&!Buffer.isBuffer(selected))throw Error('Choose a saved file or provide merged text');
        if(conflict.kind==='assistant-skill'){
          atomic(path.join(store.root,'skills/package-history',hash(target),currentHash+'.txt'),before);atomic(target,selected);
        }else store.publishFiles([{file:conflict.path,text:selected}]);
      }
    }
    atomic(file,JSON.stringify(resolved,null,2));return resolved;
  });
}
