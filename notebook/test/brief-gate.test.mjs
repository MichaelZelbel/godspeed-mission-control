import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {jobExecutor} from '../core/runtime.mjs';import {briefing} from '../core/briefing.mjs';
import {dueCommand} from '../core/native-due.mjs';
import {personalOperation} from '../core/personal-operations.mjs';
// Where one reminder is kept: its page under notebook/Deadlines/, which is what a rehearsal must
// leave exactly as it was (since 30 October 2026 a reminder is a record, not a file in due/).
const page=(store,slug)=>store.file(store.list('deadlines').find(r=>r.native_slug===slug));
// A failed fact check must name the records it rejects (Archon R1, round 3); these fixtures fail only the reader check.
const readerFails=(input,reason)=>input.check==='source-facts'?{passed:true,reason:'Fictional sources checked.'}:{passed:false,reason};
test('a briefing cannot request a decision on a prepared artifact changed during judgment',async()=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-brief-action-stale-'))),query=new QueryService(store),goal=store.save('goals',{title:'Fictional inspect sources',status:'adopted'}),draft=store.save('notes',{title:'Fictional exact proposed change',content:'Original fictional proposal.'});
 store.save('work_items',{title:'Fictional source review',state:'awaiting_approval',goal_id:goal.id,draft_id:draft.id});let checks=0;
 const provider=async input=>{if(input.kind==='brief-verification'){if(++checks===2)store.save('notes',{id:draft.id,content:'Changed fictional proposal.'});return {passed:true,reason:'Fictional previous draft accepted'};}assert.equal(input.context.action_artifacts[0].content,draft.content);return 'No fresh fictional health observations are available. Review the fictional source proposal: '+input.context.action_artifacts[0].link;};
 await assert.rejects(jobExecutor(provider,query)({kind:'morning-brief',id:'brief-action-stale'},{store,settings:{}}),/sources changed/);assert.equal(store.list('notifications').length,0);
});
test('a briefing offers exact linked decisions and centers its ready contribution rather than asking for unprepared work',async()=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-brief-actions-'))),query=new QueryService(store),goal=store.save('goals',{title:'Fictional teach source inspection',status:'adopted'}),note=store.save('notes',{title:'Fictional checked script',content:'Exact fictional script to review.'});
 const entry=store.save('lead_entries',{title:note.title,content:note.content,goal_id:goal.id,note_id:note.id,status:'ready',delivery_day:'2026-01-01'});
 store.save('work_items',{title:'Unprepared fictional research',state:'awaiting_approval',goal_id:goal.id});
 const provider=async input=>{if(input.kind==='brief-verification')return {passed:true,reason:'Fictional checked source and reader.'};assert.equal(input.context.action_artifacts.length,1);const action=input.context.action_artifacts[0];assert.equal(action.record_id,entry.id);assert.equal(action.goal,goal.title);assert.equal(action.link,'/dashboard/notes/'+note.id);assert.match(input.contract,/main user action/);return 'No fresh fictional health observations are available. Review this fictional script for teaching source inspection.\n\n'+note.content+'\n\n'+action.link;};
 const result=await jobExecutor(provider,query)({kind:'morning-brief',id:'brief-actions'},{store,settings:{}});assert.ok(store.get('notes',result.record_id).content.includes(note.content));
});
test('the briefing preserves the full ready contribution and link without claiming the user saw or posted it',async()=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-brief-lead-'))),query=new QueryService(store),content='Fictional copy-ready option one.\n\nFictional copy-ready option two.\n\nFictional copy-ready option three.',note=store.save('notes',{title:'Fictional contribution',content}),entry=store.save('lead_entries',{title:note.title,content,note_id:note.id,status:'ready',delivery_day:'2026-01-01'});let writes=0;
 const provider=async input=>{if(input.kind==='brief-verification')return {passed:true,reason:'Fixture current sources and reader checked'};writes++;if(writes===1)return 'No fresh fictional health observations are available. A fictional post is ready.';assert.ok(input.context.check_feedback.some(f=>/complete checked contribution/.test(f)));return 'No fresh fictional health observations are available. Choose a draft to post.\n\n'+input.context.contribution.content+'\n\n'+input.context.contribution.link;};
 const result=await jobExecutor(provider,query)({kind:'morning-brief',id:'fictional-lead-brief'},{store,settings:{}}),saved=store.get('notes',result.record_id),queued=store.get('lead_entries',entry.id);assert.equal(writes,2);assert.ok(saved.content.includes(content));assert.ok(saved.content.includes('/dashboard/notes/'+note.id));assert.equal(queued.status,'queued');assert.equal(queued.shown_at,undefined);assert.equal(queued.posted_at,undefined);assert.equal(queued.delivery_note_id,saved.id);
});
test('brief sources are prepared before writing and a failed judgment delivers checked facts only',async()=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-brief-'))),query=new QueryService(store),calls=[];
 store.save('health_observations',{metric:'Fictional energy',value:6,observed_at:new Date().toISOString()});
 const provider=async i=>{calls.push(i);return i.kind==='brief-verification'?JSON.stringify(readerFails(i,'Invented result absent from sources')):'Fictional energy improved to 10.';};
 const result=await jobExecutor(provider,query)({kind:'morning-brief',id:'brief'},{store,settings:{}});
 const note=store.get('notes',result.record_id);assert.equal(result.fallback,true);assert.match(note.content,/Fictional energy: 6/);assert.doesNotMatch(note.content,/improved to 10/);
 assert.ok(calls.find(i=>i.kind==='morning-brief').context.health.some(h=>h.value===6));assert.ok(query.rows('job_receipts').some(r=>r.kind==='brief-delivery-verification'&&r.state==='failed'));
});

