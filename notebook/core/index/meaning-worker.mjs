import {parentPort, workerData} from 'node:worker_threads';
import {DatabaseSync} from 'node:sqlite';

// This connection never writes. Loading and comparing the large vector set
// belongs to this thread, so even its first disk read cannot stop the browser.
const db = new DatabaseSync(workerData.file, {readOnly: true});
db.exec('PRAGMA busy_timeout=5000');
let model = null, documents = new Map(), loads = 0;
function vectorsOf(rows) {
  return rows.map(row => {
    const bytes = row.vec;
    // SQLite's buffer need not start on a float boundary. Copy only this
    // passage, never retain a second copy of the entire result set.
    const copy = new Uint8Array(bytes.byteLength); copy.set(bytes);
    return new Float32Array(copy.buffer);
  });
}
function load(space) {
  if (model === space) return;
  const next = new Map();
  for (const row of db.prepare('SELECT uid, vec FROM vectors WHERE model=? ORDER BY uid, chunk').iterate(space)) {
    const vector = vectorsOf([row])[0], current = next.get(row.uid);
    if (current) current.push(vector); else next.set(row.uid, [vector]);
  }
  documents = next; model = space; loads++;
}
function search({space, vector, limit, allowed}) {
  load(space);
  const permitted = allowed ? new Set(allowed) : null, best = [];
  for (const [uid, passages] of documents) {
    if (permitted && !permitted.has(uid)) continue;
    let score = -Infinity;
    for (const passage of passages) {
      if (passage.length !== vector.length) continue;
      let value = 0; for (let i = 0; i < vector.length; i++) value += passage[i] * vector[i];
      if (value > score) score = value;
    }
    if (score !== -Infinity) best.push({uid, similarity: score});
  }
  return best.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
}
function insideWords({words, types, limit}) {
  const filter = types?.length ? ' AND d.type IN (' + types.map(() => '?').join(',') + ')' : '';
  const like = words.map(() => "(docs_fts.title || ' ' || docs_fts.body) LIKE ? ESCAPE '\\'").join(' AND ');
  return db.prepare(`SELECT d.uid, d.type, d.id, d.title, 0 AS rank FROM docs_fts JOIN docs d ON d.rowid=docs_fts.rowid WHERE ${like}${filter} LIMIT ?`)
    .all(...words.map(word => '%' + word.replace(/[\\%_]/g, '\\$&') + '%'), ...(types || []), limit);
}
parentPort.on('message', message => {
  const {id, kind} = message;
  try {
    let value;
    if (kind === 'search') value = search(message);
    else if (kind === 'warm') {load(message.space); value = {documents: documents.size};}
    else if (kind === 'inside') value = insideWords(message);
    // Changes arrive after the database commit. Messages are ordered with
    // searches, including changes made while the first load was in progress.
    else if (kind === 'put' && model === message.space) documents.set(message.uid, message.vectors);
    else if (kind === 'remove') for (const uid of message.uids) documents.delete(uid);
    else if (kind === 'clear' && model === message.space || kind === 'keep' && model !== message.space) {model = null; documents = new Map();}
    else if (kind === 'stats') value = {loads, documents: documents.size, model};
    if (id) parentPort.postMessage({id, value});
  } catch (error) { if (id) parentPort.postMessage({id, error: error.message}); }
});
