// A REMINDER IS A NOTEBOOK PAGE, AND ITS CLOSING IS A MOMENT (2026-10-29, #90).
//
// Today a reminder with a day attached is a file due/<slug>.md written by tools/due.js, and its
// closing or its drop is a second file in world/events/ carrying closes:/drops: (D-258: done is
// something that happened, never a word in the plan). On a mission control that is its own
// repository the notebook's sync carries only notebook/, so both files travel only when a session
// commits them: on 19 October 2026 only the first one was committed, and for nine mornings the
// brief asked its owner about something he had finished.
//
// So both get a home inside notebook/. A reminder is a `deadlines` page under Deadlines/ (its
// shape is in records/layout.mjs and below), and a closing or a drop is a `moments` record on the
// timeline. This file holds what says which record is which, so that two machines that make the
// same reminder, or the same closing out of the same old file, make one record and not two. The
// readers still read due/; tickets 02 to 05 move them.

import { hash } from './records/store.mjs';

// ---------------------------------------------------------------- the fields of a reminder
//
// One record field per line a due/ file holds (tools/due.js: ORDER, the add-on lines of cmdAdd,
// the calendar marker of cmdMarker), so that converting one loses nothing. A head line this map
// does not name is a line the owner wrote by hand, and tools/due.js keeps those rather than
// eating them; it is kept here too, in `head_lines`.
export const HEAD_FIELDS = Object.freeze({
  'TITLE': 'title',                       // what it is
  'DONE-WHEN': 'done_when',               // what is true when it is finished
  'COST-IF-MISSED': 'cost_if_missed',     // what slipping past the last day costs
  'SELF-CHECK': 'self_check',             // none, or file-newer
  'SELF-CHECK-ARG': 'self_check_arg',     // what the self check looks at
  'REPEATS': 'repeats',                   // the word as written: no, weekly, every 10 days, ...
  'LINK': 'link',
  'SOURCE': 'source',
  'ADDON': 'addon',                       // the add-on that made it, if one did
  'ADDON-KEY': 'addon_key',               // the add-on's own name for it
  'ADDON-STATE': 'addon_state',           // the add-on's fingerprint of what it last wrote
  'CALENDAR-MARKER': 'calendar_marker',   // which calendar entry is this reminder's one entry
});
// Where the rest of the file goes: every STRIP line into `windows`, one
// {start, deadline, target, moved, extra} each (`deadline` empty for a window with a target and
// no last day, `extra` the words on the line that tools/due.js did not recognise and did not
// eat), the file's own name into `native_slug`, and ## Log, the SAID lines the brief writes
// included, into `log`, which records/layout.mjs writes as the Markdown body.
//
// There is no state field on purpose. Whether a window is open is worked out from the moments
// below, the way tools/due.js works it out from world/events/ today: two copies of one fact
// drift, one copy cannot.
export const WINDOW_FIELDS = Object.freeze(['start', 'deadline', 'target', 'moved', 'extra']);

// ---------------------------------------------------------------- identity you can derive

const text = value => value === null || value === undefined ? '' : String(value);
// A record's uid is 32 characters, as the uid dueRows already gives a reminder.
const derived = parts => hash(parts.map(text).join('\n')).slice(0, 32);

// The uid of the reminder that is due/<slug>.md. The same derivation
// notebook/core/native-due.mjs (dueRows) has made since the notebook first listed these, so a
// reminder converted into a page and the row read from its file are one record and never two.
// It depends on nothing but the name, so two machines converting the same mission control derive
// the same uid and the sync merges their pages into one.
export function deadlineUid(slug) {
  const name = text(slug).trim();
  if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(name)) throw new Error('A reminder is named in small letters, digits and dashes');
  return hash('due/' + name).slice(0, 32);
}

export const CLOSING_KINDS = Object.freeze(['closes', 'drops']);

// The uid of the moment that closes or drops a reminder, derived from what it closes: the
// reminder's name, the window it closes (the window's first day, empty when the reminder has one
// window), which kind it is, and `from`, the world/events/ file the closing was read out of.
//
// `from` is what makes this safe to derive. Two machines taking in the same old event file must
// make ONE moment, so the file's name is part of the identity. A closing made here and now came
// out of no file: it is its own act, it passes no `from`, and closingMoment leaves the uid to the
// store. That is why one reminder closed on two machines while they were apart keeps two moments
// after they sync, with nothing for the owner to settle, instead of one machine's record quietly
// standing for the other's.
export function closingUid({ slug, window = '', kind, from = '' }) {
  if (!CLOSING_KINDS.includes(kind)) throw new Error('A closing moment either closes or drops');
  deadlineUid(slug);
  return derived(['closing', 'due/' + text(slug).trim(), window, kind, from]);
}

// ---------------------------------------------------------------- a closing is a moment
//
// What `store.save('moments', ...)` is given for a closing or a drop. The moment carries a typed
// reference to the reminder by uid, so the reference survives a rename of either; which kind it
// is; the window's first day, for one window of a repeating reminder; what shows it (no evidence,
// no closing, as in tools/due.js); and where it came from. Moments are append-only in the store
// already, and this writes nothing that would need changing afterwards.
export function closingMoment({ deadline, kind, day, window = '', evidence, source = '', from = '' }) {
  if (!CLOSING_KINDS.includes(kind)) throw new Error('A closing moment either closes or drops');
  if (!deadline || !deadline.uid || !deadline.id) throw new Error('A closing moment needs the reminder it closes');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text(day))) throw new Error('A closing happened on a day, written year first');
  if (!text(evidence).trim()) throw new Error('Say what shows it: a closing without evidence closes nothing');
  const slug = text(deadline.native_slug).trim();
  if (from && !slug) throw new Error('A closing taken out of an old event file needs the reminder it names');
  const title = (kind === 'closes' ? 'Done: ' : 'Dropped: ') + text(deadline.title).trim();
  return {
    // Derived only when this closing was read out of an old world/events/ file; otherwise the
    // store gives it one of its own (see closingUid).
    ...(from ? { uid: closingUid({ slug, window, kind, from }) } : {}),
    title,
    happened_at: day,
    category: 'obligation',
    obligation_kind: kind,
    obligation_window: window || null,
    evidence: text(evidence).replace(/\s+/g, ' ').trim(),
    source: text(source).trim() || 'the notebook',
    ...(from ? { moved_from: from } : {}),
    deadline_id: deadline.id,
    references: [{ type: 'deadlines', id: deadline.id, uid: deadline.uid, field: 'deadline_id' }],
  };
}
