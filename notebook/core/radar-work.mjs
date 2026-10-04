import fs from 'node:fs';
import {hash} from './records/store.mjs';
import {localPath} from './local-path.mjs';
import {recipeContext} from './recipe-context.mjs';
import {visibleRows} from './visibility.mjs';

const json=value=>typeof value==='string'?JSON.parse(value.replace(/^```(?:json)?\s*|\s*```$/g,'')):value;
function selected({store,query},id){
 const proposal=visibleRows(query,'notes').find(n=>n.id===id&&n.source_app==='radar'&&n.radar);
 if(!proposal||!['Adopt','Trial'].includes(proposal.radar.verdict))throw Error('Choose an adopted proposal or a current trial');
 const item=store.get('work_items',proposal.radar.implementation_work_id);
 if(!item||item.kind!=='radar-implementation'||item.decision_id!==proposal.radar.decision_id)throw Error('The current radar implementation task is missing');
 return {proposal,item};
}
function method(store,file){
 if(typeof file!=='string'||!/^skills\/[a-z][a-z0-9-]{0,80}\/SKILL\.md$/.test(file))throw Error('Choose one installed workflow SKILL.md in this workspace');
 const path=localPath(store.root,file);if(!fs.existsSync(path)||!fs.lstatSync(path).isFile())throw Error('This workflow is not installed in the selected workspace');
 const content=fs.readFileSync(path,'utf8');if(Buffer.byteLength(content)>65536)throw Error('This workflow exceeds the supported edit size');
 return {file,path,content,sha256:hash(content),workflow:recipeContext(store,file.split('/')[1])};
}
function requireCurrent(proposal,input){if(input.proposal_hash!==proposal._hash)throw Error('The radar proposal changed; read its current version before preparing or approving work');}
function schedule(store,kind,item){
 const id=kind+'-'+item.id,old=store.get('jobs',id);
 return store.prepare('jobs',{id,kind,work_id:item.id,owner:store.get('settings','installation')?.owner||store.device,paused:false,state:'pending',next_run:new Date().toISOString(),interval_ms:86400000},old);
}
function requireJob(store,job,kind,item){
 const current=store.get('jobs',job.id),owner=store.get('settings','installation')?.owner||store.device;
 if(!current||current.kind!==kind||current.work_id!==item.id||current.owner!==owner||owner!==store.device||current.paused)throw Error('The selected workflow task has no active job owned by this installation');
}

