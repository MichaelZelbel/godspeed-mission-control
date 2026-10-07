import fs from 'node:fs';
import path from 'node:path';
import {hash} from '../records/store.mjs';
import {QueryService} from '../query.mjs';
import {visibleRows} from '../visibility.mjs';

// Search by meaning, as an optional plug. Any service that answers the
// OpenAI-style POST <address>/embeddings works: OpenRouter, OpenAI, a local
// Ollama, any cloud service. The model never runs inside the notebook. The
// vectors are a derived part of the search index (search.sqlite), rebuilt from
// the notes whenever the model changes, so they never hold anything the
// notebook does not. Without a connection, search stays word-only and says so.

// What is embedded: the things a person asks about.
export const MEANING_TYPES = new Set(['notes', 'contacts', 'moments', 'entities', 'claims', 'collection_items', 'wiki_pages', 'media_analysis', 'note_chunks', 'contact_topics']);
const CHUNK = 1500, OVERLAP = 200, MAX_CHUNKS = 40, BATCH = 64;

export function embeddingConfig(state) {
  const file = path.join(state, 'embeddings.json');
  let saved = null; try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  const env = process.env.GODSPEED_EMBEDDINGS_URL ? {url: process.env.GODSPEED_EMBEDDINGS_URL, key: process.env.GODSPEED_EMBEDDINGS_KEY || '', model: process.env.GODSPEED_EMBEDDINGS_MODEL, dimensions: Number(process.env.GODSPEED_EMBEDDINGS_DIMENSIONS) || null} : null;
  const config = saved || env;
  return config?.url && config?.model ? config : null;
}
export function saveEmbeddingConfig(state, config) {
  const file = path.join(state, 'embeddings.json');
  if (!config) { fs.rmSync(file, {force: true}); return; }
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(config), {mode: 0o600}); fs.renameSync(tmp, file);
  try { fs.chmodSync(file, 0o600); } catch {}
}
// The address of the embeddings endpoint, whether the owner gave the base
// ("https://openrouter.ai/api/v1") or the full path.
export function embeddingsUrl(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:' && !['127.0.0.1', 'localhost', '::1'].includes(u.hostname) && !/^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(u.hostname) && !u.hostname.endsWith('.internal')) throw new Error('Use an https address, or a service on this computer or network');
  return u.pathname.replace(/\/+$/, '').endsWith('/embeddings') ? u.href : u.href.replace(/\/+$/, '') + '/embeddings';
}
// One call to the service: a list of texts in, a list of unit-length vectors out.
export function embedder(config, {fetchImpl = fetch} = {}) {
  const url = embeddingsUrl(config.url);
  return async (texts, {signal} = {}) => {
    const response = await fetchImpl(url, {method: 'POST', headers: {'Content-Type': 'application/json', ...(config.key ? {Authorization: 'Bearer ' + config.key} : {})},
      body: JSON.stringify({model: config.model, input: texts, ...(config.dimensions ? {dimensions: config.dimensions} : {})}), signal: signal || AbortSignal.timeout(60000)});
    if (!response.ok) { let reason = ''; try { const body = await response.json(); reason = String(body?.error?.message || body?.message || '').slice(0, 200); } catch {} throw Object.assign(new Error('The embeddings service answered ' + response.status + (reason ? ': ' + reason : '')), {upstreamStatus: response.status}); }
    const body = await response.json(), data = Array.isArray(body?.data) ? [...body.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)) : null;
    if (!data || data.length !== texts.length || data.some(d => !Array.isArray(d.embedding) || !d.embedding.length)) throw new Error('The embeddings service gave no vector for every text');
    return {vectors: data.map(d => unit(Float32Array.from(d.embedding))), tokens: body.usage?.total_tokens || body.usage?.prompt_tokens || null};
  };
}
function unit(v) { let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; for (let i = 0; i < v.length; i++) v[i] /= n; return v; }

