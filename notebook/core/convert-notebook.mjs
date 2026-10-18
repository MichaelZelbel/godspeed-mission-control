// Converts an existing workspace to the readable layout (layout.mjs) in place.
//
// Before 2026-10-05 every note was notes/<id>.md with JSON on top, and every
// other record <type>/<id>.json. The store reads both, and writes a record in
// the readable layout whenever it saves it, so a workspace works unconverted;
// this turns all of it at once, so the folder reads as a notebook.
//
// It changes where a file is and how its frontmatter is written, never what a
// record holds: no revision, no new history, no reference rewritten. It runs
// under the workspace lock, refuses a workspace with validation problems,
// copies notebook/ aside first, writes through the store's recoverable
// transactions, then checks that every record is still there, unchanged and
// where it belongs. Run twice, the second run changes nothing.
import fs from 'node:fs';
import path from 'node:path';
import { atomic, hash } from './records/store.mjs';
import { systemFolder } from './records/layout.mjs';

const GROUP = 500;
// A folder of the old layout: named like a record type, directly in
// notebook/, holding nothing but record files of that type.
function legacyFolders(store) {
  const records = new Set(store.fileOf.values());
  return fs.readdirSync(store.recordsRoot, { withFileTypes: true }).filter(entry => entry.isDirectory() && entry.name !== systemFolder && /^[a-z][a-z0-9_]*$/.test(entry.name)).map(entry => entry.name).filter(name => {
    const entries = fs.readdirSync(path.join(store.recordsRoot, name), { withFileTypes: true });
    return entries.length && entries.every(e => e.isFile() && records.has(path.join(store.recordsRoot, name, e.name)) && store.records.get(name + '/' + e.name.replace(/\.(json|md)$/, '')));
  });
}
const filesUnder = root => {
  const out = [], walk = dir => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, entry.name); if (entry.isDirectory()) walk(file); else if (entry.isFile()) out.push(file); } };
  if (fs.existsSync(root)) walk(root);
  return out;
};
// What the store compares to tell an unchanged record: the hash of the record
// as it writes it today, whatever the file it was read from looked like.
const fingerprint = store => new Map([...store.records.values()].map(r => [r.uid, r._hash]));

export function convertNotebook(store, { dryRun = false, now = new Date() } = {}) {
  return store.withLock(() => store.snapshot(() => {
    if (store.problems.length) return { converted: false, dryRun, reason: 'The notebook has validation problems; nothing was changed. Run validate and fix them first.', problems: store.problems };
    const changes = store.layoutChanges();
    const renamed = changes.filter(c => c.from !== c.to).map(({ type, id, from, to }) => ({ type, id, from, to }));
    const rewritten = changes.filter(c => c.from === c.to).map(({ type, id, from }) => ({ type, id, path: from }));
    const byType = changes.reduce((counts, c) => ({ ...counts, [c.type]: (counts[c.type] || 0) + 1 }), {});
    const report = { workspace: store.root, records: store.records.size, unchanged: store.records.size - changes.length, changed: changes.length, byType, renamed, rewritten };
    if (dryRun || !changes.length) return { converted: false, dryRun, ...report };

    // A copy of notebook/ as it was, checked byte for byte, before any change.
    const backup = path.join(store.state, 'backups', 'notebook-before-readable-files-' + now.toISOString().replace(/[:.]/g, '-'));
    if (fs.existsSync(backup)) throw new Error('A backup for this moment already exists: ' + backup);
    fs.cpSync(store.recordsRoot, path.join(backup, path.basename(store.recordsRoot)), { recursive: true, preserveTimestamps: true });
    const copied = filesUnder(store.recordsRoot).map(file => {
      const relative = path.relative(store.root, file), digest = hash(fs.readFileSync(file)), copy = path.join(backup, relative);
      if (!fs.existsSync(copy) || hash(fs.readFileSync(copy)) !== digest) throw new Error('The backup copy of ' + relative + ' does not match; nothing was converted');
      return { file: relative.split(path.sep).join('/'), sha256: digest };
    });
    atomic(path.join(backup, 'backup.json'), JSON.stringify({ format: 1, kind: 'notebook-before-readable-files', at: now.toISOString(), files: copied }, null, 2));

    // The old one-folder-per-type folders (contacts/, collections/, ...) go
    // into the system folder first, whole. A file system that ignores case
    // would otherwise write Collections/Books.md into the old collections/.
    // A system record is then already where it belongs; the others move on
    // from there to the targets planned above.
    for (const folder of legacyFolders(store)) {
      const from = path.join(store.recordsRoot, folder), to = path.join(store.recordsRoot, systemFolder, folder);
      if (!fs.existsSync(to)) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.renameSync(from, to); continue; }
      for (const name of fs.readdirSync(from)) { if (fs.existsSync(path.join(to, name))) throw new Error('Two files for one record: ' + path.join(folder, name) + '; nothing further was converted'); fs.renameSync(path.join(from, name), path.join(to, name)); }
      fs.rmdirSync(from);
    }
    store.scan(true);
    const before = fingerprint(store), targets = new Map(changes.map(c => [c.type + '/' + c.id, c.to]));
    for (let i = 0; i < changes.length; i += GROUP) {
      const group = changes.slice(i, i + GROUP).map(c => c.record);
      store.commit(group, { paths: new Map(group.map(r => [r.type + '/' + r.id, targets.get(r.type + '/' + r.id)])) });
    }

    // Every record is still there, holds what it held, and is where it belongs.
    store.scan(true);
    const after = fingerprint(store), left = store.layoutChanges();
    const lost = [...before.keys()].filter(uid => !after.has(uid)), altered = [...before].filter(([uid, digest]) => after.has(uid) && after.get(uid) !== digest).map(([uid]) => uid);
    if (store.problems.length || lost.length || altered.length || after.size !== before.size || left.length)
      throw new Error('The conversion did not verify (problems ' + store.problems.length + ', missing ' + lost.length + ', altered ' + altered.length + ', still misplaced ' + left.length + '). notebook/ as it was is in ' + backup);
    const result = { converted: true, dryRun: false, backup, ...report };
    atomic(path.join(backup, 'conversion-report.json'), JSON.stringify(result, null, 2));
    return result;
  }));
}
