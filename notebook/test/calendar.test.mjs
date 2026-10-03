import test from 'node:test';
import assert from 'node:assert/strict';
import {nextCalendarRun} from '../core/jobs/calendar.mjs';
test('calendar respects Berlin weekdays and daylight saving gap without duplicate replay',()=>{
 const job={calendar:{time:'09:00',weekdays:[1,2,3,4,5]}};
 assert.equal(nextCalendarRun(job,'Europe/Berlin',Date.parse('2026-10-23T08:00:00Z')),'2026-10-26T08:00:00.000Z');
 const spring={calendar:{time:'02:30',weekdays:[0]}};
 assert.equal(nextCalendarRun(spring,'Europe/Berlin',Date.parse('2026-03-28T23:00:00Z')),'2026-03-29T01:00:00.000Z');
 const fall={calendar:{time:'02:30',weekdays:[0]}};
 assert.equal(nextCalendarRun(fall,'Europe/Berlin',Date.parse('2026-10-25T00:31:00Z')),'2026-11-01T01:30:00.000Z');
});
test('monthly schedules retain their chosen day across short months and skip a second run in the same month',()=>{
 const job={calendar:{time:'09:00',month_day:31}};
 assert.equal(nextCalendarRun(job,'Europe/Berlin',Date.parse('2026-01-31T08:01:00Z')),'2026-02-28T08:00:00.000Z');
 assert.equal(nextCalendarRun(job,'Europe/Berlin',Date.parse('2026-02-28T08:01:00Z')),'2026-03-31T07:00:00.000Z');
 assert.throws(()=>nextCalendarRun({calendar:{time:'09:00',month_day:32}},'UTC'),/calendar/);
});
