import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {jobExecutor} from '../core/runtime.mjs';
import {dueCommand} from '../core/native-due.mjs';
test('brief sources are prepared before writing and failed judgment prevents delivery',async()=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-brief-'))),query=new QueryService(store),calls=[];
 store.save('health_observations',{metric:'Fictional energy',value:6,observed_at:new Date().toISOString()});
 const provider=async i=>{calls.push(i);return i.kind==='brief-verification'?JSON.stringify({passed:false,reason:'Invented result absent from sources'}):'Fictional energy improved to 10.';};
 await assert.rejects(jobExecutor(provider,query)({kind:'morning-brief',id:'brief'},{store,settings:{}}),/Invented/);assert.equal(query.rows('notes').filter(n=>n.source_app==='morning-brief').length,0);
 assert.ok(calls.find(i=>i.kind==='morning-brief').context.health.some(h=>h.value===6));assert.ok(query.rows('job_receipts').some(r=>r.kind==='brief-verification'&&r.state==='failed'));
});

test('a mechanical briefing failure gets one evidence-led rewrite and only the checked bytes are saved',async()=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-brief-rewrite-'))),query=new QueryService(store);let writes=0;
 store.save('health_observations',{metric:'Fictional energy',value:6,observed_at:new Date().toISOString()});
 const corrected='Your fictional energy reading is 6. Review the fictional checklist today.';
 const provider=async input=>{
  if(input.kind==='brief-verification')return {passed:true,reason:'Fixture current energy and review action checked.'};
  writes++;if(writes===1)return 'Your fictional energy is 6 — review the checklist.';
  assert.equal(input.phase,'one-rewrite');assert.ok(input.context.check_feedback.some(reason=>/writing style/.test(reason)));return corrected;
 };
 const result=await jobExecutor(provider,query)({kind:'morning-brief',id:'brief-rewrite'},{store,settings:{}});
 assert.equal(writes,2);assert.equal(store.get('notes',result.record_id).content,corrected);assert.equal(query.rows('notifications').length,1);
 assert.equal(query.rows('job_receipts').filter(r=>r.kind==='brief-code-gate'&&r.state==='failed').length,1);
});

test('previous briefing evidence is not recursively copied into the next writer context',async()=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-brief-context-'))),query=new QueryService(store);
 store.save('notes',{title:'Previous note',content:'Earlier fictional briefing.',source_app:'morning-brief',evidence:{previous:[{evidence:{private_fixture:'Never recurse this old evidence into the next brief.'}}]}});
 const provider=async input=>{
  if(input.kind==='brief-verification')return {passed:true,reason:'Fixture checked.'};
  assert.equal(input.context.previous.length,1);assert.equal(Object.hasOwn(input.context.previous[0],'evidence'),false);return 'No fresh fictional health observations are available. Review the fictional draft today.';
 };
 await jobExecutor(provider,query)({kind:'morning-brief',id:'brief-context'},{store,settings:{}});
});

test('rehearsal executes reminder completion in its retained copy without changing live knowledge or notifications',async()=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-brief-rehearsal-'))),query=new QueryService(store);
 const note=store.save('notes',{title:'Fictional completed inspection',content:'Pending'}),deadline=store.save('deadlines',{title:'Fictional inspection',status:'open',start_at:new Date(Date.now()-3600000).toISOString(),due_at:new Date().toISOString(),completion_check:{type:'note-contains',note_id:note.id,text:'Inspection complete'},completion_baseline_hash:note._hash,recurrence:{days:1}});
 store.save('notes',{id:note.id,content:'Inspection complete'});const before=store.get('deadlines',deadline.id)._hash;
 const provider=async input=>input.kind==='brief-verification'?{passed:true,reason:'Fixture checked.'}:'No fresh fictional health observations are available. The fictional inspection is complete.';
 const result=await jobExecutor(provider,query)({kind:'brief-rehearsal',id:'rehearsal'},{store,settings:{}});
 assert.equal(result.rehearsal,true);assert.equal(result.silent,true);assert.equal(store.get('deadlines',deadline.id)._hash,before);assert.equal(store.get('deadlines',deadline.id).status,'open');
 assert.equal(query.rows('notifications').length,0);assert.equal(query.rows('notes').filter(n=>n.source_app==='morning-brief').length,0);
 const copy=new Store(result.rehearsal_workspace);assert.equal(copy.get('deadlines',deadline.id).status,'closed');assert.ok(copy.get('deadlines',deadline.id).next_id);
});

test('rehearsal includes canonical native obligations without altering their live text or timestamp',async()=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-native-brief-rehearsal-'))),query=new QueryService(store),today=new Date().toISOString().slice(0,10);
 dueCommand(store,['add','fictional-native','--title','Fictional native practice','--from',today,'--to',today,'--done-when','Practice recorded','--cost','Fictional missed practice']);
 const source=path.join(store.root,'due','fictional-native.md'),original=fs.readFileSync(source,'utf8'),modified=fs.statSync(source).mtimeMs;
 const provider=async input=>{if(input.kind==='brief-verification')return {passed:true,reason:'Fixture checked.'};assert.ok(input.context.deadlines.some(d=>d.native_slug==='fictional-native'));return 'No fresh fictional health observations are available. Complete the fictional practice today.';};
 const result=await jobExecutor(provider,query)({kind:'brief-rehearsal',id:'native-rehearsal'},{store,settings:{}});
 assert.equal(fs.readFileSync(source,'utf8'),original);assert.equal(fs.statSync(source).mtimeMs,modified);
 const copy=new Store(result.rehearsal_workspace),copyQuery=new QueryService(copy);assert.ok(copyQuery.rows('deadlines').some(d=>d.native_slug==='fictional-native'&&d.title==='Fictional native practice'));
});

test('rehearsal preserves file-newer completion evidence without copying the dependency contents',async()=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-brief-date-evidence-'))),query=new QueryService(store),today=new Date().toISOString().slice(0,10);
 fs.mkdirSync(path.join(store.root,'work'),{recursive:true});const dependency=path.join(store.root,'work','fictional-result.txt');fs.writeFileSync(dependency,'Fictional private result, not needed to check its date.');
 const before=fs.readFileSync(dependency,'utf8'),stamp=fs.statSync(dependency).mtimeMs;
 dueCommand(store,['add','fictional-date','--title','Fictional dated result','--from',today,'--to',today,'--done-when','The result file exists in this window','--cost','Fictional missed result','--self-check','file-newer','--self-check-arg','work/fictional-result.txt']);
 const originalDue=fs.readFileSync(path.join(store.root,'due','fictional-date.md'),'utf8');
 const provider=async input=>{if(input.kind==='brief-verification')return {passed:true,reason:'Fixture checked.'};assert.ok(!input.context.deadlines.some(d=>d.native_slug==='fictional-date'));return 'No fresh fictional health observations are available. The fictional result has been recorded.';};
 const result=await jobExecutor(provider,query)({kind:'brief-rehearsal',id:'date-rehearsal'},{store,settings:{}}),copied=path.join(result.rehearsal_workspace,'work','fictional-result.txt');
 assert.equal(fs.readFileSync(copied,'utf8'),'');assert.ok(Math.abs(fs.statSync(copied).mtimeMs-stamp)<1);
 assert.equal(fs.readFileSync(dependency,'utf8'),before);assert.equal(fs.statSync(dependency).mtimeMs,stamp);assert.equal(fs.readFileSync(path.join(store.root,'due','fictional-date.md'),'utf8'),originalDue);
 assert.equal(new QueryService(new Store(result.rehearsal_workspace)).rows('deadlines').find(d=>d.native_slug==='fictional-date').status,'closed');
});
