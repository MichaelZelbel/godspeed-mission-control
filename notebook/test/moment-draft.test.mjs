import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains,momentDraft} from '../core/domains.mjs';
import {createService} from '../server/main.mjs';

// The Add Moment form's "Suggest title and other values" got "scheduled",
// "neutral", "high", a timestamp and "people"; the form reads past_fact /
// future_plan / ongoing / unknown, numbers, a date and "participants", so all
// of it fell back to defaults (6 October 2026).
test('a moment draft arrives in the form\'s own values',()=>{
  assert.deepEqual(momentDraft({title:'Knee MRI',happened_at:'2026-10-12T09:00:00Z',status:'scheduled',impact_level:'neutral',confidence_date:'high',confidence_truth:7.6,people:['Fictional Ana']}),
    {title:'Knee MRI',happened_at:'2026-10-12',happened_end:null,status:'future_plan',impact_level:2,confidence_date:8,confidence_truth:8,participants:['Fictional Ana'],people:['Fictional Ana']});
  assert.equal(momentDraft({status:'past_fact',impact_level:9}).impact_level,4);
});
test('the model is told today and the form\'s values, and its answer is normalized',async()=>{
  const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-draft-'))),domains=new Domains(new QueryService(store));let seen;
  domains.provider=async input=>{seen=input;return {draft:{title:'Knee MRI',happened_at:'2026-10-12',status:'scheduled',impact_level:'2',confidence_date:9,confidence_truth:9,participants:['Dr. Example']}};};
  const result=await domains.invoke('draft-event',{messages:[{role:'user',content:'Knee MRI on Monday'}],today:'2026-10-06',people:[]});
  assert.equal(seen.input.today,'2026-10-06');assert.match(seen.contract,/past_fact, future_plan, ongoing, unknown/);assert.match(seen.contract,/input\.today/);
  assert.equal(result.draft.status,'future_plan');assert.equal(result.draft.impact_level,2);
});

test('drafting sends only the current description, day and names without retrieving or saving records',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-focused-draft-')),store=new Store(root),query=new QueryService(store),domains=new Domains(query);
  store.save('notes',{title:'Private unrelated record',content:'PRIVATE-RECORD-MUST-NOT-LEAVE'});
  store.save('contacts',{name:'Fictional Ana',notes:'PRIVATE-CONTACT-DETAILS'});
  domains.index={search(){assert.fail('Drafting must not search the notebook');}};
  query.rows=()=>assert.fail('Drafting must not read notebook tables');
  store.waitForWriter=()=>assert.fail('Drafting must not wait for an unrelated notebook write');
  let seen,calls=0;
  domains.provider=async request=>{seen=request;calls++;return {draft:{title:'Dinner',description:'Dinner with Ana tomorrow',happened_at:'2026-10-17',status:'future_plan',impact_level:1,confidence_date:9,confidence_truth:8,participants:['Fictional Ana']},notes_created:[{title:'Unasked',content:'Do not save'}]};};
  const result=await domains.invoke('draft-event',{messages:[{role:'system',content:'OLD-CHAT-MUST-NOT-LEAVE'},{role:'user',content:'Earlier request'},{role:'user',content:'Dinner with Ana tomorrow'}],today:'2026-10-16',people:[{name:'Fictional Ana',notes:'PRIVATE-CONTACT-DETAILS'}],unrelated:'UNRELATED-INPUT-MUST-NOT-LEAVE'});
  assert.deepEqual(seen.input,{messages:[{role:'user',content:'Dinner with Ana tomorrow'}],today:'2026-10-16',people:[{name:'Fictional Ana'}]});
  assert.equal(seen.context,undefined);assert.doesNotMatch(JSON.stringify(seen),/PRIVATE-|OLD-CHAT|UNRELATED-/);assert.equal(calls,1);
  assert.deepEqual(Object.keys(result),['draft']);assert.equal(result.draft.title,'Dinner');assert.equal(store.list('moments').length,0);assert.equal(store.list('notes').length,1);
});

test('English and German drafts preserve date spans, source language and known participant names',async()=>{
  const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-language-draft-'))),domains=new Domains(new QueryService(store));
  for(const fixture of [
    {text:'Trip with Ana from October 19 to 21',title:'Trip with Ana',start:'2026-10-19',end:'2026-10-21'},
    {text:'Reise mit Ana von Montag bis Mittwoch',title:'Reise mit Ana',start:'2026-10-19',end:'2026-10-21'}
  ]){
    domains.provider=async request=>{assert.match(request.contract,/same language/i);assert.match(request.contract,/coming one/);assert.match(request.contract,/input\.people/);return {draft:{title:fixture.title,description:fixture.text,happened_at:fixture.start,happened_end:fixture.end,status:'future_plan',impact_level:1,confidence_date:8,confidence_truth:8,participants:['Fictional Ana']}};};
    const result=await domains.invoke('draft-event',{messages:[{role:'user',content:fixture.text}],today:'2026-10-16',people:[{name:'Fictional Ana'}]});
    assert.equal(result.draft.title,fixture.title);assert.equal(result.draft.description,fixture.text);assert.equal(result.draft.happened_at,fixture.start);assert.equal(result.draft.happened_end,fixture.end);assert.deepEqual(result.draft.participants,['Fictional Ana']);
  }
});

test('malformed suggestions fail clearly without a second AI call or saved moment',async()=>{
  const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-invalid-draft-'))),domains=new Domains(new QueryService(store));
  for(const response of ['not JSON',{draft:{}},{draft:{title:'Incomplete'}},{draft:{title:'Bad date',happened_at:'tomorrow',status:'future_plan',impact_level:1,confidence_date:8,confidence_truth:8,participants:[]}},{reply:'I saved it'}]){
    let calls=0;domains.provider=async()=>{calls++;return response;};
    await assert.rejects(domains.invoke('draft-event',{messages:[{role:'user',content:'Dinner tomorrow'}],today:'2026-10-16'}),/try again/i);
    assert.equal(calls,1);assert.equal(store.list('moments').length,0);
  }
});

test('the suggestion HTTP endpoint answers while an unrelated notebook writer holds the lock',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-draft-http-lock-'));
  const service=await createService({root,port:0,provider:async()=>({draft:{title:'Dinner',description:'Dinner tomorrow',happened_at:'2026-10-17',happened_end:null,status:'future_plan',impact_level:1,confidence_date:8,confidence_truth:8,participants:[]}})});
  const lock=path.join(service.store.state,'workspace.lock');fs.writeFileSync(lock,JSON.stringify({pid:process.pid,at:new Date().toISOString()}));
  try{
    const response=await fetch('http://127.0.0.1:'+service.address.port+'/api/functions/draft-event',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:'Dinner tomorrow'}],today:'2026-10-16',people:[]}),signal:AbortSignal.timeout(1000)});
    assert.equal(response.status,200);assert.equal((await response.json()).data.draft.title,'Dinner');assert.equal(service.store.list('moments').length,0);
  }finally{fs.unlinkSync(lock);await service.close();}
});

test('a suggestion stops after twenty seconds and aborts the underlying AI call',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-timeout-draft-'))),domains=new Domains(new QueryService(store));let signal;
  domains.provider=request=>{signal=request.signal;assert.equal(request.timeout_ms,20000);return new Promise(()=>{});};
  const pending=domains.invoke('draft-event',{messages:[{role:'user',content:'Dinner tomorrow'}],today:'2026-10-16'});
  const rejected=assert.rejects(pending,/20 seconds.*try again/i);
  t.mock.timers.tick(20000);await rejected;assert.equal(signal.aborted,true);assert.equal(store.list('moments').length,0);
});
