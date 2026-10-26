import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {jobExecutor} from '../core/runtime.mjs';
import {addonCommand} from '../core/native-personal.mjs';
import {readEvents} from '../../third-party/addons/godspeed-charm/lib/record.mjs';

// The Charm Challenge line in the notebook's own morning brief: written by the add-on, carried word
// for word as one line, enforced by the gate like the cycle heads-up, and never ending a challenge
// from a rehearsal.
const RUNNING='Charm Challenge: day 10 of 21, 12 days to go.';
const FINISH='Charm Challenge done: 21 days. Restarts on the way: 0.';
const OK='No fresh health observations are recorded. Your day is open.';
function fixture(start){
 process.env.GODSPEED_CHARM_NOW='2026-10-21T08:00:00Z';
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-charm-brief-'))),query=new QueryService(store);
 store.save('settings',{id:'installation',timezone:'Europe/Berlin'});
 if(start)addonCommand(store,{addon:'charm',args:['start']});
 return {store,query};
}
const finishes=store=>readEvents(store.root).filter(e=>e.kind==='finish').length;
test.after(()=>{delete process.env.GODSPEED_CHARM_NOW;delete process.env.GODSPEED_NOW;});

test('a running challenge puts its line in the brief, and the gate refuses a draft without it',async()=>{
 const {store,query}=fixture(true);
 process.env.GODSPEED_CHARM_NOW='2026-10-30T08:00:00Z';process.env.GODSPEED_NOW='2026-10-30T08:00:00Z';
 let writes=0;
 const provider=async input=>{
  if(input.kind==='brief-verification')return {passed:true,reason:'Fictional sources checked.'};
  assert.equal(input.context.charm_line,RUNNING);
  assert.match(input.writerContract||JSON.stringify(input),/When charm_line is a line, put it in word for word as one line of its own, and say nothing else about the Charm Challenge\./);
  if(++writes===1)return OK;
  assert.ok(input.context.check_feedback.some(f=>f==='Include the Charm Challenge line word for word, as one line of its own'));
  return OK+'\n\n'+RUNNING;
 };
 const result=await jobExecutor(provider,query)({kind:'morning-brief',id:'brief-charm'},{store,settings:{}});
 assert.equal(writes,2);assert.ok(store.get('notes',result.record_id).content.endsWith(RUNNING));
});

// The walk-through of 26 October 2026, with a real model: the plain-words check failed the whole
// note twice, calling the line "an unexplained internal game/tracking mechanic", while the gate
// requires it. Both checks are told the line is the person's own and is checked in code.
test('the brief\'s checks are told the line is the person\'s own, so they never fail the note for it',async()=>{
 const {store,query}=fixture(true);
 process.env.GODSPEED_CHARM_NOW='2026-10-30T08:00:00Z';process.env.GODSPEED_NOW='2026-10-30T08:00:00Z';
 const contracts=[];
 const provider=async input=>{
  if(input.kind==='brief-verification'){
   contracts.push(input.contract);
   // As the real model judged: the line fails the note unless the check is told what it is.
   if(input.context.draft.includes(RUNNING)&&!input.contract.includes('"'+RUNNING+'"'))return {passed:false,reason:'An unexplained internal game/tracking mechanic.'};
   return {passed:true,reason:'Fictional sources checked.'};
  }
  return OK+'\n\n'+RUNNING;
 };
 const result=await jobExecutor(provider,query)({kind:'morning-brief',id:'brief-charm-checks'},{store,settings:{}});
 assert.ok(store.get('notes',result.record_id).content.endsWith(RUNNING));
 assert.equal(contracts.length,2,'one source check and one plain-words check, no rewrite');
 for(const contract of contracts)assert.match(contract,/the person's own Charm Challenge count/);
});

test('no challenge: no line, and the gate ignores it',async()=>{
 const {store,query}=fixture(false);
 const provider=async input=>{if(input.kind==='brief-verification')return {passed:true,reason:'Fictional sources checked.'};assert.equal(input.context.charm_line,null);return OK;};
 await jobExecutor(provider,query)({kind:'morning-brief',id:'brief-no-charm'},{store,settings:{}});
});

test('on the finish day the line is the finish line; a rehearsal writes no finish event, the real brief does',async()=>{
 const {store,query}=fixture(true);
 process.env.GODSPEED_CHARM_NOW='2026-11-11T08:00:00Z';process.env.GODSPEED_NOW='2026-11-11T08:00:00Z';
 const seen=[];
 const provider=async input=>{if(input.kind==='brief-verification')return {passed:true,reason:'Fictional sources checked.'};seen.push(input.context.charm_line);return OK+'\n'+input.context.charm_line;};
 assert.equal(finishes(store),0);
 await jobExecutor(provider,query)({kind:'morning-brief',id:'brief-rehearse',rehearsal:true},{store,settings:{}});
 assert.match(seen[0],/^Charm Challenge done: 21 days\./);
 assert.equal(finishes(store),0);
 await jobExecutor(provider,query)({kind:'morning-brief',id:'brief-finish'},{store,settings:{}});
 assert.equal(seen[1],seen[0]);assert.equal(finishes(store),1);
});
