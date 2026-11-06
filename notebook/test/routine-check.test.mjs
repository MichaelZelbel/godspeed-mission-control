import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';import {installStarter} from '../core/starter-workspace.mjs';
import {readNotices} from '../core/notices.mjs';import {CONNECTION_NOTICE_PREFIX} from '../core/connection-names.mjs';
import {checkRoutines,routineFinding} from '../core/routine-check.mjs';import {runConnectionCheck} from '../scripts/connection-check.mjs';
import {STARTING_ROUTINES} from '../core/starting-routines.mjs';import {calendarCron} from '../core/routine-times.mjs';

for(const key of Object.keys(process.env))if(/^(GODSPEED_|HERMES_)/.test(key))delete process.env[key];

// "YOUR ROUTINES" IN THE DAILY CONNECTION CHECK (#239). The clock and the jobs list are made up.
const NOW=Date.parse('2026-11-05T05:00:00Z'),DAY='2026-11-05',ago=h=>new Date(NOW-h*3600000).toISOString(),ahead=h=>ago(-h);
const fixture=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-routine-check-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));installStarter(root);const home=path.join(root,'hermes');fs.mkdirSync(home);return {root,home,store:new Store(root,{device:'pc'})};};
const daily=(id,over={})=>({id,name:'Routine '+id,enabled:true,schedule:{kind:'cron',expr:'0 23 * * *'},created_at:ago(500),last_run_at:ago(30),last_status:'ok',next_run_at:ahead(18),...over});
const failing=(id,streak,over={})=>daily(id,{last_run_at:ago(5),last_status:'error',last_error:'Traceback\nstderr:\nthe backup disk is full',next_run_at:ahead(19),failure_streak:streak,...over});
const check=(f,jobs)=>checkRoutines({store:f.store,home:f.home,day:DAY,timezone:'UTC',now:()=>new Date(NOW),jobs});
const said=f=>readNotices(f.store);

test('a daily routine last run 30 hours ago is told once, and 20 hours ago says nothing',t=>{
 const f=fixture(t);
 check(f,[daily('late'),daily('fine',{schedule:{kind:'cron',expr:'0 9 * * *'},last_run_at:ago(20),next_run_at:ahead(4)})]);
 const [n,...rest]=said(f);assert.equal(rest.length,0);
 assert.ok(n.id.startsWith(CONNECTION_NOTICE_PREFIX));assert.match(n.text,/"Routine late" did not run when it was due Wednesday 4 November at 23:00/);assert.ok(!/Routine fine/.test(n.text));
 assert.ok(n.about&&n.facts.length===1);
 check(f,[daily('late'),daily('fine',{schedule:{kind:'cron',expr:'0 9 * * *'},last_run_at:ago(20),next_run_at:ahead(4)})]);assert.equal(said(f).length,1,'the same spell is not told again');
});

test('a first run is quiet until an occurrence after it was made is overdue',()=>{
 for(const schedule of [{kind:'cron',expr:'0 23 * * *'},{kind:'interval',minutes:1440}]){
  const job=daily('first',{schedule,created_at:'2026-11-04T23:30:00Z',last_run_at:null,last_status:null,next_run_at:'2026-11-05T23:00:00Z'});
  assert.equal(routineFinding(job,{},{now:NOW,day:DAY,timezone:'UTC'}).found,null);
 }
});

test('a quarter-hourly starting routine reports its latest missed occurrence',()=>{
 const job=daily('stepped',{schedule:{kind:'cron',expr:'*/15 * * * *'},last_run_at:'2026-11-05T03:30:00Z',next_run_at:'2026-11-05T05:15:00Z'});
 const {found}=routineFinding(job,{},{now:NOW,day:DAY,timezone:'UTC'});
 assert.match(found.words,/Thursday 5 November at 04:45/);
});

test('an unsupported Hermes cron does not create a missed-run notice',()=>{
 const job=daily('custom-month',{schedule:{kind:'cron',expr:'0 9 * 1 *'},last_run_at:'2025-01-09T09:00:00Z',next_run_at:'2027-01-09T09:00:00Z'});
 assert.equal(routineFinding(job,{},{now:NOW,day:DAY,timezone:'UTC'}).found,null);
});

test('an interval routine uses its own recurrence',()=>{
 const job=daily('interval',{schedule:{kind:'interval',minutes:15},last_run_at:'2026-11-05T04:30:00Z',next_run_at:'2026-11-05T05:15:00Z'});
 assert.match(routineFinding(job,{},{now:NOW,day:DAY,timezone:'UTC'}).found.words,/Thursday 5 November at 04:45/);
});

