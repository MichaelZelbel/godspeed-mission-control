// What the copy of the old reminders into the notebook COSTS, run by hand (#90, ticket 02).
//
// A generated mission control of fifty reminders and a hundred closings: how long the first copy
// takes, how long a run with nothing to do takes - which is almost every run, because the brief,
// the 08:00 reminders, Settings and every command go through it - and what a year of the morning
// brief's daily mentions of fifty reminders adds to the notebook. The last one matters because the
// brief writes a SAID line into a reminder's file every day it mentions it, so these files change
// daily and are copied daily.
//
//   node notebook/test/due-copy-timing.mjs [--reminders 50] [--events 100] [--days 5]
//
// It is not a node --test file: it prints numbers and fails only when one of them is out of
// bounds, so it can be read as well as checked. The days default to five because what is measured
// per day is the same whichever number it is, and a day on which every one of fifty reminders is
// mentioned writes two hundred records: thirty of them, run by hand on 30 October 2026, added
// 35 KB, the same 24 bytes per reminder per day, and kept no copy of an earlier version.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../core/records/store.mjs';
import { copyOldReminders, copyIfFilesChanged } from '../core/due-copy.mjs';
import { dueDelivered } from '../core/native-due.mjs';

const option = (name, fallback) => { const at = process.argv.indexOf('--' + name); return at > 0 && process.argv[at + 1] ? Number(process.argv[at + 1]) : fallback; };
const REMINDERS = option('reminders', 50), EVENTS = option('events', 100), DAYS = option('days', 5);
// A megabyte, and a run with nothing to do that nobody waits for.
const YEAR_LIMIT = 1024 * 1024, QUIET_LIMIT = 2000;

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'godspeed-due-copy-timing-'));
fs.mkdirSync(path.join(root, 'due'), { recursive: true });
fs.mkdirSync(path.join(root, 'world', 'events'), { recursive: true });
fs.writeFileSync(path.join(root, 'AGENTS.md'), '');
const slugs = [];
for (let n = 0; n < REMINDERS; n++) {
  const slug = 'invented-thing-' + n;
  slugs.push(slug);
  fs.writeFileSync(path.join(root, 'due', slug + '.md'), `TITLE: An invented thing number ${n}
DONE-WHEN: It is done.
COST-IF-MISSED: Something made up.
SELF-CHECK: none
SELF-CHECK-ARG:
REPEATS: no
LINK:
SOURCE: me, 2026-01-01

## Windows
STRIP: 2026-01-01 2027-06-30

## Log
- 2026-01-01 created, window 2026-01-01 to 2027-06-30
`);
}
// A hundred closings: the first twenty reminders closed five times over (a repeating one closes a
// window at a time), and in among them the life events that say nothing about a reminder at all.
for (let n = 0; n < EVENTS; n++) {
  const slug = 'invented-thing-' + (n % 20), day = '2026-0' + (1 + (n % 9)) + '-' + String(1 + (n % 28)).padStart(2, '0');
  fs.writeFileSync(path.join(root, 'world', 'events', day + '-made-up-' + n + '.md'), n % 5 === 0 ? `---
date: ${day}
participants: [me]
---

Something that happened and closes nothing.
` : `---
date: ${day}
participants: [me]
closes: [due/${slug}]
evidence: a made-up receipt number ${n}
source: me, in a session
---

An invented thing number ${n % 20}: finished.
`);
}

const store = new Store(root, { device: 'pc' });
store.save('settings', { id: 'installation', owner: 'pc', timezone: 'UTC' });
const took = work => { const at = process.hrtime.bigint(); const result = work(); return [Number(process.hrtime.bigint() - at) / 1e6, result]; };
const bytes = () => {
  let total = 0;
  const walk = dir => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, entry.name); if (entry.isDirectory()) walk(file); else total += fs.statSync(file).size; } };
  walk(path.join(root, 'notebook'));
  return total;
};

console.log(REMINDERS + ' reminders in due/, ' + EVENTS + ' events in world/events/, in ' + root);
const [first, report] = took(() => copyOldReminders(store, { day: '2026-10-30' }));
console.log('  the first copy:                      ' + Math.round(first) + ' ms (' + report.copied.length + ' reminders, ' + report.closed.length + ' closings)');
const [quiet] = took(() => copyOldReminders(store, { day: '2026-10-30' }));
console.log('  a run with nothing to do:            ' + Math.round(quiet) + ' ms (the notebook\'s own way: every old file read and compared)');
const [cheap, skipped] = took(() => copyIfFilesChanged(root, { day: '2026-10-30' }));
console.log('  the same from tools/due.js:          ' + Math.round(cheap) + ' ms (' + (skipped.skipped || 'copied') + ')');

const before = bytes();
for (let d = 0; d < DAYS; d++) dueDelivered(store, slugs, new Date(Date.parse('2026-10-01T07:00:00Z') + d * 86400000));
const added = bytes() - before;
const perDay = added / (REMINDERS * DAYS), year = perDay * 50 * 365;
console.log('  ' + DAYS + ' days of the brief mentioning every one of them: ' + Math.round(added / 1024) + ' KB, ' +
  Math.round(perDay) + ' bytes per reminder per day');
console.log('  so fifty reminders mentioned daily for a year:  about ' + Math.round(year / 1024) + ' KB');
console.log('  copies of earlier versions kept by the copy:   ' + store.list('record_history').length);

let bad = 0;
if (quiet > QUIET_LIMIT) { console.log('TOO SLOW: a run with nothing to do took ' + Math.round(quiet) + ' ms'); bad = 1; }
if (year > YEAR_LIMIT) { console.log('TOO BIG: a year of daily mentions would add about ' + Math.round(year / 1024) + ' KB'); bad = 1; }
if (store.list('record_history').length) { console.log('THE COPY KEPT COPIES: ' + store.list('record_history').length + ' of them'); bad = 1; }
if (store.list('deadlines').length !== REMINDERS) { console.log('WRONG NUMBER OF REMINDERS: ' + store.list('deadlines').length); bad = 1; }
fs.rmSync(root, { recursive: true, force: true });
console.log(bad ? 'out of bounds' : 'all three numbers are inside their bounds');
process.exit(bad);
