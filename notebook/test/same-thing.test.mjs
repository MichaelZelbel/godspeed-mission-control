import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';
import {NoteProcessing, jobFor} from '../core/processing.mjs';
import {valueKey, sameValue, factKind, sameIndex, relationKey} from '../core/same-thing.mjs';
import {screenSuggestions, knownRecords, previousProcessedText} from '../core/suggestion-filter.mjs';
import {relevantFacts} from '../core/proposals.mjs';

// One rule for "the same thing" (core/same-thing.mjs), used when a suggestion is screened and when a
// fact is kept. Every name and number here is made up.
const fixture = t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'godspeed-same-thing-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const store = new Store(root), query = new QueryService(store);
  return {store, query, domains: new Domains(query)};
};
const fact = (value, label = 'Phone', extra = {}) => ({type: 'add_claim', title: label + ': ' + value, payload: {label, attribute: label.toLowerCase().replace(/\W+/g, '_'), value, subject_type: 'self', subject_id: null, ...extra}, evidence_quote: String(value)});

test('values are compared written one way: phone numbers, emails, dates, amounts and names', () => {
  for (const phone of ['07700 900 123', '+44.7700.900123', '0044 7700 900123', '(07700) 900-123']) assert.ok(sameValue('+44 7700 900123', phone), phone);
  assert.ok(sameValue('Sam.Rivera@Example.org', 'mailto:sam.rivera@example.org'));
  for (const date of ['15 June 2041', '15.06.2041', 'June 15, 2041', '15. Juni 2041']) assert.ok(sameValue('2041-06-15', date), date);
  for (const amount of ['120.50 €', '120,50 EUR', 'EUR 120.50', '€120.5']) assert.ok(sameValue('€ 120,50', amount), amount);
  assert.ok(sameValue('€ 12.345,67', '12,345.67 EUR'));
  assert.ok(sameValue('Fictional Consulting GmbH', 'fictional consulting'));
  assert.ok(sameValue('Zoë Müller', 'zoe muller'));
  assert.ok(!sameValue('4815162342', '+44 20 7946 0018'), 'a booking number is no phone number');
  assert.ok(!sameValue('120.50', '120.55'));
  assert.ok(!sameValue('2041-06-15', '2041-06-16'));
  assert.equal(valueKey('+44 20 7946 0018').type, 'phone');
  assert.equal(valueKey('HVH-77821-4412').type, 'digits');
  assert.equal(valueKey('Fictional Bay').type, 'text');
});

test('a fact is the same under its other names, and an email or a phone number under any name', () => {
  assert.equal(factKind('location', 'Location', 'Fictional Bay'), 'lives-in');
  assert.equal(factKind('contact_email', 'Contact email', 'x@example.org'), 'email');
  assert.equal(factKind('mobile_number', 'Mobile number', '+44 7700 900123'), 'phone');
  const index = sameIndex({claims: [{subject_type: 'self', attribute: 'phone', value: '+44 7700 900123'}, {subject_type: 'self', attribute: 'agreed_retirement_date', value: '2041-06-15'},
    {subject_type: 'self', attribute: 'monthly_pension', value: '€ 120,50'}, {subject_type: 'self', attribute: 'age', value: '41'}]});
  assert.equal(index.match(fact('07700 900 123', 'Mobile number')).reason, 'known_fact');
  assert.equal(index.match(fact('15 June 2041', 'Agreed pension start date')).reason, 'known_fact', 'a related name and the same date');
  assert.equal(index.match(fact('120.50 €', 'Pension payment')).reason, 'known_fact', 'an amount with cents is that amount under any name');
  assert.equal(index.match(fact('41', 'Gaming level')), null, 'a short value under an unrelated name is another fact');
  assert.equal(index.match(fact('+44 7700 900123', 'Phone', {subject_type: 'contact', contact_id: 'someone-else'})), null, 'someone else\'s fact');
});

test('a timeline entry is the same on its day from the same note, nearly the same a day apart, or with the same people', () => {
  const index = sameIndex({moments: [{id: 'm1', title: 'Moved to Northfield', happened_at: '2026-03-01', source_note_id: 'n1'}, {id: 'm2', title: 'Dinner with Jordan', happened_at: '2026-05-10'}],
    participants: [{moment_id: 'm2', person_id: 'jordan'}]});
  const moment = (title, happened_at, extra = {}) => ({type: 'add_moment', title, payload: {title, happened_at, ...extra}});
  assert.equal(index.match(moment('We moved to Northfield', '2026-03-02', {source_note_id: 'n9'})).reason, 'known_moment');
  assert.equal(index.match(moment('New house keys', '2026-03-01', {source_note_id: 'n1'})).reason, 'known_moment', 'same note, same day');
  assert.equal(index.match(moment('Dinner at the harbour', '2026-05-10', {participants: [{contact_id: 'jordan'}]})).reason, 'known_moment', 'same person, a shared word');
  assert.equal(index.match(moment('Dentist appointment', '2026-03-02', {source_note_id: 'n1'})), null, 'the same note on another day is another event');
  assert.equal(index.match(moment('Moved to Northfield', '2026-06-01')), null);
});

