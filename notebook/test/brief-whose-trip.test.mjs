import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {jobExecutor} from '../core/runtime.mjs';import {dayOf} from '../core/trackers.mjs';
// Issue #386: the calendar made a booking mail into an event the owner organized, a collected
// summary turned that into "with <owner>", and the brief said "you fly" about someone else's flight.
const DAY=86400000,today=dayOf(new Date(),'UTC'),later=new Date(Date.now()+30*DAY).toISOString().slice(0,10);
const write=(root,relative,text)=>{const file=path.join(root,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);};
const HEALTH='No fresh fictional health observations are available.';
// A stand-in fact check that can only catch the wrong "you" from the records the brief hands it.
const run=async(store,duringCheck=()=>{})=>{
 const query=new QueryService(store),calls=[];
 const provider=async input=>{
  calls.push(input);
  if(input.kind==='brief-verification'){
   duringCheck(input);
   if(input.check!=='source-facts')return {passed:true,reason:'Fictional reader checked.',rejection_scope:'non-source',rejected_source_ids:[]};
   const {sources,draft}=input.context,note=sources.day_notes.find(n=>/Fictional Anna travel Lisbon/.test(n.title)),fact=sources.people.facts.find(f=>f.subject==='Fictional Anna'&&f.value==='Lisbon');
   if(/you fly/i.test(draft)&&note&&fact)return {passed:false,reason:'Fictional Anna is the one flying to Lisbon.',rejection_scope:'source-claims',rejected_source_ids:[fact.id]};
   return {passed:true,reason:'Fictional sources checked.',rejection_scope:'non-source',rejected_source_ids:[]};
  }
  if(input.phase==='write')return 'You fly to Lisbon at 10:25 today. '+HEALTH;
  assert.ok(input.context.check_feedback.some(reason=>/Fictional Anna/.test(reason)));
  return 'Fictional Anna flies to Lisbon at 10:25. '+HEALTH;
 };
 const result=await jobExecutor(provider,query)({kind:'morning-brief',id:'brief-whose-trip'},{store,settings:{}});
 const note=store.get('notes',result.record_id);
 return {saved:note.content,evidence:JSON.stringify(note.evidence??null),calls,writes:calls.filter(c=>c.kind==='morning-brief')};
};

test("someone else's trip in the owner's calendar is not told as the owner's, though the collected summary says it is",async()=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-brief-whose-trip-')));
 store.save('contacts',{name:'Fictional Anna'});
 const trip=store.save('notes',{title:'Fictional Anna travel Lisbon '+today+' - '+later,content:'Fictional packing list.',created_at:new Date(Date.now()-2*DAY).toISOString()});
 const old=store.save('notes',{title:'Fictional trip 2020-01-01 - 2020-01-05',content:'Long over.',created_at:'2020-01-01T08:00:00Z'});
 write(store.root,'world/claims/anna-travel.md','---\nsubject: fictional-anna\nattribute: travel\nvalue: Lisbon\nvalid_from: '+today+'\nvalid_to: '+later+'\n---\nFictional Anna flies to Lisbon.\n');
 write(store.root,'observations/calendar-today.md','10:25 to 05:30 Flight to Lisbon with Fictional Owner\n');
 const {saved,calls,writes}=await run(store),first=writes[0];
 assert.ok(first.context.workspace_sources.files.some(f=>f.path==='observations/calendar-today.md'));
 assert.ok(first.context.day_notes.some(n=>n.id===trip.id));
 assert.ok(!first.context.day_notes.some(n=>n.id===old.id));
 assert.match(first.contract,/not proof/);
 assert.match(calls.find(c=>c.check==='source-facts').contract,/names someone else/);
 assert.equal(writes.length,2);
 assert.doesNotMatch(saved,/you fly/i);
 assert.match(saved,/Fictional Anna flies to Lisbon/);
});

