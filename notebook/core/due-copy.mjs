// EVERY OLD REMINDER AND CLOSING IS COPIED INTO THE NOTEBOOK, AND KEPT LEVEL (2026-10-30, #90).
//
// A reminder with a day attached is still a file due/<slug>.md written by tools/due.js, and its
// closing or drop still a second file in world/events/. On a mission control that is its own
// repository the notebook's sync carries only notebook/, so neither file travels unless a session
// commits it: on 19 October 2026 only the first of the two was committed and the morning brief
// asked its owner for nine mornings about something he had finished.
//
// Ticket 01 gave both a home inside notebook/ (deadline-records.mjs). This file fills it, and only
// ADDS: nothing in due/ or world/ is changed, moved or removed, and no reader reads the records
// yet. The reason it comes before the switch is that Michael's server takes every merge into main
// by itself, and the machines of one mission control update at different times: when tools/due.js
// starts reading records (ticket 03), every machine must already hold them.
//
// WHAT KEEPS IT HONEST
//
// - One reader of the old files: tools/due-files.js, the very one tools/due.js uses, so the records
//   can never disagree with the program about what a file says.
// - Every field of a record comes out of the file, never from this computer's clock or name. Two
//   machines copy the same folder before either syncs, and the notebook merges two versions of one
//   record field by field (sync/identity.mjs): a field that differs on both sides with no older
//   version between them would be a conflict for its owner to settle. With the file deciding every
//   field, only updated_at, revision and device differ, and the merge settles those itself.
// - Per old file, the hash of what was copied, as a `due_copies` record in the notebook's own
//   bookkeeping, so it syncs and a second machine does not copy the same file twice.
// - The notebook's version of a reminder is never overwritten unseen: when the file AND the page
//   changed since the copy, the page stays and both versions are kept as one review item.
// - What the copy adds is bounded. The morning brief writes a SAID line into a reminder's file
//   every day it mentions it, so these files change daily and are copied daily, and every save
//   would otherwise leave a full copy of the record behind as history (records/store.mjs commit).
//   The copy removes its own history copies again (the same prune the scheduler does for its
//   receipts): the whole log is in the record itself, so nothing is lost, and a year of daily
//   mentions of fifty reminders stays well inside a megabyte (notebook/test/due-copy-timing.mjs).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Store, hash, readableSlug } from './records/store.mjs';
import { deadlineUid, closingUid } from './deadline-records.mjs';

const require_ = createRequire(import.meta.url);
const { createDueFiles } = require_('../../tools/due-files.js');

// The notebook's bookkeeping of the copy: one record per old file, holding the hash that was
// copied and what it became. It is bookkeeping, not a page, so it lives in _system/ and syncs
// with everything else there.
export const COPY_TYPE = 'due_copies';
// The review item for the one case nobody may decide for the owner.
export const BOTH_CHANGED = 'deadline_both_changed';

// The fields of a deadline record the copy owns, in one order, so "has the page changed since it
// was copied?" is asked of what the copy wrote and not of updated_at, revision or device.
const COPIED = ['title', 'done_when', 'cost_if_missed', 'self_check', 'self_check_arg', 'repeats', 'link',
  'source', 'addon', 'addon_key', 'addon_state', 'calendar_marker', 'head_lines', 'native_slug',
  'native_file', 'windows', 'log'];
// Keys sorted, so the same value compares equal however it was read back.
const canonical = value => JSON.stringify(value, (key, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(name => [name, v[name]])) : v);
const digestOf = record => hash(canonical(COPIED.map(field => record?.[field] ?? null)));
// What a bookkeeping record says, without the housekeeping the store adds.
const BOOK = ['file', 'kind', 'file_hash', 'record_type', 'record_uid', 'record_id', 'record_digest', 'names', 'review_item'];
const bookDigest = record => hash(canonical(BOOK.map(field => record?.[field] ?? null)));
// A bookkeeping record's identity, derived from the path of the old file it is about, so the same
// old file makes one record on every machine.
const copyUid = file => hash('due-copy/' + file).slice(0, 32);
// A name tools/due.js can use for a file in due/, and so for a reminder (tools/due-files.js).
const SLUG = /^[a-z0-9][a-z0-9-]{0,59}$/;
const idFor = (prefix, text) => prefix + '-' + hash(text).slice(0, 24);
const read = file => { try { return fs.readFileSync(file, 'utf8'); } catch (error) { if (error.code === 'ENOENT' || error.code === 'EISDIR') return null; throw error; } };
const dayOf = store => {
  const timezone = store.get('settings', 'installation')?.timezone || 'UTC';
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
};

