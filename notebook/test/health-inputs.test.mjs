import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {personalOperation} from '../core/personal-operations.mjs';
import {currentHealth,PHONE_SOURCE} from '../core/health-inputs.mjs';
import {healthFeedId} from '../core/health-feed-id.mjs';
import {acceptUpload} from '../core/phone-health.mjs';
import {jobExecutor} from '../core/runtime.mjs';

const setup=()=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-health-input-'))),query=new QueryService(store);
 store.save('settings',{id:'installation',owner:'local',timezone:'Europe/Berlin'});
 store.save('profiles',{id:'owner',timezone:'Europe/Berlin'});
 return {store,query};
};
test('fresh health excludes future, stale and hidden measurements and retains calendar-day precision',()=>{
 const {store,query}=setup(),now=Date.parse('2026-10-04T02:00:00Z');
 for(const row of [
  {id:'fresh',observed_at:'2026-10-03T10:00:00Z'},
  {id:'today-date-only',observed_at:'2026-10-04T12:00:00Z',observed_on:'2026-10-04',date_precision:'day'},
  {id:'future',observed_at:'2026-10-04T06:00:00Z'},
  {id:'future-day',observed_at:'2026-10-05T00:00:00Z',observed_on:'2026-10-05',date_precision:'day'},
  {id:'impossible-day',observed_at:'2026-10-03T00:00:00Z',observed_on:'2026-09-31',date_precision:'day'},
  {id:'stale',observed_at:'2026-09-01T10:00:00Z'},
  {id:'hidden',observed_at:'2026-10-03T10:00:00Z',ai_visibility:'hidden'},
 ])store.save('health_observations',{metric:'Fictional software checks',value:2,...row});
 const health=currentHealth(query,{now});
 assert.deepEqual(health.observations.map(r=>r.id).sort(),['fresh','today-date-only']);
 assert.equal(health.has_fresh_measurements,true);assert.equal(health.excluded_stale_or_future,4);
 assert.equal(health.timezone,'Europe/Berlin');
});
test('selected CSV corrections keep source history, reject impossible and future dates, and enter coaching sources',async()=>{
 const {store,query}=setup(),operation=input=>personalOperation({store,query},input);
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const content='date,fictional_software_checks\n'+day+',2\n';
 assert.equal(operation({type:'health-import-csv',source:'Fictional checks only',content}).imported,1);
 const before=store.list('health_observations')[0];assert.equal(before.date_precision,'day');assert.equal(before.observed_on,day);
 assert.equal(operation({type:'health-import-csv',source:'Fictional checks only',content}).imported,0);
 const corrected=content.replace(',2\n',',3\n');operation({type:'health-import-csv',source:'Fictional checks only',content:corrected});
 assert.equal(store.get('health_observations',before.id).value,3);
 assert.ok(store.list('record_history').some(r=>r.source_id===before.id&&r.snapshot.value===2));
 assert.equal(fs.readFileSync(path.join(store.root,before.source_file),'utf8'),content);
 for(const bad of ['2026-02-31','2999-01-01'])assert.throws(()=>operation({type:'health-import-csv',source:'Rejected fictional date',content:'date,fictional_software_checks\n'+bad+',9\n'}),/calendar dates/);
 assert.throws(()=>operation({type:'health-import-csv',source:'No numeric fictional measurements',content:'date,fictional_software_checks\n'+day+',unknown\n'}),/numeric measurement/);
 assert.equal(store.list('health_observations').length,1);
 let seen;
 const execute=jobExecutor(async input=>{seen=input.context;return 'Which fictional software check would help with the next test?';},query);
 await execute({id:'fictional-health-coach',kind:'coaching',area:'health'},{store,settings:store.get('settings','installation')});
 assert.equal(seen.health.length,1);assert.equal(seen.health[0].value,3);
 assert.equal(seen.health_freshness.has_fresh_measurements,true);
 assert.equal(query.rows('coach_talks')[0].sources.includes('fictional_software_checks'),true);
});
test('the phone and the selected CSV keep a day under the same id, so a CSV correction replaces the phone record',()=>{
 const {store,query}=setup(),operation=input=>personalOperation({store,query},input);
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 acceptUpload(store,{metrics:[{name:'step_count',units:'count',data:[{date:day+' 08:00:00 +0100',qty:100,source:'Fictional Phone'}]}],workouts:[]},{now:new Date()});
 const phone=store.list('health_observations');assert.equal(phone.length,1);
 assert.equal(phone[0].id,healthFeedId(PHONE_SOURCE,day,'steps'));
 operation({type:'health-import-csv',source:PHONE_SOURCE,content:'date,steps\n'+day+',250\n'});
 const all=store.list('health_observations');assert.equal(all.length,1,'one record, corrected in place');
 assert.equal(all[0].id,phone[0].id);assert.equal(all[0].value,250);assert.equal(phone[0].via,'phone-receiver');assert.ok(!all[0].via,'a CSV correction is not the phone receiver row any more');
 operation({type:'health-import-csv',source:'Fictional other feed',content:'date,steps\n'+day+',7\n'});
 assert.notEqual(store.list('health_observations').find(r=>r.value===7).id,phone[0].id);
});
test('two same-day records from two sources that are not the phone are both returned',()=>{
 const {store,query}=setup(),now=Date.parse('2026-10-04T12:00:00Z');
 for(const [id,source,value] of [['a','Fictional watch',1000],['b','Fictional scale app',2000]])store.save('health_observations',{id,metric:'steps',value,source,observed_on:'2026-10-04',date_precision:'day',observed_at:'2026-10-04T00:00:00Z'});
 const got=currentHealth(query,{now}).observations;
 assert.deepEqual(got.map(r=>r.id).sort(),['a','b']);
 assert.deepEqual(got.map(r=>r.value).sort((x,y)=>x-y),[1000,2000]);
});
test('rows that are not day records pass through whole, and the count of excluded rows ignores the ones a newer source replaced',()=>{
 const {store,query}=setup(),now=Date.parse('2026-10-04T12:00:00Z');
 const row=(id,source,extra)=>store.save('health_observations',{id,metric:'steps',value:1,source,...(source==='Health Auto Export'?{via:'phone-receiver'}:{}),observed_on:'2026-10-04',observed_at:'2026-10-04T08:00:00Z',...extra});
 row('t1',PHONE_SOURCE,{});row('t2','Fictional CSV',{});
 assert.deepEqual(currentHealth(query,{now}).observations.map(r=>r.id).sort(),['t1','t2'],'timestamped rows are never collapsed');
 row('d1',PHONE_SOURCE,{date_precision:'day',metric:'weight_kg'});row('d2','Fictional CSV',{date_precision:'day',metric:'weight_kg'});
 const health=currentHealth(query,{now});
 assert.equal(health.observations.filter(r=>r.metric==='weight_kg').length,1);
 assert.equal(health.excluded_stale_or_future,0,'a replaced row is not stale or future');
 // A row that names no day cannot be matched to another on one, whatever its precision says.
 for(const [id,source] of [['n1',PHONE_SOURCE],['n2','Fictional CSV']])store.save('health_observations',{id,metric:'sleep_total_h',value:7,source,...(source===PHONE_SOURCE?{via:'phone-receiver'}:{}),date_precision:'day',observed_at:'2026-10-04T08:00:00Z'});
 assert.deepEqual(currentHealth(query,{now}).observations.filter(r=>r.metric==='sleep_total_h').map(r=>r.id).sort(),['n1','n2']);
});
test('a CSV that someone labelled with the phone appname is still a CSV: nothing is collapsed unless the phone receiver wrote one of the rows',()=>{
 const {store,query}=setup(),operation=input=>personalOperation({store,query},input),now=Date.now();
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
 operation({type:'health-import-csv',source:PHONE_SOURCE,content:'date,steps\n'+day+',100\n'});
 operation({type:'health-import-csv',source:'Fictional other CSV',content:'date,steps\n'+day+',200\n'});
 const rows=store.list('health_observations');
 assert.equal(rows.length,2);assert.ok(rows.every(r=>!r.via),'a CSV import marks nothing as the phone');
 assert.deepEqual(currentHealth(query,{now}).observations.map(r=>r.value).sort((a,b)=>a-b),[100,200],'both desktop imports stay');
 // The phone receiver then writes the same day under its own id: only now is there a phone row to collapse against.
 acceptUpload(store,{metrics:[{name:'step_count',units:'count',data:[{date:day+' 08:00:00 +0100',qty:300,source:'Fictional Phone'}]}],workouts:[]},{now:new Date(now)});
 const phoneRow=store.list('health_observations').find(r=>r.via==='phone-receiver');
 assert.ok(phoneRow);assert.equal(phoneRow.id,healthFeedId(PHONE_SOURCE,day,'steps'),'it replaced the CSV that used the phone appname');
 assert.equal(store.list('health_observations').length,2);
 assert.deepEqual(currentHealth(query,{now}).observations.map(r=>r.value),[300],'now the phone row and the other CSV collapse to the newest');
});