// A document's text as passages: about 1,500 characters each, overlapping a
// little, cut at paragraph or sentence ends where there is one.
export function passages(title, body) {
  const text = String(body || '').replace(/\r\n?/g, '\n').trim(), head = String(title || '').trim();
  if (!text) return head ? [head] : [];
  const out = [];
  for (let start = 0; start < text.length && out.length < MAX_CHUNKS;) {
    let end = Math.min(text.length, start + CHUNK);
    if (end < text.length) { const cut = Math.max(text.lastIndexOf('\n\n', end), text.lastIndexOf('. ', end)); if (cut > start + CHUNK / 2) end = cut + 1; }
    out.push((head ? head + '\n' : '') + text.slice(start, end).trim());
    if (end >= text.length) break;
    start = Math.max(end - OVERLAP, start + 1);
  }
  return out;
}

// The space a vector lives in: the model, the size it was asked for and the
// service that made it. Vectors of one space cannot be compared with another's.
// Until 6 October 2026 the model's name alone stood for all three, so the same
// model at another size kept every old vector (see MeaningIndex).
export function vectorSpace(config){
  if(!config)return null;let url=config.url;try{url=embeddingsUrl(config.url);}catch{}
  return [config.model,config.dimensions||'',url].join(' | ');
}
// The vectors, in the search index's own SQLite file. Small on purpose: one
// place to swap the store if another is ever wanted (none is built now).
// The model column holds the vector space (vectorSpace).
export class VectorStore {
  constructor(db) {
    this.db = db;
    // vectors_digests answers digests() from the index alone: without it every
    // round walked every stored vector, 34,000 rows of 6 KB on Michael's
    // laptop, to read 9,000 digests (7 October 2026).
    db.exec(`CREATE TABLE IF NOT EXISTS vectors (uid TEXT NOT NULL, chunk INTEGER NOT NULL, model TEXT NOT NULL, digest TEXT NOT NULL, vec BLOB NOT NULL, PRIMARY KEY (uid, chunk));
      CREATE INDEX IF NOT EXISTS vectors_model ON vectors(model);
      CREATE INDEX IF NOT EXISTS vectors_digests ON vectors(model, uid, digest) WHERE chunk=0;`);
    this.cache = null;
  }
  // uid -> digest the stored vectors were made from, for one model.
  digests(model) { return new Map(this.db.prepare('SELECT uid, digest FROM vectors WHERE model=? AND chunk=0').all(model).map(r => [r.uid, r.digest])); }
  // How many numbers each stored vector of the space has (0 when none is stored).
  size(model) { const row = this.db.prepare('SELECT length(vec) AS bytes FROM vectors WHERE model=? LIMIT 1').get(model); return row ? row.bytes / 4 : 0; }
  clear(model) { if (this.db.prepare('DELETE FROM vectors WHERE model=?').run(model).changes) this.cache = null; }
  put(uid, digest, model, vectors) {
    const size = this.size(model);
    if (vectors.some(v => v.length !== (size || vectors[0].length))) throw new Error('Vectors of different sizes cannot be kept together');
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM vectors WHERE uid=?').run(uid);
      const insert = this.db.prepare('INSERT INTO vectors VALUES(?,?,?,?,?)');
      vectors.forEach((v, i) => insert.run(uid, i, model, digest, Buffer.from(v.buffer, v.byteOffset, v.byteLength)));
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    this.cache = null;
  }
  remove(uids) { if (!uids.length) return; const del = this.db.prepare('DELETE FROM vectors WHERE uid=?'); this.db.exec('BEGIN'); try { for (const uid of uids) del.run(uid); this.db.exec('COMMIT'); } catch (e) { this.db.exec('ROLLBACK'); throw e; } this.cache = null; }
  dropOtherModels(model) { const n = this.db.prepare('DELETE FROM vectors WHERE model<>?').run(model).changes; if (n) this.cache = null; return n; }
  count(model) { return this.db.prepare('SELECT COUNT(DISTINCT uid) n, COUNT(*) c FROM vectors WHERE model=?').get(model); }
  // Every vector of the model in one block of memory, read once and kept
  // until something changes: a scan of 30,000 is a fraction of a second.
  load(model) {
    if (this.cache?.model === model) return this.cache;
    // Only vectors of one size go into the block: a stray one of another size
    // made it fail with "Invalid typed array length".
    const all = this.db.prepare('SELECT uid, vec FROM vectors WHERE model=?').all(model), dim = all[0] ? all[0].vec.byteLength / 4 : 0, rows = all.filter(r => r.vec.byteLength === dim * 4);
    const matrix = new Float32Array(rows.length * dim), uids = new Array(rows.length);
    rows.forEach((r, i) => { matrix.set(new Float32Array(r.vec.buffer, r.vec.byteOffset, dim), i * dim); uids[i] = r.uid; });
    return this.cache = {model, dim, matrix, uids};
  }
  // The documents whose passages are nearest to the query, best passage per document.
  search(model, query, {limit = 50, uids = null} = {}) {
    const {dim, matrix, uids: owners} = this.load(model);
    if (!dim || query.length !== dim) return [];
    const best = new Map();
    for (let i = 0; i < owners.length; i++) {
      if (uids && !uids.has(owners[i])) continue;
      let s = 0; const o = i * dim; for (let d = 0; d < dim; d++) s += matrix[o + d] * query[d];
      if (!(best.get(owners[i]) >= s)) best.set(owners[i], s);
    }
    return [...best].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([uid, similarity]) => ({uid, similarity}));
  }
}