export function radarWorkCommand(context,command,id,input){
 const {store}=context;
 let chosen;
 if(command==='rollback'){
  const proposal=visibleRows(context.query,'notes').find(n=>n.id===id&&n.source_app==='radar'&&n.radar),item=store.get('work_items',input.work_id||proposal?.radar.implementation_work_id);
  if(!proposal||!item||item.kind!=='radar-implementation'||item.source_note_id!==proposal.id)throw Error('Choose the actual applied task belonging to this radar proposal');chosen={proposal,item};
 }else chosen=selected(context,id);
 const {proposal,item}=chosen;
 if(command==='method')return {...method(store,input.file),proposal_id:id,proposal_hash:proposal._hash};
 requireCurrent(proposal,input);
 if(command==='prepare'){
  const currentMethod=method(store,input.file);if(input.file_hash!==currentMethod.sha256)throw Error('The selected workflow changed; read its current file before preparing a draft');
  if(['attempted','verified'].includes(item.state))throw Error('This implementation has already started; review or roll it back before preparing different work');
  if(item.preparation?.proposal_hash===proposal._hash&&item.preparation?.file_hash===currentMethod.sha256&&item.preparation?.workflow_hash===hash(currentMethod.workflow)){
   const oldDraft=item.draft_id&&visibleRows(context.query,'notes').find(n=>n.id===item.draft_id),oldJob=store.get('jobs','radar-prepare-'+item.id);
   if(item.state==='awaiting_approval'&&oldDraft?.implementation?.verified&&hash(oldDraft.content||'')===oldDraft.implementation.content_hash)return {work_id:item.id,state:item.state,draft_id:item.draft_id,replayed:true};
   if(item.state==='preparing'&&oldJob&&!oldJob.paused&&oldJob.state!=='needs_review')return {work_id:item.id,state:item.state,draft_id:null,replayed:true};
  }
  return store.withLock(()=>{
   if(store.get('notes',id)._hash!==proposal._hash||store.get('work_items',item.id)._hash!==item._hash||method(store,input.file).sha256!==currentMethod.sha256)throw Error('The proposal, task or workflow changed during preparation');
   const prepared=store.prepare('work_items',{state:'preparing',allowed_action:'prepare-workflow-draft',preparation:{file:input.file,file_hash:currentMethod.sha256,workflow_hash:hash(currentMethod.workflow),proposal_hash:proposal._hash},draft_id:null,approval:null,error:null},item);
   store.commit([prepared,schedule(store,'radar-prepare',item)]);return {work_id:item.id,state:'preparing',file:input.file};
  });
 }
 if(command==='allow'){
  const draft=visibleRows(context.query,'notes').find(n=>n.id===input.draft_id&&n.source_app==='radar-implementation-draft'&&n.work_id===item.id);
  if(item.state!=='awaiting_approval'||!draft||draft._hash!==input.draft_hash||item.draft_id!==draft.id||!draft.implementation?.verified)throw Error('Read the exact checked implementation draft before allowing its file change');
  const currentMethod=method(store,item.preparation?.file);
  if(input.file_hash!==currentMethod.sha256||currentMethod.sha256!==item.preparation.file_hash||hash(currentMethod.workflow)!==item.preparation.workflow_hash||proposal._hash!==item.preparation.proposal_hash)throw Error('The original workflow or proposal changed; this approval is stale');
  if(!draft.content.trim()||Buffer.byteLength(draft.content)>65536||hash(draft.content)!==draft.implementation.content_hash)throw Error('The prepared implementation content changed');
  return store.withLock(()=>{
   if(store.get('notes',id)._hash!==proposal._hash||store.get('notes',draft.id)._hash!==draft._hash||store.get('work_items',item.id)._hash!==item._hash||method(store,currentMethod.file).sha256!==currentMethod.sha256)throw Error('The implementation changed while approval was being saved');
   const approved=store.prepare('work_items',{state:'pending',allowed_action:'apply-workflow-draft',approval:{source:'user-radar-command',draft_id:draft.id,draft_hash:draft._hash,content_hash:hash(draft.content),file:currentMethod.file,file_hash:currentMethod.sha256,proposal_hash:proposal._hash,approved_at:new Date().toISOString(),expires_at:new Date(Date.now()+3600000).toISOString()}},item);
   store.commit([approved,schedule(store,'radar-work',item)]);return {work_id:item.id,state:'pending',file:currentMethod.file,approved_content_hash:hash(draft.content)};
  });
 }
 if(command==='rollback'){
  if(item.state!=='verified'||item.verification?.kind!=='applied-workflow')throw Error('Choose this task’s actual applied workflow change');
  const currentMethod=method(store,item.verification.file);
  if(input.file_hash!==currentMethod.sha256||currentMethod.sha256!==item.verification.content_hash)throw Error('The workflow changed after implementation; preserve that edit and review before rollback');
  const originalPath=localPath(store.root,item.verification.rollback_file),original=fs.readFileSync(originalPath,'utf8');
  if(hash(original)!==item.verification.original_hash)throw Error('The retained rollback source changed');
  return store.withLock(()=>{
   if(store.get('notes',id)._hash!==proposal._hash||store.get('work_items',item.id)._hash!==item._hash||method(store,currentMethod.file).sha256!==currentMethod.sha256)throw Error('The workflow or task changed before rollback');
   store.commit([store.prepare('work_items',{state:'rolled_back',rolled_back_at:new Date().toISOString(),rollback_evidence:{file:currentMethod.file,restored_hash:hash(original)}},item),store.prepare('notes',{radar:{...proposal.radar,lifecycle:'rolled-back'}},proposal)],{files:[{file:currentMethod.file,text:original},{file:'skills/history/'+hash([item.id,currentMethod.sha256])+'.md',text:currentMethod.content}]});
   if(hash(fs.readFileSync(currentMethod.path))!==hash(original))throw Error('Rolled back workflow failed read-back');return {work_id:item.id,state:'rolled_back',file:currentMethod.file};
  });
 }
 throw Error('Choose method, prepare, allow or rollback');
}

