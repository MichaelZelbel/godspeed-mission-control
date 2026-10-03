import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {Domains} from '../core/domains.mjs';import {conversationOperations} from '../core/personal-operations.mjs';import {Scheduler} from '../core/jobs/scheduler.mjs';import {jobExecutor} from '../core/runtime.mjs';
import {decide,remind} from '../core/goal-loop.mjs';import {cardCommand} from '../core/card-commands.mjs';import {nativeTick} from '../core/native-personal.mjs';
import {loadSettings,saveSettings} from '../../third-party/addons/godspeed-coach/lib/settings.mjs';
const fixture=()=>{const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-review-')));return {store,query:new QueryService(store)};};
test('a failing run preserves a pause and schedule edited during execution',async()=>{
 const {store}=fixture();store.save('settings',{id:'installation',owner:store.device,timezone:'UTC'});const job=store.save('jobs',{id:'fictional',owner:store.device,kind:'selftest',paused:false,next_run:new Date().toISOString(),interval_ms:60000});
 const changed='2030-01-01T09:00:00.000Z',scheduler=new Scheduler(store,{executor:async()=>{store.save('jobs',{id:job.id,paused:true,next_run:changed});throw Error('Fictional failure');}});await scheduler.tick();assert.equal(store.get('jobs',job.id).paused,true);assert.equal(store.get('jobs',job.id).next_run,changed);
});
test('automatic conversation routing and model operations record one coaching reply',async()=>{
 const {store,query}=fixture(),domains=new Domains(query,{provider:async()=>({reply:'Recorded.',operations:[{type:'coach-reply',id:talk.id,content:'I took the fictional break',source_quote:'Record my reply: I took the fictional break'}]})}),talk=await domains.invoke('personal-operation',{type:'coach-open',area:'health',question:'Fictional question?'});
 await domains.invoke('conversation-chat',{conversation_id:'fictional-coaching',talk_id:talk.id,request_id:'fictional-reply',message:'Record my reply: I took the fictional break'});assert.equal(query.rows('coach_talks')[0].replies.length,1);
});
test('agreed habit schedules a real review and a later notebook answer records the observed day',async()=>{
 const {store,query}=fixture(),domains=new Domains(query),talk=await domains.invoke('personal-operation',{type:'coach-open',area:'health',question:'Fictional movement?'}),habit=await domains.invoke('personal-operation',{type:'habit-agree',talk_id:talk.id,title:'Fictional stretch',agreement:'I agree to try',check_at:'2026-10-10T09:00:00Z'});
 const job=store.get('jobs','habit-check-'+habit.id);assert.equal(job.next_run,'2026-10-10T09:00:00.000Z');
 const review=await jobExecutor(async()=> 'Did you try the fictional stretch?',query)(job,{store,settings:{timezone:'UTC'}}),note=store.get('notes',review.record_id);
 assert.deepEqual(note.habit_ids,[habit.id]);const result=await domains.invoke('note-chat',{note_id:note.id,message:'done',request_id:'fictional-habit-reply'});assert.match(result.reply,/Recorded/);
 assert.equal(query.rows('habits').find(h=>h.id===habit.id).observations.at(-1).answer,'done');
 assert.equal((await domains.invoke('note-chat',{note_id:note.id,message:'done',request_id:'fictional-habit-reply'})).reply,result.reply);
});
test('negated and hypothetical approval cannot grant local editing',()=>{
 const {store,query}=fixture(),domains=new Domains(query),note=store.save('notes',{title:'Fictional note',content:'Original'}),item=store.save('work_items',{title:'Fictional edit',kind:'local-note',state:'awaiting_approval'});
 for(const message of ['Do not allow editing any note.','For example, allow editing any note.','Allow editing any note.'])assert.throws(()=>conversationOperations(domains,{message,request_id:message,conversation_id:'fictional'},[{type:'work-allow-local',source_quote:'allow editing any note',id:item.id,note_id:note.id}]),/explicit|exact/);
 assert.equal(store.get('work_items',item.id).state,'awaiting_approval');
});
test('card commands reject external files and traversal before execution',()=>{
 const {store}=fixture(),external=path.join(os.tmpdir(),'fictional-external-'+Date.now()+'.md');fs.writeFileSync(external,'Keep this text');
 for(const target of [external,'goals/diagnoses/../../outside.md'])assert.throws(()=>cardCommand(store,{card:'goals',args:['diagnose','g','--refute',target,'--evidence','Fictional evidence']}),/projected/);
 assert.equal(fs.readFileSync(external,'utf8'),'Keep this text');
 assert.throws(()=>cardCommand(store,{card:'goals',args:['diagnose','g','--date','../../outside']}),/YYYY/);
});
test('goal decision excludes hidden attention and linked evidence',async()=>{
 const {store,query}=fixture();store.save('goals',{id:'hidden',title:'Secret fictional goal',status:'adopted',ai_visibility:'hidden'});const goal=store.save('goals',{title:'Visible fictional goal',status:'adopted'});store.save('forecasts',{goal_id:goal.id,title:'Secret fictional forecast',ai_visibility:'hidden'});store.save('decisions',{goal_id:goal.id,title:'Secret fictional decision',ai_visibility:'hidden'});
 await decide({id:'decision'},{store,query,provider:async input=>{assert.ok(!JSON.stringify(input).includes('Secret fictional'));return {action:'Write agenda',kind:'draft',check:'Agenda has a question',reason:'Preparation'};}});
});
test('reminder batch advances to obligations beyond the first three',()=>{
 const {store,query}=fixture(),now=Date.now();for(let i=0;i<4;i++)store.save('deadlines',{id:'fictional-'+i,title:'Fictional obligation '+i,status:'open',due_at:new Date(now+3600000+i).toISOString()});
 remind({}, {store,query},now);assert.equal(store.list('notifications').length,3);remind({}, {store,query},now);assert.equal(store.list('notifications').length,4);assert.equal(remind({}, {store,query},now).silent,true);
});
test('unanswered daily habit is offered once on each later day',async()=>{
 const {store,query}=fixture(),domains=new Domains(query);store.save('settings',{id:'installation',timezone:'UTC'});saveSettings(store.root,{...loadSettings(store.root),timezone:'UTC',habit_check_at:'19:00'});
 const talk=await domains.invoke('personal-operation',{type:'coach-open',area:'health',question:'Fictional movement?'});await domains.invoke('personal-operation',{type:'habit-agree',talk_id:talk.id,title:'Fictional stretch',agreement:'I agree to try',check_at:'2030-01-01T19:00:00Z'});
 const day1=new Date();day1.setUTCHours(19,0,0,0);const day2=new Date(day1.getTime()+86400000);
 assert.equal(nativeTick(store,'coach',day1).silent,false);assert.equal(nativeTick(store,'coach',day1).silent,true);assert.equal(nativeTick(store,'coach',day2).silent,false);assert.equal(nativeTick(store,'coach',day2).silent,true);
});
test('unrequested conversation change is rejected independently of the provider',()=>{
 const {store,query}=fixture();assert.throws(()=>conversationOperations(new Domains(query),{message:'Hello',request_id:'hello',conversation_id:'one'},[{type:'goal-add',source_quote:'Hello',title:'Unrequested goal'}]),/explicit/);assert.equal(store.list('goals').length,0);
});
test('request retry with changed operation wording produces a conflict instead of another obligation',()=>{
 const {store,query}=fixture(),domains=new Domains(query),input={message:'Remind me to prepare the fictional workshop tomorrow',request_id:'one',conversation_id:'one'},op={type:'obligation-add',source_quote:input.message,title:'Prepare fictional workshop',due_at:'2026-10-04T09:00:00Z'};
 conversationOperations(domains,input,[op]);assert.throws(()=>conversationOperations(domains,input,[{...op,title:'Prepare the fictional workshop'}]),/conflict/);assert.equal(store.list('deadlines').length,1);conversationOperations(domains,input,[op]);assert.equal(store.list('deadlines').length,1);
});
test('old schedule owner stops before its next job after a transfer',async()=>{
 const {store}=fixture(),calls=[];store.save('settings',{id:'installation',owner:store.device,timezone:'UTC'});for(const id of ['a','b'])store.save('jobs',{id,kind:'fixture',owner:store.device,next_run:'2020-01-01T00:00:00Z',interval_ms:60000});
 const scheduler=new Scheduler(store,{executor:async job=>{calls.push(job.id);if(job.id==='a')scheduler.transfer('new-owner');return {verified:true,silent:true};}});await scheduler.tick();assert.deepEqual(calls,['a']);assert.equal(store.get('jobs','b').owner,'new-owner');
});
test('connector repair does not displace selected goal work',async()=>{
 const {store,query}=fixture();store.save('work_items',{id:'a-repair',state:'pending',kind:'repair'});const g=store.save('goals',{title:'Workshop',status:'adopted'}),d=store.save('decisions',{goal_id:g.id,state:'selected'}),w=store.save('work_items',{id:'z-goal-work',goal_id:g.id,decision_id:d.id,state:'pending',kind:'draft',allowed_action:'save-draft',title:'Checklist',check:'Has agenda'});
 await jobExecutor(async i=>i.kind==='work-verification'?JSON.stringify({passed:true,evidence:'Agenda exists'}):'Agenda: introduction and practice',query)({kind:'goal-work'},{store,settings:{}});assert.equal(store.get('work_items',w.id).state,'verified');assert.equal(store.get('work_items','a-repair').state,'pending');
});
test('coaching excludes hidden observations and does not reopen a closed same-day conversation',async()=>{
 const {store,query}=fixture(),calls=[];store.save('health_observations',{metric:'Secret fictional metric',value:999,ai_visibility:'hidden',observed_at:new Date().toISOString()});const run=jobExecutor(async i=>{calls.push(i);return 'How was your week?';},query);
 const result=await run({kind:'coaching'},{store,settings:{}});assert.ok(!JSON.stringify(calls).includes('Secret fictional metric'));const domains=new Domains(query);await domains.invoke('personal-operation',{type:'coach-close',id:result.talk_id});const count=store.list('notes').length;assert.equal((await run({kind:'coaching'},{store,settings:{}})).silent,true);assert.equal(calls.length,1);assert.equal(store.list('notes').length,count);await assert.rejects(domains.invoke('personal-operation',{type:'coach-open',area:'health',question:'New question?'}),/already closed/);
});
test('habit observation cannot fabricate completion when no explicit answer is supplied',async()=>{
 const {store,query}=fixture(),domains=new Domains(query),talk=await domains.invoke('personal-operation',{type:'coach-open',area:'health',question:'Breaks?'}),habit=await domains.invoke('personal-operation',{type:'habit-agree',talk_id:talk.id,title:'Fictional break',agreement:'I agree to try',check_at:'2026-10-10T09:00:00Z'});
 await assert.rejects(domains.invoke('personal-operation',{type:'habit-observe',id:habit.id,observation:'I did not take the break'}),/explicit/);assert.equal(query.rows('habits')[0].observations.length,0);await domains.invoke('personal-operation',{type:'habit-observe',id:habit.id,observation:'I did not take the break',answer:'no'});assert.equal(query.rows('habits')[0].observations[0].answer,'no');
});
