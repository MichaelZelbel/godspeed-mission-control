// How "Suggest title and other values" fills the Add/Edit Moment form, kept
// apart from the dialog so it can be tested with node --test
// (notebook/test/moment-form.test.mjs).

import { AI_BUSY, AI_BUSY_STATUS, AI_NO_CREDIT, AI_NO_CREDIT_STATUS, AI_REFUSED_STATUS, AI_STALLED, AI_STALLED_STATUS, AI_UNREACHABLE_STATUS, NO_AI_STATUS } from '../../../../core/no-ai.mjs';

const DAY = /^(\d{4}-\d{2}-\d{2})/;

export const MOMENT_STATUSES = ['past_fact', 'future_plan', 'ongoing', 'unknown'];

// The day a date names, as yyyy-MM-dd, or "" when there is none.
function formDay(value) {
  const match = DAY.exec(String(value ?? '').trim());
  return match ? match[1] : '';
}

/**
 * Which fields count as filled when the dialog opens. The dialog sets a
 * field's flag when the person changes it; a value a suggestion put there is
 * not theirs, so a later suggestion may replace it. A new moment's starting
 * values (today, Unknown, the middle of each slider) are placeholders, not
 * choices. An existing moment's saved values are filled, except an empty
 * title or date, the status Unknown, and a score the writer left out (a gap
 * a suggestion may fill, like the empty title and date).
 */
export function filledOnOpen(editEvent) {
  if (!editEvent) return { title: false, dateStart: false, dateEnd: false, status: false, impactLevel: false, confDate: false, confTruth: false };
  return {
    title: !!String(editEvent.title || '').trim(),
    dateStart: !!formDay(editEvent.happened_at),
    dateEnd: !!formDay(editEvent.happened_end),
    status: !!editEvent.status && editEvent.status !== 'unknown',
    impactLevel: editEvent.impact_level != null,
    confDate: editEvent.confidence_date != null,
    confTruth: editEvent.confidence_truth != null,
  };
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const wholeNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
};

/**
 * Applies a suggestion to the form: it fills only the fields the person has
 * not filled in yet and never replaces what they typed or picked. Until
 * 10 October 2026 it replaced everything, so a start date the person had
 * chosen became "yesterday" from the description. People are added to,
 * never removed.
 *
 * form:   { title, dateStart, dateEnd, status, impactLevel, confDate, confTruth, matchedPeople }
 * filled: the flags from filledOnOpen, set to true for every field the person changed
 * draft:  the suggestion { title, happened_at, happened_end, status, impact_level, confidence_date, confidence_truth, participants }
 * people: the known contacts [{ id, name }]
 *
 * Returns { form, changed, newPeople }: the merged form, the names of the
 * fields the suggestion filled, and suggested names not yet in People.
 */
export function mergeSuggestion(form, filled, draft, people = []) {
  const next = { ...form, matchedPeople: [...(form.matchedPeople || [])] };
  const changed = [];
  const d = draft || {};

  const title = typeof d.title === 'string' ? d.title.trim() : '';
  if ((!String(form.title || '').trim() || !filled.title) && title && title !== form.title) { next.title = title; changed.push('title'); }

  const start = formDay(d.happened_at);
  if ((!form.dateStart || !filled.dateStart) && start && start !== form.dateStart) { next.dateStart = start; changed.push('dateStart'); }

  // An end date is only filled when it does not end before the start the
  // form keeps, which may be the person's own and not the suggestion's.
  const end = formDay(d.happened_end);
  if ((!form.dateEnd || !filled.dateEnd) && end && end !== form.dateEnd && (!next.dateStart || end >= next.dateStart)) { next.dateEnd = end; changed.push('dateEnd'); }

  if (!filled.status && MOMENT_STATUSES.includes(d.status) && d.status !== form.status) { next.status = d.status; changed.push('status'); }

  const impact = wholeNumber(d.impact_level);
  if (!filled.impactLevel && impact !== null && clamp(impact, 1, 4) !== form.impactLevel) { next.impactLevel = clamp(impact, 1, 4); changed.push('impactLevel'); }
  const confDate = wholeNumber(d.confidence_date);
  if (!filled.confDate && confDate !== null && clamp(confDate, 0, 10) !== form.confDate) { next.confDate = clamp(confDate, 0, 10); changed.push('confDate'); }
  const confTruth = wholeNumber(d.confidence_truth);
  if (!filled.confTruth && confTruth !== null && clamp(confTruth, 0, 10) !== form.confTruth) { next.confTruth = clamp(confTruth, 0, 10); changed.push('confTruth'); }

  const newPeople = [];
  for (const raw of Array.isArray(d.participants) ? d.participants : []) {
    const name = typeof raw === 'string' ? raw.trim() : '';
    if (!name) continue;
    const found = people.find((p) => String(p.name || '').toLowerCase() === name.toLowerCase());
    if (found) {
      if (!next.matchedPeople.includes(found.id)) { next.matchedPeople.push(found.id); if (!changed.includes('people')) changed.push('people'); }
    } else if (!newPeople.some((n) => n.toLowerCase() === name.toLowerCase())) newPeople.push(name);
  }

  return { form: next, changed, newPeople };
}