export async function prepareRadarWork(job,{store,query,provider}){
 const item=store.get('work_items',job.work_id);if(item?.state!=='preparing'||item.allowed_action!=='prepare-workflow-draft')return {verified:true,silent:true,reason:'No selected workflow preparation'};
 requireJob(store,job,'radar-prepare',item);
 if(!provider)throw Error('Connect an assistant before preparing the selected workflow change');
 const {proposal}=selected({store,query},item.source_note_id),currentMethod=method(store,item.preparation.file);
 if(proposal._hash!==item.preparation.proposal_hash||currentMethod.sha256!==item.preparation.file_hash||hash(currentMethod.workflow)!==item.preparation.workflow_hash)throw Error('The approved preparation source changed');
 const source=visibleRows(query,'watch_observations').find(r=>r.id===proposal.radar.source_observation_id);
 if(!source||!source.content?.includes(proposal.radar.quote))throw Error('The radar proposal’s actual fetched source is unavailable');
 // The controlled worker performs these exact reads; model claims cannot replace them.
 const read=store.save('work_tool_receipts',{work_id:item.id,tool:'read_workflow',state:'verified',request:{file:currentMethod.file},result_hash:hash(currentMethod.workflow),source_observation_id:source.id});
 const context={proposal:{id:proposal.id,...proposal.radar},source:{id:source.id,url:source.url,content:source.content},current_workflow:currentMethod.workflow,selected_file:{file:currentMethod.file,content:currentMethod.content,sha256:currentMethod.sha256},tool_results:[{tool:'read_workflow',receipt_id:read.id,sha256:hash(currentMethod.workflow)}]};
 const response=json(await provider({kind:'radar-implementation-draft',context,contract:'Prepare only the selected reversible workflow change from the actual proposal and fetched source. The read_workflow tool already read the complete current method and references. Return JSON {edits:[{old:string,new:string}],reason:string}; each old text must occur exactly once in selected_file.content. At most ten precise replacements, preserving all unrelated method behavior. No shell, installation, sends, purchases or invented SDK behavior. This prepares a draft only; the user separately approves the exact finished text before any workflow file changes.'}));
 await store.waitForWriter();
 if(!Array.isArray(response?.edits)||!response.edits.length||response.edits.length>10||typeof response.reason!=='string'||!response.reason.trim())throw Error('Implementation draft needs bounded exact edits and a reason');
 let content=currentMethod.content;
 let replaced=0;
 for(const edit of response.edits){if(typeof edit.old!=='string'||!edit.old||typeof edit.new!=='string'||edit.old.length>1024||content.split(edit.old).length!==2)throw Error('Implementation edit must replace one unique existing passage of at most 1024 characters');replaced+=edit.old.length;content=content.replace(edit.old,()=>edit.new);}
 if(replaced>currentMethod.content.length/4)throw Error('A prepared experiment must preserve at least three quarters of the original method text');
 if(!content.trim()||content===currentMethod.content||Buffer.byteLength(content)>65536)throw Error('Implementation draft is empty, unchanged or too large');
 const verdict=json(await provider({kind:'radar-implementation-verification',context:{...context,proposed_content:content,edits:response.edits},contract:'Independently check the actual proposed method against the current full method, exact radar proposal and fetched primary evidence. Return JSON {passed:boolean,evidence:string}. Fail unrelated changes, lost original safeguards or behavior, claims absent from the actual source, unimplemented installation claims, changed approval boundaries or an unmet proposal completion check. This verifies a proposed text change, not its later measured benefit.'}));
 await store.waitForWriter();if(verdict?.passed!==true||typeof verdict.evidence!=='string'||!verdict.evidence.trim())throw Error('Implementation preparation check failed: '+(verdict?.evidence||'no accepted evidence'));
 return store.withLock(()=>{
  const live=store.get('work_items',item.id);if(live._hash!==item._hash||store.get('notes',proposal.id)._hash!==proposal._hash||method(store,currentMethod.file).sha256!==currentMethod.sha256||hash(method(store,currentMethod.file).workflow)!==item.preparation.workflow_hash||store.get('watch_observations',source.id)._hash!==source._hash)throw Error('The proposal, method or source changed during preparation');
  const draft=store.prepare('notes',{title:'Proposed workflow change: '+proposal.title,content,source_app:'radar-implementation-draft',work_id:item.id,proposal_id:proposal.id,implementation:{verified:true,file:currentMethod.file,original_hash:currentMethod.sha256,content_hash:hash(content),edits:response.edits,reason:response.reason,verification_evidence:verdict.evidence,source_observation_id:source.id,source_hash:source._hash}});
  store.commit([draft,store.prepare('work_items',{state:'awaiting_approval',allowed_action:null,draft_id:draft.id,draft_content_hash:hash(content)},live),store.prepare('jobs',{paused:true},store.get('jobs',job.id))]);return {verified:true,record_id:draft.id,work_id:item.id,delivery:'notebook',requires_exact_approval:true};
 });
}

