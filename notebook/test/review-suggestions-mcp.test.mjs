import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';
import {mcp} from '../server/mcp.mjs';

// An assistant decides on waiting suggestions when the owner asks (23 October 2026). No tool shows it
// a suggestion's version hash, so until then every "remove these" failed with "Read the current record
// hash before editing", and one whose note was in the trash with "Choose a visible existing record".
const fixture = t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'godspeed-review-mcp-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const store = new Store(root), query = new QueryService(store), domains = new Domains(query);
  domains.identity = {ownerAsked: words => words === 'Yes, keep the bakery'};
  return {store, query, domains};
};
const call = (env, args) => mcp({id: 1, method: 'tools/call', params: {name: 'review_suggestions', arguments: args}}, env);
const answer = result => { assert.equal(result.result.isError, undefined, result.result.content[0].text); return JSON.parse(result.result.content[0].text); };
const waiting = (store, value, extra = {}) => store.save('review_queue', {suggestion_type: 'add_claim', status: 'pending_review', origin: 'ai', title: 'Favourite bakery: ' + value, payload: {label: 'Favourite bakery', attribute: 'favourite_bakery', value, subject_type: 'self', subject_id: null}, ...extra});

test('an assistant removes, rolls back, blocks and snoozes waiting suggestions without hashes', async t => {
  const env = fixture(t), a = waiting(env.store, 'Fictional Crust'), b = waiting(env.store, 'Fictional Crumb'), c = waiting(env.store, 'Fictional Loaf'), d = waiting(env.store, 'Fictional Bun');
  assert.equal(answer(await call(env, {action: 'remove', ids: [a.id, b.id]})).succeeded, 2);
  assert.deepEqual([a, b].map(x => env.store.get('review_queue', x.id).status), ['removed', 'removed']);
  assert.equal(answer(await call(env, {action: 'block', ids: [c.id]})).succeeded, 1);
  assert.equal(env.store.get('review_queue', c.id).status, 'blocked');
  assert.ok(env.query.rows('ai_suggestion_suppressions').some(s => s.value === 'Fictional Loaf'), 'blocked: never suggested again');
  assert.equal(answer(await call(env, {action: 'snooze', ids: [d.id]})).succeeded, 1);
  assert.ok(env.store.get('review_queue', d.id).snoozed_until);
  assert.equal(answer(await call(env, {action: 'rollback', ids: [d.id]})).succeeded, 1);
  assert.equal(env.store.get('review_queue', d.id).status, 'removed');
});

test('a suggestion whose note went to the trash can still be taken away', async t => {
  const env = fixture(t), note = env.store.save('notes', {title: 'Bakeries', content: 'Fictional Crust is my favourite bakery.'});
  const item = waiting(env.store, 'Fictional Crust', {source_note_id: note.id, description: 'Fictional Crust is my favourite bakery.', payload: {label: 'Favourite bakery', attribute: 'favourite_bakery', value: 'Fictional Crust', subject_type: 'self', subject_id: null, source_type: 'note', source_id: note.id}});
  env.store.save('notes', {id: note.id, is_trashed: true});
  // Trashing withdraws it (review-sources.mjs); one kept waiting by hand is still removable.
  env.store.save('review_queue', {id: item.id, status: 'pending_review'});
  assert.equal(answer(await call(env, {action: 'rollback', ids: [item.id]})).succeeded, 1);
  assert.equal(env.store.get('review_queue', item.id).status, 'removed');
});

test('keeping needs the owner\'s own words; a suggestion about a hidden person stays out of reach', async t => {
  const env = fixture(t), item = waiting(env.store, 'Fictional Crust');
  const refused = await call(env, {action: 'keep', ids: [item.id]});
  assert.equal(refused.result.isError, true);
  assert.match(refused.result.content[0].text, /owner asked/);
  assert.equal(env.store.get('review_queue', item.id).status, 'pending_review');
  assert.equal(answer(await call(env, {action: 'keep', ids: [item.id], words: 'Yes, keep the bakery'})).succeeded, 1);
  assert.deepEqual(env.query.rows('profile_facts').filter(f => f.is_current).map(f => f.value), ['Fictional Crust']);
  const hidden = env.store.save('contacts', {name: 'Fictional Hidden', ai_visibility: 'hidden'});
  const theirs = env.store.save('review_queue', {suggestion_type: 'add_claim', status: 'pending_review', title: 'Hobby', payload: {label: 'Hobby', value: 'Chess', subject_type: 'contact', contact_id: hidden.id, subject_id: hidden.id}});
  const result = answer(await call(env, {action: 'remove', ids: [theirs.id]}));
  assert.equal(result.succeeded, 0);
  assert.match(result.errors[0].error, /visible/);
  assert.equal(env.store.get('review_queue', theirs.id).status, 'pending_review');
});

test('on a server\'s watching store, one decision after another goes through', async t => {
  // The guard kept a list of records of its own that no later write refreshed, so the second call
  // could not see its own job record and answered "Choose a visible existing record".
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'godspeed-review-mcp-watch-'));
  const store = new Store(root, {watch: true});
  t.after(() => { store.unwatch(); fs.rmSync(root, {recursive: true, force: true}); });
  const query = new QueryService(store), domains = new Domains(query), env = {store, query, domains};
  const items = ['Fictional Crust', 'Fictional Crumb', 'Fictional Loaf', 'Fictional Bun', 'Fictional Roll'].map(v => waiting(store, v));
  for (const [i, action] of ['rollback', 'remove', 'rollback', 'block', 'remove'].entries()) {
    const result = answer(await call(env, {action, ids: [items[i].id]}));
    assert.equal(result.succeeded, 1, action + ' number ' + (i + 1) + ': ' + JSON.stringify(result.errors));
  }
  assert.deepEqual(items.map(x => store.get('review_queue', x.id).status), ['removed', 'removed', 'removed', 'blocked', 'removed']);
});

test('rolling back a kept suggestion undoes it while what it made is unchanged, and refuses after an edit', async t => {
  const env = fixture(t), item = waiting(env.store, 'Fictional Crust'), other = waiting(env.store, 'Fictional Crumb');
  assert.equal(answer(await call(env, {action: 'keep', ids: [item.id, other.id], words: 'Yes, keep the bakery'})).succeeded, 2);
  assert.equal(answer(await call(env, {action: 'rollback', ids: [item.id]})).succeeded, 1);
  assert.ok(!env.query.rows('profile_facts').some(f => f.value === 'Fictional Crust'));
  const claim = env.store.get('review_queue', other.id).target_entity_id;
  env.store.save('claims', {id: claim, value: 'Fictional Crumb and Co'});
  const refused = answer(await call(env, {action: 'rollback', ids: [other.id]}));
  assert.equal(refused.succeeded, 0);
  assert.equal(env.store.get('claims', claim).value, 'Fictional Crumb and Co');
});