test('every cron schedule Godspeed emits has a prior occurrence',()=>{
 const settings=[
  {times:['09:00','16:00']},
  {times:['09:00'],weekdays:[1,3,5]},
  {times:['09:00'],month_day:31},
 ];
 for(const [index,expr] of [...STARTING_ROUTINES.map(r=>r.schedule),...settings.map(calendarCron)].entries()){
  const job=daily('emitted-'+index,{schedule:{kind:'cron',expr},last_run_at:ago(500),next_run_at:ahead(1)});
  assert.ok(routineFinding(job,{},{now:NOW+8*60000,day:DAY,timezone:'UTC'}).found,expr);
 }
});

test('weekday, month-day, and six-field Hermes schedules use only their own occurrences',()=>{
 const now=Date.parse('2026-11-05T12:00:00Z'),nextMonday='2026-11-09T09:00:00Z';
 const jobs=[
  daily('weekday',{schedule:{kind:'cron',expr:'0 9 * * 1'},last_run_at:'2026-11-02T09:00:00Z',next_run_at:nextMonday}),
  daily('month-day',{schedule:{kind:'cron',expr:'0 9 1 * *'},last_run_at:'2026-11-01T09:00:00Z',next_run_at:'2026-12-01T09:00:00Z'}),
  daily('seconds',{schedule:{kind:'cron',expr:'0 9 * * 1 30'},last_run_at:'2026-11-02T09:00:30Z',next_run_at:'2026-11-09T09:00:30Z'}),
 ];
 for(const job of jobs)assert.equal(routineFinding(job,{},{now,day:DAY,timezone:'UTC'}).found,null,job.id);
 const missed=daily('seconds-late',{schedule:{kind:'cron',expr:'0 9 * * 1 30'},last_run_at:'2026-10-26T09:00:30Z',next_run_at:'2026-11-09T09:00:30Z'});
 assert.match(routineFinding(missed,{},{now,day:DAY,timezone:'UTC'}).found.words,/Monday 2 November at 09:00/);
});

test('a selected seconds field stays quiet through its grace boundary',()=>{
 const job=daily('seconds-grace',{schedule:{kind:'cron',expr:'0 9 * * 1 30'},last_run_at:'2026-10-26T09:00:30Z',next_run_at:'2026-11-09T09:00:30Z'});
 assert.equal(routineFinding(job,{},{now:Date.parse('2026-11-02T11:00:30Z'),day:'2026-11-02',timezone:'UTC'}).found,null);
 assert.match(routineFinding(job,{},{now:Date.parse('2026-11-02T11:00:31Z'),day:'2026-11-02',timezone:'UTC'}).found.words,/Monday 2 November at 09:00/);
});

test('a month-day schedule finds its previous date across a month without it',()=>{
 const job=daily('month-end',{schedule:{kind:'cron',expr:'0 9 31 * *'},last_run_at:'2025-12-31T09:00:00Z',next_run_at:'2026-03-31T09:00:00Z'});
 assert.match(routineFinding(job,{},{now:Date.parse('2026-03-01T12:00:00Z'),day:'2026-03-01',timezone:'UTC'}).found.words,/Saturday 31 January at 09:00/);
});

test("a prior cron occurrence keeps the owner's non-UTC clock",()=>{
 const job=daily('berlin',{last_run_at:'2026-11-03T22:00:00Z',next_run_at:'2026-11-05T22:00:00Z'});
 const {found}=routineFinding(job,{},{now:NOW,day:DAY,timezone:'Europe/Berlin'});
 assert.match(found.words,/Wednesday 4 November at 23:00/);
});

test('a daily local cron keeps its grace boundary through Berlin spring daylight saving',()=>{
 const job=daily('berlin-spring',{schedule:{kind:'cron',expr:'0 9 * * *'},last_run_at:'2026-03-28T08:00:00Z',next_run_at:'2026-03-30T07:00:00Z'}),ctx={day:'2026-03-29',timezone:'Europe/Berlin'};
 assert.equal(routineFinding(job,{},{...ctx,now:Date.parse('2026-03-29T09:00:00Z')}).found,null);
 assert.match(routineFinding(job,{},{...ctx,now:Date.parse('2026-03-29T09:00:01Z')}).found.words,/Sunday 29 March at 09:00/);
});

test('one failure says nothing; two are told once with the error in plain words',t=>{
 const f=fixture(t);
 check(f,[failing('a',1)]);assert.equal(said(f).length,0);
 check(f,[failing('a',2,{last_run_at:ago(4)})]);
 assert.equal(said(f).length,1);assert.match(said(f)[0].text,/failed its last two runs: the backup disk is full/);assert.match(said(f)[0].text,/tries again/);
 check(f,[failing('a',3,{last_run_at:ago(3)})]);assert.equal(said(f).length,1,'the next check is silent');
});