test('a briefing treats a short phone day as unknown until a manual settlement arrives',async()=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-brief-incomplete-health-'))),query=new QueryService(store),day='2026-11-04';
 store.save('settings',{id:'installation',timezone:'UTC'});store.save('health_observations',{metric:'protein_g',value:50,source:'Health Auto Export',via:'phone-receiver',observed_on:day,date_precision:'day',observed_at:day+'T00:00:00Z',data_until:'19:55:00'});
 let writes=0;const provider=async input=>{
  if(input.kind==='brief-verification')return {passed:true,reason:'Fixture checked the incomplete phone day.'};
  writes++;const freshness=input.context.health_freshness,protein=freshness.days.find(row=>row.date===day)?.columns.protein_g;
  if(writes===1)return {text:'Have a protein shake to reach your target.',health_claims:[]};
  if(writes===2){assert.ok(input.context.check_feedback.some(reason=>/Assistant output cannot be used/.test(reason)));return {text:'Weekly protein: 0 known days and 1 unknown day.',health_claims:[]};}
  assert.deepEqual(protein,{value:80,source:'manual',state:'settled'});return 'Protein was 80 g. Weekly protein: 1 known day and 0 unknown days.';
 };
 const first=await briefing({id:'brief-incomplete-one'},{store,query,provider,now:new Date('2026-11-05T08:00:00Z')}),firstNote=store.get('notes',first.record_id).content;
 assert.match(firstNote,/protein_g was 50 so far/);assert.match(firstNote,/19:55:00/);assert.match(firstNote,/This week has 1 unknown phone-health day/);assert.doesNotMatch(firstNote,/protein shake/);assert.equal(query.rows('job_receipts').filter(row=>row.kind==='brief-code-gate'&&row.state==='failed').length,2);
 personalOperation({store,query},{type:'health-add',metric:'protein_g',value:80,unit:'g',observed_at:day+'T12:00:00Z'});
 const second=await briefing({id:'brief-incomplete-two'},{store,query,provider,now:new Date('2026-11-06T08:00:00Z')});assert.match(store.get('notes',second.record_id).content,/1 known day and 0 unknown days/);
});
test('a briefing counts several unknown phone columns on one day once',async()=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-brief-unknown-day-count-'))),query=new QueryService(store),day='2026-11-04';
 store.save('settings',{id:'installation',timezone:'UTC'});
 for(const [metric,value] of [['steps',4200],['protein_g',50]])store.save('health_observations',{metric,value,source:'Health Auto Export',via:'phone-receiver',observed_on:day,date_precision:'day',observed_at:day+'T00:00:00Z',data_until:'19:55:00'});
 const provider=async input=>{
  if(input.kind==='brief-verification')return {passed:true,reason:'Fixture checked the incomplete phone day count.'};
  return 'Do not use this fictional health advice.';
 };
 const result=await briefing({id:'brief-unknown-day-count'},{store,query,provider,now:new Date('2026-11-05T08:00:00Z')});
 assert.match(store.get('notes',result.record_id).content,/This week has 1 unknown phone-health day\./);
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
 // The reminder itself, as a person opens it: its page under notebook/Deadlines/ (#90).
 const source=page(store,'fictional-native'),original=fs.readFileSync(source,'utf8'),modified=fs.statSync(source).mtimeMs;
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
 const originalPage=fs.readFileSync(page(store,'fictional-date'),'utf8');
 const provider=async input=>{if(input.kind==='brief-verification')return {passed:true,reason:'Fixture checked.'};assert.ok(!input.context.deadlines.some(d=>d.native_slug==='fictional-date'));return 'No fresh fictional health observations are available. The fictional result has been recorded.';};
 const result=await jobExecutor(provider,query)({kind:'brief-rehearsal',id:'date-rehearsal'},{store,settings:{}}),copied=path.join(result.rehearsal_workspace,'work','fictional-result.txt');
 assert.equal(fs.readFileSync(copied,'utf8'),'');assert.ok(Math.abs(fs.statSync(copied).mtimeMs-stamp)<1);
 assert.equal(fs.readFileSync(dependency,'utf8'),before);assert.equal(fs.statSync(dependency).mtimeMs,stamp);assert.equal(fs.readFileSync(page(store,'fictional-date'),'utf8'),originalPage);
 assert.equal(new QueryService(new Store(result.rehearsal_workspace)).rows('deadlines').find(d=>d.native_slug==='fictional-date').status,'closed');
});