test("the owner's own flight is still told as the owner's",async()=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-brief-own-trip-')));
 store.save('contacts',{name:'Fictional Anna'});
 write(store.root,'observations/calendar-today.md','10:25 Flight to Lisbon\n');
 const {saved,writes}=await run(store),first=writes[0];
 assert.ok(!first.context.day_notes.some(n=>/Lisbon/.test(n.title+n.content)));
 assert.ok(!first.context.people.facts.some(f=>/Lisbon/.test(f.value)));
 assert.equal(writes.length,1);
 assert.match(saved,/You fly to Lisbon at 10:25 today\./);
});

test('a dated fact about a person or thing hidden from assistants reaches neither the brief nor its saved note',async()=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-brief-hidden-people-')));
 store.save('contacts',{name:'Fictional Hidden Bob',ai_visibility:'hidden'});
 store.save('entities',{name:'Fictional Secret Clinic',ai_visibility:'hidden'});
 write(store.root,'world/claims/bob-travel.md','---\nsubject: fictional-hidden-bob\nattribute: travel\nvalue: Rome\nvalid_from: '+today+'\nvalid_to: '+later+'\n---\nFictional Hidden Bob flies to Rome.\n');
 write(store.root,'world/claims/clinic-visit.md','---\nsubject: fictional-secret-clinic\nattribute: appointment\nvalue: Fictional therapy\nvalid_from: '+today+'\nvalid_to: '+later+'\n---\nFictional therapy session.\n');
 write(store.root,'observations/calendar-today.md','10:25 Flight to Lisbon\n');
 const {evidence,calls}=await run(store);
 for(const call of calls)assert.doesNotMatch(JSON.stringify(call.context),/Rome|Fictional therapy|Hidden Bob|Secret Clinic/);
 assert.doesNotMatch(evidence,/Rome|Fictional therapy|Hidden Bob|Secret Clinic/);
});

test('a people fact that changes while the brief is judged sends it back for a new draft',async()=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-brief-people-changed-')));
 store.save('contacts',{name:'Fictional Anna'});
 write(store.root,'observations/calendar-today.md','10:25 Flight to Lisbon\n');
 const changeOnce=input=>{if(input.check==='source-facts'&&!fs.existsSync(path.join(store.root,'world/claims/anna-travel.md')))write(store.root,'world/claims/anna-travel.md','---\nsubject: fictional-anna\nattribute: travel\nvalue: Lisbon\nvalid_from: '+today+'\nvalid_to: '+later+'\n---\nFictional Anna flies to Lisbon.\n');};
 await assert.rejects(run(store,changeOnce),/Briefing sources changed during judgment/);
 assert.equal(store.list('notifications').length,0);
});

test('a fact check that keeps rejecting a people fact by its id still ends in a checked factual brief',async()=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-brief-people-rejected-')));
 store.save('contacts',{name:'Fictional Anna'});
 write(store.root,'world/claims/anna-travel.md','---\nsubject: fictional-anna\nattribute: travel\nvalue: Lisbon\nvalid_from: '+today+'\nvalid_to: '+later+'\n---\nFictional Anna flies to Lisbon.\n');
 const query=new QueryService(store);let factId;
 const provider=async input=>{
  if(input.kind==='brief-verification'){
   if(input.check!=='source-facts')return {passed:true,reason:'Fictional reader checked.',rejection_scope:'non-source',rejected_source_ids:[]};
   factId=input.context.sources.people.facts.find(f=>f.subject==='Fictional Anna').id;
   return {passed:false,reason:'Fictional Anna is the one flying.',rejection_scope:'source-claims',rejected_source_ids:[factId]};
  }
  return 'You fly to Lisbon at 10:25 today. '+HEALTH;
 };
 await jobExecutor(provider,query)({kind:'morning-brief',id:'brief-people-rejected'},{store,settings:{}});
 const receipt=store.list('job_receipts').find(r=>r.kind==='brief-factual-fallback');
 assert.equal(receipt.state,'verified');
 assert.deepEqual(receipt.rejected_source_ids,[factId]);
});
