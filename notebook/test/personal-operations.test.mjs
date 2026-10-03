import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';
 const fixture=provider=>{const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-personal-'))),query=new QueryService(store);return {store,query,domains:new Domains(query,{provider})};};
test('an omitted operation source quote is repaired before any write, then the outcome persists once',async()=>{
 let calls=0,goal;
 const message='Record this outcome for my fictional goal: the draft needs a rain sensor section.';
 const {store,domains}=fixture(async()=>{calls++;return {reply:'Recorded.',operations:[{type:'goal-outcome',id:goal.id,evidence:'Draft needs rain sensor section',outcome:'rejected',...(calls>1?{source_quote:message}:{})}]};});
 goal=store.save('goals',{title:'Fictional garden',status:'adopted',progress:[]});
 const result=await domains.invoke('conversation-chat',{message,conversation_id:'fictional-repair',request_id:'repair-outcome'});
 assert.equal(calls,2);assert.equal(store.get('goals',goal.id).progress.length,1);
 assert.equal(result.operation_results.length,1);
});
test('ordinary conversation creates an adopted goal only from an explicit sourced operation',async()=>{
 const {store,domains}=fixture(async()=>JSON.stringify({reply:'Saved.',operations:[{type:'goal-add',source_quote:'My goal is a fictional workshop',title:'Fictional workshop',measure:'Ten fictional participants'}]}));
 await domains.invoke('conversation-chat',{message:'My goal is a fictional workshop',conversation_id:'test'});
 assert.equal(store.list('goals')[0]?.status,'adopted');assert.ok(store.get('jobs','goal-work'));
 await domains.invoke('conversation-chat',{message:'My goal is a fictional workshop',conversation_id:'test'});assert.equal(store.list('goals').length,1);
 await assert.rejects(domains.invoke('conversation-chat',{message:'Hello',conversation_id:'other'}),/source|explicit/i);
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
