import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Scheduler} from '../core/jobs/scheduler.mjs';
import {jobExecutor} from '../core/runtime.mjs';
import {Domains} from '../core/domains.mjs';
const fixture=()=>{const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-v2-')));return {store,query:new QueryService(store)};};
test('a completed deliverable can wait for a real outcome quietly and new evidence wakes the decision',async()=>{
 const {store,query}=fixture();const goal=store.save('goals',{title:'Fictional volunteer checklist',own_words:'Fictional volunteer checklist',measure:'An actual volunteered clarity rating',status:'adopted',progress:[{kind:'applied-local-note',evidence:'The checklist was replaced and read back'}]});
 let calls=0;const run=jobExecutor(async()=>{calls++;return {kind:'wait',reason:'The checklist exists; wait for a real volunteered rating',check_at:new Date(Date.now()+3600000).toISOString()};},query);
 const job={kind:'goal-decision',id:'fictional-decision'},context={store,settings:{}};
 assert.equal((await run(job,context)).silent,true);assert.equal(store.list('work_items').length,0);assert.equal(store.list('decisions')[0].state,'waiting');
 await run(job,context);assert.equal(calls,1);
 store.save('goals',{id:goal.id,progress:[...goal.progress,{kind:'reported-observation',value:2,evidence:'Fictional volunteer rated clarity 2/5'}]});
 await run(job,context);assert.equal(calls,2);
});

test('changed direction cancels stale approved work even when its provider returns later',async()=>{
 const {store,query}=fixture(),domains=new Domains(query),goal=store.save('goals',{title:'Fictional old direction',own_words:'Fictional old direction',status:'adopted',progress:[]}),note=store.save('notes',{title:'Fictional target',content:'Keep this original'}),decision=store.save('decisions',{goal_id:goal.id,state:'selected'}),item=store.save('work_items',{title:'Old authorized edit',goal_id:goal.id,decision_id:decision.id,kind:'local-note',state:'awaiting_approval',check:'Old edit exists',attempts:0});
 await domains.invoke('personal-operation',{type:'work-allow-local',id:item.id,note_id:note.id});
 const run=jobExecutor(async()=>{await domains.invoke('personal-operation',{type:'goal-change',id:goal.id,title:'Fictional changed direction',measure:'An actual volunteered observation',reason:'Changed my mind'});return {deliverable:'The old content must never be applied'};},query);
 await assert.rejects(run({kind:'goal-work'},{store,settings:{}}),/Goal changed/);
 assert.equal(store.get('work_items',item.id).state,'cancelled');
 assert.equal(store.get('notes',note.id).content,'Keep this original');
 assert.equal(store.get('decisions',decision.id).state,'cancelled');
 assert.equal(store.get('goals',goal.id).own_words,'Fictional changed direction');
 assert.equal(store.get('goals',goal.id).changes.at(-1).before.title,'Fictional old direction');
 await assert.rejects(domains.invoke('personal-operation',{type:'work-allow-local',id:item.id,note_id:note.id}),/pending|await|cancel|active/i);
 await assert.rejects(domains.invoke('personal-operation',{type:'goal-change',id:goal.id,title:' ',reason:'Fictional empty title'}),/Goal/);
 await assert.rejects(domains.invoke('personal-operation',{type:'goal-change',id:goal.id,measure:' ',reason:'Fictional empty measure'}),/Progress measure/);
});

test('reported checks finish selected observation work once and inform the next decision without inventing success',async()=>{
 const {store,query}=fixture(),domains=new Domains(query);new Scheduler(store).configure({goal:'Fictional outline quality'});const goal=store.list('goals')[0];
 const decision=store.save('decisions',{goal_id:goal.id,state:'selected'}),item=store.save('work_items',{title:'Rate the fictional outline',goal_id:goal.id,decision_id:decision.id,kind:'observation',state:'awaiting_approval',check:'The reviewer rates clarity at least 4 out of 5'});
 const input={type:'work-record-observation',id:item.id,evidence:'Fictional internal review: clarity scored 2 out of 5; the setup section is unclear.',value:2,passed:false};
 await domains.invoke('personal-operation',input);const completed=store.get('work_items',item.id),progress=store.get('goals',goal.id).progress;
 assert.equal(completed.state,'verified');assert.equal(completed.verification.kind,'reported-observation');assert.equal(completed.verification.passed,false);assert.equal(progress.at(-1).value,2);assert.equal(progress.at(-1).outcome,'check failed');
 assert.equal(store.get('notes',completed.result_id).content.includes(input.evidence),true);assert.equal(completed.verification.content_hash,store.get('notes',completed.result_id)._hash);
 await domains.invoke('personal-operation',input);assert.equal(store.get('goals',goal.id).progress.length,progress.length);
 await assert.rejects(domains.invoke('personal-operation',{...input,evidence:'A competing report'}),/already recorded/i);
 let sawFailedCheck=false;const provider=async request=>{if(request.kind==='goal-decision'){sawFailedCheck=request.context.goal.progress.some(p=>p.outcome==='check failed'&&p.value===2);return {kind:'draft',action:'Clarify the fictional setup section',check:'Contains clear setup steps'};}return {deliverable:'Fictional setup steps'};};
 const scheduler=new Scheduler(store,{executor:jobExecutor(provider,query)});store.save('jobs',{id:'goal-decision',next_run:new Date().toISOString()});store.save('jobs',{id:'goal-work',paused:true});await scheduler.tick();assert.equal(sawFailedCheck,true);
 const closed=store.save('goals',{id:goal.id,status:'paused'}),stale=store.save('work_items',{goal_id:closed.id,decision_id:decision.id,kind:'observation',state:'awaiting_approval'});
 await assert.rejects(domains.invoke('personal-operation',{...input,id:stale.id}),/no longer active/i);
});

test('routine notices expose readable text and a result link in the notebook notification view',()=>{
 const {store,query}=fixture();const note=store.save('notes',{title:'Fictional overdue inspection',content:'Inspect the fictional garden robot: overdue.'});
 store.save('notifications',{record_id:note.id,status:'ready'});
 const notice=query.rows('notifications')[0];assert.equal(notice.title,note.title);assert.equal(notice.body,note.content);assert.equal(notice.link,'/dashboard/notes/'+note.id);assert.equal(notice.is_read,false);
});

test('a newly selected decision wakes its enabled worker and preserves deliberately paused work',async()=>{
 const {store,query}=fixture(),provider=async input=>input.kind==='goal-decision'?{action:'Prepare a fictional checklist',kind:'draft',check:'Includes the rain rule'}:input.kind==='work-verification'?{passed:true,evidence:'Contains the rain rule'}:{deliverable:'Rain rule: stop watering when wet.'};
 const scheduler=new Scheduler(store,{executor:jobExecutor(provider,query)});scheduler.configure({goal:'Fictional checklist'});
 store.save('jobs',{id:'goal-work',next_run:new Date(Date.now()+86400000).toISOString()});
 await scheduler.tick();await scheduler.tick();assert.equal(store.list('work_items')[0].state,'verified');
 const goal=store.list('goals')[0];store.save('goals',{id:goal.id,progress:[]});
 store.save('jobs',{id:'goal-work',paused:true});store.save('jobs',{id:'goal-decision',next_run:new Date().toISOString()});
 await scheduler.tick();assert.equal(store.get('jobs','goal-work').paused,true);
});

test('scheduled subscription work uses supported low effort and wakes a due failed draft retry',async()=>{
 const {store,query}=fixture();let fail=true;const requests=[];
 const provider=Object.assign(async input=>{requests.push(input);if(input.kind==='goal-decision')return {action:'Fictional retry checklist',kind:'draft',check:'Contains rain rule'};if(input.kind==='work-verification'){if(fail)throw Error('Fictional timeout');return {passed:true,evidence:'Rain rule is present'};}return {deliverable:'Rain rule: stop when wet.'};},{options:async()=>({current:'fictional-subscription',models:[{id:'fictional-subscription',efforts:['low','high']}]})});
 const scheduler=new Scheduler(store,{executor:jobExecutor(provider,query)});scheduler.configure({goal:'Fictional retry'});await scheduler.tick();const item=store.list('work_items')[0];assert.equal(item.state,'failed');
 assert.equal(requests.every(r=>r.effort==='low'),true);fail=false;store.save('work_items',{id:item.id,retry_after:new Date(Date.now()-1000).toISOString()});store.save('jobs',{id:'goal-work',state:'pending',next_run:new Date(Date.now()+86400000).toISOString()});
 await scheduler.tick();assert.equal(store.get('work_items',item.id).state,'verified');assert.equal(store.get('work_items',item.id).attempts,2);assert.equal(store.list('notes').filter(n=>n.work_id===item.id).length,1,'A draft retry keeps one result with retained revisions');
});

test('an explicit draft retry releases interrupted work but refuses applied work and live attempts',async()=>{
 const {store,query}=fixture(),domains=new Domains(query);new Scheduler(store).configure({goal:'Fictional repair'});const goal=store.list('goals')[0];
 const decision=store.save('decisions',{goal_id:goal.id,state:'selected'}),draft=store.save('work_items',{goal_id:goal.id,decision_id:decision.id,kind:'draft',allowed_action:'save-draft',state:'attempted',attempts:3,max_attempts:3});
 store.save('jobs',{id:'goal-work',paused:true,state:'needs_review'});
 const receipt=store.save('job_receipts',{kind:'goal-work',state:'attempted',pid:process.pid,started_at:new Date().toISOString()});
 await assert.rejects(domains.invoke('personal-operation',{type:'work-retry-draft',id:draft.id}),/still running/i);
 store.save('job_receipts',{id:receipt.id,state:'failed'});
 await domains.invoke('personal-operation',{type:'work-retry-draft',id:draft.id});
 const retried=store.get('work_items',draft.id);assert.equal(retried.state,'pending');assert.equal(retried.attempts,3);assert.equal(retried.max_attempts,4);assert.equal(retried.retry_reviews.length,1);assert.equal(store.get('jobs','goal-work').paused,false);
 const applied=store.save('work_items',{kind:'local-note',state:'needs_review'});await assert.rejects(domains.invoke('personal-operation',{type:'work-retry-draft',id:applied.id}),/draft/i);
});
test('paired provisioning does not hide first goal and reconciliation preserves pauses',()=>{
 const {store}=fixture();store.save('settings',{id:'installation',owner:'vps',timezone:'Europe/Berlin',permissions:[]});
 store.save('jobs',{id:'coaching',kind:'coaching',owner:'vps',paused:true});
 new Scheduler(store).configure({goal:'Prepare fictional workshop'});
 assert.equal(store.list('goals').length,1);assert.equal(store.list('goals')[0].status,'adopted');
 assert.equal(store.get('jobs','goal-work').owner,'vps');assert.equal(store.get('jobs','coaching').paused,true);
 new Scheduler(store).configure({goal:'Prepare fictional workshop'});assert.equal(store.list('goals').length,1);
});
test('decision selects durable work; exact work is consumed once and checked outcome informs next decision',async()=>{
 const {store,query}=fixture(),calls=[];
 const provider=async input=>{calls.push(input);return input.kind==='work-verification'?JSON.stringify({passed:true,evidence:'Contains preparation and follow-up checklist'}):input.kind==='goal-decision'?JSON.stringify({action:'Write the fictional workshop checklist',kind:'draft',check:'A checklist with preparation and follow-up',reason:'Reduce uncertainty',forecast:{probability:0.7,measure:'ready',check_at:'2026-10-05T00:00:00Z'}}):'Preparation: choose an agenda. Follow-up: collect feedback.';};
 const scheduler=new Scheduler(store,{executor:jobExecutor(provider,query)});scheduler.configure({goal:'Prepare fictional workshop'});
 await scheduler.tick();const work=store.list('work_items')[0];assert.ok(work);assert.equal(work.state,'verified');
 assert.ok(JSON.stringify(calls.find(c=>c.kind==='goal-work')).includes('Write the fictional workshop checklist'));
 assert.ok(store.get('notes',work.result_id));assert.equal(store.list('goals')[0].progress.length,1);
 await scheduler.tick();assert.equal(calls.filter(c=>c.kind==='goal-work').length,1);
 const goal=store.list('goals')[0];store.save('goals',{id:goal.id,progress:[...goal.progress,{evidence:'Checklist trial failed: agenda was missing',outcome:'failed'}]});
 await jobExecutor(provider,query)({kind:'goal-decision',id:'next-decision'},{store,settings:store.get('settings','installation')});
 assert.ok(JSON.stringify(calls.at(-1)).includes('agenda was missing'));
});
test('failed decision and paused goal prevent unrelated work',async()=>{
 const {store,query}=fixture();let workCalls=0;
 const scheduler=new Scheduler(store,{executor:jobExecutor(async i=>{if(i.kind==='goal-decision')throw Error('Decision fixture failed');workCalls++;return 'Wrong work';},query)});
 scheduler.configure({goal:'Prepare fictional workshop'});await scheduler.tick();assert.equal(workCalls,0);assert.equal(store.list('work_items').length,0);
});
test('quiet reminders deduplicate approaching deadline and recurring completion retains history',async()=>{
 const {store,query}=fixture(),run=jobExecutor(null,query),ctx={store,settings:{}};
 assert.equal((await run({kind:'deadline-reminder',id:'reminders'},ctx)).silent,true);assert.equal(store.list('notes').length,0);
 store.save('deadlines',{id:'fictional-weekly',title:'Fictional exercise',due_at:new Date(Date.now()+3600000).toISOString(),status:'open'});
 assert.equal((await run({kind:'deadline-reminder',id:'reminders'},ctx)).silent,false);
 assert.equal((await run({kind:'deadline-reminder',id:'reminders'},ctx)).silent,true);assert.equal(store.list('notes').length,1);
});
test('controlled local worker applies only its approved target and rejects a changed precondition',async()=>{
 const {store,query}=fixture(),domains=new Domains(query),goal=store.save('goals',{title:'Fictional workshop',status:'adopted',progress:[]}),note=store.save('notes',{title:'Fictional checklist',content:'Old draft'}),decision=store.save('decisions',{goal_id:goal.id,state:'selected'});
 const item=store.save('work_items',{title:'Update fictional checklist',goal_id:goal.id,decision_id:decision.id,kind:'local-note',check:'Contains a preparation checklist',state:'awaiting_approval',attempts:0});
 await domains.invoke('personal-operation',{type:'work-allow-local',id:item.id,note_id:note.id});
 const provider=async i=>i.kind==='work-verification'?JSON.stringify({passed:true,evidence:'Preparation checklist exists'}):'Preparation checklist: choose a fictional agenda.';
 await jobExecutor(provider,query)({kind:'goal-work',id:'worker'},{store,settings:{}});assert.equal(store.get('notes',note.id).content,'Preparation checklist: choose a fictional agenda.');assert.equal(store.get('work_items',item.id).verification.kind,'applied-local-note');
 const second=store.save('work_items',{title:'Second edit',goal_id:goal.id,decision_id:decision.id,kind:'local-note',check:'New checklist',state:'awaiting_approval',attempts:0});
 await domains.invoke('personal-operation',{type:'work-allow-local',id:second.id,note_id:note.id});store.save('notes',{id:note.id,content:'Concurrent user edit'});
 await assert.rejects(jobExecutor(provider,query)({kind:'goal-work',id:'worker'},{store,settings:{}}),/changed|conflict/i);assert.equal(store.get('notes',note.id).content,'Concurrent user edit');
});
test('controlled worker executes visible read tools and retains real tool receipts',async()=>{
 const {store,query}=fixture(),goal=store.save('goals',{title:'Fictional workshop',status:'adopted'}),note=store.save('notes',{title:'Fictional plan',content:'Preparation needs a listening question'}),decision=store.save('decisions',{goal_id:goal.id,state:'selected'}),item=store.save('work_items',{title:'Prepare fictional agenda',goal_id:goal.id,decision_id:decision.id,kind:'draft',allowed_action:'save-draft',check:'Use the recorded preparation requirement',state:'pending'});
 const provider=async i=>{if(i.kind==='work-verification'){assert.equal(i.context.goal.id,goal.id);assert.equal(i.context.tool_results[0].result.content,note.content);assert.equal(i.context.source_notes.some(n=>n.id===note.id),true);return {passed:true,evidence:'Uses the saved requirement'};}if(!i.context.tool_results.length)return {tool_calls:[{name:'read_note',id:note.id}]};assert.equal(i.context.tool_results[0].result.content,note.content);return {deliverable:'Agenda: '+i.context.tool_results[0].result.content};};
 await jobExecutor(provider,query)({kind:'goal-work'},{store,settings:{}});assert.equal(store.get('work_items',item.id).state,'verified');assert.equal(store.list('work_tool_receipts')[0].tool,'read_note');
});
test('a checked local edit is refused when its actual read tools missed the required source',async()=>{
 const {store,query}=fixture(),domains=new Domains(query),source=store.save('notes',{title:'Required fictional rain rule',content:'Stop watering when the sensor is wet.'}),other=store.save('notes',{title:'Different fictional source',content:'This is an unrelated briefing.'}),target=store.save('notes',{title:'Fictional approved target',content:'Keep original target'}),goal=store.save('goals',{title:'Read the required rain rule with read_note and edit the approved target only',status:'adopted'}),decision=store.save('decisions',{goal_id:goal.id,state:'selected'}),item=store.save('work_items',{goal_id:goal.id,decision_id:decision.id,kind:'local-note',state:'awaiting_approval',check:'The actual read_note tool reads '+source.id+' and the replacement quotes its rule',attempts:0});
 await domains.invoke('personal-operation',{type:'work-allow-local',id:item.id,note_id:target.id});
 const provider=async request=>{
  if(request.kind==='work-verification')return {passed:true,evidence:'I wrongly claim that the source was read.'};
  return request.context.tool_results.length?{deliverable:'I claim to have read the required source.'}:{tool_calls:[{name:'read_note',id:other.id}]};
 };
 await assert.rejects(jobExecutor(provider,query)({kind:'goal-work'},{store,settings:{}}),/Completion check failed/);
 assert.equal(store.get('notes',target.id).content,'Keep original target');
 assert.equal(store.get('work_items',item.id).state,'needs_review');
 assert.equal(store.get('goals',goal.id).progress?.length||0,0);
});