test('a person is the same by name, accents and case, nickname and surname; the owner is never a new person', () => {
  const index = sameIndex({contacts: [{id: 'r', name: 'Robert Smith', aliases: ['Bob']}, {id: 'z', name: 'Zoë Müller'}], selfNames: ['Sam Rivera', 'Sam']});
  const person = name => ({type: 'add_contact', title: 'Add ' + name, payload: {name}});
  for (const name of ['Bob', 'bob smith', 'ROBERT SMITH', 'Zoe Muller', 'Sam Rivera']) assert.equal(index.match(person(name))?.reason, 'known_person', name);
  assert.equal(index.match(person('Bob Jones')), null);
  assert.equal(index.match(person('Priya Natarajan')), null);
});

test('a relationship is the same in either direction and under its everyday words', () => {
  assert.equal(relationKey({source_type: 'contact', source_id: 'mum', target_type: 'self', label: 'mother'}), relationKey({source_type: 'self', target_type: 'contact', target_id: 'mum', label: 'son'}));
  assert.equal(relationKey({source_type: 'contact', source_id: 'a', target_type: 'contact', target_id: 'b', label: 'colleague'}), relationKey({source_type: 'contact', source_id: 'b', target_type: 'contact', target_id: 'a', label: 'co-worker'}));
  assert.notEqual(relationKey({source_type: 'contact', source_id: 'a', target_type: 'self', label: 'friend'}), relationKey({source_type: 'contact', source_id: 'a', target_type: 'self', label: 'manager'}));
});

test('the lookups cost the same with 200 facts or 20,000', () => {
  const claims = n => Array.from({length: n}, (_, i) => ({subject_type: 'self', attribute: 'fictional_kind_' + (i % 50), value: 'Fictional value number ' + i}));
  const time = n => { const started = performance.now(), index = sameIndex({claims: claims(n)}); for (let i = 0; i < 2000; i++) index.match(fact('Fictional value number ' + (i * 7), 'Fictional kind ' + (i % 50))); return performance.now() - started; };
  time(200);
  assert.ok(time(20000) < 3000, 'building the index for 20,000 facts and 2,000 lookups take seconds at most');
});

test('the screen leaves out what was suggested before in any status, a second copy, and old words of an edited note', () => {
  const records = {queue: [
    {suggestion_type: 'add_claim', status: 'removed', payload: {label: 'Phone', value: '+44 7700 900123', subject_type: 'self'}},
    {suggestion_type: 'add_claim', status: 'withdrawn', payload: {label: 'Hobby', value: 'Fictional chess', subject_type: 'self'}}]};
  const previousText = 'Jordan Lee\nMet Jordan at the gym. Jordan is a nurse.';
  const {kept, dropped} = screenSuggestions([fact('07700 900 123'), fact('Fictional chess', 'Hobby'), fact('Fictional chess', 'Hobby'),
    {...fact('nurse', 'Job'), evidence_quote: 'Jordan is a nurse.'}, {...fact('4 May', 'Birthday'), evidence_quote: 'Jordan\'s birthday is on 4 May.'}], records, {previousText});
  assert.deepEqual(dropped.map(d => d.reason), ['already_suggested', 'already_suggested', 'old_words']);
  assert.match(dropped[1].detail, /twice in one answer/);
  assert.deepEqual(kept.map(k => k.payload.value), ['Fictional chess', '4 May'], 'a withdrawn suggestion does not stop the same thing from new words');
});

test('keeping a fact finds the value already there, written another way and under another name', t => {
  const {query, domains} = fixture(t);
  domains.writeFact({label: 'Phone', attribute: 'phone', value: '+44 7700 900123'});
  domains.writeFact({label: 'Email', attribute: 'email', value: 'sam.rivera@example.org'});
  assert.equal(domains.writeFact({label: 'Phone', attribute: 'phone', value: '+44.7700.900123'}).facts[0].outcome, 'already_recorded');
  assert.equal(domains.writeFact({label: 'Work email', attribute: 'work_email', value: 'Sam.Rivera@example.org'}).facts[0].outcome, 'already_recorded');
  assert.equal(query.rows('claims').length, 2);
});

