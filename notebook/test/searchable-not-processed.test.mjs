import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';
import {NoteProcessing, jobFor} from '../core/processing.mjs';
import {SearchIndex} from '../core/index/search.mjs';
import {visibleRows} from '../core/visibility.mjs';

// An add-on that writes many notes (one per scanned letter, say) already wrote the summary and the
// key facts into each one. Processing them again filled the 40-a-day queue for weeks, oldest first,
// so the person's own notes waited behind them. The only way out was ai_visibility: hidden, which
// also takes a note out of search, and the assistant has to find these notes. A note written with
// skip_processing: true stays visible and searchable; processing never takes it, in the queue or in
// a bulk run, and it never counts against the daily limit. One note's own "process" still works.
const setup = ({limit = 40} = {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'godspeed-search-only-'));
  const store = new Store(root, {device: 'vps'}), query = new QueryService(store), domains = new Domains(query);
  store.save('settings', {id: 'installation', owner: 'vps', timezone: 'Europe/Berlin'});
  store.save('settings', {id: 'processing', enabled: true, daily_limit: limit, quiet_minutes: 0, min_chars: 5, retry_minutes: 30, max_attempts: 3, since: '2026-01-01T00:00:00.000Z'});
  const asked = [];
  domains.provider = async input => {
    asked.push(input.note?.id || input.source?.id || input.kind);
    return {metadata: {type: 'reference', summary: 'Fictional summary'}, tags: ['letter'], suggestions: []};
  };
  return {root, store, query, domains, asked, processing: new NoteProcessing({store, query, domains, device: 'vps'})};
};
// A letter as an add-on writes it through the notebook's local door (POST /api/query).
const letter = (query, n, extra = {}) => query.execute({table: 'notes', operation: 'insert', values: {
  title: 'Fictional Hollis Roofing invoice ' + n, content: 'Invoice ' + n + ' from Fictional Hollis Roofing, 1,250.00 EUR, due on 30 November.',
  folder_path: 'Documents', source_app: 'fictional-addon', skip_processing: true, ...extra}}).data[0];

test('a note marked skip_processing is never queued, and the person\'s own note is processed first', async () => {
  const {store, query, processing, asked} = setup({limit: 1});
  const letters = [1, 2, 3].map(n => letter(query, n));
  assert.equal(store.get('notes', letters[0].id).skip_processing, true, 'the mark is kept as written');
  const mine = store.save('notes', {title: 'My plan', content: 'A fictional plan of my own for the weekend, written after the letters.'});
  assert.deepEqual(processing.candidates().map(c => c.note.id), [mine.id], 'only the person\'s note waits');
  assert.equal(processing.sweep().waiting, 1);
  const now = Date.now() + 600000;
  assert.equal((await processing.tick({now})).note_id, mine.id);
  assert.equal((await processing.tick({now: now + 60000})).skipped, 'daily limit reached', 'the person\'s note used the one run');
  assert.deepEqual(asked, [mine.id]);
  for (const l of letters) assert.equal(jobFor(query, l.id), null, 'no processing record for a marked note');
});

test('marked notes never count against the daily limit', async () => {
  const {store, query, processing, asked} = setup({limit: 2});
  for (let n = 1; n <= 5; n++) letter(query, n);
  const a = store.save('notes', {title: 'First own note', content: 'A fictional first note of my own about the garden.'});
  const b = store.save('notes', {title: 'Second own note', content: 'A fictional second note of my own about the garage.'});
  const now = Date.now() + 600000;
  await processing.tick({now}); await processing.tick({now: now + 60000});
  assert.deepEqual(asked.sort(), [a.id, b.id].sort());
  assert.equal(processing.status.processed_today, 2);
});

test('a marked note stays visible to the assistant and is found by search', () => {
  const {store, query} = setup();
  const l = letter(query, 7);
  assert.ok(visibleRows(query, 'notes').some(n => n.id === l.id), 'visible like any note');
  const index = new SearchIndex(store);
  try { assert.ok(index.search('Hollis Roofing').map(r => r.id).includes(l.id), 'search finds it'); }
  finally { index.close(); }
});

test('marking a note that waits takes it out of the queue; taking the mark off puts it back', () => {
  const {store, query, processing} = setup();
  const l = letter(query, 9, {skip_processing: false});
  assert.deepEqual(processing.candidates().map(c => c.note.id), [l.id]);
  query.execute({table: 'notes', operation: 'update', values: {skip_processing: true}, filters: [['eq', 'id', l.id]]});
  assert.deepEqual(processing.candidates(), []);
  store.save('notes', {id: l.id, skip_processing: false});
  assert.deepEqual(processing.candidates().map(c => c.note.id), [l.id]);
});

for (const name of ['backfill-metadata', 'backfill-profile-extraction']) {
  test(name + ' (a bulk run) leaves marked notes alone', async () => {
    const {store, query, domains, asked} = setup();
    letter(query, 11);
    const mine = store.save('notes', {title: 'My notes', content: 'A fictional note of my own that is not processed yet.'});
    const r = await domains.invoke(name, {});
    assert.deepEqual(asked, [mine.id], 'only the person\'s note was processed');
    assert.equal(r.total, 1, 'the marked note is not counted as waiting');
  });
}

test('the note\'s own "process" still works on a marked note', async () => {
  const {query, domains, asked} = setup();
  const l = letter(query, 12);
  await domains.invoke('process-note', {note_id: l.id});
  assert.deepEqual(asked, [l.id], 'asked for this one note, it is processed');
});
