import fs from 'node:fs';
import path from 'node:path';
import {atomic,decode,hash,safe} from './records/store.mjs';
import {durable,isRecordPath} from './file-policy.mjs';

function retained(store,id){
  safe(id);const file=path.join(store.root,'conflicts',id+'.json');
  return {file,conflict:JSON.parse(fs.readFileSync(file,'utf8'))};
}
function targetFor(store,conflict,assistantPath){
  let target,allowed;
  if(conflict.kind==='assistant-skill'){
    const descriptor=JSON.parse(fs.readFileSync(assistantPath,'utf8').replace(/^\uFEFF/,''));
    allowed=path.resolve(descriptor.home,'skills');target=path.resolve(conflict.target);
  }else if(conflict.kind==='git'){
    if(!durable(conflict.path))throw Error('Conflict target is not durable state');
    allowed=store.root;target=path.resolve(store.root,conflict.path);
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
    if(selected===null||selected===undefined)throw Error('A missing retained version cannot replace a saved file');
    if(choice!=='current'&&conflict.encoding==='base64'){
      if(choice==='merged')throw Error('Choose a retained binary version; text merging is unavailable for binary files');
      selected=Buffer.from(selected,'base64');if(hash(selected)!==conflict.digests?.[choice])throw Error('Retained binary conflict version failed its integrity check');
    }
    // Save the actual version reviewed as well as both older edits. A choice
    // of current is an acknowledgement and never rewrites that file.
    const resolved={...conflict,resolved_at:new Date().toISOString(),choice,reviewed_hash:currentHash,reviewed_encoding:before&&(before.includes(0)||!Buffer.from(before.toString('utf8')).equals(before))?'base64':'utf8'};
    resolved.reviewed_current=before?before.toString(resolved.reviewed_encoding):null;
    if(choice!=='current'){
      if(conflict.kind==='stale-write'){
        const value=typeof selected==='string'?JSON.parse(selected):selected;
        const current=store.get(conflict.type,conflict.record_id);
        if(value.id!==conflict.record_id||value.uid!==current.uid)throw Error('A merged edit must keep the original record identity');
        if(conflict.type==='moments')throw Error('Events are append-only; add a correction event');
        store.commit([store.prepare(conflict.type,value,current)]);
      }else if(conflict.kind==='git'&&isRecordPath(conflict.path)){
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
