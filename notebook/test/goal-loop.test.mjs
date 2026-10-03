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
 const provider=async i=>{if(i.kind==='work-verification')return {passed:true,evidence:'Uses the saved requirement'};if(!i.context.tool_results.length)return {tool_calls:[{name:'read_note',id:note.id}]};assert.equal(i.context.tool_results[0].result.content,note.content);return {deliverable:'Agenda: '+i.context.tool_results[0].result.content};};
 await jobExecutor(provider,query)({kind:'goal-work'},{store,settings:{}});assert.equal(store.get('work_items',item.id).state,'verified');assert.equal(store.list('work_tool_receipts')[0].tool,'read_note');
});
