import test from 'node:test';
import assert from 'node:assert/strict';
import {habitProgressPng,habitProgressSvg,habitProgressText} from '../core/habit-progress-image.mjs';

export function fictionalHabit(){return {id:'habit-example-reading',name:'Read a page',doneMeans:'Read one page of a book.',progress:{version:1,today:'2026-10-13',timezone:'Europe/Berlin',display:'standard',currentRun:12,lifetimeCompletedDays:120,coverage:{scheduleHistoryComplete:true},calendar:Array.from({length:14},(_,i)=>({date:'2026-10-'+String(i+1).padStart(2,'0'),status:['completed','protected','paused','missed','missed','unknown','completed'][i%7],answer:i%7===4?'no':null}))}};}

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
 assert.ok(!svg.includes('Current streak'));assert.ok(svg.includes('Completed days, all time'));
});
test('invalid dates, duplicate dates and invalid totals cannot become a progress picture',()=>{
 for(const change of [h=>h.progress.calendar[0].date='2026-02-31',h=>h.progress.calendar[1].date=h.progress.calendar[0].date,h=>h.progress.lifetimeCompletedDays=-1]){
  const habit=fictionalHabit();change(habit);assert.throws(()=>habitProgressSvg(habit));
 }
});
test('bundled rasterizer and font make a repeatable phone-sized PNG, including long text and large counts',async()=>{
 const habit=fictionalHabit();habit.name='A long reading habit with <friends> & a meaningful purpose '.repeat(3);habit.progress.lifetimeCompletedDays=12345678;
 const a=await habitProgressPng(habit,{locale:'de-DE'}),b=await habitProgressPng(habit,{locale:'de-DE'});
 assert.deepEqual(a,b);assert.equal(a.subarray(1,4).toString(),'PNG');assert.equal(a.readUInt32BE(16),840);assert.equal(a.readUInt32BE(20),1140);assert.ok(a.length>10000);
});
