// A REMINDER AND ITS CLOSING ARE KEPT IN THE NOTEBOOK, AND NOWHERE ELSE (2026-10-30, #90).
//
// Until now tools/due.js kept an obligation as a file due/<slug>.md and its closing or drop as a
// second file in world/events/ (D-258: done is something that happened, never a word in the plan).
// On a mission control that is its own repository the notebook's sync carries only notebook/, so
// neither file travelled unless a session committed it: on 19 October 2026 only the first of the
// two was committed, and for nine mornings the morning brief asked its owner about something he
// had finished.
//
// Ticket 01 gave both a home inside notebook/ (deadline-records.mjs: a `deadlines` page under
// Deadlines/, a closing `moments` record under Timeline/). Ticket 02 filled it from the old files
// and keeps it level with them (due-copy.mjs). This file is the third step: the storage
// tools/due.js reads and writes. It offers exactly the surface tools/due-files.js offers - slugs,
// parseFile, worldEvents, applyEvents, writeEvent, save - so the program itself does not change.
// The bands, the targets, the windows, the sentences, the cap of three a morning, the self checks
// and every word every command prints are the same; only where the answer is kept has moved.
//
// WHAT IS STILL READ OUT OF due/, AND NOTHING IS EVER WRITTEN THERE. A file in due/ that this
// program cannot read gets no record on purpose (due-copy.mjs), because nobody may guess what a
// window it cannot parse was meant to say. It is said in the reminders every day until it is
// fixed, exactly as it is today, so those files are read here, through the one reader
// (tools/due-files.js), and never written and never moved.
//
// EVERY WRITE IS ONE RECORD THROUGH THE STORE, UNDER THE WORKSPACE LOCK. The lock is one writer at
// a time and is never re-entered, so the caller that holds it already (notebook/core/native-due.mjs
// runs these commands inside store.withLock) is used as it is, and a run that holds nothing takes
// it once for the whole command.
import path from 'node:path';
import { createRequire } from 'node:module';
import { HEAD_FIELDS, closingMoment, deadlineUid } from './deadline-records.mjs';
import { liveMoments } from './due-copy.mjs';

const require_ = createRequire(import.meta.url);
const { SLUG, applyEventsOver, problemOf, parseRef, isDate, beganOn, logDays } = require_('../../tools/due-files.js');

// The fields of a deadline record this program owns, in the shape tools/due-files.js (recordsOf)
// gives them, so a page the copy wrote and a page this program wrote are the same page and reading
// one back and saving it again changes nothing.
const FIELDS = Object.entries(HEAD_FIELDS);
const text = value => value === null || value === undefined ? '' : String(value);
const posix = value => String(value).split(path.sep).join('/');
// A record's own log is the Markdown body of its page, so a person can read and edit it. Every
// line of it is kept, the SAID lines the morning brief writes included, and anything the owner
// added by hand below them.
const logLines = value => text(value).split('\n').filter(line => line.trim() !== '');
const windowOut = s => ({ start: s.from, deadline: s.to || '', target: s.target || '', moved: s.moved || '', extra: [...(s.extra || [])] });
const windowIn = w => ({ from: text(w?.start), to: text(w?.deadline), target: text(w?.target), moved: text(w?.moved),
                         extra: Array.isArray(w?.extra) ? [...w.extra] : [], state: 'open', closed: '', legacy: '' });