test('an unsupported cron still reports two failed runs',t=>{
 const f=fixture(t);
 check(f,[failing('unsupported',2,{schedule:{kind:'cron',expr:'0 9 * 1 *'}})]);
 assert.equal(said(f).length,1);assert.match(said(f)[0].text,/"Routine unsupported" failed its last two runs/);
});

test('without a failure streak, two errored runs seen at different checks are not taken for consecutive',t=>{
 const f=fixture(t),bare=over=>{const j=failing('a',0,over);delete j.failure_streak;return j;};
 check(f,[bare()]);check(f,[bare({last_run_at:ago(1)})]);
 assert.equal(said(f).length,0,'a good run may have come between them');
});

// A daily-round routine: Hermes records the run as good and godspeed-routines-status.json says it failed.
const round=(f,now,failed,failure_streak=failed?1:0)=>{
 const job=daily('round',{script:'godspeed-daily-round-choose.py',last_run_at:new Date(now-5*3600000).toISOString(),next_run_at:new Date(now+19*3600000).toISOString()});
 fs.writeFileSync(path.join(f.home,'godspeed-routines-status.json'),JSON.stringify(failed?{decide:{failed:'the goal file is damaged',at:job.last_run_at,failure_streak}}:{}));
 return job;
};

test('two sidecar failures before one daily check are told together',t=>{
 const f=fixture(t),job=daily('work',{script:'godspeed-daily-round-work.py',last_run_at:'2026-11-04T16:00:00Z',next_run_at:'2026-11-05T10:00:00Z'});
 fs.writeFileSync(path.join(f.home,'godspeed-routines-status.json'),JSON.stringify({work:{failed:'the work item did not pass its check',at:job.last_run_at,failure_streak:2}}));
 check(f,[job]);
 assert.equal(said(f).length,1);assert.match(said(f)[0].text,/"Routine work" failed its last two runs: the work item did not pass its check/);
});

test('a failure only the status record shows is told at its second run, once, across days',t=>{
 const f=fixture(t),on=(day,now,failed,failure_streak)=>checkRoutines({store:f.store,home:f.home,day,timezone:'UTC',now:()=>new Date(now),jobs:[round(f,now,failed,failure_streak)]});
 const next=NOW+24*3600000,after=NOW+48*3600000,later=NOW+72*3600000;
 on(DAY,NOW,true,1);assert.equal(said(f).length,0,'one failed run says nothing');
 on('2026-11-06',next,true,2);assert.equal(said(f).length,1);assert.match(said(f)[0].text,/failed its last two runs: the goal file is damaged/);
 on('2026-11-07',after,true,3);assert.equal(said(f).length,1,'the same spell is not told on a later day');
 on('2026-11-08',later,false);assert.equal(said(f).length,1,'a good run closes it');
 on('2026-11-09',later+24*3600000,true,1);assert.equal(said(f).length,1,'a first failure after the good run says nothing');
 on('2026-11-10',later+48*3600000,true,2);assert.equal(said(f).length,2,'the second failure of a new spell is told');
});

test('a notice that could not be queued is told at the next check, also for a failure only the status record shows',t=>{
 const f=fixture(t),on=(day,now,failure_streak)=>checkRoutines({store:f.store,home:f.home,day,timezone:'UTC',now:()=>new Date(now),jobs:[round(f,now,true,failure_streak)]});
 const next=NOW+24*3600000,after=NOW+48*3600000,notices=path.join(f.store.state,'notices.json');
 on(DAY,NOW,1);
 fs.mkdirSync(notices,{recursive:true});
 assert.throws(()=>on('2026-11-06',next,2),/could not be queued/);
 fs.rmSync(notices,{recursive:true});
 on('2026-11-06',next,2);assert.equal(said(f).length,1);
});

test('a notice that could not be queued does not write a legacy error_run back',t=>{
 const f=fixture(t),late=daily('late');
 fs.writeFileSync(path.join(f.store.state,'connection-check-routines.json'),JSON.stringify({routines:{[late.id]:{ok_at:'2026-11-03T00:00:00Z',error_run:'obsolete'}}}));
 fs.mkdirSync(path.join(f.store.state,'notices.json'),{recursive:true});
 assert.throws(()=>check(f,[late]),/could not be queued/);
 const saved=JSON.parse(fs.readFileSync(path.join(f.store.state,'connection-check-routines.json'),'utf8')).routines[late.id];
 assert.equal('error_run' in saved,false);assert.equal('ok_at' in saved,false);
});