// ---------------------------------------------------------------- the cheap look first
// Names, sizes and times of the old files. A run where nothing changed is the usual run (the 08:00
// reminders, Settings, every command), and it must cost nothing: with this unchanged there is no
// workspace to open, no lock to take and no record to read. It lives in .godspeed/, which is this
// computer's own state and never syncs, and losing it only costs one full pass.
function marks(root) {
  const out = [];
  for (const folder of ['due', path.join('world', 'events')]) {
    let names = [];
    try { names = fs.readdirSync(path.join(root, folder), { withFileTypes: true }).filter(e => e.isFile()).map(e => e.name).sort(); } catch { continue; }
    for (const name of names) {
      if (!name.endsWith('.md')) continue;
      let stat; try { stat = fs.statSync(path.join(root, folder, name)); } catch { continue; }
      out.push(folder.replace(/\\/g, '/') + '/' + name + '\t' + stat.size + '\t' + Math.round(stat.mtimeMs));
    }
  }
  return hash(out.join('\n'));
}
const markFile = root => path.join(root, '.godspeed', 'due-copy.json');
function marked(root) { try { return JSON.parse(fs.readFileSync(markFile(root), 'utf8')).files || ''; } catch { return ''; } }
function mark(root, value) {
  try { fs.mkdirSync(path.dirname(markFile(root)), { recursive: true }); fs.writeFileSync(markFile(root), JSON.stringify({ files: value }) + '\n'); } catch { /* a copy that cannot leave a note just looks again next time */ }
}

// ---------------------------------------------------------------- a closing, as a reader sees it
//
// A moment is append-only: what happened is never rewritten. When a closing event in world/events/
// is edited (its evidence, its day, or `closes:` turned into `drops:`), the notebook's own way to
// say so is a correction record on the timeline (event_corrections), which every reader applies
// over the moment and which takes it back when it carries removed_at. query.mjs does exactly this
// for every screen; the copy does it here, and reads the same way, so what the old files say and
// what the records say cannot drift apart.
const CLOSING_FIELDS = ['title', 'happened_at', 'evidence', 'source'];
function corrections(store) {
  const byMoment = new Map();
  for (const item of store.list('event_corrections')) {
    if (!byMoment.has(item.moment_id)) byMoment.set(item.moment_id, []);
    byMoment.get(item.moment_id).push(item);
  }
  return byMoment;
}
export function liveMoments(store, byMoment = corrections(store)) {
  return store.list('moments').map(moment => {
    const over = (byMoment.get(moment.id) || []).slice().sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id));
    return over.reduce((result, item) => ({ ...result, ...item.patch }), moment);
  }).filter(moment => !moment.removed_at);
}

// ---------------------------------------------------------------- a record out of a file
//
// Not store.prepare(): that stamps the record with this computer's name and this moment, and two
// machines that copy the same folder before either syncs would then write two versions of one
// record that differ in those two lines. With no older version between them the sync cannot tell
// which is right, so it keeps both for review (sync/identity.mjs) - four review items for one
// reminder and its closing, about nothing. Written this way, the two machines write the same
// record, byte for byte, and the merge has nothing to decide. The same reason record_history's own
// copies are written by hand, as the device 'history'.
const WRITTEN_BY = 'due-copy';
function converted(type, value, old) {
  const uid = String(old?.uid || value.uid);
  // The id the store would give it (records/store.mjs prepare): out of the title and the uid, so
  // it is the same id on every machine. A deadline brings its own, `due-<slug>`.
  const id = String(old?.id || value.id || readableSlug(value.name || value.title || type) + '-' + uid.slice(0, 8));
  const record = { tags: [], aliases: [], references: [], metadata: {}, user_id: 'owner', ...(old || {}), ...value,
    format: 1, type, id, uid, device: WRITTEN_BY, revision: (old?.revision || 0) + 1,
    created_at: old?.created_at || value.created_at, updated_at: value.updated_at };
  delete record._hash;
  return record;
}

