// EVERY OLD LIFE EVENT, CLAIM AND ENTITY FILE IS COPIED INTO THE NOTEBOOK (#90, second slice).
//
// What Mission Control kept in world/events/, world/claims/ and world/entities/ is a plain file per
// record. On a mission control that is its own Git repository the notebook's sync carries only
// notebook/, so those files reach another computer only if a session commits them, and the
// notebook has had the records for all three all along: a moment on the timeline, a claim, an
// entity (docs/full-version/file-format.md). This fills them from the files, as due-copy.mjs did for
// reminders, and world-retire.mjs then retires the files.
//
// A closing event (`closes:` / `drops:`) is a reminder's, and stays with due-copy.mjs.
//
// WHAT KEEPS IT HONEST (the argument of due-copy.mjs, unchanged)
//
// - Every field of a record comes out of the file, never from this computer's clock or name, so two
//   machines that copy the same folder before either syncs write the same record, and the
//   notebook's field-by-field merge (sync/identity.mjs) has nothing to ask the owner. The uid of a
//   record is derived from the file's path (an entity's from its slug, so a claim that names an
//   entity with no file of its own and the file that comes later are one record).
// - Per file, one `world_copies` record in _system/: the hash and the whole text that was copied,
//   and what it became. Nothing of a file is lost even where it became no record of its own (an
//   entity that is a contact already).
// - A record the owner has changed since the copy wrote it is never overwritten by a later change
//   of its file: only a record that still says what the copy last wrote follows the file.
// - A file that cannot be copied (it does not read, or lacks what its record needs) is left exactly
//   where it is and is said once where the owner reads (notices.mjs), never in a receipt file.
import fs from 'node:fs';
import path from 'node:path';
import { Store, hash } from './records/store.mjs';
import { frontMatter } from './world-facts.mjs';
import { queueNotice } from './notices.mjs';
import { WORLD_COPY_TYPE } from './copy-types.mjs';
import { canonical, converted, read, writable } from './due-copy.mjs';

