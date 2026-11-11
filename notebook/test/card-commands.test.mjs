import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {Domains} from '../core/domains.mjs';import {commandWords,nativeCardRows} from '../core/card-commands.mjs';
const fixture=()=>{const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-cards-')));return {store,domains:new Domains(new QueryService(store))};};

test('cancelling projected native work preserves its complete multiline task and check',async()=>{
 const {store,domains}=fixture(),title='Fictional exact checklist\nStop watering when wet.\nRecord both sensor readings.',check='Exact three-line source\nNo additional steps.';
 const work=store.save('work_items',{id:'fictional-multiline-work',title,goal_id:'fictional-goal',state:'awaiting_approval',kind:'local-note',check,allowed_action:null,attempts:0});
 await domains.invoke('conversation-chat',{conversation_id:'fictional-cancel',message:'/work cancel '+work.id+' --why "Unapproved duplicate fictional task"',request_id:'cancel-once'});
 const current=store.get('work_items',work.id);assert.equal(current.state,'cancelled');assert.equal(current.title,title);assert.equal(current.check,check);assert.equal(current.allowed_action,null);assert.equal(current.attempts,0);assert.equal(current.kind,'local-note');
 assert.equal(store.list('record_history').some(h=>h.source_id===work.id&&h.snapshot.title===title),true);
});
test('chat exposes original forecast validation, retained revisions and scoring with canonical records',async()=>{
 const {store,domains}=fixture(),run=message=>domains.invoke('conversation-chat',{conversation_id:'fictional',message,request_id:message});
 await assert.rejects(run('/forecast file --id fictional --question "Workshop ready" --resolves-when "Checklist exists" --deadline 2030-01-01 --p 0.712 --reference-class "Fictional prior workshops including failures" --evidence "Fictional records"'),/two decimals/);
 await run('/forecast file --id fictional --question "Workshop ready" --resolves-when "Checklist exists" --deadline 2030-01-01 --p 0.70 --reference-class "Fictional prior workshops including failures" --evidence "Fictional records"');assert.equal(store.get('forecasts','fictional').probability,0.7);
 await run('/forecast revise fictional --p 0.60 --why "One checklist item remains"');assert.equal(store.get('forecasts','fictional').probability,0.6);assert.ok(store.get('forecasts','fictional').legacy_log.some(l=>l.event==='REVISED'));
 await run('/forecast resolve fictional --outcome no --evidence "Fictional workshop cancelled"');assert.equal(store.get('forecasts','fictional').observed,false);const result=await run('/forecast score --json');assert.ok(result.reply.includes('0.36'));
 assert.equal(store.list('forecasts').length,1);assert.equal(store.list('record_history').filter(h=>h.source_type==='forecasts').length>0,true);
});
test('explicit journal command parsing preserves quoted words and retries once',async()=>{
 const {store,domains}=fixture();assert.deepEqual(commandWords('/journal note "Words with spaces"'),['/journal','note','Words with spaces']);const input={message:'/journal note "Fictional next move"',conversation_id:'fictional',request_id:'one'};await domains.invoke('conversation-chat',input);await domains.invoke('conversation-chat',input);assert.equal(domains.query.rows('journal').filter(j=>j.content==='Fictional next move').length,1);assert.ok(store.get('jobs','journal-tick'));
});
test('a work card the person postponed is mirrored as held, and as waiting for approval once the hold ends',()=>{
 const {store}=fixture(),root=store.root,today=process.env.GODSPEED_TODAY;
 fs.mkdirSync(path.join(root,'work'),{recursive:true});fs.mkdirSync(path.join(root,'world','claims'),{recursive:true});
 const card=(id,touches)=>fs.writeFileSync(path.join(root,'work',id+'.md'),`ID: ${id}\nSTATUS: blocked\nKEY: apply-${id}\n${touches?`TOUCHES: ${touches}\n`:''}WHAT: Answer the podcast's interview invitation about the book\nDONE WHEN: answered\nOWNER: godspeed\nNEEDS: authorization\nOUTWARD: yes\nSOURCE: next-action\n\n## Log\n`);
 card('W-1','the-book');card('W-2','');
 const claim=validTo=>fs.writeFileSync(path.join(root,'world','claims','the-book--interview-stance--2026-09-10.md'),`---\nsubject: the-book\nattribute: interview-stance\nvalue: not yet, only once the book is out of beta\nstance: postponed\nsteps: [interview]\nvalid_from: 2026-09-10\n${validTo?`valid_to: ${validTo}\n`:''}---\n`);
 const rows=()=>Object.fromEntries(nativeCardRows(store,'work_items').map(r=>[r.id,r]));
 try{
  process.env.GODSPEED_TODAY='2026-09-26';claim('');
  let r=rows();assert.equal(r['W-1'].state,'held');assert.equal(r['W-1'].held_by,'world/claims/the-book--interview-stance--2026-09-10.md');
  assert.equal(r['W-2'].state,'awaiting_approval');assert.equal(r['W-2'].held_by,undefined);
  claim('2026-09-20');r=rows();assert.equal(r['W-1'].state,'awaiting_approval');assert.equal(r['W-1'].held_by,undefined);
 }finally{if(today===undefined)delete process.env.GODSPEED_TODAY;else process.env.GODSPEED_TODAY=today;}
});
