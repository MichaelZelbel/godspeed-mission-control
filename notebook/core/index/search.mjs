import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {durableRoots,durableFiles,shared,recordsFolder} from '../file-policy.mjs';
import {hash,decode,encode} from '../records/store.mjs';
import {candidate} from '../records/layout.mjs';
import {mergeRanked} from './meaning.mjs';
import {STOPWORDS} from './stopwords.mjs';

// The search index: one SQLite file beside the notebook, rebuilt from the
// notebook whenever it is missing or of an older form, so it never holds
// anything the files do not. Words are found with SQLite's full-text search
// (FTS5, BM25 ranking): every word of a query is looked for on its own, in
// any order, ignoring case and accents ("orthopade" finds "Orthopäde"), and
// a word may be the start of a longer one ("ortho" finds it too). A query
// whose words appear nowhere as words is looked for inside words as well, so
// "termin" still finds "Arzttermin".
const FORMAT = '2';
// Bookkeeping nobody searches for: earlier versions of records, receipts,
// schedules, settings. Their words would only push the notes and people
// they belong to further down.
const UNSEARCHED = new Set(['record_history','jobs','job_receipts','command_receipts','work_tool_receipts','import_mappings','settings','connector_status','embeddings','review_queue_bulk_jobs','note_ai_jobs','gdrive_imports','approvals','mcp_api_tokens','mcp_preferences','notification_preferences','user_roles','github_sync_log','event_corrections','supervisor_state']);
const SKIPPED_KEYS = new Set(['id','uid','type','format','revision','device','user_id','references','metadata','embedding','embeddings','structured_fields','_hash','share_token','token','request_hash']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The words of a record a person would search for: every text it holds,
// not its field names, identifiers, dates or bookkeeping.
export function searchText(record) {
  const parts = [];
  const visit = (value, depth) => {
    if (depth > 6 || value == null) return;
    if (typeof value === 'string') { if (value.trim() && !UUID.test(value)) parts.push(value); return; }
    if (Array.isArray(value)) { for (const item of value) visit(item, depth + 1); return; }
    if (typeof value === 'object') for (const [key, next] of Object.entries(value)) { if (depth === 0 && (SKIPPED_KEYS.has(key) || /(_id|_uid|_at|_hash|_ids)$/.test(key))) continue; visit(next, depth + 1); }
  };
  visit(record, 0);
  return parts.join('\n');
}
export function documentOf(record) {
  if (!record?.uid || !record.type || record.removed_at || UNSEARCHED.has(record.type)) return null;
  const title = record.title || record.name || (record.attribute ? record.attribute + ': ' + (record.value ?? '') : null) || record.id;
  return [record.uid, record.type, record.id, String(title), searchText(record), record._hash || hash(encode(record))];
}
// The words of a query, as FTS5 reads them: each one quoted, so a word like
// "and", "near" or a stray quote is just a word.
export function queryWords(query) {
  return [...String(query || '').normalize('NFC').matchAll(/[\p{L}\p{N}]+/gu)].map(m => m[0]).slice(0, 16);
}
// The terms of a query: what is separated by spaces. A term of several words
// ("excluded-marker", "v2.18", "jean-luc") is those words in that order.
export function queryTerms(query) {
  return String(query || '').split(/\s+/).map(queryWords).filter(words => words.length).slice(0, 12);
}

export class SearchIndex {
  constructor(store, { background = false } = {}) {
    this.store = store; this.file = path.join(store.state, 'search.sqlite');
    const open = () => {
      this.db = new DatabaseSync(this.file);
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)');
      const format = this.db.prepare("SELECT value FROM meta WHERE key='format'").get()?.value;
      if (format !== FORMAT) {
        // An index of an earlier form is rebuilt, never migrated: it holds
        // nothing the notebook does not.
        this.db.exec('DROP TABLE IF EXISTS documents; DROP TABLE IF EXISTS docs; DROP TABLE IF EXISTS docs_fts;');
        this.db.exec(`CREATE TABLE docs (rowid INTEGER PRIMARY KEY, uid TEXT UNIQUE NOT NULL, type TEXT, id TEXT, title TEXT, digest TEXT);
          CREATE VIRTUAL TABLE docs_fts USING fts5(title, body, tokenize='unicode61 remove_diacritics 2', prefix='2 3');`);
        this.db.prepare("INSERT OR REPLACE INTO meta VALUES('format',?)").run(FORMAT);
        this.fresh = true;
        if (format) try { this.db.exec('VACUUM'); } catch {}
      }
    };
    try { open(); } catch (error) { try { this.db?.close(); } catch {} if (fs.existsSync(this.file)) fs.renameSync(this.file, this.file + '.corrupt-' + Date.now()); for (const suffix of ['-wal', '-shm']) if (fs.existsSync(this.file + suffix)) fs.renameSync(this.file + suffix, this.file + '.corrupt-' + Date.now() + suffix); open(); this.recovered = true; this.fresh = true; }
    this.statements();
    // What the index holds, row by row: uid -> digest of what was indexed.
    this.indexed = new Map(this.db.prepare('SELECT uid, digest FROM docs').all().map(row => [row.uid, row.digest]));
    if (background) {
      // The server answers at once with what the index already holds; records
      // are brought up to date first (no file is read for them), then files.
      this.syncRecords();
      this.ready = this.rebuildBackground().catch(() => false);
    } else this.rebuild();
  }
  statements() {
    this.find = this.db.prepare('SELECT rowid FROM docs WHERE uid=?');
    this.insertDoc = this.db.prepare('INSERT INTO docs(uid,type,id,title,digest) VALUES(?,?,?,?,?)');
    this.insertText = this.db.prepare('INSERT INTO docs_fts(rowid,title,body) VALUES(?,?,?)');
    this.deleteDoc = this.db.prepare('DELETE FROM docs WHERE rowid=?');
    this.deleteText = this.db.prepare('DELETE FROM docs_fts WHERE rowid=?');
  }
  // One document in, replacing what the index held under its uid.
  put(document) {
    const [uid, type, id, title, body, digest] = document;
    this.drop(uid);
    const { lastInsertRowid } = this.insertDoc.run(uid, type, id, title, digest);
    this.insertText.run(lastInsertRowid, title, body);
    this.indexed.set(uid, digest);
  }
  drop(uid) {
    const row = this.find.get(uid);
    if (row) { this.deleteText.run(row.rowid); this.deleteDoc.run(row.rowid); }
    this.indexed.delete(uid);
  }
  // Records straight from the store's view: no file is read.
  recordDocuments() {
    this.store.scan(); const documents = [];
    for (const r of this.store.records.values()) { const d = documentOf(r); if (d) documents.push(d); }
    return documents;
  }
  // Bring the record rows up to date from the store's view, writing only
  // what differs. Workspace files are left as they are.
  syncRecords() {
    const documents = this.recordDocuments(), next = new Map(documents.map(d => [d[0], d]));
    const changed = documents.filter(d => this.indexed.get(d[0]) !== d[5]);
    const removed = [...this.indexed.keys()].filter(uid => !uid.startsWith('file-') && !next.has(uid));
    this.write(changed, removed);
    return changed.length + removed.length;
  }
  write(changed, removed) {
    if (!changed.length && !removed.length) return 0;
    this.db.exec('BEGIN');
    try { for (const uid of removed) this.drop(uid); for (const document of changed) this.put(document); this.db.exec('COMMIT'); }
    catch (error) { this.db.exec('ROLLBACK'); this.indexed = new Map(this.db.prepare('SELECT uid, digest FROM docs').all().map(row => [row.uid, row.digest])); throw error; }
    return changed.length + removed.length;
  }
  fileDocument(relative, text) { return ['file-' + hash(relative), 'workspace_file', relative, relative, text, hash(text)]; }
  rebuild() {
    this.generation = (this.generation || 0) + 1;
    const documents = this.recordDocuments();
    const visit = relative => { const absolute = path.join(this.store.root, relative); if (!fs.existsSync(absolute)) return; const stat = fs.lstatSync(absolute); if (stat.isSymbolicLink()) return; if (stat.isDirectory()) { for (const name of fs.readdirSync(absolute)) if (shared(relative + '/' + name)) visit(relative + '/' + name); } else if (stat.size <= 512 * 1024 && /\.(md|json|jsonl|txt)$/.test(relative)) documents.push(this.fileDocument(relative, fs.readFileSync(absolute, 'utf8'))); };
    for (const name of [...durableRoots.filter(r => r !== recordsFolder), ...durableFiles]) visit(name);
    // An owner's own pages in the notebook folder are searched like any file.
    for (const file of this.store.documents || []) visit(path.relative(this.store.root, file).split(path.sep).join('/'));
    return this.replace(documents);
  }
  // Compare what was read with what the index holds and write only the rows
  // that differ. Returns the number of rows written.
  replace(documents) {
    const next = new Map(documents.map(document => [document[0], document]));
    const changed = [...next.values()].filter(document => this.indexed.get(document[0]) !== (document[5] ?? hash(document[4])));
    for (const document of changed) if (document[5] === undefined) document[5] = hash(document[4]);
    const removed = [...this.indexed.keys()].filter(uid => !next.has(uid));
    this.lastRebuild = new Date().toISOString();
    return this.write(changed, removed);
  }
  rebuildBackground() {
    if (this.closed) return Promise.resolve(false);
    if (this.pending) { this.again = true; return this.pending; }
    this.pending = (async () => {
      let changed = false;
      do {
        this.again = false;
        const generation = this.generation, documents = await this.readBackground();
        if (this.closed) break;
        // A foreground writer/rebuild may run while file reads yield. Never
        // replace its newer index with the earlier background collection.
        if (generation !== this.generation) { this.again = true; continue; }
        changed = this.replace(documents) > 0 || changed;
      } while (this.again && !this.closed);
      return changed;
    })().finally(() => { this.pending = null; });
    return this.pending;
  }
  // Put the records a write just changed straight into the index, so a search
  // run immediately afterwards finds them.
  update(records) {
    this.generation = (this.generation || 0) + 1;
    const changed = [], removed = [];
    for (const record of records) {
      if (!record?.uid || !record?.type) continue;
      const document = documentOf(record);
      if (document) { if (this.indexed.get(document[0]) !== document[5]) changed.push(document); }
      else if (this.indexed.has(record.uid)) removed.push(record.uid);
    }
    this.write(changed, removed);
    this.lastRebuild = new Date().toISOString();
  }
  // What the store reports as gone (a removed or renamed record).
  forget(records) {
    this.generation = (this.generation || 0) + 1;
    const store = this.store, removed = records.filter(r => r?.uid && this.indexed.has(r.uid) && !(store.keyOfUid?.has(r.uid) && !store.records.get(store.keyOfUid.get(r.uid))?.removed_at)).map(r => r.uid);
    this.write([], removed);
  }
  // Workspace files named by a watcher, read again on their own.
  refreshFiles(names) {
    const changed = [], removed = [];
    for (const relative of names) {
      const uid = 'file-' + hash(relative), absolute = path.join(this.store.root, ...relative.split('/'));
      let stat = null; try { stat = fs.lstatSync(absolute); } catch {}
      // In the notebook folder only an owner's own page is a file; records
      // reach the index through the store.
      const page = !relative.startsWith(recordsFolder + '/') || this.store.documents?.has(absolute);
      if (stat?.isFile() && page && shared(relative) && stat.size <= 512 * 1024 && /\.(md|json|jsonl|txt)$/.test(relative)) {
        const document = this.fileDocument(relative, fs.readFileSync(absolute, 'utf8'));
        if (this.indexed.get(uid) !== document[5]) changed.push(document);
      } else if (this.indexed.has(uid)) removed.push(uid);
    }
    this.generation = (this.generation || 0) + 1;
    return this.write(changed, removed);
  }
  // Every file is read in one step that cannot be interrupted, and the loop
  // then hands the event loop back. A read that spans an await keeps the file
  // open, and on Windows an open record file makes the atomic rename behind a
  // note save fail. Pausing between files is what keeps the server answering.
  async breathe() {
    if (++this.readsSinceBreath < 25) return;
    this.readsSinceBreath = 0;
    await new Promise(resolve => setImmediate(resolve));
  }
  readText(file) {
    try { return fs.readFileSync(file, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async readBackground() {
    const documents = [], io = fs.promises;
    this.readsSinceBreath = 0;
    const entries = async folder => { try { return await io.readdir(folder, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return []; throw error; } };
    let pages = [];
    if (this.store.watching) {
      // The store already holds every record and is told about every change.
      documents.push(...this.recordDocuments());
      pages = [...(this.store.documents || [])].map(file => path.relative(this.store.root, file).split(path.sep).join('/'));
    } else {
      // The same files Store.scan reads: every record file under notebook/.
      const records = new Map(), walk = async relative => {
        for (const entry of await entries(path.join(this.store.recordsRoot, ...relative.split('/').filter(Boolean)))) {
          if (this.closed) return;
          if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
          const name = relative ? relative + '/' + entry.name : entry.name;
          if (entry.isDirectory()) { await walk(name); continue; }
          if (!entry.isFile() || !candidate(name)) continue;
          const file = path.join(this.store.recordsRoot, ...name.split('/'));
          await this.breathe();
          try { const text = this.readText(file); if (text === null) continue; const record = decode(text, file); record._hash = hash(encode(record)); records.set(record.type + '/' + record.id, record); }
          catch (error) { if (error.code === 'NOT_RECORD') pages.push(path.relative(this.store.root, file).split(path.sep).join('/')); /* Invalid records are excluded just as in Store.scan. */ }
        }
      };
      await walk('');
      if (this.closed) return [];
      for (const r of records.values()) { const d = documentOf(r); if (d) documents.push(d); }
    }
    const visit = async relative => {
      if (this.closed) return;
      const absolute = path.join(this.store.root, relative); let stat;
      try { stat = await io.lstat(absolute); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
      if (stat.isSymbolicLink()) return;
      if (stat.isDirectory()) { for (const entry of await entries(absolute)) if (shared(relative + '/' + entry.name)) await visit(relative + '/' + entry.name); }
      else if (stat.size <= 512 * 1024 && /\.(md|json|jsonl|txt)$/.test(relative)) {
        await this.breathe();
        const text = this.readText(absolute);
        if (text !== null) documents.push(this.fileDocument(relative, text));
      }
    };
    for (const name of [...durableRoots.filter(r => r !== recordsFolder), ...durableFiles]) await visit(name);
    for (const name of pages) await visit(name);
    return documents;
  }
  // Ranked word search. Every word must appear; a word may be the start of
  // a longer one. When that finds little, words are also looked for inside
  // longer words, and failing all of that, any of the words will do.
  search(query, { limit = 200, types = null } = {}) {
    // Common words go, unless the query is nothing but common words.
    const all = queryTerms(query), meaningful = all.filter(t => t.length > 1 || !STOPWORDS.has(t[0].toLowerCase()));
    const terms = meaningful.length ? meaningful : all, words = terms.flat();
    if (!words.length) return [];
    const typeFilter = types?.length ? ' AND d.type IN (' + types.map(() => '?').join(',') + ')' : '', typeArgs = types?.length ? types : [];
    const run = match => this.db.prepare(`SELECT d.uid, d.type, d.id, d.title, snippet(docs_fts, 1, '[', ']', '…', 14) AS snippet, bm25(docs_fts, 4.0, 1.0) AS rank
      FROM docs_fts JOIN docs d ON d.rowid = docs_fts.rowid WHERE docs_fts MATCH ?${typeFilter} ORDER BY rank LIMIT ?`).all(match, ...typeArgs, limit);
    const quote = w => '"' + w.replaceAll('"', '""') + '"';
    const quoted = terms.map(t => t.length === 1 ? quote(t[0]) + '*' : quote(t.join(' ')));
    let rows = run(quoted.join(' AND '));
    if (rows.length < Math.min(limit, 20) && terms.every(t => t.length === 1) && words.every(w => w.length >= 3)) {
      // Inside longer words (German compounds): slower, so only when needed.
      const seen = new Set(rows.map(r => r.uid)), like = words.map(() => "(docs_fts.title || ' ' || docs_fts.body) LIKE ? ESCAPE '\\'").join(' AND ');
      const extra = this.db.prepare(`SELECT d.uid, d.type, d.id, d.title, NULL AS snippet, 0 AS rank FROM docs_fts JOIN docs d ON d.rowid = docs_fts.rowid WHERE ${like}${typeFilter} LIMIT ?`)
        .all(...words.map(w => '%' + w.replace(/[\\%_]/g, '\\$&') + '%'), ...typeArgs, limit);
      rows = [...rows, ...extra.filter(r => !seen.has(r.uid))].slice(0, limit);
    }
    let loose = false;
    if (!rows.length && terms.length > 1) { rows = run(quoted.join(' OR ')); loose = true; }
    return rows.map(({ uid, type, id, title, snippet, rank }) => ({ uid, type, id, title, ...(snippet ? { snippet } : {}), rank, ...(loose ? { loose: true } : {}) }));
  }
  // Any of these words, best matches first: how a note's related notes are
  // found (related.mjs). Each word is quoted, so none is read as syntax.
  searchAny(words, { types = null, limit = 20 } = {}) {
    const terms = words.flatMap(w => queryWords(w)).slice(0, 24);
    if (!terms.length) return [];
    const typeFilter = types?.length ? ' AND d.type IN (' + types.map(() => '?').join(',') + ')' : '';
    return this.db.prepare(`SELECT d.uid, d.type, d.id, d.title, snippet(docs_fts, 1, '[', ']', '…', 14) AS snippet, bm25(docs_fts, 4.0, 1.0) AS rank
      FROM docs_fts JOIN docs d ON d.rowid = docs_fts.rowid WHERE docs_fts MATCH ?${typeFilter} ORDER BY rank LIMIT ?`).all(terms.map(t => '"' + t.replaceAll('"', '""') + '"').join(' OR '), ...(types?.length ? types : []), limit);
  }
  // Words and, when a meaning service is connected (this.meaning, meaning.mjs),
  // meaning: one ranked list. Says which it used.
  async searchHybrid(query, { limit = 50, types = null } = {}) {
    const words = this.search(query, { limit: Math.max(limit, 100), types });
    if (!this.meaning?.ready) return { rows: words.slice(0, limit), mode: 'words', note: 'Searching by words only: no meaning service is connected.' };
    let meanings = [];
    try { meanings = await this.meaning.search(query, { limit: Math.max(limit, 100), types }); }
    catch (error) { return { rows: words.slice(0, limit), mode: 'words', note: 'Meaning search is unavailable right now (' + error.message + '); these are word matches.' }; }
    const known = new Map(words.map(r => [r.uid, r])), missing = meanings.filter(m => !known.has(m.uid)).map(m => m.uid);
    if (missing.length) {
      const rows = this.db.prepare(`SELECT uid, type, id, title FROM docs WHERE uid IN (${missing.map(() => '?').join(',')})`).all(...missing);
      for (const r of rows) known.set(r.uid, { uid: r.uid, type: r.type, id: r.id, title: r.title });
    }
    const rows = mergeRanked(words, meanings.filter(m => known.has(m.uid)).map(m => ({ ...known.get(m.uid), similarity: m.similarity })), { limit });
    return { rows, mode: 'words and meaning' };
  }
  // A passage read out of a note's PDF (note_chunks) is found as its note: the
  // hit becomes the note, once, at the passage's place in the list.
  passagesAsNotes(rows) {
    const out = [], seen = new Set();
    for (const r of rows) {
      let row = r;
      if (r.type === 'note_chunks') {
        const noteId = this.store.get('note_chunks', r.id)?.note_id, note = noteId && this.store.get('notes', noteId);
        if (!note) continue;
        row = { ...r, uid: note.uid, type: 'notes', id: note.id, title: note.title || note.id, via: 'passage' };
      }
      if (!seen.has(row.uid)) { seen.add(row.uid); out.push(row); }
    }
    return out;
  }
  close() { this.closed = true; this.db.close(); }
}