test('a briefing cannot deliver after its adopted goal or health source changes during judgment',async()=>{
 for(const change of ['goal','health']){
  const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-brief-stale-'))),query=new QueryService(store),goal=store.save('goals',{title:'Fictional inspect the source',status:'adopted'}),health=store.save('health_observations',{metric:'Fictional energy',value:6,observed_at:new Date().toISOString()});let checks=0;
  const provider=async input=>{if(input.kind==='brief-verification'){if(++checks===2){if(change==='goal')store.save('goals',{id:goal.id,status:'paused'});else store.save('health_observations',{id:health.id,value:3});}return {passed:true,reason:'Fictional checker accepted the old snapshot'};}return 'Fictional energy is 6. Inspect the fictional source for the adopted goal.';};
  await assert.rejects(jobExecutor(provider,query)({kind:'morning-brief',id:'brief-stale-'+change},{store,settings:{}}),/sources changed/);
  assert.equal(store.list('notes').filter(n=>n.source_app==='morning-brief').length,0);assert.equal(store.list('notifications').length,0);assert.equal(checks,2);
 }
});

test('a briefing cannot deliver after its rehearsal receipt or ready contribution changes during judgment',async()=>{
 for(const change of ['receipt','contribution']){
  const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-brief-added-source-stale-'))),query=new QueryService(store);let source,content,note,checks=0;
  if(change==='receipt')source=store.save('job_receipts',{kind:'brief-rehearsal',state:'verified',result:'Fictional rehearsal completed'});
  else {content='Fictional copy-ready contribution.';note=store.save('notes',{title:'Fictional contribution',content});source=store.save('lead_entries',{title:note.title,content,note_id:note.id,status:'ready',delivery_day:'2026-01-01'});}
  const provider=async input=>{if(input.kind==='brief-verification'){if(++checks===2)store.save(change==='receipt'?'job_receipts':'lead_entries',{id:source.id,state:change==='receipt'?'failed':undefined,status:change==='contribution'?'queued':undefined});return {passed:true,reason:'Fictional checker accepted the old snapshot'};}return change==='receipt'?'No fresh fictional health observations are available. The fictional rehearsal is complete.':'No fresh fictional health observations are available. Review this fictional contribution.\n\n'+content+'\n\n/dashboard/notes/'+note.id;};
  await assert.rejects(jobExecutor(provider,query)({kind:'morning-brief',id:'brief-added-source-'+change},{store,settings:{}}),/sources changed/);
  assert.equal(store.list('notes').filter(n=>n.source_app==='morning-brief').length,0);assert.equal(store.list('notifications').length,0);assert.equal(checks,2);
 }
});