test('keeping a person, a timeline entry or a relationship the notebook already has links to it instead of adding a second', async t => {
  const {store, query, domains} = fixture(t), bob = store.save('contacts', {name: 'Robert Smith', aliases: ['Bob']}), mum = store.save('contacts', {name: 'Fictional Mum'});
  store.save('moments', {title: 'Moved to Northfield', happened_at: '2026-03-01', status: 'past_fact'});
  domains.query.execute({table: 'contact_relationships', operation: 'insert', values: {source_type: 'contact', source_id: mum.id, target_type: 'self', target_id: null, label: 'mother'}});
  const items = [store.save('review_queue', {suggestion_type: 'add_contact', status: 'pending_review', payload: {name: 'Bob Smith'}}),
    store.save('review_queue', {suggestion_type: 'add_moment', status: 'pending_review', payload: {title: 'We moved to Northfield', happened_at: '2026-03-01'}}),
    store.save('review_queue', {suggestion_type: 'add_relationship', status: 'pending_review', payload: {source_type: 'self', source_id: null, target_type: 'contact', target_id: mum.id, label: 'son'}})];
  const kept = await domains.invoke('review-queue-bulk', {action: 'keep', ids: items.map(i => i.id)});
  assert.deepEqual(kept.errors, []);
  assert.equal(query.rows('contacts').length, 2);
  assert.equal(query.rows('moments').length, 1);
  assert.equal(query.rows('contact_relationships').length, 1);
  assert.equal(store.get('review_queue', items[0].id).target_entity_id, bob.id);
  const undone = await domains.invoke('review-queue-bulk', {action: 'rollback', ids: items.map(i => i.id)});
  assert.equal(undone.succeeded, 3);
  assert.equal(query.rows('moments').length, 1, 'Undo removes nothing it did not add');
  assert.equal(query.rows('contacts').length, 2);
});

test('a processed note keeps its "done" while another program writes, so the same text is not processed again', async t => {
  const {store, query, domains} = fixture(t);
  store.save('settings', {id: 'installation', owner: 'local', timezone: 'UTC'});
  let calls = 0;
  domains.provider = async input => { calls++; return {metadata: {type: 'observation'}, tags: [], suggestions: [{type: 'add_claim', title: 'Sport', payload: {label: 'Favourite sport', value: 'Fictional climbing', subject: 'self'}, evidence_quote: input.note.text.slice(0, 20)}]}; };
  const processing = new NoteProcessing({store, query, domains, device: 'local'});
  await processing.tick({now: Date.now() - 1000});
  const note = store.save('notes', {title: 'Sport', content: 'I love fictional climbing on Mondays.'});
  // The moment processing records "done", another writer holds the workspace once.
  const withLock = store.withLock.bind(store), saveAsync = store.saveAsync.bind(store), save = store.save.bind(store);
  let armed = false, blocked = false;
  const arm = (type, value) => { if (type === 'note_ai_jobs' && value.state === 'completed' && !blocked) armed = true; };
  store.saveAsync = (type, value, ...rest) => { arm(type, value); return saveAsync(type, value, ...rest); };
  store.save = (type, value, ...rest) => { arm(type, value); return save(type, value, ...rest); };
  store.withLock = fn => { if (armed) { armed = false; blocked = true; throw Object.assign(new Error('Workspace is being written by another process'), {code: 'WRITER_BUSY'}); } return withLock(fn); };
  const later = Date.parse(note.updated_at) + 180000;
  assert.equal((await processing.tick({now: later})).processed, 1);
  assert.ok(blocked, 'the save met another writer');
  assert.equal(jobFor(query, note.id).state, 'completed');
  assert.equal((await processing.tick({now: later + 600000})).processed, 0);
  assert.equal(calls, 1, 'processed once');
  assert.equal(query.rows('review_queue').length, 1);
  assert.match(previousProcessedText(query, store.get('notes', note.id)), /fictional climbing/);
});

test('processing is shown the facts a note is about first, not the first 80', () => {
  const facts = [...Array.from({length: 100}, (_, i) => ({label: 'Fictional fact ' + i, attribute: 'fictional_' + i, value: 'Value ' + i})), {label: 'Phone', attribute: 'phone', value: '+44 7700 900123'}];
  const shown = relevantFacts(facts, {title: 'Signature', content: 'Mobile: 07700 900 123'});
  assert.equal(shown.length, 80);
  assert.equal(shown[0].value, '+44 7700 900123');
});

test('the screen reads the notebook as it is: knownRecords holds every fact, also one hidden from assistants', t => {
  const {store, query, domains} = fixture(t);
  store.save('profile_categories', {slug: 'private-stuff', name: 'Private', visibility_scope: 'private'});
  domains.writeFact({label: 'Diagnosis', attribute: 'diagnosis', value: 'Fictional condition', category_slug: 'private-stuff'});
  const {dropped} = screenSuggestions([fact('Fictional condition', 'Diagnosis')], knownRecords(query));
  assert.equal(dropped[0]?.reason, 'known_fact');
});
