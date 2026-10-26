import fs from 'node:fs';
import path from 'node:path';
import {fieldList} from './fields.mjs';
import {plainWords} from './review-sources.mjs';
import {sameIndex} from './same-thing.mjs';

// WHAT REACHES THE REVIEW PAGE (23 October 2026).
//
// Processing a note asks the notebook's model for facts, timeline entries and people, and until
// 23 October 2026 everything it answered went to the Review page once its quote was found in the
// note. Nothing compared a suggestion with what the notebook already had: a phone number and a work
// email that were saved facts long ago were proposed again. The only duplicate check was a hash of the
// model's exact answer, so a note processed again after an edit proposed the same things in other
// words, and one trip note and one letter left eight copies in an hour. Checks like these existed in
// the earlier hosted notebook and did not come along when the notebook became files.
//
// Now every suggestion a model makes passes screenSuggestions before it is queued, with no model:
//
// - what the notebook already has, or was already offered in any status, is left out, by the one rule
//   for "the same thing" that keeping a fact uses too (same-thing.mjs);
// - when a note is processed again after an edit, a suggestion quoted from words the last processing
//   had already read is left out, so only new words can bring something new.
//
// What it leaves out is written to <state>/suggestion-filter.jsonl, never to the queue, so it can be
// looked at and counted. test/suggestion-cases.test.mjs runs the shipped cases through it.

// The notebook's records a suggestion is compared with, as lists (scripts/suggestion-quality.mjs
// passes them as they were on an earlier day). Every record, also those hidden from the assistant:
// this comparison sends nothing anywhere.
export function knownRecords(query) {
  return {claims: query.rows('claims'), queue: query.rows('review_queue'), moments: query.rows('moments'), participants: query.rows('moment_participants'), contacts: query.rows('contacts'),
    selfNames: [query.rows('profiles')[0]?.display_name, ...query.rows('user_self_aliases').filter(a => a.is_active !== false).map(a => a.alias)].filter(n => n && n !== 'Owner'),
    relationships: query.rows('contact_relationships'), documents: query.rows('person_documents')};
}

const describe = (thing) => thing.kind === 'fact' ? thing.label + ' = ' + thing.value : thing.kind === 'moment' ? thing.date + ' ' + thing.title : thing.kind === 'person' ? thing.names[0] : '';
// Suggestions are taken in order, so the second copy in one answer is left out too.
export function screenSuggestions(suggestions, records, {fields = fieldList(), note = null, previousText = null} = {}) {
  const index = sameIndex(records, {fields, note}), kept = [], dropped = [];
  for (const item of suggestions) {
    const same = index.match(item), quote = item.evidence_quote ?? item.description;
    if (same) {
      const earlier = same.reason === 'already_suggested', thisRun = earlier && same.thing.record?.origin === 'this run';
      dropped.push({suggestion: item, step: 'screen', reason: same.reason, detail: (thisRun ? 'twice in one answer: ' : earlier ? 'suggested before: ' : 'already in the notebook: ') + describe(same.thing), same: same.thing.record || null});
    } else if (previousText && typeof quote === 'string' && plainWords(quote) && plainWords(previousText).includes(plainWords(quote))) {
      dropped.push({suggestion: item, step: 'screen', reason: 'old_words', detail: 'quoted from words the last processing already read'});
    } else { kept.push(item); index.remember(item); }
  }
  return {kept, dropped, index};
}

// The text of a note as its last processing read it, or null when it was never processed. Processing
// saves the note with processed_at, and later versions keep that time, so the first version that
// carries the newest processed_at is the one that was read; earlier versions are in the note's history.
// The note's own record is asked, not the job record: on 23 October 2026 a letter was processed three
// times with the same text because the job's "done" was never saved (processing.mjs).
export function previousProcessedText(query, note) {
  const at = note.processed_at;
  if (!at) return null;
  const versions = [...query.rows('record_history').filter(h => h.source_type === 'notes' && (h.source_uid === note.uid || h.source_id === note.id) && h.snapshot).map(h => h.snapshot), note]
    .filter(v => v.processed_at === at).sort((a, b) => (Number(a.revision) || 0) - (Number(b.revision) || 0) || String(a.updated_at).localeCompare(String(b.updated_at)));
  return versions.length ? String(versions[0].title || '') + '\n' + String(versions[0].content || '') : null;
}

// What was left out, one line each, in <state>/suggestion-filter.jsonl. The file keeps about its
// newest megabyte.
export function logFiltered(state, dropped, {note = null, source = 'process-note', at = new Date().toISOString()} = {}) {
  if (!state || !dropped.length) return;
  const file = path.join(state, 'suggestion-filter.jsonl');
  const lines = dropped.map(d => JSON.stringify({at, source, note_id: note?.id || d.suggestion.source_note_id || null, step: d.step, reason: d.reason, detail: d.detail,
    type: d.suggestion.type || d.suggestion.suggestion_type, title: d.suggestion.title || null}));
  try {
    fs.mkdirSync(state, {recursive: true});
    fs.appendFileSync(file, lines.join('\n') + '\n');
    if (fs.statSync(file).size > 2 * 1024 * 1024) { const text = fs.readFileSync(file, 'utf8'); fs.writeFileSync(file, text.slice(text.indexOf('\n', text.length - 1024 * 1024) + 1)); }
  } catch {}
}
