import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {Store,atomic,hash} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {radarCommand} from '../core/radar-lifecycle.mjs';
import {prepareRadarWork,applyRadarWork} from '../core/radar-work.mjs';
import {recipeContext} from '../core/recipe-context.mjs';

const original='# Fictional software test method\n\nKeep exact source evidence and separate approval.\nRecord source IDs.\nPreserve prior outcomes and ask before any outward action.\n';
function fixture(){
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-radar-worker-'))),query=new QueryService(store),context={store,query};
 store.save('settings',{id:'installation',owner:'local',timezone:'UTC'});
 atomic(path.join(store.root,'skills/fictional-method/SKILL.md'),original);
 atomic(path.join(store.root,'skills/fictional-method/references/checks.md'),'Fictional test reference: preserve exact source bytes.');
 const source=store.save('watch_observations',{content:'Fictional primary evidence: record source hashes beside source IDs.',url:'http://127.0.0.1/fictional-primary-evidence'});
 const proposal=store.save('notes',{title:'Fictional method experiment',content:'A fictional software acceptance proposal, not a real framework result.',source_app:'radar',radar:{change:'Record source hashes beside IDs',experiment:'Change only the selected source-recording sentence.',check:'The selected method retains all safeguards and includes source hashes.',rollback:'Restore the retained original method bytes.',end_date:new Date(Date.now()+7*86400000).toISOString().slice(0,10),source_observation_id:source.id,quote:'record source hashes beside source IDs.'}});
 const cmd=(command,input)=>JSON.parse(radarCommand(context,[command,proposal.id,JSON.stringify(input)]).result);
 cmd('verdict',{verdict:'Trial',reason:'Fictional reversible method experiment only.'});
 return {...context,source,proposal,cmd,file:path.join(store.root,'skills/fictional-method/SKILL.md')};
}
async function checkedDraft(f){
 const preview=f.cmd('method',{file:'skills/fictional-method/SKILL.md'});
 f.cmd('prepare',{file:preview.file,file_hash:preview.sha256,proposal_hash:preview.proposal_hash});
 const task=f.store.get('work_items',f.store.get('notes',f.proposal.id).radar.implementation_work_id),job=f.store.get('jobs','radar-prepare-'+task.id);
 const result=await prepareRadarWork(job,{...f,provider:async input=>{
  assert.ok(input.context.current_workflow.sources.some(s=>s.path==='references/checks.md'));
  assert.ok(input.context.tool_results[0].receipt_id);
  if(input.kind==='radar-implementation-draft')return {edits:[{old:'Record source IDs.',new:'Record source IDs and source hashes.'}],reason:'Retain an exact source fingerprint.'};
  assert.ok(input.context.proposed_content.includes('Record source IDs and source hashes.'));
  return {passed:true,evidence:'The actual checked text preserves the other original safeguards and adds the source-backed hash instruction.'};
 }});
 const draft=f.store.get('notes',result.record_id);return {task:f.store.get('work_items',task.id),draft};
}
function allow(f,draft){
 const preview=f.cmd('method',{file:'skills/fictional-method/SKILL.md'});
 f.cmd('allow',{draft_id:draft.id,draft_hash:draft._hash,file_hash:preview.sha256,proposal_hash:preview.proposal_hash});
 const item=f.store.get('work_items',f.store.get('notes',f.proposal.id).radar.implementation_work_id);
 return f.store.get('jobs','radar-work-'+item.id);
}