// ---------------------------------------------------------------- the copy
//
// Under the notebook's workspace lock, and under it exactly once: the caller may hold it already
// (native-due.mjs runs every obligation command inside store.withLock), and the lock is one
// writer at a time, never re-entered.
export function copyOldReminders(store, { day = null, timeoutMs = 30000 } = {}) {
  const when = day || dayOf(store);
  const work = () => copyUnderLock(store, when);
  return store.holding ? work() : store.withLockSoon(work, { timeoutMs });
}

// A store that may be written: not a staged view of a transaction and not the read-only copy a
// backup or a restore looks at, both of which bring a `withLock` of their own (records/store.mjs,
// transaction and Store.inspect). A read that lands on one of those copies them nothing.
export const writable = store => !!store && !Object.hasOwn(store, 'withLock');

// What `copyOldReminders` answers, so a caller (and the tests) can see what one run did:
// {copied, updated, closed, corrected, reviews, needsALook, waiting, unchanged}.
function copyUnderLock(store, day) {
  const root = store.root;
  const files = createDueFiles({ root });
  const report = { copied: [], updated: [], closed: [], corrected: [], reviews: [], needsALook: [], waiting: [], unchanged: true };
  const book = new Map(store.list(COPY_TYPE).map(record => [record.file, record]));
  const pages = new Map(store.list('deadlines').map(record => [record.uid, record]));
  const moments = new Set(store.list('moments', { removed: true }).map(record => record.uid));
  const corrected = corrections(store);
  // Every closing the notebook holds as its readers see it, by uid, and which old event file each
  // one came out of: what a changed event file is held against below.
  const live = new Map(liveMoments(store, corrected).map(record => [record.uid, record]));
  const fromFile = new Map();
  for (const moment of live.values()) {
    if (!moment.moved_from) continue;
    if (!fromFile.has(moment.moved_from)) fromFile.set(moment.moved_from, []);
    fromFile.get(moment.moved_from).push(moment);
  }
  const write = [], forget = [], touched = new Map();
  // What the old files say every closing should be now, by uid, filled in as the reminders are
  // read (recordsOf gives a reminder and its closings together).
  const wantedClosings = new Map();

  // One record of this write, and the history copy that writing it would leave behind, named so it
  // can be taken away again afterwards: commit() names that copy after the version going out, its
  // revision and its hash (records/store.mjs commit).
  const prepare = (type, value, old) => {
    if (old) forget.push('record_history/' + old.uid + '-' + old.revision + '-' + old._hash.slice(0, 12));
    const record = converted(type, value, old || null);
    write.push(record);
    return record;
  };
  const remember = (file, text, value) => touched.set(file, { file, text, ...value });
  // One correction on the timeline, named after the moment and the new content of the old file it
  // came out of, so two machines that read the same edit write the one correction and not two.
  const correct = (moment, patch, digest, day) => {
    const already = (corrected.get(moment.id) || []).length + write.filter(r => r.type === 'event_corrections' && r.moment_id === moment.id).length;
    const id = idFor('due-copy-correction', [moment.uid, digest, canonical(patch)].join('|'));
    if (store.get('event_corrections', id)) return;
    prepare('event_corrections', { id, uid: hash(id).slice(0, 32), moment_id: moment.id, patch, sequence: already + 1,
      created_at: day + 'T00:00:00Z', updated_at: day + 'T00:00:00Z',
      references: [{ type: 'moments', id: moment.id, uid: moment.uid }] }, null);
  };

  // ---- the reminders, and the closings of each
  const events = files.worldEvents();
  const eventOf = new Map(events.map(event => [event.file, event]));
  // Which reminders a changed or new closing event names: they are looked at even when their own
  // file has not changed, so a closing written the old way closes its reminder on the next run.
  const todo = new Set();
  for (const event of events) {
    const text = read(path.join(root, ...event.file.split('/')));
    if (text === null) continue;
    if (book.get(event.file)?.file_hash === hash(text)) continue;
    for (const ref of [...event.closes, ...event.drops]) todo.add(ref.slug);
  }
  for (const slug of files.slugs()) {
    const file = 'due/' + slug + '.md';
    const text = read(path.join(root, 'due', slug + '.md'));
    if (text === null) continue;
    const known = book.get(file);
    const uid = SLUG.test(slug) ? deadlineUid(slug) : null;
    // Unchanged, and its page is there: nothing to do. A page somebody deleted is written again,
    // because a reminder that is in due/ is a reminder this machine holds. One whose file and page
    // both changed (`review_item`) is looked at on every run until they agree again, because what
    // moves then is the page, and only the page: the copy would otherwise never notice.
    if (uid && known?.file_hash === hash(text) && !known.review_item && pages.has(uid) && !todo.has(slug)) continue;
    todo.add(slug);
  }
  for (const slug of [...todo].sort()) {
    const file = 'due/' + slug + '.md';
    const text = read(path.join(root, 'due', slug + '.md'));
    if (text === null) continue;
    const made = files.recordsOf(slug);
    // A file that does not read gets no record and is left exactly as it is: it stays "needs a
    // look" in the list, the brief and the notebook, every day, until it is fixed.
    if (!made) { report.needsALook.push(file); continue; }
    const digest = hash(text);
    const known = book.get(file);
    const page = pages.get(made.deadline.uid);
    const wanted = digestOf(made.deadline);
    if (!page) {
      prepare('deadlines', made.deadline, null);
      report.copied.push(slug);
      remember(file, text, { kind: 'reminder', at: made.deadline.updated_at, file_hash: digest, record_type: 'deadlines', record_uid: made.deadline.uid, record_id: made.deadline.id, record_digest: wanted });
    } else if (digestOf(page) === wanted) {
      // The page already says what the file says (the usual second run, and the usual other
      // machine): nothing is written but the note of what was copied.
      remember(file, text, { kind: 'reminder', at: made.deadline.updated_at, file_hash: digest, record_type: 'deadlines', record_uid: page.uid, record_id: page.id, record_digest: wanted });
    } else if (known && known.record_digest && digestOf(page) === known.record_digest) {
      // The page is still exactly what the copy last wrote, and the file says something else now:
      // the page follows the file. `record_digest` is what the COPY wrote, never what the owner
      // has: a page the owner changed can never match it, so a page kept for review below is
      // never overwritten later, however often this reminder comes back through a changed closing.
      prepare('deadlines', made.deadline, page);
      report.updated.push(slug);
      remember(file, text, { kind: 'reminder', at: made.deadline.updated_at, file_hash: digest, record_type: 'deadlines', record_uid: page.uid, record_id: page.id, record_digest: wanted });
    } else {
      // Both changed. The notebook's version stays, and both are kept as one review item, named
      // after the two versions so that it is one item however often this runs. Nothing is dropped
      // and nothing becomes a second reminder. What the copy wrote last stays the baseline below
      // (30 October 2026: it was replaced with the page the owner had, and then the next changed
      // closing of that reminder made the branch above take the file's version over the owner's).
      const id = idFor('due-copy-review', file + '\n' + digest + '\n' + digestOf(page));
      if (!store.get('review_queue', id)) {
        prepare('review_queue', { id, uid: hash(id).slice(0, 32), suggestion_type: BOTH_CHANGED, status: 'pending_review',
          created_at: made.deadline.updated_at, updated_at: made.deadline.updated_at,
          title: 'A reminder changed in two places: ' + (made.deadline.title || slug),
          description: file + ' and the page ' + (page.title || slug) + ' were both changed since this reminder was copied into the notebook. The notebook\'s version is the one being kept.',
          payload: { file, slug, from_the_file: made.deadline, in_the_notebook: page, deadline_id: page.id } }, null);
        report.reviews.push(id);
      }
      remember(file, text, { kind: 'reminder', at: made.deadline.updated_at, file_hash: digest, record_type: 'deadlines', record_uid: page.uid, record_id: page.id, record_digest: known?.record_digest || null, review_item: id });
    }
    // The closings of this reminder: each one once, by the uid derived from the old event file it
    // came out of, so two machines taking in the same file make one moment. A moment is
    // append-only: one that is there is never written again.
    for (const closing of made.closings) {
      wantedClosings.set(closing.uid, closing);
      if (moments.has(closing.uid)) continue;
      moments.add(closing.uid);
      prepare('moments', closing, null);
      report.closed.push(closing.title);
    }
  }
  // ---- what was taken out of each closing event
  for (const [file, event] of eventOf) {
    const text = read(path.join(root, ...file.split('/')));
    if (text === null) continue;
    const digest = hash(text);
    if (book.get(file)?.file_hash === digest) continue;
    // This file is remembered as copied only once every closing in it IS a moment in the notebook.
    // One of a reminder with no page (its file is gone, or does not read) is not: a moment may not
    // point at a reminder that is not there. Then the file's hash is not remembered and the next
    // run looks again, rather than the closing being quietly left out for ever.
    const named = [], missing = [], says = new Set();
    for (const [kind, refs] of [['closes', event.closes], ['drops', event.drops]]) {
      for (const ref of refs) {
        named.push(ref.slug);
        if (!SLUG.test(ref.slug)) { missing.push(ref.slug); continue; }
        const uid = closingUid({ slug: ref.slug, window: ref.window, kind, from: file });
        says.add(uid);
        if (!moments.has(uid)) missing.push(ref.slug);
      }
    }
    if (missing.length) { report.waiting.push(file); continue; }
    // The file was edited after it was copied. A moment it no longer says anything about is taken
    // back, and one whose words or day it changed is corrected to what the file says now - as a
    // correction on the timeline, because what happened is never rewritten. Without this, turning
    // `closes:` into `drops:` left both (the kind is part of a closing's identity), and an edited
    // evidence or day stayed as it first arrived.
    for (const moment of fromFile.get(file) || []) {
      if (says.has(moment.uid)) continue;
      correct(moment, { removed_at: event.date + 'T00:00:00Z' }, digest, event.date);
      report.corrected.push(moment.title + ' (taken back: ' + file + ' no longer says it)');
    }
    for (const uid of says) {
      const moment = live.get(uid), should = wantedClosings.get(uid);
      if (!moment || !should) continue;
      const patch = {};
      for (const field of CLOSING_FIELDS) if (canonical(moment[field] ?? null) !== canonical(should[field] ?? null)) patch[field] = should[field] ?? null;
      if (!Object.keys(patch).length) continue;
      correct(moment, patch, digest, event.date);
      report.corrected.push(moment.title + ' (' + Object.keys(patch).join(', ') + ' as ' + file + ' says it now)');
    }
    remember(file, text, { kind: 'closing', at: event.date + 'T00:00:00Z', file_hash: digest, record_type: 'moments', names: [...new Set(named)].sort() });
  }

  // ---- one write, then the history copies of this very write taken away again
  for (const [file, value] of touched) {
    const old = book.get(file) || null;
    // Every field of it is written on every pass, `null` where it does not apply: a record this
    // one is built from keeps nothing it no longer says (a reminder that came to agree with its
    // page again must stop carrying `review_item`, or it would be held for review for ever).
    const record = { id: idFor('due-copy', file), uid: copyUid(file), file,
      kind: value.kind, file_hash: value.file_hash, record_type: value.record_type,
      record_uid: value.record_uid ?? null, record_id: value.record_id ?? null,
      record_digest: value.record_digest ?? null, names: value.names ?? null,
      review_item: value.review_item ?? null,
      // Out of the old file too, like every field here: a bookkeeping record two machines write
      // must be the same record with the same words, or their merge would ask its owner about it.
      created_at: value.at, updated_at: value.at };
    if (old && bookDigest(old) === bookDigest(record)) continue;
    prepare(COPY_TYPE, record, old);
  }
  if (!write.length) { mark(root, marks(root)); return report; }
  report.unchanged = false;
  store.commit(write);
  const gone = forget.filter(key => store.get('record_history', key.slice('record_history/'.length)));
  if (gone.length) store.commit([], { removeKeys: gone });
  mark(root, marks(root));
  return report;
}