export const COPY_TYPE = WORLD_COPY_TYPE;
export const slugify = text => String(text || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const FOLDERS = ['world/claims', 'world/events', 'world/entities'];
const EPOCH = '1970-01-01T00:00:00Z';
const norm = s => String(s ?? '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const humanize = text => { const t = String(text || '').replace(/[-_]+/g, ' ').trim(); return t ? t[0].toUpperCase() + t.slice(1) : t; };
const list = value => Array.isArray(value) ? value.filter(Boolean) : value ? [String(value)] : [];

// The fields of each record the copy owns, in one order.
const OWNED = {
  entities: ['name', 'slug', 'entity_type', 'aliases', 'description', 'menerio_id', 'origin'],
  claims: ['subject_type', 'subject_id', 'attribute', 'value', 'valid_from', 'valid_to', 'confidence', 'cardinality', 'category_slug',
    'evidence_quote', 'origin', 'relationship', 'object_type', 'object_id', 'object_name', 'stance', 'steps', 'until', 'until_name', 'subject_slug'],
  moments: ['title', 'happened_at', 'description', 'source', 'origin'],
};
const digestOf = (type, record) => hash(canonical(OWNED[type].map(field => record?.[field] ?? null)));
const BOOK = ['file', 'kind', 'file_hash', 'file_text', 'record_type', 'record_uid', 'record_digest'];
const bookDigest = record => hash(canonical(BOOK.map(field => record?.[field] ?? null)));
const bookUid = file => hash('world-copy-book/' + file).slice(0, 32);
const fileUid = file => hash('world-copy/' + file).slice(0, 32);
const entityUid = slug => hash('world-entity/' + slug).slice(0, 32);
const slotUid = (type, id, attribute) => hash(['world-slot', type, id || '', attribute].join('/')).slice(0, 32);
const idFor = (prefix, text) => prefix + '-' + hash(text).slice(0, 24);

// ---------------------------------------------------------------- the files
export function oldFiles(root) {
  const out = [];
  for (const folder of FOLDERS) {
    let names = [];
    try { names = fs.readdirSync(path.join(root, ...folder.split('/')), { withFileTypes: true }).filter(e => e.isFile() && e.name.endsWith('.md')).map(e => e.name).sort(); } catch { continue; }
    for (const name of names) out.push({ file: folder + '/' + name, kind: folder.split('/')[1] });
  }
  return out;
}

// ---------------------------------------------------------------- the cheap look first
// Names, sizes and times of the old files, in .godspeed/ (this computer's own state, never synced),
// so that the usual run where nothing changed opens no workspace and takes no lock.
function marks(root) {
  const out = [];
  for (const { file } of oldFiles(root)) {
    let stat; try { stat = fs.statSync(path.join(root, ...file.split('/'))); } catch { continue; }
    out.push(file + '\t' + stat.size + '\t' + Math.round(stat.mtimeMs));
  }
  return hash(out.join('\n'));
}
const markFile = root => path.join(root, '.godspeed', 'world-copy.json');
export function noteOf(root) { try { return JSON.parse(fs.readFileSync(markFile(root), 'utf8')) || {}; } catch { return {}; } }
export function writeNote(root, patch) {
  const note = { ...noteOf(root), ...patch };
  try { fs.mkdirSync(path.dirname(markFile(root)), { recursive: true }); fs.writeFileSync(markFile(root), JSON.stringify(note) + '\n'); }
  catch { /* a copy that cannot leave a note just looks again next time */ }
  return note;
}

// ---------------------------------------------------------------- who a file's subject is
// In the notebook's own terms, whatever it hides: an entity file names its person's notebook id
// (menerio_id: the import kept Menerio's ids) and nicknames; a person merged into another is that
// other; several cards with one name are one person kept twice, the oldest standing for them.
// Hiding is the readers' business (visibility.mjs), so it is not asked here.
function people(store, entityFiles, write) {
  const contacts = store.list('contacts'), byId = new Map(), byName = new Map();
  for (const c of contacts) for (const id of [c.id, ...(c.former_ids || [])]) byId.set(id, c);
  const follow = c => { for (let hops = 0; c?.merged_into && c.merged_into !== 'self' && hops < 6; hops++) c = byId.get(c.merged_into) || c; return c; };
  for (const c of contacts) if (!c.merged_into) for (const n of [c.name, ...list(c.aliases)]) if (typeof n === 'string' && n.trim()) byName.set(norm(n), [...(byName.get(norm(n)) || []), c]);
  const bySlugName = new Map();
  for (const c of contacts) if (!c.merged_into && slugify(c.name)) bySlugName.set(slugify(c.name), [...(bySlugName.get(slugify(c.name)) || []), c]);
  const things = store.list('entities'), bySlug = new Map(things.filter(e => e.slug).map(e => [e.slug, e]));
  const cached = new Map();
  const namesOf = (slug, e) => [e.name, ...list(e.aliases)].filter(Boolean).map(norm).concat(e.name ? [] : [norm(humanize(slug))]);

  const find = (slug, create) => {
    if (cached.has(slug)) return cached.get(slug);
    const e = entityFiles.get(slug) || { name: humanize(slug) }, names = namesOf(slug, e);
    let result;
    if (slug === 'me' || String(e.self) === 'true') result = { type: 'self', id: null, name: e.name || null };
    else {
      let c = e.menerio_id ? follow(byId.get(e.menerio_id)) : null;
      if (!c) c = follow([...new Set([...names.flatMap(n => byName.get(n) || []), ...(bySlugName.get(slug) || [])])].sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))[0]);
      if (c) result = { type: 'contact', id: c.id, name: c.name };
      else {
        const thing = bySlug.get(slug) || things.find(t => names.includes(norm(t.name)));
        if (thing) result = { type: 'entity', id: thing.id, name: thing.name, record: thing };
        else if (!create) result = null;
        else {
          const made = converted('entities', {
            uid: entityUid(slug), name: e.name || humanize(slug) || slug, slug, entity_type: e.type || 'other', aliases: list(e.aliases),
            description: entityFiles.has(slug) ? entityFiles.get(slug).__body || null : null, menerio_id: e.menerio_id || null,
            origin: e.origin || 'mission control', created_at: EPOCH, updated_at: EPOCH }, null);
          write.push(made);
          result = { type: 'entity', id: made.id, name: made.name, record: made, created: true };
        }
      }
    }
    cached.set(slug, result);
    return result;
  };
  return { who: slug => find(slug, true), known: slug => find(slug, false) };
}