export async function applyRadarWork(job,{store,query}){
 const item=store.get('work_items',job.work_id);if(item?.state==='verified')return {verified:true,silent:true,reason:'The exact workflow change was already applied'};
 if(item?.state==='attempted')throw Error('This workflow application was interrupted after starting; review its retained files before any retry');
 if(item?.state!=='pending'||item.allowed_action!=='apply-workflow-draft')return {verified:true,silent:true,reason:'No exactly approved workflow change'};
 requireJob(store,job,'radar-work',item);
 const {proposal}=selected({store,query},item.source_note_id),approval=item.approval,draft=store.get('notes',item.draft_id);
 if(!approval||Date.parse(approval.expires_at)<=Date.now()||approval.proposal_hash!==proposal._hash||draft?._hash!==approval.draft_hash||hash(draft?.content||'')!==approval.content_hash)throw Error('Workflow approval expired or its exact proposal/draft changed');
 const currentMethod=method(store,approval.file),source=store.get('watch_observations',draft.implementation.source_observation_id);
 if(currentMethod.sha256!==approval.file_hash||hash(currentMethod.workflow)!==item.preparation.workflow_hash||source?._hash!==draft.implementation.source_hash)throw Error('The workflow or actual source changed after approval');
 const rollbackFile='skills/history/'+hash([item.id,currentMethod.sha256])+'.md';
 return store.withLock(()=>{
  const live=store.get('work_items',item.id);
  if(live._hash!==item._hash||store.get('notes',proposal.id)._hash!==proposal._hash||store.get('notes',draft.id)._hash!==draft._hash||method(store,currentMethod.file).sha256!==currentMethod.sha256||store.get('watch_observations',source.id)._hash!==source._hash)throw Error('The exact implementation permission or source changed before execution');
  const verification={kind:'applied-workflow',file:currentMethod.file,content_hash:approval.content_hash,original_hash:currentMethod.sha256,rollback_file:rollbackFile,draft_id:draft.id,evidence:draft.implementation.verification_evidence,at:new Date().toISOString()};
  store.commit([store.prepare('work_items',{state:'attempted',pending_verification:verification,result_id:draft.id},live)],{files:[{file:currentMethod.file,text:draft.content},{file:rollbackFile,text:currentMethod.content}]});
  if(hash(fs.readFileSync(currentMethod.path))!==approval.content_hash)throw Error('Applied workflow did not match its approved bytes');
  const records=[store.prepare('work_items',{state:'verified',verification,pending_verification:null},store.get('work_items',item.id)),store.prepare('notes',{radar:{...proposal.radar,lifecycle:'implemented',implementation_file:currentMethod.file}},proposal),store.prepare('work_tool_receipts',{work_id:item.id,tool:'apply_workflow',state:'verified',request:{file:currentMethod.file,approved_content_hash:approval.content_hash},result_hash:approval.content_hash}),store.prepare('jobs',{paused:true},store.get('jobs',job.id))];
  const trial=store.list('radar_trials').find(t=>t.work_id===item.id&&t.decision_id===item.decision_id);if(trial)records.push(store.prepare('radar_trials',{state:'running',implemented_at:verification.at},trial));store.commit(records);
  return {verified:true,work_id:item.id,record_id:draft.id,verification:'Approved workflow bytes and retained rollback were read back',file:currentMethod.file};
 });
}