// Keeps the vectors level with the notebook, in the background, a batch at a
// time. Started by the server when a service is connected; a failure is
// remembered and shown, and retried later, never thrown at a reader.
export class MeaningIndex {
  constructor(index, {config, embed = config ? embedder(config) : null} = {}) {
    this.index = index; this.config = config; this.embed = embed; this.vectors = new VectorStore(index.db); this.space = vectorSpace(config);
    this.status = {configured: !!config, model: config?.model || null, dimensions: config?.dimensions || null, indexed: 0, pending: 0, last_error: null, last_run: null};
    // Another model, size or service: what was embedded before cannot be compared, and is made again.
    if (config) this.vectors.dropOtherModels(this.space);
    this.queryCache = new Map(); this.empty = new Set();
  }
  get ready() { return !!this.embed; }
  // The records whose text may go to the embeddings service: what may reach
  // a model (visibleRows), worked out again only when the notebook changed.
  // Until 7 October 2026 every record the word index holds was sent, notes
  // hidden from assistants, sensitive ones and private facts included. Word
  // search, which stays on this machine, still holds them all.
  shared() {
    const store = this.index.store; store.scan();
    if (this.sharedFor === store.records) return this.sharedUids;
    const query = new QueryService(store), uids = query.withSnapshot(() => new Set([...MEANING_TYPES].flatMap(type => visibleRows(query, type).map(r => r.uid))));
    this.sharedFor = store.records; this.sharedUids = uids; return uids;
  }
  // Documents the index holds that meaning search covers, without their text:
  // text(doc) reads one when it is embedded. Until 7 October 2026 every round
  // read every text (65 million characters for 9,000 documents on Michael's
  // laptop, over a second) to learn which few had changed, twice a round,
  // every 20 seconds, on the thread that answers the browser; on a busy
  // machine the dashboard waited 50 seconds for a page.
  documents() {
    // Mission Control's own files too, never the verbatim prompt archive or the assistant's state.
    const shared = this.shared();
    return this.index.db.prepare(`SELECT d.rowid, d.uid, d.type, d.digest FROM docs d WHERE d.type IN (${[...MEANING_TYPES].map(() => '?').join(',')}) OR (d.type='workspace_file' AND d.id NOT LIKE 'prompts/%' AND d.id NOT LIKE 'assistant-state/%')`).all(...MEANING_TYPES).filter(d => d.type === 'workspace_file' || shared.has(d.uid));
  }
  text(doc) { return this.index.db.prepare('SELECT title, body FROM docs_fts WHERE rowid=?').get(doc.rowid) || {}; }
  pending() {
    const have = this.vectors.digests(this.space), docs = this.documents();
    const live = new Set(docs.map(d => d.uid)), stale = [...have.keys()].filter(uid => !live.has(uid));
    return {todo: docs.filter(d => have.get(d.uid) !== d.digest && !this.empty.has(d.uid + '\0' + d.digest)), stale, total: docs.length};
  }
  // One round: remove vectors of documents gone, embed up to `budget` passages.
  async step({budget = 512, signal} = {}) {
    if (!this.embed || this.running) return 0;
    this.running = true;
    try {
      const {todo, stale, total} = this.pending();
      this.vectors.remove(stale);
      let used = 0, done = 0;
      for (let i = 0; i < todo.length && used < budget;) {
        const batch = [], owners = [];
        for (; i < todo.length && batch.length < BATCH && used < budget; i++) {
          const {title, body} = this.text(todo[i]), parts = passages(title, body);
          if (!parts.length) { this.empty.add(todo[i].uid + '\0' + todo[i].digest); continue; }
          owners.push({doc: todo[i], from: batch.length, count: parts.length}); batch.push(...parts); used += parts.length;
        }
        if (!batch.length) continue;
        const {vectors} = await this.embed(batch, {signal});
        this.checkSize(vectors);
        for (const o of owners) { this.vectors.put(o.doc.uid, o.doc.digest, this.space, vectors.slice(o.from, o.from + o.count)); done++; }
      }
      const left = this.pending();
      Object.assign(this.status, {indexed: left.total - left.todo.length, pending: left.todo.length, last_error: null, last_run: new Date().toISOString()});
      return done;
    } catch (error) {
      Object.assign(this.status, {last_error: error.message, last_run: new Date().toISOString()});
      throw error;
    } finally { this.running = false; }
  }
  // A service that answers at another size than asked is refused; one whose
  // size changed although none was asked has its old vectors made again.
  checkSize(vectors) {
    const asked = this.config.dimensions, stored = this.vectors.size(this.space), wrong = vectors.find(v => v.length !== (asked || stored || vectors[0].length));
    if (!wrong) return;
    if (asked) throw new Error('The embeddings service answered with ' + wrong.length + ' numbers per text; the setting asks for ' + asked + '. Change the setting or the service.');
    this.vectors.clear(this.space); this.empty.clear(); this.queryCache.clear();
    throw new Error('The embeddings service changed the size of its answers; meaning search is being built again');
  }
  async queryVector(text) {
    const key = hash(this.space + '\0' + text);
    if (this.queryCache.has(key)) return this.queryCache.get(key);
    const {vectors} = await this.embed([text]);
    if (this.queryCache.size > 200) this.queryCache.delete(this.queryCache.keys().next().value);
    this.queryCache.set(key, vectors[0]);
    return vectors[0];
  }
  async search(text, {limit = 50, types = null} = {}) {
    if (!this.embed || !String(text || '').trim()) return [];
    const vector = await this.queryVector(String(text).slice(0, 2000));
    this.checkSize([vector]);
    const allowed = types?.length ? new Set(this.index.db.prepare(`SELECT uid FROM docs WHERE type IN (${types.map(() => '?').join(',')})`).all(...types).map(r => r.uid)) : null;
    return this.vectors.search(this.space, vector, {limit, uids: allowed});
  }
}

