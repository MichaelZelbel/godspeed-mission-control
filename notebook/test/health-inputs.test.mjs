import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {personalOperation} from '../core/personal-operations.mjs';
import {currentHealth,PHONE_SOURCE} from '../core/health-inputs.mjs';
import {healthFeedId,phoneFeedId} from '../core/health-feed-id.mjs';
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
test('health coaching refuses all provider prose while a phone column is unknown',async()=>{
 const {store,query}=setup(),day=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 store.save('health_observations',{metric:'protein_g',value:20,source:PHONE_SOURCE,via:'phone-receiver',observed_on:day,date_precision:'day',observed_at:day+'T00:00:00Z',data_until:'09:00:00'});
 const run=jobExecutor(async input=>{assert.equal(input.kind,'coaching');assert.match(input.contract,/may_be_incomplete and not_judged/);return {question:'Make up the protein gap now.',health_claims:[]};},query);
 await assert.rejects(run({id:'unknown-health-coach',kind:'coaching',area:'health'},{store,settings:store.get('settings','installation')}),/Assistant output cannot be used while phone health is unknown/);assert.equal(query.rows('coach_talks').length,0);
});
test('unknown phone health does not block non-health coaching',async()=>{
 const {store,query}=setup(),day=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 store.save('health_observations',{metric:'protein_g',value:20,source:PHONE_SOURCE,via:'phone-receiver',observed_on:day,date_precision:'day',observed_at:day+'T00:00:00Z',data_until:'09:00:00'});
 const run=jobExecutor(async input=>{assert.equal(input.kind,'coaching');assert.notEqual(input.context.area,'health');return {question:'What is one fictional next step for '+input.context.area+'?'};},query);
 for(const area of ['work-money','relationships'])await run({id:'unknown-non-health-coach-'+area,kind:'coaching',area},{store,settings:store.get('settings','installation')});
 assert.deepEqual(query.rows('coach_talks').map(talk=>talk.area).sort(),['relationships','work-money']);
});
test('the phone receiver and a CSV that carries the app name keep their own rows; the reader shows the newest of the two',()=>{
 const {store,query}=setup(),operation=input=>personalOperation({store,query},input);
 const now=Date.now(),day=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
 acceptUpload(store,{metrics:[{name:'step_count',units:'count',data:[{date:day+' 08:00:00 +0100',qty:100,source:'Fictional Phone'}]}],workouts:[]},{now:new Date(now)});
 const phone=store.list('health_observations');assert.equal(phone.length,1);
 assert.equal(phone[0].id,phoneFeedId(PHONE_SOURCE,day,'steps'));assert.equal(phone[0].via,'phone-receiver');
 assert.notEqual(phone[0].id,healthFeedId(PHONE_SOURCE,day,'steps'),'the phone has an id of its own inside the same scheme');
 operation({type:'health-import-csv',source:PHONE_SOURCE,content:'date,steps'+String.fromCharCode(10)+day+',250'+String.fromCharCode(10)});
 const all=store.list('health_observations');
 assert.equal(all.length,2,'both rows exist');
 const csv=all.find(r=>r.id===healthFeedId(PHONE_SOURCE,day,'steps')),phoneRow=all.find(r=>r.id===phone[0].id);
 assert.equal(csv.value,250);assert.equal(Object.hasOwn(csv,'via'),false,'the CSV row is not marked as the phone');
 assert.equal(phoneRow.value,100);assert.equal(phoneRow.via,'phone-receiver');
 assert.deepEqual(currentHealth(query,{now}).observations.map(r=>r.value),[250],'the CSV was written last, so it is shown');
 // The phone sends a changed value later: its own row changes, the CSV row keeps its value, and the phone row is now the newest.
 acceptUpload(store,{metrics:[{name:'step_count',units:'count',data:[{date:day+' 09:00:00 +0100',qty:60,source:'Fictional Phone'}]}],workouts:[]},{now:new Date(now+1000)});
 assert.equal(store.list('health_observations').find(r=>r.id===healthFeedId(PHONE_SOURCE,day,'steps')).value,250,'the CSV row kept its value');
 assert.equal(store.list('health_observations').length,2);
 assert.deepEqual(currentHealth(query,{now}).observations.map(r=>r.value),[160],'the phone row, written last, is shown');
 operation({type:'health-import-csv',source:'Fictional other feed',content:'date,steps'+String.fromCharCode(10)+day+',7'+String.fromCharCode(10)});
 assert.notEqual(store.list('health_observations').find(r=>r.value===7).id,phone[0].id);
 // Imitating the phone's name changes nothing about ids: see the next test.
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
 assert.equal(rows.length,2);assert.ok(rows.every(r=>!r.via),'a CSV import marks nothing as the phone');assert.ok(rows.every(r=>!Object.hasOwn(r,'via')),'an ordinary CSV row has no via property at all');
 assert.deepEqual(currentHealth(query,{now}).observations.map(r=>r.value).sort((a,b)=>a-b),[100,200],'both desktop imports stay');
 operation({type:'health-import-csv',source:'Fictional other CSV',content:'date,steps'+String.fromCharCode(10)+day+',210'+String.fromCharCode(10)});
 assert.ok(store.list('health_observations').every(r=>!Object.hasOwn(r,'via')),'a CSV correction adds no via property either');
 assert.ok(store.list('health_observations').some(r=>r.value===210));
});
test('a CSV named like the phone row, imported first, and then a phone upload: both rows survive with their own values',()=>{
 const now=Date.now(),day=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now)),nl=String.fromCharCode(10);
 for(const source of [PHONE_SOURCE+' (phone)',PHONE_SOURCE,'phone-receiver',PHONE_SOURCE+' phone-receiver']){
  const {store,query}=setup();personalOperation({store,query},{type:'health-import-csv',source,content:'date,steps'+nl+day+',250'+nl});
  acceptUpload(store,{metrics:[{name:'step_count',units:'count',data:[{date:day+' 08:00:00 +0100',qty:100,source:'Fictional Phone'}]}],workouts:[]},{now:new Date(now)});
  const rows=store.list('health_observations');
  assert.equal(rows.length,2,source);
  assert.equal(rows.find(r=>r.source===source&&r.via!=='phone-receiver').value,250,source+': the CSV row keeps its value');
  assert.equal(rows.find(r=>r.via==='phone-receiver').value,100,source+': the phone row has its own');
  assert.equal(new Set(rows.map(r=>r.id)).size,2);
 }
});

