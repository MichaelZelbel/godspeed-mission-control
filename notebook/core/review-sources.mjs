// A suggestion in the review queue waits only while the note it came from still holds it.
//
// Processing proposes facts, timeline entries and people from a note, each with the sentence it
// came from (`description`, the evidence quote). Until 23 October 2026 such a suggestion kept
// waiting after its note went to the trash or was deleted, or after that sentence was taken out of
// the note, so an add-on that takes a letter back out of the notebook could not take back what
// processing had proposed from it. Now every save of a note through the notebook (records/store.mjs
// commit) also changes that note's suggestions:
//
// - The note goes to the trash or is deleted: every suggestion still waiting is withdrawn.
// - The note's title and text no longer hold the quote they held before: that suggestion is
//   withdrawn. One whose quote was never in the note (the assistant quoted a chat) is left alone.
// - The note comes back, or the quote comes back: the suggestion waits again, unless the note has
//   meanwhile proposed the same thing anew, from other words.
//
// Withdrawn is a status of its own ("withdrawn", with withdrawn_reason), so the review page, the
// counts and Keep pass it by, and it never blocks the same suggestion being proposed again from a
// note's new words. A suggestion the person kept, removed or blocked is never changed here.
export const WITHDRAWN = 'withdrawn';
const WAITING = new Set(['pending', 'pending_review']);

const gone = note => !note || !!note.is_trashed || !!note.removed_at;
const textOf = note => String(note?.title ?? '') + '\n' + String(note?.content ?? '');
// Words compared as words: an editor that saves the same text again may wrap a line, escape a dot
// or a bracket, or mark a word with stars or underscores, and that takes no sentence out of a note.
const plain = text => String(text).normalize('NFC').replace(/\\([\\`*_{}[\]()#+\-.!|<>~])/g, '$1').replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const holds = (note, quote) => typeof quote === 'string' && plain(quote) !== '' && plain(textOf(note)).includes(plain(quote));

// Whether a change from `before` to `after` can touch the note's suggestions at all.
export const touchesSuggestions = (before, after) => !!before && (gone(before) !== gone(after) || textOf(before) !== textOf(after));

// The changes to `items` (the review rows whose source_note_id is the note) that the note's change
// from `before` to `after` makes, as [{item, patch}].
export function suggestionChanges(before, after, items, now = new Date().toISOString()) {
  const changes = [], back = new Set();
  for (const item of items) {
    if (item.removed_at || item.applied_at) continue;
    const quote = item.description, status = item.status || 'pending_review';
    if (WAITING.has(status)) {
      if (gone(after)) changes.push({item, patch: {status: WITHDRAWN, withdrawn_at: now, withdrawn_reason: after?.removed_at ? 'source_removed' : 'source_trashed', withdrawn_quoted: holds(before, quote)}});
      else if (holds(before, quote) && !holds(after, quote)) changes.push({item, patch: {status: WITHDRAWN, withdrawn_at: now, withdrawn_reason: 'source_text_gone', withdrawn_quoted: true}});
    } else if (status === WITHDRAWN && !gone(after) && (!item.withdrawn_quoted || holds(after, quote))) {
      // Not when the note proposed the same thing again meanwhile (its fingerprint names the note).
      const again = item.fingerprint && (back.has(item.fingerprint) || items.some(other => other !== item && other.fingerprint === item.fingerprint && other.status !== WITHDRAWN && !other.removed_at));
      if (again) continue;
      if (item.fingerprint) back.add(item.fingerprint);
      changes.push({item, patch: {status: 'pending_review', withdrawn_at: null, withdrawn_reason: null, withdrawn_quoted: null}});
    }
  }
  return changes;
}
