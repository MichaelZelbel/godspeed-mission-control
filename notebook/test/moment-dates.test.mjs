import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';
import {MenerioSource} from '../core/migration-source.mjs';
import {isoTimestamp, isoTimestamps, momentDates} from '../core/timestamps.mjs';

const fixture = t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'godspeed-moment-dates-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const store = new Store(root), query = new QueryService(store);
  return {store, query, domains: new Domains(query)};
};
// What the Menerio timeline dialog does with a moment's date before showing it.
const dialogDay = value => value.split('T')[0];
const read = (query, id) => query.execute({table: 'moments', selection: '*', filters: [['eq', 'id', id]]}).data[0];

test('Postgres text timestamps become ISO 8601 with the clock time and offset kept', () => {
  assert.equal(isoTimestamp('2026-10-05 00:00:00+00'), '2026-10-05T00:00:00+00:00');
  assert.equal(isoTimestamp('2026-10-11 00:00:00+02:00'), '2026-10-11T00:00:00+02:00', 'not moved to UTC, which would be the day before');
  assert.equal(isoTimestamp('2026-04-25 09:34:25.767345+00'), '2026-04-25T09:34:25.767345+00:00');
  assert.equal(isoTimestamp('2026-04-25 09:34:25-0530'), '2026-04-25T09:34:25-05:30');
  assert.equal(isoTimestamp('2026-04-25 09:34'), '2026-04-25T09:34:00');
  assert.equal(isoTimestamp('2026-04-25 09:34:25Z'), '2026-04-25T09:34:25Z');
  for (const same of ['2026-10-04', '2026-10-05T00:00:00+00:00', '2026-10-09T19:18:08.088Z', 'Lunch at 2026-10-05 12:00:00+00 sharp', '', null, undefined, 42])
    assert.equal(isoTimestamp(same), same);
});

test('the timeline reads stored space-form dates as ISO, so the edit dialog shows them', t => {
  // The three forms on the test server on 10 October 2026: the Menerio import's,
  // an assistant proposal's, and a date written by the dialog itself.
  const {store, query} = fixture(t);
  const imported = store.save('moments', {title: 'Fictional business trip', happened_at: '2026-10-05 00:00:00+00', happened_end: '2026-10-08 00:00:00+00', status: 'past_fact'});
  const proposed = store.save('moments', {title: 'Fictional gym day', happened_at: '2026-10-11 00:00:00+02:00', happened_end: null, status: 'future_plan'});
  const plain = store.save('moments', {title: 'Fictional lunch', happened_at: '2026-10-04', status: 'past_fact'});
  const trip = read(query, imported.id);
  assert.equal(trip.happened_at, '2026-10-05T00:00:00+00:00');
  assert.equal(trip.happened_end, '2026-10-08T00:00:00+00:00');
  assert.deepEqual([dialogDay(trip.happened_at), dialogDay(trip.happened_end)], ['2026-10-05', '2026-10-08']);
  assert.equal(dialogDay(read(query, proposed.id).happened_at), '2026-10-11');
  assert.equal(read(query, proposed.id).happened_end, null);
  assert.equal(read(query, plain.id).happened_at, '2026-10-04');
  assert.ok(fs.readFileSync(store.file(store.get('moments', imported.id)), 'utf8').includes('2026-10-05 00:00:00+00'), 'reading rewrites no file');
  assert.equal(query.rows('world_events').find(e => e.id === imported.id).happened_at, '2026-10-05T00:00:00+00:00');
});

test('a moment written with a space-form date is kept as ISO, and a change without dates keeps them', t => {
  const {store, query} = fixture(t);
  const id = query.execute({table: 'moments', operation: 'insert', values: {title: 'Fictional dinner', happened_at: '2026-10-11 00:00:00+02:00', happened_end: null, status: 'future_plan'}}).data[0].id;
  assert.equal(store.get('moments', id).happened_at, '2026-10-11T00:00:00+02:00');
  query.execute({table: 'moments', operation: 'update', values: {happened_end: '2026-10-12 00:00:00+02:00'}, filters: [['eq', 'id', id]]});
  assert.equal(read(query, id).happened_end, '2026-10-12T00:00:00+02:00');
  const correction = store.list('event_corrections').find(c => c.moment_id === id);
  assert.deepEqual(Object.keys(correction.patch), ['happened_end'], 'a change carries only the fields it changes');
  query.execute({table: 'moments', operation: 'update', values: {title: 'Fictional long dinner'}, filters: [['eq', 'id', id]]});
  const after = read(query, id);
  assert.equal(after.title, 'Fictional long dinner');
  assert.equal(after.happened_at, '2026-10-11T00:00:00+02:00');
  assert.equal(after.happened_end, '2026-10-12T00:00:00+02:00');
  // What the dialog saves: the day alone.
  query.execute({table: 'moments', operation: 'update', values: {happened_at: '2026-10-10', happened_end: null}, filters: [['eq', 'id', id]]});
  assert.equal(read(query, id).happened_at, '2026-10-10');
  assert.equal(read(query, id).happened_end, null);
});

test('a kept assistant proposal with a space-form date becomes a moment with an ISO date', async t => {
  const {store, query, domains} = fixture(t);
  const item = store.save('review_queue', {suggestion_type: 'add_moment', status: 'pending_review', payload: {title: 'Fictional gym day', happened_at: '2026-10-11 00:00:00+02:00'}});
  const kept = await domains.invoke('review-queue-bulk', {action: 'keep', ids: [item.id]});
  assert.equal(kept.succeeded, 1, JSON.stringify(kept.errors));
  const moment = read(query, store.get('review_queue', item.id).target_entity_id);
  assert.equal(moment.happened_at, '2026-10-11T00:00:00+02:00');
  assert.equal(store.get('moments', moment.id).happened_at, '2026-10-11T00:00:00+02:00');
});

test('the Menerio import copies rows with ISO timestamps, as Menerio handed them out', async () => {
  const source = Object.create(MenerioSource.prototype);
  source.order = () => 's.id';
  source.sql = async () => [{id: 'm1', title: 'Fictional trip', happened_at: '2026-10-05 00:00:00+00', happened_end: null, created_at: '2026-04-25 09:34:25.767345+00', metadata: {note: '2026-10-05 00:00:00+00'}}];
  const [row] = await source.page({name: 'moments', primaryKey: ['id']}, 'true', 0, 10);
  assert.equal(row.happened_at, '2026-10-05T00:00:00+00:00');
  assert.equal(row.created_at, '2026-04-25T09:34:25.767345+00:00');
  assert.equal(row.happened_end, null);
  assert.deepEqual(row.metadata, {note: '2026-10-05 00:00:00+00'}, 'values inside JSON columns stay as stored');
});

test('momentDates and isoTimestamps return the same object when nothing changes', () => {
  const done = {happened_at: '2026-10-05T00:00:00+00:00', title: 'x'};
  assert.equal(momentDates(done), done);
  assert.equal(isoTimestamps(done), done);
  assert.deepEqual(momentDates({title: 'x'}), {title: 'x'});
  assert.ok(!('happened_end' in momentDates({happened_at: '2026-10-05 00:00:00+00'})));
});
