import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {addHabit,track,untrack,setStatus,setHabitSchedule,setHabitDisplay,exemptHabitDays,readHabit,stats,initializeHabitProgress} from '../lib/habits.mjs';
import {habitProgress} from '../lib/progress.mjs';import {addDays} from '../lib/clock.mjs';import {tmpMission,area} from './helpers.mjs';
function fixture({start='2026-10-01',days='daily',timezone='Europe/Berlin'}={}) {const mc=tmpMission({'coach/health/area.md':area()});return addHabit(mc,{area:'health',title:'Read one page',doneMeans:'One page',days,timezone},start);}
const progress=(h,date,more={})=>habitProgress(h,{now:new Date(date+'T12:00:00Z'),...more});
const status=(p,date)=>p.calendar.find(d=>d.date===date)?.status;

test('full-history lifetime days survive breaks and duplicates; protection adds no completions',()=>{
 let h=fixture({start:'2023-01-01'});const lines=[];for(let i=0;i<1000;i++)lines.push(`- ${addDays('2023-01-01',i)} done (test) "read"`);
 fs.appendFileSync(h.file,lines.join('\n')+'\n');h=readHabit(h.file);
 let p=progress(h,'2025-09-26');assert.equal(p.lifetimeCompletedDays,1000);assert.equal(p.currentRun,1000);assert.equal(p.longestRun,1000);
 h=track(h,'2025-09-26','done');p=progress(h,'2025-10-04');assert.equal(p.lifetimeCompletedDays,1000);assert.equal(p.currentRun,0);assert.equal(p.longestRun,1000);assert.equal(p.achievements.at(-1).days,1000);
 h=track(h,'2025-10-04','done');p=progress(h,'2025-10-04');assert.equal(p.currentRun,1);assert.equal(p.lifetimeCompletedDays,1001);
});

test('two automatic protections per rolling30 days; late correction refunds one; skips never spend',()=>{
 let h=fixture();h=track(h,'2026-10-01','done');h=track(h,'2026-10-02','no');h=track(h,'2026-10-03','skip');h=track(h,'2026-10-04','no');h=track(h,'2026-10-05','no');h=track(h,'2026-10-06','done');
 let p=progress(h,'2026-10-06');assert.equal(status(p,'2026-10-02'),'protected');assert.equal(status(p,'2026-10-03'),'paused');assert.equal(status(p,'2026-10-04'),'protected');assert.equal(status(p,'2026-10-05'),'missed');assert.equal(p.currentRun,1);assert.equal(p.lifetimeCompletedDays,2);
 h=track(h,'2026-10-02','done');p=progress(h,'2026-10-06');assert.equal(status(p,'2026-10-05'),'protected');assert.equal(p.currentRun,3);
 h=untrack(h,'2026-10-02');p=progress(h,'2026-10-06');assert.equal(p.currentRun,1);assert.equal(p.lifetimeCompletedDays,2);
});

test('actual answers, unlimited illness and dated pause history remain distinct',()=>{
 let h=fixture();h=track(h,'2026-10-01','done');h=setStatus(h,'paused','2026-10-02');h=setStatus(h,'active','2026-10-09');h=track(h,'2026-10-09','done');
 let p=progress(h,'2026-10-09');assert.equal(p.currentRun,2);assert.equal(p.protections.used,0);assert.equal(status(p,'2026-10-05'),'paused');
 h=exemptHabitDays(h,'2026-10-10','2026-11-20','hospital');h=track(h,'2026-11-21','done');p=progress(h,'2026-11-21');assert.equal(p.currentRun,3);assert.equal(p.lifetimeCompletedDays,3);assert.equal(p.protections.used,0);
 assert.equal(stats(h,'2026-10-09',9).applicable,2);
});

test('selected weekdays and schedule effective dates do not reinterpret old opportunities',()=>{
 let h=fixture({start:'2026-10-05',days:'mon,wed,fri'});for(const d of ['2026-10-05','2026-10-07','2026-10-09'])h=track(h,d,'done');
 h=setHabitSchedule(h,'daily','2026-10-10');h=track(h,'2026-10-10','done');h=track(h,'2026-10-11','done');let p=progress(h,'2026-10-11');assert.equal(p.currentRun,5);assert.equal(status(p,'2026-10-06'),'notplanned');assert.equal(status(p,'2026-10-10'),'completed');
});

test('unknown grace is48 hours after local day end; no write or invented no; DST and fixed timezone',()=>{
 let h=fixture({start:'2026-10-23'});h=track(h,'2026-10-23','done');const before=fs.readFileSync(h.file,'utf8');
 let p=habitProgress(h,{now:new Date('2026-10-26T21:59:59Z'),timezone:'America/New_York'});assert.equal(status(p,'2026-10-24'),'unknown');assert.equal(p.timezone,'Europe/Berlin');
 p=habitProgress(h,{now:new Date('2026-10-26T22:00:00Z')});assert.equal(status(p,'2026-10-24'),'protected');assert.equal(p.calendar.find(d=>d.date==='2026-10-24').answer,null);assert.equal(fs.readFileSync(h.file,'utf8'),before);
 p=habitProgress(h,{now:new Date('2026-10-23T22:30:00Z')});assert.equal(p.today,'2026-10-24');assert.equal(p.calendar.at(-1).weekday,'Sat');
});

