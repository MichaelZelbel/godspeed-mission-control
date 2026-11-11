import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {jobExecutor} from '../core/runtime.mjs';import {dayOf} from '../core/trackers.mjs';
// Issue #386: the calendar made a booking mail into an event the owner organized, a collected
// summary turned that into "with <owner>", and the brief said "you fly" about someone else's flight.
const DAY=86400000,today=dayOf(new Date(),'UTC'),later=new Date(Date.now()+30*DAY).toISOString().slice(0,10);
const write=(root,relative,text)=>{const file=path.join(root,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);};
const HEALTH='No fresh fictional health observations are available.';
// A stand-in fact check that can only catch the wrong "you" from the records the brief hands it.
const run=async store=>{
 const query=new QueryService(store),calls=[];
 const provider=async input=>{
  calls.push(input);
  if(input.kind==='brief-verification'){
   if(input.check!=='source-facts')return {passed:true,reason:'Fictional reader checked.',rejection_scope:'non-source',rejected_source_ids:[]};
   const {sources,draft}=input.context,note=sources.day_notes.find(n=>/Fictional Anna travel Lisbon/.test(n.title)),fact=sources.people.facts.find(f=>f.subject==='Fictional Anna'&&f.value==='Lisbon');
   if(/you fly/i.test(draft)&&note&&fact)return {passed:false,reason:'Fictional Anna is the one flying to Lisbon.',rejection_scope:'source-claims',rejected_source_ids:[note.id]};
   return {passed:true,reason:'Fictional sources checked.',rejection_scope:'non-source',rejected_source_ids:[]};
  }
  if(input.phase==='write')return 'You fly to Lisbon at 10:25 today. '+HEALTH;
  assert.ok(input.context.check_feedback.some(reason=>/Fictional Anna/.test(reason)));
  return 'Fictional Anna flies to Lisbon at 10:25. '+HEALTH;
 };
 const result=await jobExecutor(provider,query)({kind:'morning-brief',id:'brief-whose-trip'},{store,settings:{}});
 return {saved:store.get('notes',result.record_id).content,calls,writes:calls.filter(c=>c.kind==='morning-brief')};
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
