import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';
 const fixture=provider=>{const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-personal-'))),query=new QueryService(store);return {store,query,domains:new Domains(query,{provider})};};

test('a note request repairs an unrequested personal action before any write',async()=>{
 let calls=0;const message='Save a note titled Fictional checklist with this content: inspection pending.';
 const {store,domains}=fixture(async()=>{calls++;assert.equal(store.list('deadlines').length,0);assert.equal(store.list('notes').length,0);return calls===1?{reply:'Reminder saved.',operations:[{type:'obligation-add',title:'Unrequested inspection',due_at:'2026-10-04T09:00:00Z',source_quote:message}]}:{reply:'Note saved.',notes_created:[{title:'Fictional checklist',content:'inspection pending.'}]};});
 await domains.invoke('conversation-chat',{message,conversation_id:'fictional-notes'});assert.equal(calls,2);assert.equal(store.list('notes').length,1);assert.equal(store.list('deadlines').length,0);
});
test('an omitted operation source quote is repaired before any write, then the outcome persists once',async()=>{
 let calls=0,goal;
 const message='Record this outcome for my fictional goal: the draft needs a rain sensor section.';
 const {store,domains}=fixture(async()=>{calls++;return {reply:'Recorded.',operations:[{type:'goal-outcome',id:goal.id,evidence:'Draft needs rain sensor section',outcome:'rejected',...(calls>1?{source_quote:message}:{})}]};});
 goal=store.save('goals',{title:'Fictional garden',status:'adopted',progress:[]});
 const result=await domains.invoke('conversation-chat',{message,conversation_id:'fictional-repair',request_id:'repair-outcome'});
 assert.equal(calls,2);assert.equal(store.get('goals',goal.id).progress.length,1);
 assert.equal(result.operation_results.length,1);
});

test('a malformed conversation response is repaired once before an actual numeric outcome is saved',async()=>{
 let calls=0,goal;const message='Record the fictional review outcome: clarity is 2 out of 5.';
 const {store,domains}=fixture(async()=>{calls++;assert.equal(store.get('goals',goal.id).progress.length,0);const response=JSON.stringify({reply:'Recorded.',operations:[{type:'goal-outcome',id:goal.id,evidence:message,value:2,outcome:'Needs correction',source_quote:message}]});return calls===1?response+' Extra model narration':response;});
 goal=store.save('goals',{title:'Fictional checklist',status:'adopted',progress:[]});
 const result=await domains.invoke('conversation-chat',{message,conversation_id:'fictional-json',request_id:'fictional-numeric-review'});
 assert.equal(calls,2);assert.equal(result.operation_results.length,1);assert.equal(store.get('goals',goal.id).progress.length,1);assert.equal(store.get('goals',goal.id).progress[0].value,2);
});

test('repeated malformed JSON is refused without executing its embedded operation',async()=>{
 let calls=0;const message='My goal is a fictional review';const {store,domains}=fixture(async()=>{calls++;return JSON.stringify({reply:'Saved.',operations:[{type:'goal-add',title:'Fictional review',measure:'A recorded result',source_quote:message}]})+' Extra narration';});
 await assert.rejects(domains.invoke('conversation-chat',{message,conversation_id:'fictional-bad-json'}),/JSON|non-whitespace/);assert.equal(calls,2);assert.equal(store.list('goals').length,0);assert.equal(store.list('notes').length,0);
});

test('reported numeric outcomes reject strings and nonfinite values without corrupting the goal history',async()=>{
 const {store,domains}=fixture(),goal=store.save('goals',{title:'Fictional measured review',status:'adopted',progress:[]});
 for(const value of ['2',Infinity,NaN])await assert.rejects(domains.invoke('personal-operation',{type:'goal-outcome',id:goal.id,evidence:'Fictional measured review',value}),/finite number/);
 assert.equal(store.get('goals',goal.id).progress.length,0);
 await domains.invoke('personal-operation',{type:'goal-outcome',id:goal.id,evidence:'Fictional clarity is 2 out of 5',value:2});assert.equal(store.get('goals',goal.id).progress[0].value,2);
});
test('ordinary conversation creates an adopted goal only from an explicit sourced operation',async()=>{
 const {store,domains}=fixture(async()=>JSON.stringify({reply:'Saved.',operations:[{type:'goal-add',source_quote:'My goal is a fictional workshop',title:'Fictional workshop',measure:'Ten fictional participants'}]}));
 await domains.invoke('conversation-chat',{message:'My goal is a fictional workshop',conversation_id:'test'});
 assert.equal(store.list('goals')[0]?.status,'adopted');assert.ok(store.get('jobs','goal-work'));
 await domains.invoke('conversation-chat',{message:'My goal is a fictional workshop',conversation_id:'test'});assert.equal(store.list('goals').length,1);
 await assert.rejects(domains.invoke('conversation-chat',{message:'Hello',conversation_id:'other'}),/source|explicit/i);
});
test('a new obligation retains its completion note baseline so old completion text is not new evidence',async()=>{
 const {store,domains}=fixture();const note=store.save('notes',{title:'Fictional inspection',content:'Inspection complete.'});
 const obligation=await domains.invoke('personal-operation',{type:'obligation-add',title:'New inspection',due_at:'2026-10-04T09:00:00Z',completion_check:{type:'note-contains',note_id:note.id,text:'Inspection complete.'}});
 assert.equal(obligation.completion_baseline_hash,store.get('notes',note.id)._hash);
});
test('recurrence completion requires evidence, rolls once and retains completed occurrence',async()=>{
 const {store,domains}=fixture();const d=store.save('deadlines',{title:'Fictional practice',due_at:'2026-10-01T09:00:00Z',status:'open',recurrence:{days:7}});
 await assert.rejects(domains.invoke('personal-operation',{type:'obligation-complete',id:d.id}),/evidence/i);
 const done=await domains.invoke('personal-operation',{type:'obligation-complete',id:d.id,evidence:'Practice recorded in fictional diary'});
 assert.equal(store.get('deadlines',d.id).status,'closed');assert.equal(store.get('deadlines',done.next_id).due_at,'2026-10-08T09:00:00.000Z');
 await domains.invoke('personal-operation',{type:'obligation-complete',id:d.id,evidence:'Repeat request'});assert.equal(store.list('deadlines').length,2);
});
test('coach resumes saved words and creates habit only after agreement',async()=>{
 const {store,query,domains}=fixture();const talk=await domains.invoke('personal-operation',{type:'coach-open',area:'health',question:'What did you notice?'});
 await domains.invoke('personal-operation',{type:'coach-reply',id:talk.id,content:'I noticed tiredness after late work.'});
 assert.equal(query.rows('coach_talks')[0].replies[0].content,'I noticed tiredness after late work.');assert.equal(query.rows('habits').length,0);
 await domains.invoke('personal-operation',{type:'habit-agree',talk_id:talk.id,title:'Fictional screen break',agreement:'I agree to try a screen break',check_at:'2026-10-10T09:00:00Z'});
 assert.equal(query.rows('habits').length,1);assert.equal(query.rows('habits')[0].talk_id,talk.id);
});