// ---------------------------------------------------------------- the cheap entrance
// For a caller that holds no store: tools/due.js, after it has answered. Opens the workspace only
// when an old file is new or changed. A workspace another writer holds, or one with no notebook,
// is left for the next run: the copy is idempotent, so nothing is lost by waiting.
export function copyIfFilesChanged(root, { day = null, store = null, timeoutMs = 30000 } = {}) {
  if (!fs.existsSync(path.join(root, 'notebook')) && !fs.existsSync(path.join(root, '.godspeed'))) return { skipped: 'no notebook' };
  if (marks(root) === marked(root)) return { skipped: 'nothing changed' };
  return copyOldReminders(store || new Store(root), { day, timeoutMs });
}

// ---------------------------------------------------------------- the check ticket 03 relies on
//
// Whether every reminder says the same thing through the records as tools/due.js says from the
// files, on the same day: the same state, the same windows, the same `today` sentence, and what
// closed it. The records are written back as old files into a folder of their own and the SAME
// program is run over both, so a difference can only come from the copy. Neither folder is
// changed: stateRows() is read without rolling anything.
const COMPARED = ['title', 'state', 'band', 'firstDay', 'lastDay', 'targetDay', 'sentence', 'attention',
  'closedOn', 'closedBy', 'doneWhen', 'selfCheck', 'problem', 'addon'];
