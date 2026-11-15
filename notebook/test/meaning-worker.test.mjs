import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {SearchIndex} from '../core/index/search.mjs';
import {MeaningIndex} from '../core/index/meaning.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'godspeed-meaning-worker-'));
  const store = new Store(root), index = new SearchIndex(store);
  const meaning = index.meaning = new MeaningIndex(index, {config: {url: 'https://example.org/v1', model: 'fictional', dimensions: 2}, embed: async () => ({vectors: [new Float32Array([1, 0])]})});
  t.after(async () => {await index.close(); fs.rmSync(root, {recursive: true, force: true});});
  return {store, index, meaning};
}
test('a cold meaning search leaves the request thread free, and updates reuse its loaded vectors', async t => {
  const {meaning} = fixture(t), model = meaning.space;
  meaning.vectors.put('one', 'a', model, [new Float32Array([1, 0])]);
  meaning.vectors.put('two', 'b', model, [new Float32Array([0, 1])]);
  let heartbeat = false;
  const tick = new Promise(resolve => setTimeout(() => {heartbeat = true; resolve();}, 0));
  const first = await meaning.worker.search(model, new Float32Array([1, 0]));
  assert.equal(heartbeat, true, 'the notebook can answer another request during the first vector load');
  await tick;
  assert.equal(first[0].uid, 'one');
  assert.equal((await meaning.worker.request({kind: 'stats'})).loads, 1);

  meaning.vectors.put('one', 'changed', model, [new Float32Array([0, 1])]);
  meaning.vectors.put('two', 'changed', model, [new Float32Array([1, 0])]);
  assert.equal((await meaning.worker.search(model, new Float32Array([1, 0])))[0].uid, 'two');
  meaning.vectors.remove(['two']);
  assert.deepEqual((await meaning.worker.search(model, new Float32Array([1, 0]))).map(row => row.uid), ['one']);
  assert.equal((await meaning.worker.request({kind: 'stats'})).loads, 1, 'changed and deleted documents do not reload the other vectors');
  assert.deepEqual(await meaning.worker.search(model, new Float32Array([1, 0]), {uids: new Set(['not-allowed'])}), []);

  meaning.vectors.clear(model);
  assert.deepEqual(await meaning.worker.search(model, new Float32Array([1, 0])), []);
});

test('cancelled searches release their caller, and a failed worker can be started again', async t => {
  const {meaning} = fixture(t), model = meaning.space;
  meaning.vectors.put('one', 'a', model, [new Float32Array([1, 0])]);
  await meaning.worker.request({kind: 'stats'}); // The independent startup warm-up has completed.
  const controller = new AbortController();
  const pending = meaning.worker.search(model, new Float32Array([1, 0]), {signal: controller.signal});
  controller.abort(new Error('New query replaced this one'));
  await assert.rejects(pending, /replaced/);
  assert.equal(meaning.worker.pending.size, 0);
  assert.equal((await meaning.worker.search(model, new Float32Array([1, 0])))[0].uid, 'one');
  await meaning.worker.worker.terminate();
  assert.equal((await meaning.worker.search(model, new Float32Array([1, 0])))[0].uid, 'one');
  await meaning.worker.close();
  const {MeaningWorker} = await import('../core/index/meaning-worker-client.mjs');
  const replacement = new MeaningWorker(meaning.index.file);
  meaning.index.meaningWorkers.add(replacement);
  await assert.rejects(replacement.request({kind: 'stats'}, {timeoutMs: 1}), /too long/);
  assert.equal(replacement.pending.size, 0);
  assert.equal((await replacement.search(model, new Float32Array([1, 0])))[0].uid, 'one');
});

test('word-only search returns title matches while the AI service is still waiting', async t => {
  const {store, index, meaning} = fixture(t);
  const note = store.save('notes', {title: 'Tax Reporting', content: 'Quarterly records'}); index.update([note]);
  let release, started;
  const waiting = new Promise(resolve => {started = resolve;});
  meaning.embed = async () => {started(); return new Promise(resolve => {release = () => resolve({vectors: [new Float32Array([1, 0])]});});};
  const delayed = index.searchHybrid('Tax Reporting'); await waiting;
  const words = await index.searchHybrid('Tax Reporting', {wordsOnly: true});
  assert.equal(words.mode, 'words'); assert.equal(words.rows[0].id, note.id);
  release(); await delayed;
});

test('changing the embedding service prevents an old background reply from overwriting the new vectors', async t => {
  const {store, index, meaning} = fixture(t);
  const note = store.save('notes', {title: 'Tax Reporting', content: 'Quarterly records'}); index.update([note]);
  let release, started;
  const waiting = new Promise(resolve => {started = resolve;});
  meaning.embed = async () => {started(); return new Promise(resolve => {release = () => resolve({vectors: [new Float32Array([1, 0])]});});};
  const oldRound = meaning.step(); await waiting; await meaning.close();
  const replacement = index.meaning = new MeaningIndex(index, {config: {url: 'https://other.example/v1', model: 'replacement', dimensions: 2}, embed: async texts => ({vectors: texts.map(() => new Float32Array([0, 1]))})});
  await replacement.step(); release(); await oldRound;
  assert.deepEqual(index.db.prepare('SELECT DISTINCT model FROM vectors').all().map(row => row.model), [replacement.space]);
  assert.equal(index.meaningWorkers.size, 1);
});

test('an exact title stays ahead of many shorter body matches before the result limit', async t => {
  const {store, index} = fixture(t);
  const target = store.save('notes', {title: 'Needle Harbor', content: 'filler '.repeat(5000)});
  const others = Array.from({length: 110}, (_, i) => store.prepare('notes', {id: 'other-'+i, title: 'Other '+i, content: 'Needle Harbor'}));
  store.withLock(() => store.commit(others)); index.update([target,...others]);
  const found = await index.searchHybrid('Needle Harbor', {wordsOnly: true, types: ['notes'], limit: 50});
  assert.equal(found.rows[0].id, target.id);
});

test('the later exact-word pass retains compound matches without using AI', async t => {
  const {store, index, meaning} = fixture(t);
  const target = store.save('notes', {title: 'Arzttermin', content: 'Monday'}); index.update([target]);
  meaning.embed = () => {throw new Error('Exact search must not use AI');};
  const first = await index.searchHybrid('termin', {wordsOnly: true}); assert.equal(first.rows.length, 0);
  const full = await index.searchHybrid('termin', {wordsOnly: true, expandWords: true});
  assert.equal(full.rows[0].id, target.id); assert.equal(full.mode, 'words');
});
