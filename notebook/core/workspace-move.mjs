import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {Store,hash,atomic} from './records/store.mjs';import {backup,restoreSeparateCopy} from './archives.mjs';import {SearchIndex} from './index/search.mjs';
const readJSON=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const normalized=file=>process.platform==='win32'?path.resolve(file).toLowerCase():path.resolve(file);
function noLinks(file){let current=path.resolve(file);for(;;){if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())throw Error('The selected physical move paths must not use symbolic links');const parent=path.dirname(current);if(parent===current)return;current=parent;}}
function contained(file,root){const relative=path.relative(root,file);return relative&&!relative.startsWith('..')&&!path.isAbsolute(relative);}
function inventory(root){
 const result={};function visit(folder){for(const entry of fs.readdirSync(folder,{withFileTypes:true})){const file=path.join(folder,entry.name),relative=path.relative(root,file).replaceAll('\\','/');if(relative==='.godspeed/workspace.lock')continue;if(entry.isSymbolicLink())throw Error('The workspace contains a linked folder or file; review it before moving');if(entry.isDirectory())visit(file);else if(entry.isFile())result[relative]=hash(fs.readFileSync(file));}}
 visit(root);return result;
}
function sameFiles(expected,actual){const keys=Object.keys(expected).sort();return keys.length===Object.keys(actual).length&&keys.every(key=>expected[key]===actual[key]);}
function stopped(root){const file=path.join(root,'.godspeed','supervisor.json');if(!fs.existsSync(file))return;const state=readJSON(file);for(const pid of [state.pid,state.child_pid].filter(Number.isInteger)){try{process.kill(pid,0);}catch(error){if(error.code==='ESRCH')continue;throw error;}throw Error('Stop only this installation’s notebook and assistant before its physical move');}}
function setup(root,installationFile){
 if(!installationFile)throw Error('Select this installation’s actual installation.json before planning a move');
 const file=path.resolve(installationFile);noLinks(file);const config=readJSON(file);
 if(contained(file,path.resolve(root)))throw Error('The installation pointer and move receipts must live outside the workspace');
 if(config.channel!=='full-alpha'||config.dataFormat!==1||normalized(config.workspace)!==normalized(root))throw Error('The installation pointer does not own the selected test workspace');
 return {file,config,config_hash:hash(fs.readFileSync(file))};
}
export function planWorkspaceMove({root,to,installationFile}){
 const source=path.resolve(root),destination=path.resolve(to||'');noLinks(source);noLinks(destination);const selected=setup(source,installationFile);
 if(!to||normalized(source)===normalized(destination)||contained(destination,source)||contained(source,destination)||fs.existsSync(destination))throw Error('Choose an absent destination outside the current workspace');
 if(contained(selected.file,destination))throw Error('The installation pointer must also live outside the destination');
 if(!fs.existsSync(path.join(source,'FULL-ALPHA.md'))||!fs.existsSync(path.join(source,'records')))throw Error('Only the selected isolated test workspace can be moved by this helper');
 const files=inventory(source);let active=false;try{stopped(source);}catch{active=true;}
 return {format:1,source,destination,installation_file:selected.file,installation_hash:selected.config_hash,files,file_count:Object.keys(files).length,files_hash:hash(Object.entries(files).sort(([a],[b])=>a.localeCompare(b))),requires_owned_stop:active,retains_original:true,old_path_alias:true,scope:'Only this selected workspace and its explicit installation pointer; other apps and sessions are untouched'};
}
export function moveWorkspace(plan){
 const fresh=planWorkspaceMove({root:plan.source,to:plan.destination,installationFile:plan.installation_file});
 if(fresh.installation_hash!==plan.installation_hash||fresh.files_hash!==plan.files_hash)throw Error('The reviewed move plan changed; preserve current work and make a fresh dry run');
 stopped(plan.source);const selected=setup(plan.source,plan.installation_file),store=new Store(plan.source),media=selected.config.media||path.join(store.state,'media');
 const id=Date.now()+'-'+randomUUID().slice(0,12),archive=path.join(store.state,'backups','move-'+id);backup(store,media,archive);const recovered=restoreSeparateCopy(store,archive);
 if(!recovered.verified)throw Error('The separate pre-move restoration did not verify');
 const retained=plan.source+'.retained-'+id,receiptFolder=path.join(path.dirname(selected.file),'workspace-moves',id);fs.mkdirSync(receiptFolder,{recursive:true});
 const receipt={format:1,id,state:'copying',source:plan.source,destination:plan.destination,retained_original:retained,installation_file:selected.file,installation_before:fs.readFileSync(selected.file,'utf8'),installation_before_hash:selected.config_hash,backup:archive,restoration:recovered.workspace,restoration_verified:true,records:recovered.records,at:new Date().toISOString()};
 const receiptFile=path.join(receiptFolder,'move.json');atomic(receiptFile,JSON.stringify(receipt,null,2));
 let captured;
 store.withLock(()=>{
  captured=inventory(plan.source);fs.mkdirSync(path.dirname(plan.destination),{recursive:true});fs.cpSync(plan.source,plan.destination,{recursive:true,errorOnExist:true,force:false,filter:file=>path.relative(plan.source,file).replaceAll('\\','/')!=='.godspeed/workspace.lock'});
  if(!sameFiles(captured,inventory(plan.destination))||!sameFiles(captured,inventory(plan.source)))throw Error('The copied workspace changed or its bytes differ; both copies are retained for review');
 });
 if(hash(fs.readFileSync(selected.file))!==selected.config_hash)throw Error('The installation pointer changed before the move; copied files are retained');
 const target=new Store(plan.destination);if(target.problems.length||target.records.size!==store.records.size)throw Error('The copied knowledge references did not verify; retain both folders');
 if(fs.existsSync(retained)||fs.existsSync(plan.destination+'.retained-'+id))throw Error('A retained move path already exists');
 fs.renameSync(plan.source,retained);
 try{fs.symlinkSync(plan.destination,plan.source,process.platform==='win32'?'junction':'dir');}catch(error){fs.renameSync(retained,plan.source);throw error;}
 receipt.state='alias-ready';receipt.copied_files=Object.keys(captured).length;atomic(receiptFile,JSON.stringify(receipt,null,2));
 const next={...selected.config,workspace:plan.destination};atomic(selected.file,JSON.stringify(next,null,2));receipt.installation_after_hash=hash(fs.readFileSync(selected.file));
 const index=new SearchIndex(target);try{index.rebuild();}finally{index.close();}
 if(normalized(fs.realpathSync(plan.source))!==normalized(plan.destination)||readJSON(selected.file).workspace!==plan.destination||target.scan().size!==receipt.records||target.problems.length)throw Error('The new workspace, old alias or installation pointer failed its final read-back');
 receipt.state='verified';receipt.verified_at=new Date().toISOString();atomic(receiptFile,JSON.stringify(receipt,null,2));return {...receipt,receipt_file:receiptFile};
}
export function undoWorkspaceMove(receiptFile){
 const file=path.resolve(receiptFile),receipt=readJSON(file);if(receipt.state!=='verified'||!receipt.restoration_verified)throw Error('Select the actual verified move receipt');
 const {source,destination}=receipt;if(!fs.lstatSync(source).isSymbolicLink()||normalized(fs.realpathSync(source))!==normalized(destination))throw Error('The old alias changed; retain it and review before undo');
 noLinks(destination);stopped(destination);const selected=setup(destination,receipt.installation_file);if(selected.config_hash!==receipt.installation_after_hash)throw Error('Installation settings changed after moving; review before undo');
 const store=new Store(destination),media=selected.config.media||path.join(store.state,'media'),id=Date.now()+'-'+randomUUID().slice(0,12),archive=path.join(store.state,'backups','undo-move-'+id);backup(store,media,archive);const recovered=restoreSeparateCopy(store,archive);
 if(!recovered.verified)throw Error('The separate pre-undo restoration did not verify');
 const copy=source+'.undo-copy-'+id,retained=destination+'.retained-'+id;let captured;
 store.withLock(()=>{captured=inventory(destination);fs.cpSync(destination,copy,{recursive:true,errorOnExist:true,force:false,filter:file=>path.relative(destination,file).replaceAll('\\','/')!=='.godspeed/workspace.lock'});if(!sameFiles(captured,inventory(copy))||!sameFiles(captured,inventory(destination)))throw Error('Undo copy changed; retain all copies for review');});
 if(hash(fs.readFileSync(selected.file))!==selected.config_hash)throw Error('The installation pointer changed during undo');
 // Remove only the verified owned link, never its target or any retained copy.
 fs.unlinkSync(source);
 try{fs.renameSync(copy,source);}catch(error){fs.symlinkSync(destination,source,process.platform==='win32'?'junction':'dir');throw error;}
 try{fs.renameSync(destination,retained);}catch(error){fs.renameSync(source,copy);fs.symlinkSync(destination,source,process.platform==='win32'?'junction':'dir');throw error;}
 try{fs.symlinkSync(source,destination,process.platform==='win32'?'junction':'dir');}catch(error){fs.renameSync(retained,destination);fs.renameSync(source,copy);fs.symlinkSync(destination,source,process.platform==='win32'?'junction':'dir');throw error;}
 atomic(selected.file,JSON.stringify({...selected.config,workspace:source},null,2));
 const current=new Store(source),index=new SearchIndex(current);try{index.rebuild();}finally{index.close();}
 if(current.problems.length||current.records.size!==recovered.records||normalized(fs.realpathSync(destination))!==normalized(source))throw Error('The undone workspace failed its final check; retained copies remain available');
 const result={...receipt,state:'undone',undone_at:new Date().toISOString(),undo_retained:retained,undo_backup:archive,undo_restoration:recovered.workspace,undo_records:recovered.records};atomic(file,JSON.stringify(result,null,2));return result;
}
