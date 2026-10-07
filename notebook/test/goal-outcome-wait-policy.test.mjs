import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {Domains} from '../core/domains.mjs';import {jobExecutor} from '../core/runtime.mjs';
function fixture(){const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-outcome-policy-'))),query=new QueryService(store),domains=new Domains(query);const at=new Date(Date.now()-60000).toISOString(),goal=store.save('goals',{title:'Fictional approved checklist',own_words:'Fictional approved checklist',measure:'A separately reported review',status:'adopted',wait_for_report:true,progress:[{kind:'applied-local-note',at,evidence:'The chosen local checklist was replaced and read back.'}]});const applied=store.save('work_items',{goal_id:goal.id,title:'Replace the fictional checklist',state:'verified',kind:'local-note',verification:{kind:'applied-local-note',at}});return {store,query,domains,goal,applied};}

test('an explicit outcome wait suppresses a model that would repeat the completed edit, until an actual report arrives',async()=>{
 const f=fixture();let calls=0;
 const run=jobExecutor(async()=>{calls++;return {action:'Correct the reported checklist defect',kind:'draft',check:'Address the actual reported omission',reason:'The actual review needs a clearer dry reading instruction'};},f.query),job={kind:'goal-decision',id:'fictional-decision'},deps={store:f.store,settings:{}};
 const first=await run(job,deps);assert.equal(first.silent,true);assert.equal(calls,0);assert.equal(f.store.list('decisions')[0].wait_for_work_id,f.applied.id);
 f.store.save('notes',{title:'Unrelated fictional note',content:'No checklist review occurred.'});await run(job,deps);assert.equal(f.store.list('decisions').length,1);assert.equal(calls,0);assert.equal(f.store.list('work_items').length,1);
 await f.domains.invoke('personal-operation',{type:'goal-outcome',id:f.goal.id,evidence:'Fictional reported review: clarity is 2/5; clarify the dry reading step.',value:2,outcome:'Needs correction'});
 await run(job,deps);assert.equal(calls,1);assert.equal(f.store.list('work_items').length,2);
});

test('changing only the outcome-wait policy does not authorize another edit, but a genuinely changed direction does',async()=>{
 const f=fixture();let calls=0;const run=jobExecutor(async()=>{calls++;return {action:'Draft a fictional troubleshooting note',kind:'draft',check:'Matches the new direction',reason:'The user changed direction'};},f.query),job={kind:'goal-decision',id:'fictional-decision'},deps={store:f.store,settings:{}};
 await f.domains.invoke('personal-operation',{type:'goal-change',id:f.goal.id,wait_for_report:true,reason:'Wait for my separate report'});await run(job,deps);assert.equal(calls,0);
 await f.domains.invoke('personal-operation',{type:'goal-change',id:f.goal.id,title:'Fictional troubleshooting note',reason:'Changed direction'});await run(job,deps);assert.equal(calls,1);
});

test('conversation cannot turn on an outcome wait without an explicit current request',async()=>{
 const f=fixture(),message='My goal is a fictional checklist';f.domains.provider=async()=>({reply:'Saved.',operations:[{type:'goal-add',title:'New fictional checklist',wait_for_report:true,source_quote:message}]});
 await assert.rejects(f.domains.invoke('conversation-chat',{message,conversation_id:'fictional'}),/explicit request/);assert.equal(f.store.list('goals').length,1);
});
