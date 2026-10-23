import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';

// What processing proposed from a note (a fact, a timeline entry, a new person) waited in the review
// queue after the note was trashed, or after the words it came from were taken out of it. An add-on
// that takes a letter back out of the notebook (it empties the note and trashes it) could not take
// back what processing had already proposed from that letter. Now a waiting suggestion is withdrawn
// when its note goes to the trash or is deleted, or when the sentence it quotes is no longer in the
// note; it comes back when the note does. A suggestion the person already kept stays kept.
const MOVED = 'I moved to Leipzig in May.', CLIMB = 'We go climbing on Monday the 12th.', BEN = 'Fictional Ben lent me his rope.';
const WAITING = ['pending', 'pending_review', 'auto_applied_unreviewed'];
const setup = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'godspeed-withdraw-'));
  const store = new Store(root, {device: 'vps'}), query = new QueryService(store), domains = new Domains(query);
  store.save('settings', {id: 'installation', owner: 'vps', timezone: 'Europe/Berlin'});
  domains.provider = async input => {
    const text = input.note.text, s = [];
    if (text.includes(MOVED)) s.push({type: 'add_claim', title: 'Home city', payload: {label: 'Home city', value: 'Leipzig', subject: 'self'}, evidence_quote: MOVED});
    if (text.includes(CLIMB)) s.push({type: 'add_moment', title: 'Climbing', payload: {title: 'Climbing trip', happened_at: '2026-10-12', status: 'future_plan'}, evidence_quote: CLIMB});
    if (text.includes(BEN)) s.push({type: 'add_contact', title: 'Add Fictional Ben', payload: {name: 'Fictional Ben'}, evidence_quote: BEN});
    if (text.includes('Ben gave')) s.push({type: 'add_contact', title: 'Add Fictional Ben', payload: {name: 'Fictional Ben'}, evidence_quote: 'Fictional Ben gave me a rope.'});
    return {metadata: {type: 'observation'}, tags: [], suggestions: s};
  };
  const note = store.save('notes', {title: 'Autumn', content: [MOVED, CLIMB, BEN].join(' ')});
  return {store, query, domains, note};
};
const process = async ({domains}, note) => domains.invoke('process-note', {note_id: note.id});
const items = ({query}, note) => query.rows('review_queue').filter(r => r.source_note_id === note.id);
const statusOf = (ctx, note, type) => items(ctx, note).filter(r => r.suggestion_type === type).map(r => r.status);
const door = ({query}, note, values) => query.execute({table: 'notes', operation: 'update', values, filters: [['eq', 'id', note.id]]}).data[0];
const keep = async ({domains}, item) => { const r = await domains.invoke('review-queue-bulk', {action: 'keep', scope: {ids: [item.id]}}); if (r.errors?.length) throw new Error(r.errors[0].error); };

test('trashing a note withdraws what it proposed; what was kept stays; restoring brings the rest back', async () => {
  const ctx = setup(), {note} = ctx;
  await process(ctx, note);
  assert.equal(items(ctx, note).length, 3);
  await keep(ctx, items(ctx, note).find(r => r.suggestion_type === 'add_contact'));
  door(ctx, note, {is_trashed: true, trashed_at: new Date().toISOString()});
  assert.deepEqual(statusOf(ctx, note, 'add_claim'), ['withdrawn']);
  assert.deepEqual(statusOf(ctx, note, 'add_moment'), ['withdrawn']);
  assert.deepEqual(statusOf(ctx, note, 'add_contact'), ['kept'], 'a kept suggestion stays kept');
  assert.equal(ctx.query.rows('review_queue').filter(r => WAITING.includes(r.status)).length, 0, 'nothing waits in the review queue');
  door(ctx, note, {is_trashed: false, trashed_at: null});
  assert.deepEqual(statusOf(ctx, note, 'add_claim'), ['pending_review']);
  assert.deepEqual(statusOf(ctx, note, 'add_moment'), ['pending_review']);
  assert.deepEqual(statusOf(ctx, note, 'add_contact'), ['kept']);
});

test('taking a sentence out of a note withdraws only what it quoted; putting it back brings it back', async () => {
  const ctx = setup(), {note, store} = ctx;
  await process(ctx, note);
  door(ctx, note, {content: [MOVED, BEN].join(' ')});
  assert.deepEqual(statusOf(ctx, note, 'add_moment'), ['withdrawn']);
  assert.deepEqual(statusOf(ctx, note, 'add_claim'), ['pending_review']);
  assert.deepEqual(statusOf(ctx, note, 'add_contact'), ['pending_review']);
  const withdrawn = items(ctx, note).find(r => r.suggestion_type === 'add_moment');
  assert.equal(withdrawn.withdrawn_reason, 'source_text_gone');
  store.save('notes', {id: note.id, content: [MOVED, CLIMB, BEN].join(' ')});
  assert.deepEqual(statusOf(ctx, note, 'add_moment'), ['pending_review']);
});

