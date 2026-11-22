import test from 'node:test';
import assert from 'node:assert/strict';
import {filledOnOpen, mergeSuggestion, newPersonOffer, newPeopleToCreate} from '../ui/src/components/timeline/moment-form.mjs';

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
  // A real case: the owner picked a start date, and the suggestion made it "yesterday".
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

test('a moment saved without scores leaves them open to a suggestion, and its saved scores are its own', () => {
  const sparse = {title: 'Sparse', description: null, happened_at: '2026-10-05T00:00:00+00:00', happened_end: null, status: 'past_fact', impact_level: null, confidence_date: null, confidence_truth: null};
  assert.deepEqual(filledOnOpen(sparse), {title: true, dateStart: true, dateEnd: false, status: true, impactLevel: false, confDate: false, confTruth: false});
  const form = {title: sparse.title, dateStart: '2026-10-05', dateEnd: '', status: 'past_fact', impactLevel: null, confDate: null, confTruth: null, matchedPeople: []};
  const merged = mergeSuggestion(form, filledOnOpen(sparse), draft, people).form;
  assert.equal(merged.dateStart, '2026-10-05', 'the saved day stays');
  assert.deepEqual([merged.impactLevel, merged.confDate, merged.confTruth], [1, 9, 8], 'the missing scores are gaps the suggestion fills');
  const undated = {...sparse, happened_at: null};
  assert.equal(filledOnOpen(undated).dateStart, false, 'a moment with no day at all leaves its date open too');
  assert.equal(mergeSuggestion({...form, dateStart: ''}, filledOnOpen(undated), draft, people).form.dateStart, '2026-10-09');
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

test('the People picker offers a typed name that is nobody in People as a new person', () => {
  assert.equal(newPersonOffer('  Fictional   Dora ', people, []), 'Fictional Dora');
  assert.equal(newPersonOffer('', people, []), null, 'an empty search offers nothing');
  assert.equal(newPersonOffer('   ', people, []), null);
});

test('a typed name that is in People under another case is not offered as new', () => {
  assert.equal(newPersonOffer('fictional ana', people, []), null);
  assert.equal(newPersonOffer('FICTIONAL BEN', people, []), null);
  // A part of a name is still a new name: "Fictional" alone is nobody.
  assert.equal(newPersonOffer('Fictional', people, []), 'Fictional');
});

test('a name already added as new is not offered twice', () => {
  assert.equal(newPersonOffer('fictional dora', people, ['Fictional Dora']), null);
});

test('with an empty People list any typed name can be added', () => {
  assert.equal(newPersonOffer('Fictional Eli', [], []), 'Fictional Eli');
});

test('a save creates the suggested and the typed new people, each once and only those kept', () => {
  assert.deepEqual(newPeopleToCreate(['Fictional Cleo'], ['Fictional Dora', 'fictional cleo']), ['Fictional Cleo', 'Fictional Dora']);
  assert.deepEqual(newPeopleToCreate([], []), [], 'a new chip removed before saving creates nobody');
  assert.deepEqual(newPeopleToCreate(['  '], ['']), []);
});

// #779: a saved moment's confirmation says when no facts were pulled out because of the AI.
test('a refused or unreachable AI is told apart from anything else the extraction says', async () => {
  const {aiFailureKind, factsNotPulledOut} = await import('../ui/src/components/timeline/moment-form.mjs');
  const {AI_REFUSED_STATUS, AI_UNREACHABLE_STATUS, NO_AI_ANALYSIS} = await import('../core/no-ai.mjs');
  assert.equal(aiFailureKind(AI_REFUSED_STATUS + '. Check it in Settings, Your AI, then try again.'), 'refused');
  assert.equal(aiFailureKind(AI_UNREACHABLE_STATUS + '. Check its connection in Settings, Your AI, then try again.'), 'unreachable');
  for (const other of [NO_AI_ANALYSIS, 'Source note missing', '', undefined]) assert.equal(aiFailureKind(other), null);
  assert.equal(factsNotPulledOut('refused'), 'No facts were pulled out of it. ' + AI_REFUSED_STATUS + '. Check it in Settings, Your AI.');
  assert.equal(factsNotPulledOut('unreachable'), 'No facts were pulled out of it. ' + AI_UNREACHABLE_STATUS + '. Check its connection in Settings, Your AI.');
  for (const other of ['ready', null, undefined]) assert.equal(factsNotPulledOut(other), null);
});

// #861: a 402 (no credit) and a 429 (busy or limited) are causes of their own, said in the route's
// shared words, never as an outage.
test('a service with no credit or a busy one is named as its own cause in the moment save', async () => {
  const {aiFailureKind, factsNotPulledOut} = await import('../ui/src/components/timeline/moment-form.mjs');
  const {AI_NO_CREDIT, AI_BUSY, AI_NO_CREDIT_STATUS, AI_BUSY_STATUS} = await import('../core/no-ai.mjs');
  assert.equal(aiFailureKind(AI_NO_CREDIT), 'no-credit');
  assert.equal(aiFailureKind(AI_BUSY), 'busy');
  assert.equal(factsNotPulledOut('no-credit'), 'No facts were pulled out of it. ' + AI_NO_CREDIT);
  assert.equal(factsNotPulledOut('busy'), 'No facts were pulled out of it. ' + AI_BUSY);
  assert.ok(AI_NO_CREDIT.startsWith(AI_NO_CREDIT_STATUS));
  assert.ok(AI_BUSY.startsWith(AI_BUSY_STATUS));
});

// #812: a moment saved by hand while no AI is connected says so, with the shared wording.
test('the extraction\'s no-AI answer becomes the shared no-AI sentence, anything else does not', async () => {
  const {factsNotPulledOut, noAiFacts, NO_AI_FACTS} = await import('../ui/src/components/timeline/moment-form.mjs');
  const {AI_REFUSED_STATUS, NO_AI_ANALYSIS, NO_AI_STATUS} = await import('../core/no-ai.mjs');
  assert.equal(factsNotPulledOut('none'), NO_AI_FACTS);
  assert.equal(noAiFacts(NO_AI_ANALYSIS), NO_AI_FACTS);
  assert.equal(NO_AI_FACTS, NO_AI_STATUS + ', so no facts about its people were pulled out. Connect your AI service in Settings, Your AI.');
  assert.ok(NO_AI_FACTS.includes('Settings, Your AI'));
  for (const other of [AI_REFUSED_STATUS + '. Check it in Settings, Your AI, then try again.', 'Source note missing', '', null, undefined]) assert.equal(noAiFacts(other), null);
});