test('a briefing cannot deliver after a previous briefing changes during judgment',async()=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-brief-prior-stale-'))),query=new QueryService(store),prior=store.save('notes',{title:'Previous fictional briefing',content:'Old fictional advice.',source_app:'morning-brief'});let checks=0;
 const provider=async input=>{if(input.kind==='brief-verification'){if(++checks===2)store.save('notes',{id:prior.id,content:'Changed fictional advice.'});return {passed:true,reason:'Fixture checked the old previous briefing'};}return 'No fresh fictional health observations are available. Inspect the fictional source.';};
 await assert.rejects(jobExecutor(provider,query)({kind:'morning-brief',id:'brief-prior-stale'},{store,settings:{}}),/sources changed/);
 assert.equal(store.list('notes').filter(n=>n.source_app==='morning-brief').length,1);assert.equal(store.list('notifications').length,0);assert.equal(checks,2);
});

test('overlapping checked briefings file identical content only once',async()=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-brief-overlap-'))),query=new QueryService(store),provider=async input=>input.kind==='brief-verification'?{passed:true,reason:'Fictional sources checked'}:'No fresh fictional health observations are available. Inspect the fictional source.';
 const run=jobExecutor(provider,query),results=await Promise.all([run({kind:'morning-brief',id:'brief-one'},{store,settings:{}}),run({kind:'morning-brief',id:'brief-two'},{store,settings:{}})]);
 assert.equal(store.list('notes').filter(n=>n.source_app==='morning-brief').length,1);assert.equal(store.list('notifications').length,1);assert.equal(results.filter(r=>r.silent).length,1);
});


test('a briefing reads the latest selected finding source without copying unrelated collection history',async()=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-brief-selected-'))),query=new QueryService(store),topic=store.save('watch_topics',{title:'Fictional selected finding',paused:true}),url='https://fictional.invalid/source';
 const old=store.save('watch_observations',{topic_id:topic.id,url,content:'Older fictional source words',observed_at:new Date(Date.now()-60000).toISOString()}),current=store.save('watch_observations',{topic_id:topic.id,url,content:'Current exact fictional source words',observed_at:new Date().toISOString()});
 const unrelated=store.save('watch_observations',{topic_id:'fictional-unselected',url:'https://fictional.invalid/unselected',content:'Unselected fictional history '.repeat(20000),observed_at:new Date().toISOString()});
 store.save('watch_findings',{topic_id:topic.id,what:'A fictional source changed',link:url,status:'pending',score:80,expires:new Date(Date.now()+86400000).toISOString()});
 const provider=async input=>{if(input.kind==='brief-verification')return {passed:true,reason:'Fictional current evidence checked'};assert.deepEqual(input.context.source_receipts.map(s=>s.id),[current.id]);assert.equal(input.context.source_receipts[0].content,current.content);return 'No fresh fictional health observations are available. A fictional source changed: '+url;};
 await jobExecutor(provider,query)({kind:'morning-brief',id:'brief-selected'},{store,settings:{}});assert.equal(store.get('watch_observations',old.id).content,old.content);assert.equal(store.get('watch_observations',unrelated.id).content,unrelated.content);
});


