// FINISHED DEADLINES GET THEIR TIMELINE STATUS AND SCORES WHEN THE NOTEBOOK STARTS (2 November 2026).
//
// 2.0.0-beta.15 (#141, #147) gives a done or dropped deadline's moment the status past_fact and its
// three scores, and corrects older ones by an appended correction. That correction ran only when the
// deadline copy next ran, so on the first server updated to 2.0.0-beta.15 thirty finished deadlines
// still showed "unknown" and no scores after the update. The notebook now runs it when it starts
// (core/due-copy.mjs, repairTimelineAtStart; server/main.mjs). These tests hold it to that: an old
// closing is corrected by the start alone, once, without replacing an owner's rating, a read-only
// copy is never written, and GODSPEED_TIMELINE_REPAIR=off leaves it to the deadline runner.
// Everything in here is made up.
for (const key of Object.keys(process.env)) if (/^(GODSPEED_|HERMES_)/.test(key)) delete process.env[key];

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../core/records/store.mjs';
import { QueryService } from '../core/query.mjs';
import { copyOldReminders, repairTimelineAtStart, needsTimelineRatings } from '../core/due-copy.mjs';
import { write } from './due-seed.mjs';

const DAY = '2026-10-30';
const ratingsOf = row => [row.status, row.impact_level, row.confidence_date, row.confidence_truth];

// A mission control as an update finds it: its reminders already copied by an earlier version, and
// one deadline closed before 2.0.0-beta.15, so its moment has no status and no scores.
// The folder goes last, after a notebook started on it has closed (Windows keeps its files open).
function updated(t, { service = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'godspeed-timeline-repair-'));
  const own = { service };
  t.after(async () => { await own.service?.close(); fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 }); });
  write(root);
  const store = new Store(root, { device: 'pc' });
  store.save('settings', { id: 'installation', owner: 'pc', timezone: 'UTC' });
  copyOldReminders(store, { day: DAY });
  const old = store.save('moments', { title: 'Done: Fictional task', happened_at: DAY,
    category: 'obligation', obligation_kind: 'closes', deadline_id: 'due-rates',
    evidence: 'A receipt exists', confidence_truth: 7 });
  return { root, store, old, own };
}

test('the start repairs an older closing once, and keeps the owner\'s own rating', async t => {
  const { store, old } = updated(t);
  assert.equal(needsTimelineRatings(store), true, 'the old closing needs its status and scores');
  const report = await repairTimelineAtStart(store, { day: DAY });
  assert.ok(report.corrected.some(line => /timeline ratings/.test(line)), JSON.stringify(report));
  const row = new QueryService(store).rows('moments').find(m => m.id === old.id);
  assert.deepEqual(ratingsOf(row), ['past_fact', 1, 10, 7], 'status and the missing scores given, the owner\'s truth kept');
  const count = store.list('event_corrections').length;
  assert.deepEqual(await repairTimelineAtStart(store, { day: DAY }), { skipped: 'nothing to repair' });
  assert.equal(store.list('event_corrections').length, count, 'a second start appends nothing');
});

test('a read-only copy of the workspace is never repaired', async t => {
  const { store } = updated(t);
  const view = Object.create(store, { withLock: { value: () => { throw new Error('written'); } } });
  assert.deepEqual(await repairTimelineAtStart(view, { day: DAY }), { skipped: 'not writable' });
  assert.equal(needsTimelineRatings(store), true, 'still waiting for a writable start');
});

test('the notebook\'s own start does it, after its door is open', async t => {
  const { root, old, own } = updated(t);
  process.env.GODSPEED_ASSISTANT_CONFIG = path.join(root, 'no-assistant.json');
  process.env.GODSPEED_TIMELINE_REPAIR = 'on';
  t.after(() => { delete process.env.GODSPEED_ASSISTANT_CONFIG; delete process.env.GODSPEED_TIMELINE_REPAIR; });
  const { createService } = await import('../server/main.mjs');
  const service = own.service = await createService({ root, port: 0 });
  const health = await fetch('http://127.0.0.1:' + service.address.port + '/health');
  assert.equal(health.status, 200, 'the notebook answers before the repair is done');
  const report = await service.timelineRepair;
  assert.ok(report.corrected?.some(line => /timeline ratings/.test(line)), JSON.stringify(report));
  const row = service.query.rows('moments').find(m => m.id === old.id);
  assert.deepEqual(ratingsOf(row), ['past_fact', 1, 10, 7]);
});

test('GODSPEED_TIMELINE_REPAIR=off leaves it to the deadline runner', async t => {
  const { root, own } = updated(t);
  process.env.GODSPEED_ASSISTANT_CONFIG = path.join(root, 'no-assistant.json');
  process.env.GODSPEED_TIMELINE_REPAIR = 'off';
  t.after(() => { delete process.env.GODSPEED_ASSISTANT_CONFIG; delete process.env.GODSPEED_TIMELINE_REPAIR; });
  const { createService } = await import('../server/main.mjs');
  const service = own.service = await createService({ root, port: 0 });
  assert.deepEqual(await service.timelineRepair, { skipped: 'off' });
  assert.equal(needsTimelineRatings(new Store(root, { device: 'pc' })), true, 'nothing was repaired');
});
