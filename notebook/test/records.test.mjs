import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store, encode, atomic } from '../core/records/store.mjs';
import { SearchIndex } from '../core/index/search.mjs';
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'godspeed-alpha-test-'));

test('fresh store, Unicode direct file edits, restart and index loss preserve data', () => {
  const root = temp(), store = new Store(root), note = store.save('notes', { title: 'Grüße 日本語', content: 'Original' });
  let index = new SearchIndex(store); assert.equal(index.search('Grüße').length, 1); index.close();
  const file = store.file(note); atomic(file, encode({ ...note, content: 'Assistant edit' }));
  fs.unlinkSync(path.join(root, '.godspeed/search.sqlite'));
  const restarted = new Store(root); index = new SearchIndex(restarted);
  assert.equal(index.search('Assistant edit').length, 1); assert.equal(restarted.get('notes', note.id).content, 'Assistant edit'); index.close();
});
test('stale edits preserve both versions and reject overwrite', () => {
  const store = new Store(temp()), note = store.save('notes', { title: 'Shared', content: 'A' }), first = store.get('notes', note.id);
  store.save('notes', { id: note.id, content: 'B' }, first._hash);
  assert.throws(() => store.save('notes', { id: note.id, content: 'C' }, first._hash), /Both versions/);
  assert.equal(store.get('notes', note.id).content, 'B');
  assert.equal(fs.readdirSync(path.join(store.root, 'conflicts')).length, 1);
});
test('multi-file crash recovers all prepared changes on restart', () => {
  const root = temp(), store = new Store(root); store.failAfter = 1;
  const p = store.prepare('contacts', { name: 'Alex' }), n = store.prepare('notes', { title: 'Meet Alex', references: [{ type: 'contacts', id: p.id, uid: p.uid }] });
  assert.throws(() => store.withLock(() => store.commit([p, n])), /Injected crash/);
  const recovered = new Store(root); assert.equal(recovered.list('contacts').length, 1); assert.equal(recovered.list('notes').length, 1); assert.equal(recovered.problems.length, 0);
});
test('rename and tombstone preserve identities and offline references', () => {
  const store = new Store(temp()), p = store.save('contacts', { name: 'Alex' });
  store.structural('contacts', p.id, 'display-name', { name: 'Alexandra' });
  assert.equal(store.get('contacts', p.id).uid, p.uid);
  store.structural('contacts', p.id, 'remove');
  store.save('notes', { title: 'Offline note', references: [{ type: 'contacts', id: p.id, uid: p.uid }] });
  assert.equal(store.problems.length, 0); assert.equal(store.list('contacts').length, 0);
});
test('offline same-name creation stays distinct', () => {
  const a = new Store(temp(), { device: 'desktop' }), b = new Store(temp(), { device: 'laptop' });
  const first = a.save('contacts', { name: 'Alex' }), second = b.save('contacts', { name: 'Alex' });
  assert.notEqual(first.id, second.id); assert.notEqual(first.uid, second.uid);
});
test('backup restores records, history and conflicts into an empty workspace', () => {
  const store = new Store(temp()); store.save('claims', { attribute: 'city', value: 'Town', valid_from: '2026-01-01', valid_to: '2026-09-01' });
  store.save('claims', { attribute: 'city', value: 'New Town', valid_from: '2026-09-01', valid_to: null });
  const backup = path.join(temp(), 'backup'); store.backup(backup);
  const restored = new Store(temp()); assert.equal(restored.restore(backup), 2); assert.equal(restored.list('claims').filter(c => c.valid_to).length, 1);
  assert.throws(() => restored.restore(backup), /empty workspace/);
});
test('missing references refuse publication and incomplete direct edits remain untouched', () => {
  const store = new Store(temp()); assert.throws(() => store.save('notes', { title: 'Bad', references: [{ type: 'contacts', id: 'missing' }] }), /validation failed/);
  const file = path.join(store.recordsRoot, 'notes', 'broken.md'); atomic(file, 'unfinished'); store.scan();
  assert.equal(store.problems.length, 1); assert.equal(fs.readFileSync(file, 'utf8'), 'unfinished');
});
test('path traversal and append-only event mutation are refused', () => {
  const store = new Store(temp()); assert.throws(() => store.save('../secrets', {}), /Invalid/);
  const event = store.save('moments', { title: 'Meeting', happened_at: '2026-10-02' });
  assert.throws(() => store.save('moments', { id: event.id, title: 'Changed' }), /append-only/);
});
