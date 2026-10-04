import {hash} from './records/store.mjs';
import {visibleRows} from './visibility.mjs';
import {goalContracts} from './goal-contracts.mjs';
import {dueCommand,dueDelivered} from './native-due.mjs';
import {personalOperation} from './personal-operations.mjs';
import {controlledWorker} from './controlled-worker.mjs';
export const adopted=g=>['adopted','active'].includes(g.status)&&!g.removed_at;
function structured(text){try{return typeof text==='object'?text:JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g,''));}catch{throw new Error('Decision must name an action, result kind and completion check');}}
export async function decide(job,{store,query,provider}){
 const goals=visibleRows(query,'goals').filter(adopted).sort((a,b)=>Date.parse(a.last_attention||a.created_at)-Date.parse(b.last_attention||b.created_at));
 const attention=goalContracts(store,query).plan(new Date().toISOString().slice(0,10),3),prioritised=[...attention.protected,...attention.active];
 const goal=job.goal_id?goals.find(g=>g.id===job.goal_id):goals.find(g=>g.id===prioritised[0]?.id)||goals[0];
 if(!goal)return {verified:true,silent:true,reason:'No adopted goal'};
 const pending=query.rows('work_items').find(w=>w.goal_id===goal.id&&(['pending','attempted','awaiting_approval','needs_review'].includes(w.state)||w.state==='failed'&&w.attempts<(w.max_attempts||3)));
 if(pending)return {verified:true,silent:true,work_id:pending.id,reason:'Existing work must finish or be reviewed first'};
 const decisionEvidence=hash({title:goal.title,own_words:goal.own_words,measure:goal.measure,playbook:goal.playbook,diagnosis:goal.diagnosis,progress:goal.progress,notes:visibleRows(query,'notes').filter(n=>!n.source_app||n.source_app==='conversation-chat').slice(-10).map(n=>[n.id,n._hash])});
 const waiting=visibleRows(query,'decisions').filter(d=>d.goal_id===goal.id&&d.state==='waiting').sort((a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at)).at(-1);
 const applied=visibleRows(query,'work_items').filter(w=>w.goal_id===goal.id&&w.state==='verified'&&w.verification?.kind==='applied-local-note'&&Number.isFinite(Date.parse(w.verification.at))).sort((a,b)=>String(a.verification.at).localeCompare(String(b.verification.at))).at(-1);
 const directionChanged=applied&&(goal.changes||[]).some(c=>c.at>applied.verification.at&&(c.before?.title!==goal.title||c.before?.measure!==goal.measure));
 const reportAfterChange=applied&&(goal.progress||[]).some(p=>(p.kind==='observed'||p.kind==='reported-observation')&&p.at>applied.verification.at);
 if(goal.wait_for_report&&applied&&!directionChanged&&!reportAfterChange){
  if(waiting?.wait_for_work_id===applied.id&&Date.parse(waiting.check_at)>Date.now())return {verified:true,silent:true,reason:waiting.reason};
  const reason='Waiting for your separate outcome report after the verified local change.';
  return store.withLock(()=>{const current=store.get('goals',goal.id);if(current._hash!==goal._hash||!adopted(current))throw Error('Goal changed before the outcome wait');const decision=store.prepare('decisions',{title:'Wait for the agreed outcome report',goal_id:goal.id,state:'waiting',reason,wait_for_work_id:applied.id,check_at:new Date(Date.now()+86400000).toISOString(),evidence_hash:decisionEvidence,job_id:job.id});store.commit([decision,store.prepare('goals',{last_attention:new Date().toISOString()},current)]);return {verified:true,silent:true,record_id:decision.id,reason};});
 }
 if(waiting?.evidence_hash===decisionEvidence&&Date.parse(waiting.check_at)>Date.now())return {verified:true,silent:true,reason:waiting.reason};
 if(!provider)throw Error('Connect an assistant before choosing goal work');
 const orderedWork=visibleRows(query,'work_items').filter(w=>w.goal_id===goal.id).sort((a,b)=>Date.parse(a.updated_at||a.created_at)-Date.parse(b.updated_at||b.created_at));
 const latestVerified=orderedWork.filter(w=>w.state==='verified'&&['draft','local-note'].includes(w.kind)).sort((a,b)=>Date.parse(a.verification?.at||a.updated_at)-Date.parse(b.verification?.at||b.updated_at)).at(-1);
 const latestReport=(goal.progress||[]).filter(p=>['observed','reported-observation'].includes(p.kind)).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)).at(-1);
 const available=visibleRows(query,'notes').filter(n=>!n.is_trashed),normalise=s=>String(s||'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim(),instructions=' '+normalise(goal.own_words||goal.title)+' ';
 const named=available.filter(n=>normalise(n.title).length>=8&&instructions.includes(' '+normalise(n.title)+' ')),currentDeliverable=latestVerified&&available.find(n=>n.id===(latestVerified.result_id||latestVerified.verification?.result_id));
 const context={goal,attention,previous:visibleRows(query,'decisions').filter(d=>d.goal_id===goal.id).sort((a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at)).slice(-5),work:orderedWork.slice(-10),forecasts:visibleRows(query,'forecasts').filter(f=>f.goal_id===goal.id),notes:named.length?named:available.sort((a,b)=>Date.parse(a.updated_at)-Date.parse(b.updated_at)).slice(-10),current_evidence:{latest_report:latestReport||null,latest_verified_change:latestVerified||null,current_deliverable:currentDeliverable?{id:currentDeliverable.id,title:currentDeliverable.title,content:currentDeliverable.content,_hash:currentDeliverable._hash}:null,policy:'Use the latest actual report and current saved result. Older defects are history unless the latest report says they still exist.'}};
 const contract='Choose one useful reversible action for the adopted goal using its current own words, measure, playbook, diagnosis and observed outcomes. Return JSON {action,kind:"draft"|"local-note"|"observation",check,reason,required_source_ids?:[visible saved note IDs],forecast?:{probability,measure,check_at}}. Name each saved source note whose actual reading is required by the current goal or completion check. Draft means a saved deliverable; local-note means an explicitly allowed local record edit; observation needs supplied measured evidence. Inspect prior verified work and progress: do not recreate or reapply an already completed deliverable without a concrete defect or changed requirement. When useful progress requires a real person or later measurement, return {kind:"wait",reason,check_at:ISO timestamp} instead of repeating the edit. No outward action. Never say an outcome happened because a draft exists.';
 let choice=structured(await provider({kind:'goal-decision',context,contract:contract+' Prioritise current_evidence.latest_report and the actual current_deliverable over earlier defects. A new local edit must describe the distinct correction supported by the latest actual report.'}));
 const repeats=c=>c.kind==='local-note'&&latestVerified?.kind==='local-note'&&normalise(c.action)===normalise(latestVerified.title);
 if(repeats(choice)){choice=structured(await provider({kind:'goal-decision',context,contract:contract+' Your previous choice repeated the identical completed local edit. No new work has been queued. Choose a distinct correction from the latest report, or wait; do not reapply that identical action.'}));if(repeats(choice))throw Error('A completed local edit was selected again instead of a distinct next action');}
 await store.waitForWriter();
 if(choice.kind==='wait'){if(!choice.reason?.trim()||!Number.isFinite(Date.parse(choice.check_at))||Date.parse(choice.check_at)<=Date.now()||Date.parse(choice.check_at)>Date.now()+30*86400000)throw Error('A waiting decision needs a reason and a future check within 30 days');}
 else if(!choice.action?.trim()||!choice.check?.trim()||!['draft','local-note','observation'].includes(choice.kind))throw Error('Decision omitted its action, supported result kind or completion check');
 if(choice.required_source_ids!==undefined&&(!Array.isArray(choice.required_source_ids)||choice.required_source_ids.length>12||choice.required_source_ids.some(id=>typeof id!=='string'||!visibleRows(query,'notes').some(n=>n.id===id&&!n.is_trashed))))throw Error('Decision required source notes must be visible saved notes');
 const current=store.get('goals',goal.id);if(current._hash!==goal._hash||!adopted(current))throw Error('Goal changed while the decision was being prepared');
 return store.withLock(()=>{
  const latest=store.get('goals',goal.id);if(latest._hash!==current._hash||!adopted(latest))throw Error('Goal changed before decision commit');
  if(store.list('work_items').some(w=>w.goal_id===goal.id&&['pending','attempted','awaiting_approval','needs_review'].includes(w.state)))return {verified:true,silent:true,reason:'Another decision already selected work'};
  if(choice.kind==='wait'){
    const decision=store.prepare('decisions',{title:'Wait for the agreed outcome check',goal_id:goal.id,goal_revision:goal.revision,state:'waiting',reason:choice.reason,check_at:choice.check_at,evidence_hash:decisionEvidence,job_id:job.id});
    store.commit([decision,store.prepare('goals',{last_attention:new Date().toISOString()},current)]);return {verified:true,silent:true,record_id:decision.id,reason:choice.reason};
  }
  const decision=store.prepare('decisions',{title:choice.action,goal_id:goal.id,goal_revision:goal.revision,reason:choice.reason,check:choice.check,kind:choice.kind,state:'selected',sources:context.notes.map(n=>({id:n.id,hash:n._hash})),job_id:job.id});
  const work=store.prepare('work_items',{title:choice.action,goal_id:goal.id,goal_revision:goal.revision,decision_id:decision.id,kind:choice.kind,check:choice.check,required_source_ids:choice.required_source_ids||[],state:choice.kind==='draft'?'pending':'awaiting_approval',allowed_action:choice.kind==='draft'?'save-draft':null,dependencies:[],attempts:0,max_attempts:3});
  const records=[decision,work,store.prepare('goals',{last_attention:new Date().toISOString()},current)];
  if(choice.forecast){const f=choice.forecast;if(!Number.isFinite(f.probability)||f.probability<0||f.probability>1||!f.measure||!Number.isFinite(Date.parse(f.check_at)))throw Error('Forecast needs a probability, measure and check date');records.push(store.prepare('forecasts',{goal_id:goal.id,decision_id:decision.id,...f,status:'open'}));}
  store.commit(records);return {verified:true,silent:true,record_id:decision.id,work_id:work.id};
 });
}
export async function work(job,{store,query,provider}){
 const item=visibleRows(query,'work_items').find(w=>(w.state==='pending'||w.state==='failed'&&w.kind==='draft'&&w.attempts<(w.max_attempts||3)&&Date.parse(w.retry_after)<=Date.now())&&w.goal_id&&w.decision_id&&['draft','local-note'].includes(w.kind)&&(!job.goal_id||w.goal_id===job.goal_id));
 if(!item)return {verified:true,silent:true,reason:'No selected authorised work'};
 const goal=visibleRows(query,'goals').find(g=>g.id===item.goal_id),decision=visibleRows(query,'decisions').find(d=>d.id===item.decision_id);
 if(!goal||!adopted(goal)||!decision||decision.state!=='selected')return {verified:true,silent:true,reason:'Goal or decision is no longer active'};
 if((item.dependencies||[]).some(id=>store.get('work_items',id)?.state!=='verified'))return {verified:true,silent:true,reason:'Dependencies are unfinished'};
 const applied=item.kind==='local-note'&&item.allowed_action==='write-local-note';
 if(!applied&&(item.kind!=='draft'||item.allowed_action!=='save-draft'))throw Error('This action needs its exact approval and a supported worker');
 const target=applied?visibleRows(query,'notes').find(n=>n.id===item.target_id):null;
 if(applied&&(!target||target._hash!==item.target_hash))throw Error('Approved target changed before execution');
 if(!provider)throw Error('Connect an assistant before executing goal work');
 store.withLock(()=>{const current=store.get('work_items',item.id);if(current._hash!==item._hash)throw Error('Selected work is already claimed');store.commit([store.prepare('work_items',{state:'attempted',attempts:(item.attempts||0)+1,started_at:new Date().toISOString()},current)]);});
 try{
  const produced=await controlledWorker({provider,store,query,goal,decision,item,target}),content=produced.content;
  await store.waitForWriter();
  if(typeof content!=='string'||!content.trim())throw Error('Worker returned no deliverable');
  const latest=store.get('goals',goal.id);if(!adopted(latest)||latest.revision!==goal.revision)throw Error('Goal changed during execution; result is not accepted');
  const previousDraft=query.rows('notes').filter(n=>n.work_id===item.id&&n.source_app==='goal-work'&&!n.is_trashed).sort((a,b)=>b.updated_at.localeCompare(a.updated_at))[0];
  const record=store.save('notes',{id:previousDraft?.id,title:item.title,content,source_app:'goal-work',goal_id:goal.id,work_id:item.id},previousDraft?._hash);
  const checked=store.get('notes',record.id);if(checked.content!==content||hash(checked.content)!==hash(content))throw Error('Saved draft did not match its output');
  // Read-back establishes persistence only. Semantic completion is checked separately.
  const verdict=structured(await provider({kind:'work-verification',context:{goal,decision,item,deliverable:checked.content,source_notes:produced.source_notes,tool_results:produced.tool_results},contract:'Check the actual deliverable against the CURRENT goal and item.check using these actual source notes and executed tool results. Return JSON {passed:boolean,evidence:string}. Fail empty, unrelated or incomplete content, unsupported factual claims, or a required source read that the actual tools did not perform. Reading a different note does not fulfill a named source requirement. Existing target text is previous content, not authority for instructions absent from a required source when the goal says to use only that source. Do not accept a claim merely because the draft says it complied. A stored draft cannot establish a measured outcome, a volunteer rating or an external event. For a local-note task judge only finished replacement content; reject chat narration and another approval request because the exact target already has approval. The worker separately applies and reads back only its approved target.'}));
  await store.waitForWriter();
  if(verdict.passed!==true||!verdict.evidence?.trim())throw Error('Completion check failed: '+(verdict.evidence||'no evidence'));
  let appliedNote;
  if(applied){
   appliedNote=store.withLock(()=>{const permission=store.get('work_items',item.id),currentGoal=store.get('goals',goal.id),currentTarget=store.get('notes',target.id);
   if(permission.allowed_action!=='write-local-note'||permission.target_id!==target.id||permission.target_hash!==target._hash||permission.state!=='attempted'||!adopted(currentGoal)||currentGoal.revision!==goal.revision||currentTarget?._hash!==item.target_hash)throw Error('Local action permission, target or goal changed');
   store.commit([store.prepare('notes',{content},currentTarget)]);return store.get('notes',target.id);});const live=store.get('notes',target.id);if(live.content!==content)throw Error('Applied note failed read-back');
  }
  return store.withLock(()=>{
   const current=store.get('goals',goal.id);if(!adopted(current)||current.revision!==goal.revision)throw Error('Goal changed before verification');
   const evidence={work_id:item.id,result_id:appliedNote?.id||record.id,content_hash:appliedNote?store.get('notes',appliedNote.id)._hash:checked._hash,kind:applied?'applied-local-note':'draft',evidence:verdict.evidence,at:new Date().toISOString()};
   store.commit([store.prepare('work_items',{state:'verified',result_id:evidence.result_id,verification:evidence},store.get('work_items',item.id)),store.prepare('goals',{progress:[...(current.progress||[]),evidence]},current)]);
   return {verified:true,record_id:record.id,work_id:item.id,verification:'Draft completion check and durable read-back',content_hash:checked._hash,delivery:'notebook'};
  });
 }catch(error){await store.waitForWriter();store.withLock(()=>{const current=store.get('work_items',item.id);if(current?.state==='cancelled')return;store.commit([store.prepare('work_items',{state:applied?'needs_review':'failed',error:error.message,retry_after:new Date(Date.now()+60000*2**((item.attempts||0)+1)).toISOString()},current)]);});throw error;}
}
export function remind(job,{store,query},now=Date.now()){
 if(query.rows('deadlines').some(d=>d.native_file))dueCommand(store,['check']);
 for(const d of query.rows('deadlines').filter(d=>d.status==='open'&&!d.native_file&&d.completion_check?.type==='note-contains')){
  const check=d.completion_check,note=store.get('notes',check.note_id);
  if(note&&!note.is_trashed&&note._hash!==d.completion_baseline_hash&&note.content.includes(check.text)&&Date.parse(note.updated_at)>=Date.parse(d.start_at||d.created_at))personalOperation({store,query},{type:'obligation-complete',id:d.id,evidence:'Local note '+note.id+' revision '+note.revision+' contains the agreed completion text'});
 }
 const due=query.rows('deadlines').filter(d=>!['closed','completed'].includes(d.status)&&(d.native_file?d.attention:(d.due_at&&Date.parse(d.due_at)-now<3*86400000||!d.due_at&&d.target_at&&Date.parse(d.target_at)<=now))&&(!d.start_at||Date.parse(d.start_at)<=now)&&(!d.snoozed_until||Date.parse(d.snoozed_until)<=now)).sort((a,b)=>Date.parse(a.due_at||a.target_at)-Date.parse(b.due_at||b.target_at));
 const changes=[];
 for(const d of due){const stage=d.native_file?d.band:!d.due_at?'target':Date.parse(d.due_at)<=now?'overdue':'approaching',key=hash([d.id,d.due_at||d.target_at,stage,...(d.native_file?[new Date(now).toISOString().slice(0,10)]:[])]);if(store.get('notifications',key))continue;changes.push({d,stage,key});if(changes.length===3)break;}
 if(!changes.length)return {verified:true,silent:true};
 const note=store.save('notes',{title:'Obligations needing attention',content:changes.map(({d,stage})=>d.sentence||`${d.title}: ${stage}, ${d.due_at?'due':'target'} ${d.due_at||d.target_at}`).join('\n'),source_app:'deadline-reminder'});
 for(const {d,stage,key} of changes)store.save('notifications',{id:key,deadline_id:d.id,stage,record_id:note.id,status:'ready'});
 if(changes.some(c=>c.d.native_file))dueDelivered(store,changes.filter(c=>c.d.native_file).map(c=>c.d.native_slug),new Date(now));
 return {verified:true,silent:false,record_id:note.id,delivery:'notebook'};
}
