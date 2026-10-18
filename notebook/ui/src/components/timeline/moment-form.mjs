// How "Suggest title and other values" fills the Add/Edit Moment form, kept
// apart from the dialog so it can be tested with node --test
// (notebook/test/moment-form.test.mjs).

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
 * title or date and the status Unknown.
 */
export function filledOnOpen(editEvent) {
  if (!editEvent) return { title: false, dateStart: false, dateEnd: false, status: false, impactLevel: false, confDate: false, confTruth: false };
  return {
    title: !!String(editEvent.title || '').trim(),
    dateStart: !!formDay(editEvent.happened_at),
    dateEnd: !!formDay(editEvent.happened_end),
    status: !!editEvent.status && editEvent.status !== 'unknown',
    impactLevel: true,
    confDate: true,
    confTruth: true,
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
