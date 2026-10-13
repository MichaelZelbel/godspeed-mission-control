import test from 'node:test';
import assert from 'node:assert/strict';
import {habitProgressPng,habitProgressSvg,habitProgressText} from '../core/habit-progress-image.mjs';

export function fictionalHabit(){return {id:'habit-example-reading',name:'Read a page',status:'active',doneMeans:'Read one page of a book.',progress:{version:1,today:'2026-10-13',timezone:'Europe/Berlin',display:'standard',currentRun:12,lifetimeCompletedDays:120,protections:{remaining:1},coverage:{scheduleHistoryComplete:true},calendar:Array.from({length:14},(_,i)=>({date:'2026-10-'+String(i+1).padStart(2,'0'),status:['completed','protected','paused','missed','missed','unknown','completed'][i%7],answer:i%7===4?'no':null,scheduled:true}))}};}

test('the picture faithfully displays saved totals and seven dated days without inventing completions',()=>{
 const habit=fictionalHabit(),before=structuredClone(habit),svg=habitProgressSvg(habit,{locale:'en-GB'}),text=habitProgressText(habit,{locale:'en-GB'});
 assert.match(text,/all time: 120/);assert.match(text,/Current streak: 12 completed days/);
 assert.equal(text.split('\n').filter(line=>/Oct:/.test(line)).length,7);
 assert.match(text,/13 Oct: Not recorded/);assert.match(text,/12 Oct: Not done/);assert.match(text,/11 Oct: Gap in record/);
 assert.match(svg,/>Tue<\/text>/);assert.match(svg,/>13 Oct<\/text>/);assert.doesNotMatch(svg,/>10\/13<\/text>/);
 assert.deepEqual(habit,before);
});
test('SVG escapes habit data and calm mode keeps lifetime progress without a streak',()=>{
 const habit=fictionalHabit();habit.name='Read <script> & "friends"';habit.progress.display='calm';
 const svg=habitProgressSvg(habit);assert.ok(svg.includes('&lt;script&gt;'));assert.ok(svg.includes('&amp;'));assert.ok(!svg.includes('<script>'));
 assert.ok(!svg.includes('Current streak'));assert.ok(svg.includes('Completed days, all time'));assert.ok(!svg.includes('ice save'));
});
test('invalid dates, duplicate dates and invalid totals cannot become a progress picture',()=>{
 for(const change of [h=>h.progress.calendar[0].date='2026-02-31',h=>h.progress.calendar[1].date=h.progress.calendar[0].date,h=>h.progress.lifetimeCompletedDays=-1]){
  const habit=fictionalHabit();change(habit);assert.throws(()=>habitProgressSvg(habit));
 }
});
test('bundled rasterizer and font make a repeatable phone-sized PNG, including long text and large counts',async()=>{
 const habit=fictionalHabit();habit.name='A long reading habit with <friends> & a meaningful purpose '.repeat(3);habit.progress.lifetimeCompletedDays=12345678;
 const a=await habitProgressPng(habit,{locale:'de-DE'}),b=await habitProgressPng(habit,{locale:'de-DE'});
 assert.deepEqual(a,b);assert.equal(a.subarray(1,4).toString(),'PNG');assert.equal(a.readUInt32BE(16),840);assert.ok(a.readUInt32BE(20)>=850&&a.readUInt32BE(20)<=1400);assert.ok(a.length>10000);
});

test('a paused habit stays safe, offers its exact resume command, and never prompts the exercise',()=>{
 const habit=fictionalHabit();habit.status='paused';habit.doneMeans='Ten resisted neck lifts';habit.progress.calendar.find(d=>d.date===habit.progress.today).status='completed';
 const svg=habitProgressSvg(habit),text=habitProgressText(habit);
 assert.match(svg,/data-character="flame-rest"/);assert.match(text,/On pause/);assert.match(text,/Your progress is safe/);assert.match(text,/resume Read a page/);
 assert.doesNotMatch(text,/Ten resisted neck lifts|Tell me when|TODAY, KEPT/);
});

test('an active rest or excused day requires no action and never masquerades as a paused habit',()=>{
 for(const status of ['notplanned','paused']){const habit=fictionalHabit();habit.progress.calendar.find(d=>d.date===habit.progress.today).status=status;
  const text=habitProgressText(habit);assert.match(text,/No action due today/);assert.doesNotMatch(text,/resume|On pause|Tell me when/);
 }
});

test('a first spark, a completed day, singular streaks and ice all have honest distinct copy',()=>{
 let habit=fictionalHabit();habit.progress.currentRun=0;let svg=habitProgressSvg(habit);assert.match(svg,/Next spark/);assert.doesNotMatch(svg,/lost|lose|break your|A missed day starts/);
 habit.progress.currentRun=1;svg=habitProgressSvg(habit);assert.match(svg,/>day in your streak</);assert.doesNotMatch(svg,/>days in your streak</);
 habit.progress.calendar.find(d=>d.date===habit.progress.today).status='completed';svg=habitProgressSvg(habit);assert.match(svg,/data-character="flame-done"/);assert.match(svg,/TODAY, KEPT/);
 habit.progress.calendar.find(d=>d.date===habit.progress.today).status='protected';svg=habitProgressSvg(habit);assert.ok(svg.includes('data-character="flame-ice"'));assert.ok(svg.includes('1 freeze ready'));assert.ok(svg.includes('Ice covers missed planned days.'));
});

test('unrecorded past dates use neutral dots; today waits without being labelled not done',()=>{
 const habit=fictionalHabit();for(const day of habit.progress.calendar){day.status='unknown';day.answer=null;}
 const svg=habitProgressSvg(habit),text=habitProgressText(habit);
 assert.equal((svg.match(/data-mark="not-recorded"/g)||[]).length,6);assert.ok(svg.includes('data-mark="waiting-spark"'));
 assert.ok(!svg.includes('data-character="flame-done"'));assert.ok(!svg.includes('>Open<'));assert.ok(!svg.includes('>Offen<'));
 assert.match(text,/13: Not recorded yet/);assert.doesNotMatch(text,/Not done/);
});

test('the action keeps its completion target even when the agreed instruction is long',()=>{
 const habit=fictionalHabit();habit.doneMeans='Read at your own pace, taking as much time as you need. '.repeat(6)+'Finish one page.';
 const svg=habitProgressSvg(habit),visible=[...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map(m=>m[1]).join(' ');
 assert.ok(visible.includes('Finish one page.'));assert.ok(!visible.includes('…'));
 habit.status='resting';habit.habit_status='paused';assert.match(habitProgressText(habit),/On pause/,'the precise habit status takes precedence over the broad shelf status');
});