test('an add-on taking its letter back (emptied and trashed in one write) withdraws everything waiting', async () => {
  const ctx = setup(), {note} = ctx;
  await process(ctx, note);
  door(ctx, note, {title: 'Kept out of the notebook', content: '', tags: [], is_trashed: true, trashed_at: new Date().toISOString()});
  assert.deepEqual(items(ctx, note).map(r => r.status), ['withdrawn', 'withdrawn', 'withdrawn']);
  // The add-on writes the letter again later (its tag was taken off): what it proposed is back.
  door(ctx, note, {title: 'Autumn', content: [MOVED, CLIMB, BEN].join(' '), is_trashed: false, trashed_at: null});
  assert.deepEqual(items(ctx, note).map(r => r.status), ['pending_review', 'pending_review', 'pending_review']);
});

test('deleting a note withdraws what it proposed', async () => {
  const ctx = setup(), {note, query} = ctx;
  await process(ctx, note);
  query.execute({table: 'notes', operation: 'delete', filters: [['eq', 'id', note.id]]});
  assert.deepEqual(items(ctx, note).map(r => r.status), ['withdrawn', 'withdrawn', 'withdrawn']);
  assert.ok(items(ctx, note).every(r => r.withdrawn_reason === 'source_removed'));
});

test('a withdrawn suggestion cannot be kept', async () => {
  const ctx = setup(), {note} = ctx;
  await process(ctx, note);
  door(ctx, note, {is_trashed: true});
  const claim = items(ctx, note).find(r => r.suggestion_type === 'add_claim');
  await assert.rejects(keep(ctx, claim), /no longer pending/);
  assert.equal(ctx.query.rows('claims').filter(c => c.value === 'Leipzig').length, 0);
});

test('a changed text can propose the same thing again from its new words, and the old one stays withdrawn', async () => {
  const ctx = setup(), {note, store} = ctx;
  await process(ctx, note);
  door(ctx, note, {content: [MOVED, CLIMB, 'Fictional Ben gave me a rope.'].join(' ')});
  assert.deepEqual(statusOf(ctx, note, 'add_contact'), ['withdrawn']);
  await process(ctx, store.get('notes', note.id));
  assert.deepEqual(statusOf(ctx, note, 'add_contact').sort(), ['pending_review', 'withdrawn'], 'proposed again from the new sentence');
  // The old sentence back as well: the old suggestion does not come back beside the new one.
  door(ctx, note, {content: [MOVED, CLIMB, BEN, 'Fictional Ben gave me a rope.'].join(' ')});
  assert.deepEqual(statusOf(ctx, note, 'add_contact').sort(), ['pending_review', 'withdrawn']);
});

test('a save that leaves the title, the text and the trash alone changes no suggestion', async () => {
  const ctx = setup(), {note, store} = ctx;
  await process(ctx, note);
  const before = items(ctx, note).map(r => r._hash);
  door(ctx, note, {is_favorite: true, tags: ['autumn'], folder_path: 'Diary'});
  store.save('notes', {id: note.id, metadata: {type: 'idea'}});
  assert.deepEqual(items(ctx, note).map(r => r._hash), before);
});

test('a suggestion that quotes words from elsewhere is withdrawn with the note, not by an edit', async () => {
  const ctx = setup(), {note, query} = ctx;
  query.execute({table: 'review_queue', operation: 'insert', values: {title: 'Favourite colour: green', suggestion_type: 'add_claim', status: 'pending_review', origin: 'ai',
    description: 'I said in our chat that green is my favourite colour.', source_note_id: note.id, payload: {label: 'Favourite colour', value: 'green', subject_type: 'self'}}});
  door(ctx, note, {content: 'Something else entirely, written later.'});
  assert.deepEqual(statusOf(ctx, note, 'add_claim'), ['pending_review'], 'its words were never in the note');
  door(ctx, note, {is_trashed: true});
  assert.deepEqual(statusOf(ctx, note, 'add_claim'), ['withdrawn']);
  door(ctx, note, {is_trashed: false});
  assert.deepEqual(statusOf(ctx, note, 'add_claim'), ['pending_review']);
});

test('one write that trashes the note and also changes a suggestion keeps both changes', async () => {
  const ctx = setup(), {note, store} = ctx;
  await process(ctx, note);
  const claim = items(ctx, note).find(r => r.suggestion_type === 'add_claim'), until = '2099-01-01T00:00:00.000Z';
  store.transaction(view => {
    view.commit([view.prepare('notes', {is_trashed: true}, view.get('notes', note.id)), view.prepare('review_queue', {snoozed_until: until}, view.get('review_queue', claim.id))]);
  });
  const after = store.get('review_queue', claim.id);
  assert.equal(after.status, 'withdrawn');
  assert.equal(after.snoozed_until, until);
});