// The record a world slug names today, with the entity record to write when nothing in the notebook
// has it yet (tools that file a claim about a slug: tools/holds.js).
export function subjectOfSlug(store, slug) {
  const records = [], { who } = people(store, new Map(), records);
  return { subject: who(slug), records };
}

// ---------------------------------------------------------------- the copy
//
// Under the notebook's workspace lock, exactly once: a caller that holds it already is not asked
// to take it again (the lock is never re-entered).
export function copyOldWorld(store, { timeoutMs = 30000 } = {}) {
  const work = () => copyUnderLock(store);
  return store.holding ? work() : store.withLockSoon(work, { timeoutMs });
}

// What `copyOldWorld` answers: {copied, updated, needsALook: [{file, why}], unchanged}.
function copyUnderLock(store) {
  const root = store.root;
  const report = { copied: [], updated: [], needsALook: [], unchanged: true };
  const book = new Map(store.list(COPY_TYPE).map(record => [record.file, record]));
  const write = [], forget = [], touched = new Map();
  const dueTook = new Set(store.list('due_copies').map(record => record.file));

  // The files, read once; a file another version of this program (due-copy) owns is not ours.
  const docs = [];
  for (const { file, kind } of oldFiles(root)) {
    let text;
    try { text = read(path.join(root, ...file.split('/'))); } catch (error) {
      report.needsALook.push({ file, why: 'it cannot be read (' + (error.code || 'error') + ')', hash: String(error.code || 'unreadable') });
      continue;
    }
    if (text === null) continue;
    const parsed = frontMatter(text);
    if (kind === 'events' && (dueTook.has(file) || (parsed && ('closes' in parsed.fields || 'drops' in parsed.fields)))) continue;
    docs.push({ file, kind, text, digest: hash(text), parsed });
  }
  const entityFiles = new Map(docs.filter(d => d.kind === 'entities' && d.parsed).map(d => [d.parsed.fields.slug || path.basename(d.file, '.md'), { ...d.parsed.fields, __body: d.parsed.body }]));
  const { who, known } = people(store, entityFiles, write);

  // A record the copy wrote before, as it is now: followed by the file only while the owner has
  // not changed it. `record_digest` is what the COPY wrote, never what the owner has.
  const place = (type, record, file, old) => {
    const there = store.list(type, { removed: true }).find(r => r.uid === record.uid);
    if (!there) { write.push(record); report.copied.push(file); return { kept: record, digest: digestOf(type, record) }; }
    if (digestOf(type, there) === digestOf(type, record)) return { kept: there, digest: digestOf(type, there) };
    if (old?.record_digest && digestOf(type, there) === old.record_digest) {
      forget.push('record_history/' + there.uid + '-' + there.revision + '-' + there._hash.slice(0, 12));
      const next = converted(type, { ...record, uid: there.uid, id: there.id }, there);
      write.push(next); report.updated.push(file); return { kept: next, digest: digestOf(type, next) };
    }
    // The owner's version stays, and the book keeps what the COPY last wrote, so that no later
    // change of the file mistakes the owner's version for its own.
    return { kept: there, digest: old?.record_digest ?? null };
  };
  const remember = (file, text, digest, value) => touched.set(file, { file, file_text: text, file_hash: digest, ...value });
  const bad = (doc, why) => { report.needsALook.push({ file: doc.file, why, hash: doc.digest }); };

  // entities first, so that claims and events find them
  for (const doc of docs.filter(d => d.kind === 'entities')) {
    if (book.get(doc.file)?.file_hash === doc.digest && book.get(doc.file)?.record_type) continue;
    if (!doc.parsed) { bad(doc, 'it does not start with the front matter between --- lines'); continue; }
    const slug = doc.parsed.fields.slug || path.basename(doc.file, '.md');
    const found = who(slug);
    remember(doc.file, doc.text, doc.digest, { kind: 'entity', record_type: found.type === 'self' ? 'self' : found.type === 'contact' ? 'contacts' : 'entities', record_uid: found.record?.uid || null, record_digest: null });
    if (found.created) report.copied.push(doc.file);
  }

  for (const doc of docs.filter(d => d.kind === 'claims')) {
    const old = book.get(doc.file);
    if (old?.file_hash === doc.digest && old.record_type) continue;
    if (!doc.parsed) { bad(doc, 'it does not start with the front matter between --- lines'); continue; }
    const f = doc.parsed.fields, body = doc.parsed.body;
    if (!f.subject || !f.attribute || f.value === undefined || f.value === '') { bad(doc, 'it lacks its subject, attribute or value'); continue; }
    const who_ = who(f.subject), toward = !f.object && /^relationship-to-(.+)$/.exec(String(f.attribute));
    const named = toward ? known(toward[1]) : null;
    const other = f.object ? who(f.object) : named && named.id && named.type !== 'self' ? named : null;
    const value = other ? f.value + ': ' + (other.type === 'self' ? 'you' : other.name) : String(f.value);
    const record = converted('claims', {
      uid: fileUid(doc.file), subject_type: who_.type, subject_id: who_.id, subject_slug: String(f.subject), attribute: f.attribute, value,
      ...(other ? { relationship: String(f.value), object_type: other.type, object_id: other.id, object_name: other.type === 'self' ? 'you' : other.name } : {}),
      valid_from: isDay(f.valid_from) ? f.valid_from : null, valid_to: isDay(f.valid_to) ? f.valid_to : null,
      confidence: f.confidence || 'confirmed', cardinality: f.cardinality || 'many', category_slug: f.category || null,
      evidence_quote: body ? body.slice(0, 600) : null, source_type: 'file', source_id: doc.file, origin: f.origin || 'mission control',
      ...(f.stance ? { stance: String(f.stance) } : {}), ...(list(f.steps).length ? { steps: list(f.steps) } : {}),
      ...(f.until ? { until: fileUid('world/claims/' + String(f.until).replace(/\.md$/, '') + '.md'), until_name: String(f.until).replace(/\.md$/, '') } : {}),
      created_at: (isDay(f.valid_from) ? f.valid_from : '1970-01-01') + 'T00:00:00Z', updated_at: (isDay(f.valid_from) ? f.valid_from : '1970-01-01') + 'T00:00:00Z' }, null);
    const { kept, digest } = place('claims', record, doc.file, old);
    // The claim is shown to the assistant by its slot (query.mjs profile_facts), as every claim
    // the notebook writes is (domains.mjs writeFact).
    const slotOf = store.list('fact_slots').find(s => s.subject_type === record.subject_type && s.subject_id === record.subject_id && s.attribute === record.attribute);
    if (!slotOf && !write.some(r => r.type === 'fact_slots' && r.uid === slotUid(record.subject_type, record.subject_id, record.attribute)))
      write.push(converted('fact_slots', { uid: slotUid(record.subject_type, record.subject_id, record.attribute), name: record.attribute, subject_type: record.subject_type,
        subject_id: record.subject_id, contact_id: record.subject_type === 'contact' ? record.subject_id : null, attribute: record.attribute, label: humanize(record.attribute),
        category_slug: f.category || null, cardinality: record.cardinality, show_to_agent: true, is_pinned: false, created_at: record.created_at, updated_at: record.created_at }, null));
    remember(doc.file, doc.text, doc.digest, { kind: 'claim', record_type: 'claims', record_uid: kept.uid, record_digest: digest });
  }

  for (const doc of docs.filter(d => d.kind === 'events')) {
    const old = book.get(doc.file);
    if (old?.file_hash === doc.digest && old.record_type) continue;
    if (!doc.parsed) { bad(doc, 'it does not start with the front matter between --- lines'); continue; }
    const f = doc.parsed.fields, body = doc.parsed.body;
    if (!isDay(f.date)) { bad(doc, 'it has no `date:` written year first'); continue; }
    const record = converted('moments', {
      uid: fileUid(doc.file), title: (body.split(/\r?\n/)[0] || '').trim().slice(0, 200) || path.basename(doc.file, '.md'), happened_at: f.date, description: body || null,
      status: 'past_fact', source: f.source || null, source_type: 'file', source_id: doc.file, origin: f.origin || 'mission control',
      created_at: f.date + 'T00:00:00Z', updated_at: f.date + 'T00:00:00Z' }, null);
    const { kept, digest } = place('moments', record, doc.file, old);
    // participants, as the links the timeline reads; the owner is no link
    for (const slug of list(f.participants)) {
      const p = who(slug);
      if (p.type === 'self') continue;
      const link = p.type === 'contact' ? 'moment_participants' : 'moment_entities', id = idFor('world-copy-link', doc.file + '|' + slug);
      if (store.get(link, id) || write.some(r => r.id === id)) continue;
      write.push(converted(link, { id, uid: hash(id).slice(0, 32), moment_id: kept.id, ...(p.type === 'contact' ? { person_id: p.id } : { entity_id: p.id }),
        created_at: f.date + 'T00:00:00Z', updated_at: f.date + 'T00:00:00Z', references: [{ type: 'moments', id: kept.id, uid: kept.uid }] }, null));
    }
    remember(doc.file, doc.text, doc.digest, { kind: 'event', record_type: 'moments', record_uid: kept.uid, record_digest: digest });
  }

  // ---- the notes of what was copied, then one write
  for (const [file, value] of touched) {
    const old = book.get(file) || null;
    const record = { id: idFor('world-copy', file), uid: bookUid(file), file, kind: value.kind, file_hash: value.file_hash, file_text: value.file_text,
      record_type: value.record_type, record_uid: value.record_uid ?? null, record_digest: value.record_digest ?? null, created_at: EPOCH, updated_at: EPOCH };
    if (old && bookDigest(old) === bookDigest(record)) continue;
    if (old) forget.push('record_history/' + old.uid + '-' + old.revision + '-' + old._hash.slice(0, 12));
    write.push(converted(COPY_TYPE, record, old));
  }
  for (const item of report.needsALook) tellAbout(store, item);
  if (!write.length) { writeNote(root, { files: report.needsALook.length ? '' : marks(root) }); return report; }
  report.unchanged = false;
  store.commit(write);
  const gone = forget.filter(key => store.get('record_history', key.slice('record_history/'.length)));
  if (gone.length) store.commit([], { removeKeys: gone });
  writeNote(root, { files: report.needsALook.length ? '' : marks(root) });
  return report;
}

// A file that cannot be copied is said once per change of it, in the words the owner reads, where
// notices go (Telegram or "From your routines"): never in a receipt file.
function tellAbout(store, { file, why, hash: fileHash }) {
  try {
    queueNotice(store, { id: 'world-file-' + hash(file + '|' + fileHash).slice(0, 20), about: file, step: 'world-copy',
      text: 'Godspeed could not move ' + file + ' into your notebook, because ' + why + '. It stays where it is. Open it and put that right, and the next run takes it in.' });
  } catch { /* a notice that cannot be queued is tried again on the next run: the file is still not copied */ }
}

// ---------------------------------------------------------------- the cheap entrance
// For a caller that holds no store. Opens the workspace only when an old file is new or changed.
export function copyWorldIfChanged(root, { store = null, timeoutMs = 30000 } = {}) {
  if (!fs.existsSync(path.join(root, 'notebook')) && !fs.existsSync(path.join(root, '.godspeed'))) return { skipped: 'no notebook' };
  if (marks(root) === (noteOf(root).files || '')) return { skipped: 'nothing changed' };
  const own = store || new Store(root);
  if (!writable(own)) return { skipped: 'read-only' };
  return copyOldWorld(own, { timeoutMs });
}