test('radar draft changes no method, exact approval applies once and rollback retains both versions',async()=>{
 const f=fixture(),{task,draft}=await checkedDraft(f);
 assert.equal(fs.readFileSync(f.file,'utf8'),original);assert.equal(task.allowed_action,null);assert.equal(task.state,'awaiting_approval');
 assert.equal(f.store.list('work_tool_receipts').filter(r=>r.tool==='read_workflow').length,1);
 const job=allow(f,draft),result=await applyRadarWork(job,f);assert.equal(result.verified,true);
 const applied=f.store.get('work_items',task.id);assert.equal(applied.verification.kind,'applied-workflow');
 assert.equal(recipeContext(f.store,'fictional-method').sources[0].content,draft.content);
 assert.equal(f.store.list('radar_trials')[0].state,'running');
 assert.equal((await applyRadarWork(job,f)).silent,true);
 assert.equal(f.store.list('work_tool_receipts').filter(r=>r.tool==='apply_workflow').length,1);
 f.cmd('verdict',{verdict:'Caution',reason:'Stop this fictional experiment and retain its history.'});
 assert.equal(JSON.parse(radarCommand(f,['queue']).result).length,0);
 f.cmd('rollback',{work_id:task.id,file_hash:hash(draft.content),proposal_hash:f.store.get('notes',f.proposal.id)._hash});
 assert.equal(fs.readFileSync(f.file,'utf8'),original);
 assert.equal(f.store.get('work_items',task.id).state,'rolled_back');
 assert.ok(f.store.list('radar_decisions').some(r=>r.verdict==='Trial'));
 assert.ok(fs.readdirSync(path.join(f.store.root,'skills/history')).length>=2);
});
test('stale method, source or verdict cannot execute an earlier exact permission',async()=>{
 for(const change of ['method','source','verdict']){
  const f=fixture(),{task,draft}=await checkedDraft(f),job=allow(f,draft);
  if(change==='method')atomic(f.file,original+'\nUser kept another change.\n');
  if(change==='source')f.store.save('watch_observations',{id:f.source.id,content:'The fictional source was corrected.'});
  if(change==='verdict')f.cmd('verdict',{verdict:'Assess',reason:'Review evidence instead of changing the method.'});
  if(change==='verdict'){assert.equal((await applyRadarWork(job,f)).silent,true);assert.equal(f.store.get('work_items',task.id).state,'cancelled');}
  else await assert.rejects(applyRadarWork(job,f),/changed/);
  assert.equal(fs.readFileSync(f.file,'utf8').includes('Record source IDs and source hashes.'),false);
  assert.equal(f.store.list('work_tool_receipts').some(r=>r.tool==='apply_workflow'),false);
 }
});
test('an applied byte mismatch remains attempted and cannot silently replay or claim a verified trial',async()=>{
 const f=fixture(),{task,draft}=await checkedDraft(f),job=allow(f,draft),commit=f.store.commit.bind(f.store);
 f.store.commit=(records,options)=>{const result=commit(records,options);if(options?.files?.some(r=>r.file==='skills/fictional-method/SKILL.md'))atomic(f.file,'Another process changed these actual bytes.');return result;};
 await assert.rejects(applyRadarWork(job,f),/approved bytes/);
 assert.equal(f.store.get('work_items',task.id).state,'attempted');
 assert.equal(f.store.list('radar_trials')[0].state,'awaiting_implementation');
 await assert.rejects(applyRadarWork(job,f),/interrupted/);
 assert.equal(f.store.list('work_tool_receipts').some(r=>r.tool==='apply_workflow'),false);
 const retained=f.store.get('work_items',task.id).pending_verification;
 assert.equal(fs.readFileSync(path.join(f.store.root,retained.rollback_file),'utf8'),original);
});
test('oversized replacements and hidden primary evidence fail before any implementation draft or file change',async()=>{
 for(const hidden of [false,true]){
  const f=fixture(),preview=f.cmd('method',{file:'skills/fictional-method/SKILL.md'});
  f.cmd('prepare',{file:preview.file,file_hash:preview.sha256,proposal_hash:preview.proposal_hash});
  if(hidden)f.store.save('watch_observations',{id:f.source.id,ai_visibility:'hidden'});
  const task=f.store.get('work_items',f.store.get('notes',f.proposal.id).radar.implementation_work_id),job=f.store.get('jobs','radar-prepare-'+task.id);
  await assert.rejects(prepareRadarWork(job,{...f,provider:async()=>({edits:[{old:original,new:'Replace the whole method.'}],reason:'An invalid test draft.'})}),hidden?/unavailable/:/three quarters/);
  assert.equal(fs.readFileSync(f.file,'utf8'),original);
  assert.equal(f.store.list('notes').some(n=>n.source_app==='radar-implementation-draft'),false);
 }
 assert.throws(()=>fixture().cmd('method',{file:'../personal/SKILL.md'}),/installed workflow/);
});

test('changed drafts and exhausted preparation jobs can be reviewed again without losing earlier evidence',async()=>{
 const f=fixture(),{task,draft}=await checkedDraft(f),preview=f.cmd('method',{file:'skills/fictional-method/SKILL.md'});
 f.store.save('notes',{id:draft.id,content:draft.content+'\nA user changed this draft.'});
 const request={file:preview.file,file_hash:preview.sha256,proposal_hash:preview.proposal_hash};
 assert.equal(f.cmd('prepare',request).state,'preparing');
 assert.ok(f.store.get('notes',draft.id).content.includes('A user changed this draft.'));
 f.store.save('jobs',{id:'radar-prepare-'+task.id,state:'needs_review',paused:true});
 assert.equal(f.cmd('prepare',request).state,'preparing');
 assert.equal(f.store.get('jobs','radar-prepare-'+task.id).paused,false);
 const job=f.store.get('jobs','radar-prepare-'+task.id);
 f.store.save('jobs',{id:job.id,owner:'other-device'});
 await assert.rejects(prepareRadarWork(job,{...f,provider:async()=>{throw Error('A wrong owner must not call a provider');}}),/owned by this installation/);
});


test('radar preparation survives an actual writer arriving after verification without replaying the draft',async()=>{
 const f=fixture(),wait=f.store.waitForWriter.bind(f.store);let waits=0,other,closed;
 f.store.waitForWriter=async options=>{await wait(options);if(++waits===2){
  other=spawn(process.execPath,['-e',"const fs=require('fs'),path=require('path'),file=path.join(process.argv[1],'.godspeed','workspace.lock');fs.writeFileSync(file,JSON.stringify({pid:process.pid}),{flag:'wx'});process.stdout.write('held');setTimeout(()=>fs.unlinkSync(file),200);",f.store.root],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  closed=new Promise((resolve,reject)=>{other.on('error',reject);other.on('close',code=>code===0?resolve():reject(Error('Fictional writer failed '+code)));});
  await new Promise((resolve,reject)=>{other.stdout.once('data',resolve);other.stderr.once('data',data=>reject(Error(String(data))));other.once('error',reject);});
 }};
 try{const {draft}=await checkedDraft(f);assert.ok(other);await closed;assert.equal(f.store.get('notes',draft.id).revision,1);assert.equal(f.store.list('notes').filter(n=>n.source_app==='radar-implementation-draft').length,1);assert.equal(f.store.list('work_tool_receipts').filter(r=>r.tool==='read_workflow').length,1);assert.equal(fs.readFileSync(f.file,'utf8'),original);}finally{if(closed)await closed;}
});
