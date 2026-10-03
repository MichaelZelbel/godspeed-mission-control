import fs from 'node:fs';
import path from 'node:path';
import {Store,hash,atomic} from './records/store.mjs';
import {backup} from './archives.mjs';
import {verifyBundle} from './migration.mjs';

export const workspaceDigest=store=>hash([...store.scan().values()].map(r=>[r.type,r.id,r._hash]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
export function planMerge(store,staged,mediaRoot){
  store.scan();const incoming=new Store(staged),existing=[...store.records.values()];
  if(store.problems.length||incoming.problems.length)throw new Error('Some stored relationships need repair before importing. Your content has not been changed.');
  const identities=new Map(),uids=new Map(existing.map(r=>[r.uid,r]));
  for(const record of existing)for(const alias of [record.id,...record.aliases||[]])identities.set(record.type+'/'+alias.toLowerCase(),record);
  const selected=[],resolved=new Map();let skipped=0;
  for(const record of incoming.records.values()){
    const matches=[...new Set([uids.get(record.uid),...([record.id,...record.aliases||[]].map(id=>identities.get(record.type+'/'+id.toLowerCase())))].filter(Boolean))];
    if(matches.length>1||matches.some(r=>r.type!==record.type))throw new Error('An imported identity matches more than one existing item. Your content has not been changed.');
    if(matches.length){skipped++;resolved.set(record.uid,matches[0]);continue;}
    const next=structuredClone(record);delete next._hash;next.device=store.device;
    // Imported schedules never start executing merely because content was copied.
    if(next.type==='jobs'){next.enabled=false;next.paused=true;}
    selected.push(next);resolved.set(record.uid,next);
  }
  for(const record of selected)for(const ref of record.references||[]){
    const target=resolved.get(ref.uid);
    if(target){ref.uid=target.uid;if(![target.id,...target.aliases||[]].includes(ref.id)){
      // A collision with a different identity is never silently rewired.
      throw new Error('An imported relationship conflicts with an existing item. Your content has not been changed.');
    }}
  }
  const problems=store.validateReferences([...existing,...selected]);
  if(problems.length)throw new Error('Some imported relationships could not be preserved. Your content has not been changed.');
  const stagedMedia=path.join(incoming.state,'media'),media=[];
  if(fs.existsSync(stagedMedia))for(const name of fs.readdirSync(stagedMedia)){
    const source=path.join(stagedMedia,name),destination=path.join(mediaRoot,name);
    if(fs.existsSync(destination)){if(hash(fs.readFileSync(source))!==hash(fs.readFileSync(destination)))throw new Error('An attachment conflicts with an existing file. Your content has not been changed.');}
    else media.push({name,sha256:hash(fs.readFileSync(source))});
  }
  const report=JSON.parse(fs.readFileSync(path.join(incoming.state,'migration-report.json'),'utf8'));
  const notes=selected.filter(r=>r.type==='notes'&&!r.removed_at),contacts=selected.filter(r=>r.type==='contacts'&&!r.removed_at);
  // Detect changes to what would be added, rather than unrelated preferences or
  // existing edits that are already protected by the keep-current policy.
  const digest=hash({records:selected.map(r=>[r.type,r.id,hash(r)]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),media});
  return {digest,records:selected,media,summary:{notes:notes.filter(r=>!r.is_trashed).length,trashedNotes:notes.filter(r=>r.is_trashed).length,contacts:contacts.length,attachments:report.media,items:selected.length,keptExisting:skipped,archivedTables:report.archivedTables.filter(t=>t.count).length}};
}
export function applyMerge({root,device,staged,bundle,mediaRoot,jobRoot,digest}){
  verifyBundle(bundle);const store=new Store(root,{device});
  let plan=planMerge(store,staged,mediaRoot);
  if(plan.digest!==digest)throw new Error('Your content changed since the preview. Preview again before importing.');
  const snapshot=path.join(jobRoot,'backup');backup(store,mediaRoot,snapshot);
  const created=[];
  try{
    store.withLock(()=>{
      plan=planMerge(store,staged,mediaRoot);
      if(plan.digest!==digest)throw new Error('Your content changed since the preview. Preview again before importing.');
      fs.mkdirSync(mediaRoot,{recursive:true});
      for(const entry of plan.media){
        const source=path.join(staged,'.godspeed/media',entry.name),destination=path.join(mediaRoot,entry.name);
        if(hash(fs.readFileSync(source))!==entry.sha256)throw new Error('An attachment failed verification. Preview again before importing.');
        fs.copyFileSync(source,destination,fs.constants.COPYFILE_EXCL);created.push(destination);
      }
      store.commit(plan.records);
    });
  }catch(error){
    // Recover any durable transaction before deciding whether media is referenced.
    store.withLock(()=>store.recover());store.scan();
    const committed=plan.records.some(r=>store.records.has(r.type+'/'+r.id));
    if(!committed)for(const file of created)fs.unlinkSync(file);
    throw error;
  }
  store.scan();if(store.problems.length)throw new Error('The imported copy needs review. Your backup has been retained.');
  const receipt={...plan.summary,completedAt:new Date().toISOString(),backupSaved:true,sourceUnchanged:true};
  atomic(path.join(jobRoot,'receipt.json'),JSON.stringify(receipt));return receipt;
}