export function sameThroughRecords(store, { day = null } = {}) {
  const when = day || dayOf(store);
  const { createDueCommands } = require_('../../tools/due.js');
  const rows = root => {
    const out = new Map();
    for (const row of createDueCommands({ root, commandArgs: [], date: when, copy: false }).stateRows(when)) out.set(row.slug, row);
    return out;
  };
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'godspeed-due-check-'));
  try {
    fs.mkdirSync(path.join(scratch, 'due'), { recursive: true });
    fs.mkdirSync(path.join(scratch, 'world', 'events'), { recursive: true });
    fs.writeFileSync(path.join(scratch, 'AGENTS.md'), '');
    const deadlines = store.list('deadlines').filter(record => record.native_slug);
    // The closings as every reader of the notebook sees them: their corrections applied, and the
    // ones a correction took back left out (liveMoments above).
    const closings = liveMoments(store).filter(record => record.category === 'obligation' && record.obligation_kind);
    createDueFiles({ root: scratch }).writeFilesFrom({ deadlines, closings });
    const mine = rows(store.root), theirs = rows(scratch);
    const differences = [], needsALook = [];
    for (const [slug, row] of mine) {
      const other = theirs.get(slug);
      if (!other) {
        // A file that does not read has no record on purpose, and says so every day in the list
        // and the brief. It is named here, and it is not a difference.
        if (row.state === 'needs-a-look') { needsALook.push(slug); continue; }
        differences.push(slug + ': the files have it, the records do not');
        continue;
      }
      for (const field of COMPARED) {
        // A closing that was only ever the word `done` on a window line names no event file in
        // the files ("legacy"), and names the event the records made of it in the records.
        if (field === 'closedBy' && row.closedBy === 'legacy') continue;
        const a = row[field] === undefined ? null : row[field], b = other[field] === undefined ? null : other[field];
        if (canonical(a) !== canonical(b)) differences.push(slug + ': ' + field + ' is ' + canonical(a) + ' from the files and ' + canonical(b) + ' through the records');
      }
    }
    for (const slug of theirs.keys()) if (!mine.has(slug)) differences.push(slug + ': the records have it, the files do not');
    return { same: differences.length === 0, differences, needsALook, day: when, reminders: mine.size };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
