import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {personalOperation} from '../core/personal-operations.mjs';
import {currentHealth} from '../core/health-inputs.mjs';
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
