import test from 'node:test';
import assert from 'node:assert/strict';
import {filledOnOpen, mergeSuggestion} from '../ui/src/components/timeline/moment-form.mjs';

const people = [{id: 'p-ana', name: 'Fictional Ana'}, {id: 'p-ben', name: 'Fictional Ben'}];
const blank = {title: '', dateStart: '2026-10-10', dateEnd: '', status: 'unknown', impactLevel: 2, confDate: 5, confTruth: 5, matchedPeople: []};
const draft = {title: 'Lunch with Ana', happened_at: '2026-10-09', happened_end: null, status: 'past_fact', impact_level: 1, confidence_date: 9, confidence_truth: 8, participants: ['Fictional Ana', 'Fictional Cleo']};

test('a suggestion on a new moment fills every field, its placeholder date and sliders included', () => {
  const {form, changed, newPeople} = mergeSuggestion(blank, filledOnOpen(null), draft, people);
  assert.equal(form.title, 'Lunch with Ana');
  assert.equal(form.dateStart, '2026-10-09', 'today is a placeholder, not a choice');
  assert.equal(form.status, 'past_fact');
  assert.deepEqual([form.impactLevel, form.confDate, form.confTruth], [1, 9, 8]);
  assert.deepEqual(form.matchedPeople, ['p-ana']);
  assert.deepEqual(newPeople, ['Fictional Cleo']);
  assert.deepEqual(changed.sort(), ['confDate', 'confTruth', 'dateStart', 'impactLevel', 'people', 'status', 'title']);
});

test('a suggestion never replaces what the person filled in', () => {
  // Michael's case: he picked a start date, and the suggestion made it "yesterday".
  const typed = {...blank, title: 'My own title', dateStart: '2026-09-30', dateEnd: '2026-10-02', status: 'ongoing', impactLevel: 4, confDate: 10, confTruth: 3, matchedPeople: ['p-ben']};
  const filled = {title: true, dateStart: true, dateEnd: true, status: true, impactLevel: true, confDate: true, confTruth: true};
  const {form, changed} = mergeSuggestion(typed, filled, {...draft, happened_end: '2026-10-12'}, people);
  assert.equal(form.title, 'My own title');
  assert.equal(form.dateStart, '2026-09-30');
  assert.equal(form.dateEnd, '2026-10-02');
  assert.equal(form.status, 'ongoing');
  assert.deepEqual([form.impactLevel, form.confDate, form.confTruth], [4, 10, 3]);
  assert.deepEqual(form.matchedPeople, ['p-ben', 'p-ana'], 'people are added to, never removed');
  assert.deepEqual(changed, ['people']);
});

test('a suggestion fills the empty fields beside the filled ones', () => {
  const partly = {...blank, dateStart: '2026-09-30'};
  const filled = {...filledOnOpen(null), dateStart: true, impactLevel: true};
  const {form, changed} = mergeSuggestion(partly, filled, draft, people);
  assert.equal(form.dateStart, '2026-09-30', 'the chosen start date stays');
  assert.equal(form.impactLevel, 2, 'a slider set by hand stays, even on its starting value');
  assert.equal(form.title, 'Lunch with Ana');
  assert.equal(form.status, 'past_fact');
  assert.deepEqual([form.confDate, form.confTruth], [9, 8]);
  assert.ok(!changed.includes('dateStart') && !changed.includes('impactLevel'));
});

test('a cleared start date counts as empty again, and an end date never lands before the start', () => {
  const cleared = {...blank, dateStart: ''};
  assert.equal(mergeSuggestion(cleared, {...filledOnOpen(null), dateStart: true}, draft, people).form.dateStart, '2026-10-09');
  const chosen = {...blank, dateStart: '2026-10-20'};
  const span = {...draft, happened_at: '2026-10-05', happened_end: '2026-10-08'};
  const merged = mergeSuggestion(chosen, {...filledOnOpen(null), dateStart: true}, span, people).form;
  assert.equal(merged.dateStart, '2026-10-20');
  assert.equal(merged.dateEnd, '', 'an end before the kept start is left out');
  assert.equal(mergeSuggestion(blank, filledOnOpen(null), span, people).form.dateEnd, '2026-10-08');
});

test('an existing moment keeps its saved values; only its gaps and an Unknown status are filled', () => {
  const saved = {title: 'Business trip', description: null, happened_at: '2026-10-05T00:00:00+00:00', happened_end: null, status: 'unknown', impact_level: 2, confidence_date: 5, confidence_truth: 5};
  const filled = filledOnOpen(saved);
  assert.deepEqual(filled, {title: true, dateStart: true, dateEnd: false, status: false, impactLevel: true, confDate: true, confTruth: true});
  const form = {title: saved.title, dateStart: '2026-10-05', dateEnd: '', status: 'unknown', impactLevel: 2, confDate: 5, confTruth: 5, matchedPeople: []};
  const merged = mergeSuggestion(form, filled, {...draft, happened_at: '2026-10-04', happened_end: '2026-10-08'}, people).form;
  assert.equal(merged.title, 'Business trip');
  assert.equal(merged.dateStart, '2026-10-05');
  assert.equal(merged.dateEnd, '2026-10-08');
  assert.equal(merged.status, 'past_fact');
  assert.deepEqual([merged.impactLevel, merged.confDate, merged.confTruth], [2, 5, 5]);
});

test("a value the last suggestion filled is not the person's, so a newer suggestion replaces it", () => {
  const first = mergeSuggestion(blank, filledOnOpen(null), {...draft, happened_end: '2026-10-10'}, people).form;
  assert.equal(first.title, 'Lunch with Ana');
  const second = mergeSuggestion(first, filledOnOpen(null), {...draft, title: 'Long lunch with Ana', happened_end: '2026-10-11', impact_level: 2}, people).form;
  assert.equal(second.title, 'Long lunch with Ana');
  assert.equal(second.dateEnd, '2026-10-11');
  assert.equal(second.impactLevel, 2);
  // Once the person types a title, it is theirs.
  const typed = mergeSuggestion({...first, title: 'Lunch!'}, {...filledOnOpen(null), title: true}, {...draft, title: 'Another title'}, people).form;
  assert.equal(typed.title, 'Lunch!');
});

test('a suggestion missing values leaves those fields as they are', () => {
  const {form, changed} = mergeSuggestion(blank, filledOnOpen(null), {title: '  ', happened_at: null, status: 'nonsense', impact_level: null, confidence_date: 'x'}, people);
  assert.deepEqual(form, blank);
  assert.deepEqual(changed, []);
  assert.deepEqual(mergeSuggestion(blank, filledOnOpen(null), null, people).changed, []);
  assert.equal(mergeSuggestion(blank, filledOnOpen(null), {impact_level: 9, confidence_truth: -3}, people).form.impactLevel, 4);
  assert.equal(mergeSuggestion(blank, filledOnOpen(null), {impact_level: 9, confidence_truth: -3}, people).form.confTruth, 0);
});