// ---------------------------------------------------------------- one mission control's records
//
// `store` is the notebook of one mission control; `files` is the old-file reader of the same
// folder (tools/due-files.js), used for the files that do not read and for nothing else.
// `unproven` is what ticket 02's copy saw in world/events/ that says it closes something without
// saying what shows it: it closes nothing, and `mc-due check` goes on naming it.
export function createDueRecords({ store, files, unproven = [] }) {
const UNPROVEN = [...unproven];

// ---- what the notebook holds now
let PAGES = null, MOMENTS = null, EVENTS = null, LOOKS = null;
const CACHE = new Map();
function pages() {
  if (PAGES) return PAGES;
  PAGES = new Map();
  // A deadline Settings saved before 18 October 2026 and moved into due/ keeps its place in
  // _system/ and is not a reminder of its own (records/layout.mjs, isReadable), so one reminder is
  // never two.
  for (const record of store.list('deadlines')) {
    if (!record.native_slug || record.moved_to || !SLUG.test(record.native_slug)) continue;
    PAGES.set(record.native_slug, record);
  }
  return PAGES;
}
// Every closing and drop, as every reader of the notebook sees it: its corrections applied, and
// the ones a correction took back left out (due-copy.mjs, liveMoments). Two copies of one fact
// drift, one copy cannot, so the state of a reminder is worked out from these and from nothing else.
function moments() {
  if (MOMENTS) return MOMENTS;
  MOMENTS = liveMoments(store).filter(record => record.category === 'obligation' && record.obligation_kind);
  return MOMENTS;
}
// The files in due/ that this program cannot read. They have no record and never get one.
function looks() {
  if (LOOKS) return LOOKS;
  LOOKS = new Map();
  for (const seen of files.needsALook()) LOOKS.set(seen.slug, seen);
  return LOOKS;
}

// ---- the closings, in the shape the band rule and "which window closed" already read
//
// `file` is what `mc-due state` prints as what closed a thing and what `done` and `drop` answer
// with. For a closing taken out of an old world/events/ file it stays that file's own name, so
// nothing a reader ever saw about an older closing changes; for one made here it is the moment's
// own page, which is a file the owner can open and read.
const pageOf = record => {
  const file = store.fileOf?.get('moments/' + record.id);
  return file ? posix(path.relative(store.root, file)) : 'notebook/Timeline/' + record.id + '.md';
};
const slugOfMoment = record => text(record.deadline_id).replace(/^due-/, '');
function eventOf(record) {
  const slug = slugOfMoment(record);
  if (!SLUG.test(slug) || !isDate(record.happened_at)) return null;
  const ref = { slug, window: text(record.obligation_window) };
  const event = { file: record.moved_from ? text(record.moved_from) : pageOf(record), date: record.happened_at,
                  closes: [], drops: [], evidence: text(record.evidence), source: text(record.source) };
  event[record.obligation_kind === 'drops' ? 'drops' : 'closes'].push(ref);
  return event;
}
function worldEvents() {
  if (EVENTS) return EVENTS;
  // By the day it happened and then by its file, which is the order the old files were read in
  // (world/events/ sorted by name, and those names begin with the day), so two closings of one
  // window on one day are applied in the same order as before.
  EVENTS = moments().map(eventOf).filter(Boolean)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  return EVENTS;
}
// A file that does not read has no record, so a drop of it that an older version wrote the old way
// is in world/events/ and nowhere else. Those are read for these files only, which is the one
// thing left that due/ and world/events/ are read for: a reminder nobody can read must not come
// back as open after it was called off.
const eventsFor = (o) => looks().has(o.slug) ? [...worldEvents(), ...files.worldEvents()] : worldEvents();
function applyEvents(o) { return applyEventsOver(o, eventsFor(o)); }

// ---- one reminder, as the program works on it
function fromPage(record) {
  const head = {};
  for (const [line, field] of FIELDS) if (record[field] !== undefined && record[field] !== null) head[line] = text(record[field]);
  head['TITLE'] = text(record.title) || record.native_slug;
  for (const [line, value] of Object.entries(record.head_lines || {})) head[line] = text(value);
  const strips = (Array.isArray(record.windows) ? record.windows : []).map(windowIn);
  const log = logLines(record.log), said = [];
  for (const line of log) {
    const m = line.match(/^-\s*(\d{4}-\d{2}-\d{2})\s+SAID\s+(\S+)\s*$/);
    if (m) said.push({ date: m[1], channel: m[2] });
  }
  const o = { slug: record.native_slug, path: 'due/' + record.native_slug + '.md', text: '', head, strips, log, said,
              page: record.id, problem: problemOf(record.native_slug, 'a page', strips) };
  applyEvents(o);
  return o;
}
function parseFile(slug) {
  if (CACHE.has(slug)) return CACHE.get(slug);
  const page = pages().get(slug);
  if (page) { const o = fromPage(page); CACHE.set(slug, o); return o; }
  // A file nobody can read, read by the one reader of the old files. One whose very name cannot be
  // used reads as nothing at all, exactly as before, and the caller says so by its file name.
  const seen = looks().get(slug);
  if (!seen) return null;
  const o = files.parseFile(slug);
  if (!o) return null;
  applyEvents(o);
  CACHE.set(slug, o);
  return o;
}
const unreadable = (slug) => { const o = files.unreadable(slug); applyEvents(o); return o; };
// Every reminder this mission control holds: its pages, and the files that need a look, which are
// counted and said exactly as they are today.
function slugs() {
  const out = new Set(pages().keys());
  for (const slug of looks().keys()) out.add(slug);
  return [...out].sort();
}
const exists = (slug) => pages().has(slug) || looks().has(slug);
const filePath = (slug) => 'due/' + slug + '.md';

// ---- writing: one record through the store, inside the lock the caller holds
const written = new Set();
function commit(records, { prune = false } = {}) {
  const forget = prune ? records.filter(r => r.old).map(r => 'record_history/' + r.old.uid + '-' + r.old.revision + '-' + r.old._hash.slice(0, 12)) : [];
  store.commit(records.map(r => r.record));
  // The morning brief writes a SAID line into a reminder every day it mentions it, and every save
  // would otherwise leave a whole copy of the record behind as history (records/store.mjs commit).
  // A write that is nothing but those lines takes its own copy away again, the way ticket 02's
  // copy does: the whole log is in the record itself, so nothing is lost, and a year of daily
  // mentions of fifty reminders stays far inside a megabyte.
  const gone = forget.filter(key => store.get('record_history', key.slice('record_history/'.length)));
  if (gone.length) store.commit([], { removeKeys: gone });
  for (const r of records) written.add(r.record.type + '/' + r.record.id);
  PAGES = null; MOMENTS = null; EVENTS = null;
}
// A reminder as a record, in the very shape tools/due-files.js (recordsOf) gives it, with the
// identity derived from the name so that two machines that make the same reminder make one record.
function recordFrom(o, old) {
  const head = {}, lines = {};
  for (const [line, field] of FIELDS) head[field] = o.head[line] === undefined ? '' : text(o.head[line]);
  for (const line of Object.keys(o.head)) if (!HEAD_FIELDS[line]) lines[line] = text(o.head[line]);
  return {
    id: old?.id || 'due-' + o.slug, uid: deadlineUid(o.slug),
    ...head,
    title: text(o.head['TITLE']) || o.slug,
    native_slug: o.slug, native_file: 'due/' + o.slug + '.md',
    windows: o.strips.map(windowOut),
    log: o.log.length ? o.log.join('\n') + '\n' : '',
    head_lines: lines,
    // EVERY FIELD OF IT COMES OUT OF THE REMINDER, never from this computer's clock, exactly as
    // ticket 02's copy of an old file does (tools/due-files.js, recordsOf). A reminder made out of
    // secrets/expires.txt is made by every machine of one mission control by itself, from the same
    // list, and the notebook merges two versions of one record field by field: a created_at or an
    // updated_at stamped by two clocks would be a conflict for its owner to settle about nothing
    // (found by notebook/test/due-copy.test.mjs, 30 October 2026). So the first day of the first
    // window is when it began, and the last day its log speaks of is when it last changed - never
    // a window's own day, because the last day of a tax return is next year and nothing may be
    // written as changed in the future.
    created_at: (beganOn(o) || '1970-01-01') + 'T00:00:00Z',
    updated_at: (logDays(o).pop() || beganOn(o) || '1970-01-01') + 'T00:00:00Z',
  };
}
function save(o) {
  // A file that does not read is never written to, by this program or anything else.
  if (!SLUG.test(o.slug || '') || looks().has(o.slug)) return false;
  const old = pages().get(o.slug) || null;
  const value = recordFrom(o, old);
  // EVERY CHANGE THIS PROGRAM MAKES IS IN THE REMINDER'S OWN LOG, so it keeps no history copy of
  // the version it replaces (the same prune ticket 02's copy does, and the scheduler for its
  // receipts). It writes a log line for each one - created, the brief said it, the next window
  // opened, you moved the day you aim for, it closed - and a new window and a moved day are
  // written beside what they replace and never over it, so nothing is lost. Kept, they would grow
  // without end: the morning brief mentions a reminder every day it is loud, and a whole copy of a
  // record whose log grows daily is tens of megabytes a year for fifty reminders (measured in
  // notebook/test/due-copy.test.mjs). A change the OWNER makes to a page in their own editor is
  // not written through here and keeps its history like every other page.
  const prune = !!old;
  // The store's own stamp (records/store.mjs prepare), except for the three lines it would take
  // from this computer: the write is this computer's act and says so, where ticket 02's copy of an
  // old file deliberately says `due-copy`, and the two days are the reminder's own (see above).
  const record = { ...store.prepare('deadlines', value, old), device: store.device,
                   created_at: old?.created_at || value.created_at, updated_at: value.updated_at };
  commit([{ record, old }], { prune });
  CACHE.set(o.slug, o);
  return true;
}
// THE ONE WRITER OF A CLOSING OR A DROP, and it only ever appends: what happened is never
// rewritten (moments are append-only in the store). A closing made here carries no `from`, so the
// store gives it a uid of its own, which is why one reminder closed on two machines while they
// were apart keeps two moments after they sync, with nothing for its owner to settle.
function writeEvent(day, { closes = [], drops = [], evidence, source, text: body }) {
  if (!String(evidence || '').trim()) return null;
  const kind = closes.length ? 'closes' : 'drops';
  const ref = parseRef(closes[0] || drops[0] || '');
  if (!ref) return null;
  const page = pages().get(ref.slug) || null;
  const known = page || parseFile(ref.slug);
  // A reminder with no page (a file nobody can read, called off) still has its derived identity, so
  // the drop is a moment like any other and points at the page the name will have once it is fixed.
  const deadline = page || { id: 'due-' + ref.slug, uid: deadlineUid(ref.slug), native_slug: ref.slug,
                             title: (known && known.head && known.head['TITLE']) || ref.slug };
  const value = closingMoment({ deadline, kind, day, window: ref.window, evidence, source: source || 'mc-due' });
  value.description = String(body || '').trim();
  // The store refuses a reference to a record that is not there, and a reminder nobody can read
  // has no page: the moment names it by deadline_id, which is where every reader finds it anyway.
  if (!page) value.references = [];
  const record = { ...store.prepare('moments', value, null), device: store.device };
  commit([{ record, old: null }]);
  const made = worldEvents().find(e => e.file === pageOf(record));
  for (const o of CACHE.values()) applyEvents(o);
  return made ? made.file : pageOf(record);
}

return { DUE: path.join(store.root, 'due'), filePath, exists, slugs, parseFile, unreadable, worldEvents,
         applyEvents, writeEvent, save, cache: CACHE, unproven: UNPROVEN, written,
         reread: () => { PAGES = null; MOMENTS = null; EVENTS = null; LOOKS = null; CACHE.clear(); } };
}
