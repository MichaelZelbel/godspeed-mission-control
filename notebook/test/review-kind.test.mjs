import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewKind} from '../ui/src/lib/review-kind.mjs';

// A Review card says in plain words what it holds (23 October 2026: red and blue calendars, no words).
test('a review card names its kind: timeline entry, a fact about you or a person by name, a new person', () => {
  const names = new Map([['p1', 'Fictional Jordan']]);
  assert.equal(reviewKind({suggestion_type: 'add_moment', payload: {}}).label, 'Timeline entry');
  assert.equal(reviewKind({suggestion_type: 'add_claim', payload: {subject_type: 'self'}}).label, 'Fact about you');
  assert.equal(reviewKind({suggestion_type: 'add_claim', payload: {subject_type: 'contact', contact_id: 'p1', subject_id: 'p1'}}, names).label, 'Fact about Fictional Jordan');
  assert.equal(reviewKind({suggestion_type: 'add_profile_entry', payload: {is_owner: false, contact_id: 'gone', contact_name: 'Fictional Lee'}}).label, 'Fact about Fictional Lee');
  assert.equal(reviewKind({suggestion_type: 'add_profile_entry', payload: {is_owner: true}}).label, 'Fact about you');
  assert.equal(reviewKind({suggestion_type: 'add_contact', payload: {name: 'Fictional Priya'}}).label, 'New person');
  assert.equal(reviewKind({suggestion_type: 'something_new'}).label, 'Suggestion');
  for (const type of ['add_moment', 'add_claim', 'add_contact', 'add_relationship']) assert.match(reviewKind({suggestion_type: type, payload: {}}).hint, /Keep/);
});