test('phone day state uses its strict cutoff, while manual and food entries settle only their columns',async()=>{
 const {store,query}=setup(),now=Date.parse('2026-11-05T10:00:00Z'),day='2026-11-04',phone=(metric,value,data_until='19:55:00')=>store.save('health_observations',{metric,value,source:PHONE_SOURCE,via:'phone-receiver',observed_on:day,date_precision:'day',observed_at:day+'T00:00:00Z',data_until});
 phone('steps',100);phone('protein_g',20);phone('active_kcal',400,'21:00:00');
 const short=currentHealth(query,{now}).days[0];
 assert.equal(short.columns.steps.state,'may_be_incomplete');assert.equal(short.columns.active_kcal.state,'may_be_incomplete','21:00:00 is not past the cutoff');
 store.save('collections',{id:'food',tracker:{specialist:'food'}});const item=store.save('collection_items',{collection_id:'food',data:{when:day+' 12:00',kcal:700,protein_g:30,carbs_g:90,fat_g:20}});
 let state=currentHealth(query,{now}).days[0];assert.deepEqual(state.columns.steps,{value:100,source:'phone',state:'may_be_incomplete'});assert.deepEqual(Object.fromEntries(['food_kcal','protein_g','carbs_g','fat_g'].map(metric=>[metric,state.columns[metric]])),{food_kcal:{value:700,source:'food_tracker',state:'settled'},protein_g:{value:30,source:'food_tracker',state:'settled'},carbs_g:{value:90,source:'food_tracker',state:'settled'},fat_g:{value:20,source:'food_tracker',state:'settled'}});
 store.save('health_observations',{metric:'distance_km',value:3,source:PHONE_SOURCE,via:'phone-receiver',observed_on:day,date_precision:'day',observed_at:day+'T00:00:00Z',data_until:'21:00:30'});
 assert.equal(currentHealth(query,{now}).days[0].columns.distance_km.state,'complete');
 const operation=input=>personalOperation({store,query},input);operation({type:'health-add',metric:'protein_g',value:80,unit:'g',observed_at:day+'T12:00:00Z'});
 phone('protein_g',5,'19:55:00');
 state=currentHealth(query,{now}).days[0];assert.deepEqual(state.columns.protein_g,{value:80,source:'manual',state:'settled'});assert.equal(state.columns.steps.state,'complete');
 store.save('collection_items',{id:item.id,data:{when:day+' 12:00',kcal:750,protein_g:30,carbs_g:90,fat_g:20}});assert.equal(currentHealth(query,{now}).days[0].columns.food_kcal.value,750,'a tracker correction is the next read');
 const today='2026-11-05';store.save('health_observations',{metric:'steps',value:200,source:PHONE_SOURCE,via:'phone-receiver',observed_on:today,date_precision:'day',observed_at:today+'T00:00:00Z',data_until:'09:00:00'});
 assert.equal(currentHealth(query,{now}).days.find(row=>row.date===today).columns.steps.state,'not_judged');
 store.save('health_observations',{metric:'steps',value:300,source:'Fictional CSV',observed_on:'2026-11-03',date_precision:'day',observed_at:'2026-11-03T00:00:00Z'});
 assert.equal(currentHealth(query,{now}).days.find(row=>row.date==='2026-11-03').columns.steps.state,'legacy');
});