// Word and meaning results as one list: reciprocal rank fusion, so a note
// near the top of either list rises, and one on both rises most.
export function mergeRanked(words, meanings, {limit = 50} = {}) {
  // Close meaning matches take turns with the word matches: word, meaning, word, meaning.
  // A score that adds both lists up let every document holding one of the words outrank the
  // best match by meaning, so "knee doctor" put "Orthopäde Termin" twelfth (6 October 2026).
  // A meaning match is close when it is near the best one; the rest follow the word matches.
  // When no document held every word (loose matches), meaning goes first.
  const top = meanings[0]?.similarity ?? 0, floor = Math.max(0.3, top * 0.8);
  const close = meanings.filter(m => (m.similarity ?? 0) >= floor), weak = meanings.filter(m => (m.similarity ?? 0) < floor);
  const out = [], seen = new Map();
  const add = (r, how) => {
    const old = seen.get(r.uid);
    if (old) { if (old.matched !== how) old.matched = 'words and meaning'; if (r.similarity !== undefined) old.similarity = r.similarity; return; }
    const row = {...r, matched: how}; seen.set(r.uid, row); out.push(row);
  };
  const wordsFirst = words.length > 0 && !words[0].loose;
  for (let i = 0; i < Math.max(words.length, close.length); i++) {
    const pair = wordsFirst ? [[words[i], 'words'], [close[i], 'meaning']] : [[close[i], 'meaning'], [words[i], 'words']];
    for (const [r, how] of pair) if (r) add(r, how);
  }
  for (const r of weak) add(r, 'meaning');
  // Every word match is also listed under meaning when the meaning list holds it.
  for (const r of meanings) if (seen.has(r.uid)) { const row = seen.get(r.uid); if (row.matched === 'words') { row.matched = 'words and meaning'; row.similarity = r.similarity; } }
  return out.slice(0, limit);
}