test('the same missed routine is told once on the first day, and not again on the next',t=>{
 const f=fixture(t);
 check(f,[daily('late')]);
 checkRoutines({store:f.store,home:f.home,day:'2026-11-06',timezone:'UTC',now:()=>new Date(NOW+24*3600000),jobs:[daily('late')]});
 assert.equal(said(f).length,1);
});

test('a good run closes the spell and a later failure is told again',t=>{
 const f=fixture(t);
 check(f,[failing('a',2)]);assert.equal(said(f).length,1);
 check(f,[daily('a',{last_run_at:ago(1),next_run_at:ahead(22)})]);
 check(f,[failing('a',2,{last_run_at:ahead(0.001)})]);
 assert.equal(said(f).length,2);
});

test('paused, switched off and made-today routines say nothing',t=>{
 const f=fixture(t);
 check(f,[daily('off',{enabled:false}),daily('paused',{paused_at:ago(9)}),failing('state-paused',2,{state:'paused',paused_at:null}),daily('new',{last_run_at:null,last_status:null,created_at:ago(2)}),failing('offfail',2,{enabled:false})]);
 assert.equal(said(f).length,0);
});

test('two found the same morning give one message naming both',t=>{
 const f=fixture(t);
 check(f,[daily('one'),failing('two',2)]);
 assert.equal(said(f).length,1);assert.match(said(f)[0].text,/Routine one/);assert.match(said(f)[0].text,/Routine two/);assert.equal(said(f)[0].facts.length,2);
});

test('the AI\'s sign-in error and the check\'s own routine say nothing from this source',t=>{
 const f=fixture(t);
 check(f,[failing('ai',2,{last_error:'AuthenticationError: invalid_api_key'}),failing('own',2,{script:'godspeed-connection-check.py'})]);
 assert.equal(said(f).length,0);
});

test('runConnectionCheck tells the routines even when the connections fail, and still rejects',async t=>{
 const f=fixture(t);
 fs.mkdirSync(path.join(f.store.state,'connection-check.json'),{recursive:true});
 await assert.rejects(runConnectionCheck({root:f.root,home:f.home,env:{GODSPEED_TODAY:DAY},probes:{},jobs:[daily('late',{last_run_at:new Date(Date.now()-30*3600000).toISOString(),next_run_at:new Date(Date.now()-6*3600000).toISOString()})]}));
 assert.equal(readNotices(f.store).filter(n=>/routines-/.test(n.id)).length,1);
});

test('runConnectionCheck records a refused connection when the routine notice cannot be queued',async t=>{
 const f=fixture(t),notices=path.join(f.store.state,'notices.json');
 const jobs={*[Symbol.iterator](){fs.rmSync(notices);fs.mkdirSync(notices);yield daily('late');}};
 const probes={ai:async()=>({set_up:false}),telegram:async()=>({set_up:true,ok:false,kind:'sign-in'}),github:async()=>({set_up:false}),mail:async()=>({set_up:false}),agentmail:async()=>({set_up:false}),phone:async()=>({set_up:false})};
 await assert.rejects(runConnectionCheck({root:f.root,home:f.home,env:{GODSPEED_TODAY:DAY},probes,jobs}),/routines notice could not be queued/);
 assert.equal(f.store.get('notifications','connection-telegram').status,'pending');
 const record=JSON.parse(fs.readFileSync(path.join(f.store.state,'connection-check.json'),'utf8'));
 assert.equal(record.connections.telegram.kind,'sign-in');assert.equal(record.day,DAY);
});

test('the check reads Hermes\' own jobs list from the home when none is given',async t=>{
 const f=fixture(t);
 fs.mkdirSync(path.join(f.home,'cron'));fs.writeFileSync(path.join(f.home,'cron','jobs.json'),JSON.stringify({jobs:[daily('late',{last_run_at:new Date(Date.now()-30*3600000).toISOString(),next_run_at:new Date(Date.now()-6*3600000).toISOString()})]}));
 await runConnectionCheck({root:f.root,home:f.home,env:{GODSPEED_TODAY:DAY},probes:{}});
 const [n,...rest]=said(f);assert.equal(rest.length,0);assert.match(n.text,/"Routine late" did not run when it was due/);
});

test('an old record with the removed error_run field is written back without it, paused or not',()=>{
 const prev={ok_at:'2026-01-01T00:00:00Z',error_run:'2026-01-02T00:00:00Z'},ctx={now:Date.parse('2026-01-03T00:00:00Z'),day:'2026-01-03',timezone:'UTC'};
 for(const job of [{id:'a',last_status:'ok',last_run_at:'2026-01-02T12:00:00Z'},{id:'a',state:'paused'}]){
  const {entry}=routineFinding(job,prev,ctx);
  assert.equal('error_run' in entry,false);assert.equal('ok_at' in entry,false);
 }
});