test('a changed briefing method or already-delivered selected finding invalidates its checked draft',async()=>{
 for(const change of ['method','finding']){
  const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-brief-scope-'))),query=new QueryService(store),folder=path.join(store.root,'skills/morning-note');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'SKILL.md'),'# Fictional briefing method\nRead the selected source.\n');
  const topic=store.save('watch_topics',{title:'Fictional selected source',paused:true}),finding=store.save('watch_findings',{topic_id:topic.id,what:'Fictional source changed',link:'https://fictional.invalid/source',score:80,status:'pending',expires:new Date(Date.now()+86400000).toISOString()});let checks=0;
  const provider=async input=>{if(input.kind==='brief-verification'){if(++checks===2){if(change==='method')fs.appendFileSync(path.join(folder,'SKILL.md'),'The user changed the fictional method.\n');else store.save('watch_findings',{id:finding.id,status:'shown'});}return {passed:true,reason:'Fictional checker accepted the previous selected method'};}return 'No fresh fictional health observations are available. Fictional source changed: https://fictional.invalid/source';};
  await assert.rejects(jobExecutor(provider,query)({kind:'morning-brief',id:'brief-scope-'+change},{store,settings:{}}),/sources changed/);assert.equal(store.list('notes').filter(n=>n.source_app==='morning-brief').length,0);assert.equal(store.list('notifications').length,0);
 }
});

test('a briefing never judges today\'s phone day: it is unknown, while a settled manual column stays usable',async()=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-brief-today-'))),query=new QueryService(store),today='2026-11-05';
 store.save('settings',{id:'installation',timezone:'UTC'});
 store.save('health_observations',{metric:'steps',value:4200,source:'Health Auto Export',via:'phone-receiver',observed_on:today,date_precision:'day',observed_at:today+'T00:00:00Z',data_until:'07:40:00'});
 personalOperation({store,query},{type:'health-add',metric:'protein_g',value:80,unit:'g',observed_at:today+'T06:00:00Z'});
 let writes=0;const feedback=[];
 const provider=async input=>{
  if(input.kind==='brief-verification')return {passed:true,reason:'Fixture checked the unknown day.'};
  writes++;assert.match(input.contract,/settled/);
  const day=input.context.health_freshness.days.find(row=>row.date===today);
  assert.equal(day.columns.protein_g.state,'settled','the manual column is usable');
  if(writes===1)return {text:'Steps were 4200, a short day, and you missed the target. Protein was 80 g.',health_claims:[]};
  feedback.push(...(input.context.check_feedback||[]));
  return {text:'Protein was 80 g.',health_claims:[]};
 };
 const result=await briefing({id:'brief-today-unknown'},{store,query,provider,now:new Date('2026-11-05T08:00:00Z')}),saved=store.get('notes',result.record_id).content;
 assert.equal(writes,2,'the provider prose was refused while a phone day was unknown');
 assert.ok(feedback.some(reason=>/Assistant output cannot be used/.test(reason)));
 assert.match(saved,/so far/);assert.match(saved,/07:40:00/);assert.doesNotMatch(saved,/Protein was 80 g|short day|missed/i);
});

// Archon R2: the factual fallback never states an unfinished phone total as settled. Today's phone
// value and an earlier day that stopped before 21:00 are said "so far" with their stopped time.
for(const [name,offset,until] of [['today\'s phone day',0,'07:40:00'],['an earlier incomplete phone day',2,'19:55:00']])test('the factual fallback says '+name+' only as "so far"',async()=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-brief-fallback-phone-'))),query=new QueryService(store),day=new Date(Date.now()-offset*86400000).toISOString().slice(0,10);
 store.save('settings',{id:'installation',timezone:'UTC'});store.save('goals',{title:'Prepare a fictional guide',status:'adopted'});
 store.save('health_observations',{metric:'steps',value:4200,source:'Health Auto Export',via:'phone-receiver',observed_on:day,date_precision:'day',observed_at:day+'T00:00:00Z',data_until:until});
 const provider=async input=>input.kind==='brief-verification'?readerFails(input,'No useful action'):'Unsupported draft.';
 const result=await jobExecutor(provider,query)({kind:'morning-brief',id:'brief-fallback-phone-'+offset},{store,settings:{}}),content=store.get('notes',result.record_id).content;
 assert.equal(result.fallback,true);assert.doesNotMatch(content,/observation is steps: 4200/);
 assert.ok(content.includes('On '+day+', steps was 4200 so far; phone data stopped at '+until+'.'),content);
});