test('legacy completions stay factual and old schedules are not invented; calm persists',()=>{
 let h=fixture();fs.writeFileSync(h.file,fs.readFileSync(h.file,'utf8').replace(/## Progress history[\s\S]*?(?=## Days)/,''));h=readHabit(h.file);h=track(h,'2026-10-01','done');h=track(h,'2026-10-02','done');
 let p=progress(h,'2026-10-06');assert.equal(p.lifetimeCompletedDays,2);assert.equal(p.coverage.scheduleHistoryComplete,false);assert.equal(p.currentRun,0);assert.match(p.coverage.note,/dated schedule/);
 h=setHabitDisplay(h,'calm');assert.equal(progress(readHabit(h.file),'2026-10-06').display,'calm');
});

test('milestones persist through breaks but factual corrections can revoke invalid achievements',()=>{
 let h=fixture();for(let i=0;i<10;i++)h=track(h,addDays('2026-10-01',i),'done');let p=progress(h,'2026-10-20');assert.equal(p.currentRun,0);assert.ok(p.achievements.some(a=>a.days===10));
 h=track(h,'2026-10-01','no');p=progress(h,'2026-10-20');assert.equal(p.lifetimeCompletedDays,9);assert.ok(!p.achievements.some(a=>a.days===10));assert.deepEqual(p.nextMilestone,{days:10,remaining:1});
 assert.throws(()=>track(h,'2026-02-30','done'),/real calendar date/);
});

test('legacy upgrade persists adoption history once and preserves all prior answers',()=>{
 let h=fixture();fs.writeFileSync(h.file,fs.readFileSync(h.file,'utf8').replace(/## Progress history[\s\S]*?(?=## Days)/,'').replace(/^TIMEZONE:.*\n/m,''));h=readHabit(h.file);
 // Source history remains untouched by read-only projection.
 fs.appendFileSync(h.file,'- 2026-10-01 done (phone) "read"\n');h=readHabit(h.file);
 const first=initializeHabitProgress(h,'2026-10-05','Europe/Berlin');assert.equal(first.changed,true);
 const text=fs.readFileSync(h.file,'utf8');assert.match(text,/- 2026-10-01 done \(phone\) "read"/);
 assert.equal(initializeHabitProgress(first.habit,'2026-10-06','UTC').changed,false);assert.equal(fs.readFileSync(h.file,'utf8'),text);
 h=track(first.habit,'2026-10-05','done');h=track(h,'2026-10-06','done');const p=progress(h,'2026-10-06');assert.equal(p.currentRun,2);assert.equal(p.lifetimeCompletedDays,3);assert.equal(p.coverage.from,'2026-10-05');assert.equal(p.coverage.scheduleHistoryComplete,false);
});

test('protection refills after30 calendar days; off-schedule actual actions add only lifetime',()=>{
 let h=fixture();h=track(h,'2026-10-01','done');h=track(h,'2026-10-02','no');h=track(h,'2026-10-03','no');h=exemptHabitDays(h,'2026-10-04','2026-10-31','holiday');h=track(h,'2026-11-01','no');h=track(h,'2026-11-02','done');let p=progress(h,'2026-11-02');assert.equal(p.currentRun,2);assert.equal(p.protections.remaining,1);
 h=fixture({start:'2026-10-05',days:'mon,wed,fri'});h=track(h,'2026-10-05','done');h=track(h,'2026-10-06','done');p=progress(h,'2026-10-06');assert.equal(p.currentRun,1);assert.equal(p.lifetimeCompletedDays,2);
});

test('asked reminders are unknown and never spend protection within reconciliation grace',()=>{
 let h=fixture();h=track(h,'2026-10-01','done');h=track(h,'2026-10-02','asked');h=track(h,'2026-10-03','asked');
 let p=progress(h,'2026-10-03');assert.equal(status(p,'2026-10-02'),'unknown');assert.equal(status(p,'2026-10-03'),'unknown');assert.equal(p.protections.used,0);assert.equal(p.pendingDays,2);
 h.log['2026-10-02'].answer='asked';p=progress(h,'2026-10-03');assert.equal(status(p,'2026-10-02'),'unknown');assert.equal(p.protections.used,0);
});

test('earned graduation survives later resume or pause',()=>{
 let h=fixture();h=track(h,'2026-10-01','done');h=setStatus(h,'graduated','2026-10-02');h=setStatus(h,'active','2026-10-03');h=setStatus(h,'paused','2026-10-04');
 assert.deepEqual(progress(h,'2026-10-04').achievements.find(a=>a.id==='graduated'),{id:'graduated',days:1,earnedOn:'2026-10-02'});
});