test('pre-phone health-add rows settle the oldest local day ahead of later phone uploads',()=>{
 const {store,query}=setup(),now=Date.parse('2026-11-05T10:00:00Z'),day='2026-10-29';
 for(const [metric,value,source_id] of [['protein_g',80,null],['carbs_g',90,'historical-message']]){
  store.save('health_observations',{metric,value,unit:'g',observed_at:'2026-10-28T23:30:00Z',source_id});
  store.save('health_observations',{metric,value:5,source:PHONE_SOURCE,via:'phone-receiver',observed_on:day,date_precision:'day',observed_at:day+'T00:00:00Z',data_until:'19:55:00'});
 }
 const columns=currentHealth(query,{now}).days.find(entry=>entry.date===day).columns;
 assert.deepEqual(columns.protein_g,{value:80,source:'manual',state:'settled'});
 assert.deepEqual(columns.carbs_g,{value:90,source:'manual',state:'settled'});
});

test('the installation timezone leaves its current phone day unjudged',()=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-health-timezone-'))),query=new QueryService(store),now=Date.parse('2026-11-06T01:00:00Z');
 store.save('settings',{id:'installation',timezone:'America/Los_Angeles'});
 store.save('health_observations',{metric:'steps',value:100,source:PHONE_SOURCE,via:'phone-receiver',observed_on:'2026-11-05',date_precision:'day',observed_at:'2026-11-05T00:00:00Z',data_until:'09:00:00'});
 const health=currentHealth(query,{now});
 assert.equal(health.timezone,'America/Los_Angeles');assert.equal(health.days[0].columns.steps.state,'not_judged');
});

test('the Food settlement mapping points at number fields the Food schema really declares, for health columns the phone also fills',async()=>{
 const {foodSchema,FOOD_TOTAL_COLUMNS}=await import('../core/food.mjs'),{PHONE_SUM_METRICS}=await import('../core/phone-health-columns.mjs');
 const fields=new Map(foodSchema().map(field=>[field.key,field]));
 for(const [healthColumn,foodField] of Object.entries(FOOD_TOTAL_COLUMNS)){
  assert.equal(fields.get(foodField)?.type,'number',healthColumn+' settles from Food field '+foodField+', which must be a number field of the Food schema');
  assert.ok(Object.values(PHONE_SUM_METRICS).includes(healthColumn),healthColumn+' is a day column the phone also fills');
 }
});
