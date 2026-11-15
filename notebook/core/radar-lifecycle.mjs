import {hash,safe} from './records/store.mjs';
import {visibleRows} from './visibility.mjs';
import {radarWorkCommand} from './radar-work.mjs';
const answer=value=>({result:typeof value==='string'?value:JSON.stringify(value,null,2)});
const words=(value,label)=>{if(typeof value!=='string'||!value.trim()||value.length>10000)throw Error(label+' needs actual text');return value.trim();};
export function radarWords(message){
 const match=String(message).match(/^\/radar\s*(\S+)?\s*([\s\S]*)$/);if(!match)throw Error('Choose a radar command');
 const command=match[1]||'help',tail=match[2].trim();
 if(['verdict','result','method','prepare','allow','rollback'].includes(command)){const value=tail.match(/^(\S+)\s+([\s\S]+)$/);if(!value)throw Error('Supply a proposal ID and one JSON object');return ['/radar',command,value[1],value[2]];}
 return ['/radar',command,...(tail?[tail]:[])];
}
export function radarCommand({store,query},args){
 const [command='help',id,...tail]=args;
 if(command==='help')return answer('/radar queue|history|trials\n/radar verdict PROPOSAL_ID JSON {verdict:Adopt|Trial|Assess|Caution,reason,expected_hash?}\n/radar result PROPOSAL_ID JSON {passed:boolean,evidence_note_id,quote,observed_at}\n/radar method PROPOSAL_ID JSON {file:skills/NAME/SKILL.md}\n/radar prepare PROPOSAL_ID JSON {file,file_hash,proposal_hash}\n/radar allow PROPOSAL_ID JSON {draft_id,draft_hash,file_hash,proposal_hash}\n/radar rollback PROPOSAL_ID JSON {file_hash,proposal_hash,work_id?}\nAdopt and Trial retain your verdict and queue separate approval. Prepare reads one installed workflow and drafts checked exact edits without changing the workflow. Allow grants one-hour permission for that exact reviewed draft and current file. The controlled scheduled worker applies only those bytes and retains rollback. No shell, installation, send or purchase is supported here. A reported trial result is your evidence, not automatic verification of its benefit.');
 if(command==='queue')return answer(visibleRows(query,'notes').filter(n=>n.source_app==='radar'&&n.radar&&n.radar.verdict!=='Caution'&&n.radar.lifecycle!=='archived'));
 if(command==='history')return answer(visibleRows(query,'radar_decisions'));
 if(command==='trials')return answer(visibleRows(query,'radar_trials'));
 safe(id||'');let input;try{input=JSON.parse(tail.join(' '));}catch{throw Error('Supply one complete JSON object; use /radar help');}
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Supply one complete JSON object');
 if(['method','prepare','allow','rollback'].includes(command))return answer(radarWorkCommand({store,query},command,id,input));
 const note=visibleRows(query,'notes').find(n=>n.id===id&&n.source_app==='radar'&&n.radar);
 if(!note)throw Error('Select an existing assistant-visible radar proposal');
 if(input.expected_hash!==undefined&&input.expected_hash!==note._hash)throw Error('The proposal changed; read its current version before deciding');
 const at=new Date().toISOString();
 if(command==='verdict'){
  if(!['Adopt','Trial','Assess','Caution'].includes(input.verdict))throw Error('Choose Adopt, Trial, Assess or Caution');
  const reason=words(input.reason,'Decision reason');
  const scopeHash=hash([note.radar.change,note.radar.experiment,note.radar.check,note.radar.rollback,note.radar.end_date]);
  const existingDecision=note.radar.decision_id?store.get('radar_decisions',note.radar.decision_id):null;
  if(note.radar.verdict===input.verdict&&note.radar.verdict_reason===reason&&existingDecision?.proposal_scope_hash===scopeHash)return answer({proposal_id:note.id,decision_id:existingDecision.id,verdict:input.verdict,lifecycle:note.radar.lifecycle,implementation_work_id:note.radar.implementation_work_id||null});
  if(input.verdict==='Trial'&&(!/^\d{4}-\d{2}-\d{2}$/.test(note.radar.end_date)||!Number.isFinite(Date.parse(note.radar.end_date))||new Date(note.radar.end_date+'T00:00:00Z').toISOString().slice(0,10)!==note.radar.end_date||Date.parse(note.radar.end_date+'T23:59:59Z')<=Date.now()||!note.radar.check||!note.radar.rollback))throw Error('A trial needs a future end date, a measurable check and rollback in its saved proposal');
  return answer(store.withLock(()=>{
   const current=store.get('notes',note.id);if(current._hash!==note._hash)throw Error('The proposal changed during its decision');
   const decision=store.prepare('radar_decisions',{proposal_id:note.id,verdict:input.verdict,reason,decided_at:at,source:'user-command',proposal_hash:note._hash,proposal_scope_hash:scopeHash});
   const patch={...note.radar,verdict:input.verdict,verdict_reason:reason,decided_at:at,decision_id:decision.id,lifecycle:input.verdict==='Caution'?'caution':input.verdict==='Assess'?'assess':'awaiting-implementation-approval',assessment_run_ids:[],archived_at:null};
   const records=[decision,store.prepare('notes',{radar:patch,content:note.content+'\n\nUser decision: '+input.verdict+'\nReason: '+reason+'\nDecided: '+at},current)];
   const priorWork=note.radar.implementation_work_id?store.get('work_items',note.radar.implementation_work_id):null;
   if(['awaiting_approval','preparing','pending'].includes(priorWork?.state))records.push(store.prepare('work_items',{state:'cancelled',allowed_action:null,approval:null,cancelled_at:at,cancellation_reason:'The user changed the radar verdict; the old pending action was never executed'},priorWork));
   const priorTrial=store.list('radar_trials').find(t=>t.proposal_id===note.id&&t.decision_id===note.radar.decision_id);
   if(priorTrial&&priorTrial.state!=='reported')records.push(store.prepare('radar_trials',{state:['awaiting_approval','preparing','pending'].includes(priorWork?.state)?'superseded-before-implementation':'superseded-requires-review',superseded_at:at,new_decision_id:decision.id},priorTrial));
   delete patch.implementation_work_id;
   if(['Adopt','Trial'].includes(input.verdict)){
    const workId='radar-implementation-'+hash([note.id,decision.id]);records.push(store.prepare('work_items',{id:workId,title:note.radar.change,kind:'radar-implementation',state:'awaiting_approval',allowed_action:null,source_note_id:note.id,decision_id:decision.id,check:note.radar.check,rollback:note.radar.rollback,scope:note.radar.experiment,requires_separate_execution_approval:true}));patch.implementation_work_id=workId;
    records[1].radar=patch;
    if(input.verdict==='Trial')records.push(store.prepare('radar_trials',{id:'radar-trial-'+hash([note.id,decision.id]),proposal_id:note.id,decision_id:decision.id,work_id:workId,end_date:note.radar.end_date,check:note.radar.check,rollback:note.radar.rollback,state:'awaiting_implementation',outcome:null}));
   }
   store.commit(records);return {proposal_id:note.id,decision_id:decision.id,verdict:input.verdict,lifecycle:patch.lifecycle,implementation_work_id:patch.implementation_work_id||null};
  }));
 }
 if(command==='result'){
  if(note.radar.verdict!=='Trial')throw Error('Choose a proposal with a current Trial decision');
  if(typeof input.passed!=='boolean')throw Error('Report whether the actual check passed or failed');
  if(typeof input.observed_at!=='string'||!/(Z|[+-]\d\d:\d\d)$/.test(input.observed_at)||!Number.isFinite(Date.parse(input.observed_at))||Date.parse(input.observed_at)>Date.now()||Date.parse(input.observed_at)<Date.parse(note.radar.decided_at))throw Error('Use the actual past observation time with timezone after the trial decision');
  const evidence=visibleRows(query,'notes').find(n=>n.id===safe(input.evidence_note_id||'')),quote=words(input.quote,'Exact evidence quote');
  if(!evidence||evidence.id===note.id||typeof evidence.content!=='string'||!evidence.content.includes(quote))throw Error('Quote an existing visible evidence note, separate from the proposal');
  const trial=visibleRows(query,'radar_trials').find(t=>t.proposal_id===note.id&&t.decision_id===note.radar.decision_id);if(!trial)throw Error('The selected trial is missing');
  return answer(store.withLock(()=>{
   const current=store.get('radar_trials',trial.id);if(current._hash!==trial._hash||store.get('notes',note.id)._hash!==note._hash||store.get('notes',evidence.id)._hash!==evidence._hash)throw Error('The trial or its evidence changed during review');
   const result=store.prepare('radar_trial_results',{trial_id:trial.id,proposal_id:note.id,passed:input.passed,evidence_note_id:evidence.id,quote,evidence_hash:evidence._hash,observed_at:new Date(input.observed_at).toISOString(),source:'user-report',verification:'reported',reported_at:at});
   store.commit([result,store.prepare('radar_trials',{state:'reported',outcome:input.passed?'reported-pass':'reported-failure',result_id:result.id},current)]);return result;
  }));
 }
 throw Error('Choose a supported radar command; use /radar help');
}
export function advanceRadarAssessments(store,query){
 return store.withLock(()=>{
  const runs=store.list('watch_runs').filter(r=>r.kind==='radar'&&r.state==='verified'),updates=[];
  for(const note of visibleRows(query,'notes').filter(n=>n.source_app==='radar'&&n.radar?.verdict==='Assess'&&n.radar.lifecycle==='assess')){
   const completed=runs.filter(r=>Date.parse(r.observed_at)>Date.parse(note.radar.decided_at)).map(r=>r.id),ids=[...new Set(completed)];
   if(JSON.stringify(ids)===JSON.stringify(note.radar.assessment_run_ids||[]))continue;
   const archived=ids.length>=3,at=new Date().toISOString();updates.push(store.prepare('notes',{radar:{...note.radar,assessment_run_ids:ids,lifecycle:archived?'archived':'assess',...(archived?{archived_at:at,archive_reason:'Three completed radar runs without a changed user verdict'}:{})},...(archived?{content:note.content+'\n\nArchived after three completed radar runs without a changed user verdict. Evidence and history are retained.'}:{})},note));
  }
  if(updates.length)store.commit(updates);return updates.map(n=>n.id);
 });
}