const sameName = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

/**
 * The name the People picker offers to add as a new person for what was
 * typed into its search, or null when it should offer nothing: the search is
 * empty, or the name is already someone in People or already waiting to be
 * added (both compared without case, so "anna" picks the existing "Anna").
 *
 * query:    the text in the search box
 * people:   the known contacts [{ id, name }]
 * newNames: the names already chosen as new people
 */
export function newPersonOffer(query, people = [], newNames = []) {
  const name = String(query ?? '').trim().replace(/\s+/g, ' ');
  if (!name) return null;
  if (people.some((p) => sameName(p.name, name))) return null;
  if (newNames.some((n) => sameName(n, name))) return null;
  return name;
}

/**
 * The new people a save creates: the ones ticked from a suggestion and the
 * ones typed into the picker, each name once (without case), in that order.
 * Saving still looks each one up in People first, so a name that exists
 * there under another case links that person instead of making a second one.
 */
export function newPeopleToCreate(suggested = [], typed = []) {
  const out = [];
  for (const raw of [...suggested, ...typed]) {
    const name = String(raw ?? '').trim();
    if (name && !out.some((n) => sameName(n, name))) out.push(name);
  }
  return out;
}

// What the server says when the AI fails, by its status line (core/no-ai.mjs, decided in
// core/ai-outcome.mjs): 'refused', 'unreachable', 'stalled', 'no-credit', 'busy', or null.
export function aiFailureKind(message) {
  const text = String(message ?? '');
  if (text.startsWith(AI_REFUSED_STATUS)) return 'refused';
  if (text.startsWith(AI_UNREACHABLE_STATUS)) return 'unreachable';
  if (text.startsWith(AI_STALLED_STATUS)) return 'stalled';
  if (text.startsWith(AI_NO_CREDIT_STATUS)) return 'no-credit';
  if (text.startsWith(AI_BUSY_STATUS)) return 'busy';
  return null;
}

// What a saved moment's confirmation adds when no facts were pulled out of it
// because of the AI (#779), or null when there is nothing to add.
export function factsNotPulledOut(kind) {
  if (kind === 'refused') return 'No facts were pulled out of it. ' + AI_REFUSED_STATUS + '. Check it in Settings, Your AI.';
  if (kind === 'unreachable') return 'No facts were pulled out of it. ' + AI_UNREACHABLE_STATUS + '. Check its connection in Settings, Your AI.';
  // The stalled sentence is the shared one (AI_STALLED, core/no-ai.mjs), so a reword there keeps
  // this notice and the Groups button's reason saying the same words (#861 review R8).
  if (kind === 'stalled') return 'No facts were pulled out of it. ' + AI_STALLED;
  if (kind === 'no-credit') return 'No facts were pulled out of it. ' + AI_NO_CREDIT;
  if (kind === 'busy') return 'No facts were pulled out of it. ' + AI_BUSY;
  return null;
}

// What a saved moment's confirmation says when the extraction answers that no AI is connected
// (#812): built from the shared no-AI wording (core/no-ai.mjs), it names Settings, Your AI the
// way the refused and unreachable answers above do. The extraction is asked when the moment is
// saved, so a tab whose cached picture still says an AI is connected gets the same answer.
export const NO_AI_FACTS = 'No facts were pulled out of it. ' + NO_AI_STATUS + '. Connect your AI service in Settings, Your AI.';
export function noAiFacts(message) {
  return String(message ?? '').startsWith(NO_AI_STATUS) ? NO_AI_FACTS : null;
}
