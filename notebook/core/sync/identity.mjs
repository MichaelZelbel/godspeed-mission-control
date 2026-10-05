// Merging two machines' notebooks by record, not by file name.
//
// A record's file is named after its title, so a rename moves the file. Git,
// told never to guess renames from content, sees a moved note as one file
// deleted and another added. On its own that turns "renamed on one machine,
// edited on the other" into a deleted file whose edit survives only as a
// conflict, plus a second copy of the note; and two notes created offline with
// the same title into one file both machines wrote. This pass finds every
// record by the uid in its frontmatter on the merge base and both sides and
// decides, per record, what the merged notebook holds:
//
// - changed on one side only: that side's version, where that side put it;
// - moved on either side and changed on both: one record, merged field by
//   field (a text field line by line); when both changed the same field
//   differently, this machine's version stays and all three are kept for
//   review, as for any concurrent edit;
// - two records wanting one file name (the same title created offline, or a
//   rename into a name the other side used): both stay, the one already there
//   on this machine keeps the name and the other gets " 2", " 3".
//
// The same record changed on both sides without moving is left to the line
// merge the reconciler already does for every file.
import { recordsFolder } from '../file-policy.mjs';
import { decode, encode, hash } from '../records/store.mjs';
import path from 'node:path';
import { candidate, folderFor, nameFor, candidateName, isReadable, childrenOf, key as nameKey } from '../records/layout.mjs';

const prefix = recordsFolder + '/';
const inNotebook = name => name.startsWith(prefix) && !name.includes('\n') && candidate(name.slice(prefix.length));
// Sorted keys, so two equal values compare equal whatever order they were read in.
const canonical = value => JSON.stringify(value, (k, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(key => [key, v[key]])) : v);
const same = (a, b) => canonical(a) === canonical(b);
const parentedTypes = new Set([...childrenOf.values()].flat().map(child => child.type));
const parented = record => isReadable(record) && parentedTypes.has(record.type);

// Field-by-field three-way merge of one record. `mergeText(base, local,
// remote)` merges a text field line by line and returns null when it cannot.
export function mergeRecords(base, local, remote, mergeText) {
  const strip = r => { if (!r) return null; const { _hash, ...value } = r; return value; };
  const b = strip(base), l = strip(local), r = strip(remote), out = {}, conflicts = [];
  for (const field of new Set([...Object.keys(l), ...Object.keys(r), ...Object.keys(b || {})])) {
    const bv = b?.[field], lv = l[field], rv = r[field];
    let value;
    if (same(lv, rv)) value = lv;
    else if (b && same(lv, bv)) value = rv;
    else if (b && same(rv, bv)) value = lv;
    // Both sides saved: the later time and the higher revision describe the result.
    else if (field === 'updated_at') value = [lv, rv].filter(v => typeof v === 'string').sort().at(-1);
    else if (field === 'revision') value = Math.max(Number(lv) || 0, Number(rv) || 0);
    else if (field === 'device') value = lv;
    else if (typeof lv === 'string' && typeof rv === 'string' && typeof bv === 'string') {
      value = mergeText(bv, lv, rv);
      if (value === null) conflicts.push(field);
    } else conflicts.push(field);
    if (value !== undefined && !conflicts.includes(field)) out[field] = value;
  }
  return conflicts.length ? { conflicts } : { record: out };
}

// The contents of many `commit:path` blobs in one git call per 2000, in
// order; null for one that does not exist.
export function readBlobs(git, specs) {
  const out = [];
  for (let i = 0; i < specs.length; i += 2000) {
    const chunk = specs.slice(i, i + 2000), bytes = git(['cat-file', '--batch'], { input: chunk.join('\n') + '\n' });
    let at = 0;
    for (let j = 0; j < chunk.length; j++) {
      const end = bytes.indexOf(10, at), header = bytes.subarray(at, end).toString('utf8');
      if (/ missing$/.test(header)) { out.push(null); at = end + 1; continue; }
      const size = Number(header.split(' ')[2]);
      out.push(bytes.subarray(end + 1, end + 1 + size)); at = end + 1 + size + 1;
    }
  }
  return out;
}
// What identifies a file across a move: the uid of the record it holds, or
// for any other file its exact content.
export function identities(git, commit, files) {
  return readBlobs(git, files.filter(file => !file.includes('\n')).map(file => commit + ':' + file)).map((bytes, i) => {
    if (!bytes) return null;
    try { return 'uid:' + decode(bytes.toString('utf8'), files[i]).uid; } catch { return 'text:' + hash(bytes); }
  }).filter(Boolean);
}

// `git` runs a git command and returns its output as a Buffer; it accepts
// { input } for standard input. `mergeText` as for mergeRecords. `find(type,
// id)` reads a record of this machine, for a type placed under its parent.
export function identityPlan({ git, mergeText, find = () => undefined, base, local, remote, remoteCommit = remote }) {
  const changes = (from, to) => {
    const parts = git(['diff', '--name-status', '--no-renames', '-z', from, to, '--', recordsFolder]).toString('utf8').split('\0'), map = new Map();
    for (let i = 0; i + 1 < parts.length && parts[i]; i += 2) if (inNotebook(parts[i + 1])) map.set(parts[i + 1], parts[i][0]);
    return map;
  };
  const L = changes(base, local), R = changes(base, remote);
  if (!L.size || !R.size) return null;
  const sides = { base, local, remote }, versions = new Map();
  // Reads `side:path` for many paths at once, decoded.
  const read = list => {
    const wanted = [...new Map(list.map(([side, file]) => [side + ':' + file, [side, file]])).values()].filter(([side, file]) => !versions.has(side + ':' + file));
    readBlobs(git, wanted.map(([side, file]) => sides[side] + ':' + file)).forEach((bytes, i) => {
      const [side, file] = wanted[i];
      if (!bytes) return versions.set(side + ':' + file, null);
      const text = bytes.toString('utf8');
      let version;
      try { const record = decode(text, file); version = { side, file, text, record, uid: record.uid }; }
      catch { version = { side, file, text, document: true }; }
      versions.set(side + ':' + file, version);
    });
  };
  // Every path the smaller side touched, on all three trees.
  const [small, large] = L.size <= R.size ? [L, R] : [R, L], largeSide = large === L ? 'local' : 'remote';
  read([...small.keys()].flatMap(file => ['base', 'local', 'remote'].map(side => [side, file])));
  const uids = new Set([...versions.values()].filter(v => v?.uid).map(v => v.uid));
  // Of the larger side, only what concerns those records or those names: the
  // same paths in another letter case, and files that mention one of the uids.
  const smallKeys = new Set([...small.keys()].map(nameKey)), extra = [...large.keys()].filter(file => smallKeys.has(nameKey(file)));
  if (uids.size) {
    const patterns = [...uids].join('\n') + '\n';
    for (const [side, kinds] of [[largeSide, 'AMT'], ['base', 'DMT']]) {
      let found = '';
      try { found = git(['grep', '-l', '-F', '-z', '--no-color', '-f', '-', sides[side], '--', recordsFolder], { input: patterns }).toString('utf8'); }
      catch (error) { if (error.status !== 1) throw error; }
      for (const entry of found.split('\0').filter(Boolean)) {
        const file = entry.slice(entry.indexOf(':') + 1);
        if (large.has(file) && kinds.includes(large.get(file))) extra.push(file);
      }
    }
  }
  read([...new Set(extra)].flatMap(file => ['base', 'local', 'remote'].map(side => [side, file])));

  // Where each record is on each side. A record on a path neither side
  // touched is unchanged there.
  const touched = file => L.has(file) || R.has(file);
  const place = new Map(), entry = uid => { if (!place.has(uid)) place.set(uid, { uid }); return place.get(uid); };
  for (const v of versions.values()) if (v?.uid) {
    const e = entry(v.uid);
    // A record found twice on one side keeps the copy at a new path.
    if (!e[v.side] || e[v.side].file === e.base?.file) e[v.side] = v;
  }
  for (const e of place.values()) for (const side of ['local', 'remote']) {
    if (e[side]) continue;
    const changed = side === 'local' ? L : R;
    if (e.base && !changed.has(e.base.file)) e[side] = { ...e.base, side, unchanged: true };
    else e[side] = null;
  }
  const status = (e, side) => !e[side] ? (e.base ? 'deleted' : 'absent') : e[side].unchanged ? 'unchanged' : !e.base ? 'added' : e[side].file === e.base.file ? (e[side].text === e.base.text ? 'unchanged' : 'modified') : 'moved';

  // The folder a merged record belongs in. Most records name their own folder;
  // an item placed under its collection takes the folder a side moved it to,
  // since a renamed collection moves its items without changing them.
  const dirOf = file => { const dir = path.posix.dirname(file.slice(prefix.length)); return dir === '.' ? '' : dir; };
  const folderOf = (record, e) => {
    if (!parented(record)) return folderFor(record, find);
    const base = e.base && dirOf(e.base.file), mine = e.local ? dirOf(e.local.file) : null, theirs = e.remote ? dirOf(e.remote.file) : null;
    return mine === null ? theirs : theirs === null || mine === theirs || mine !== base ? mine : theirs;
  };
  const matches = (file, folder, name) => {
    if (nameKey(dirOf(file)) !== nameKey(folder) || !file.endsWith('.md')) return false;
    const base = path.posix.basename(file).slice(0, -3).normalize('NFC');
    return base === name || (base.startsWith(name + ' ') && /^(?:[2-9]|[1-9]\d+)$/.test(base.slice(name.length + 1)));
  };
  const finals = new Map(), reviews = [], planned = new Set();
  const review = (file, e, kept) => reviews.push({ id: hash(file + '\0' + remoteCommit).slice(0, 24), path: file, kind: 'git', kept, base: e.base?.text ?? null, local: e.local?.text ?? null, remote: e.remote?.text ?? null, remote_commit: remoteCommit, at: new Date().toISOString() });
  for (const e of place.values()) {
    const ls = status(e, 'local'), rs = status(e, 'remote');
    if (ls === 'unchanged' || ls === 'absent' && rs !== 'absent') { finals.set(e.uid, e.remote && { file: e.remote.file, text: e.remote.text, from: 'remote' }); continue; }
    if (rs === 'unchanged' || rs === 'absent') { finals.set(e.uid, e.local && { file: e.local.file, text: e.local.text, from: 'local' }); continue; }
    // The same result on both sides (a history entry both wrote) needs nothing.
    if (e.local && e.remote && e.local.file === e.remote.file && e.local.text === e.remote.text) { finals.set(e.uid, { file: e.local.file, text: e.local.text, from: 'local' }); continue; }
    // Changed on both sides at one path: the reconciler's line merge.
    if (e.local && e.remote && e.local.file === e.remote.file && (!e.base || e.local.file === e.base.file)) { finals.set(e.uid, { file: e.local.file, deferred: true, from: 'local' }); continue; }
    if (!e.local && !e.remote) { finals.set(e.uid, null); continue; }
    if (!e.local || !e.remote) {
      // Deleted on one side, moved or changed on the other: the surviving one.
      const kept = e.local ? 'local' : 'remote', v = e[kept];
      if (!e.base || e.base.file === v.file) { finals.set(e.uid, { file: v.file, deferred: true, from: kept }); continue; }
      planned.add(e.uid); finals.set(e.uid, { file: v.file, text: v.text, from: kept }); review(v.file, e, kept); continue;
    }
    planned.add(e.uid);
    const merged = e.base ? mergeRecords(e.base.record, e.local.record, e.remote.record, mergeText) : { conflicts: ['created on both sides'] };
    if (merged.conflicts) { finals.set(e.uid, { file: e.local.file, text: e.local.text, from: 'local' }); review(e.local.file, e, 'local'); continue; }
    const text = encode(merged.record), folder = folderOf(merged.record, e), name = nameFor(merged.record);
    if (matches(e.local.file, folder, name)) finals.set(e.uid, { file: e.local.file, text, from: 'local' });
    else if (matches(e.remote.file, folder, name)) finals.set(e.uid, { file: e.remote.file, text, from: 'remote' });
    else finals.set(e.uid, { text, record: merged.record, folder, from: 'local' });
  }

  // Who ends up on each path. Pages that are not records stay where they are.
  const occupants = new Map(), add = (file, who) => { const k = nameKey(file); if (!occupants.has(k)) occupants.set(k, []); occupants.get(k).push(who); };
  for (const [uid, f] of finals) if (f?.file) add(f.file, { uid, file: f.file, local: place.get(uid).local?.file === f.file });
  for (const v of versions.values()) if (v?.document && (v.side === 'local' || v.side === 'remote') && touched(v.file)) add(v.file, { document: v.file, local: v.side === 'local' });
  // Every name either tree has, so a renamed record never lands on one.
  const tree = commit => git(['ls-tree', '-r', '-z', '--name-only', commit, '--', recordsFolder]).toString('utf8').split('\0').filter(Boolean);
  const names = new Set([...tree(local), ...tree(remote)].map(nameKey));
  const moveOut = [];
  for (const list of occupants.values()) {
    if (list.length < 2) continue;
    const records = list.filter(o => o.uid), documents = list.filter(o => o.document);
    // Two pages that are not records are the line merge's to settle.
    if (!records.length) continue;
    // A page that is not a record keeps its name; then a record both sides
    // still have there; then the one this machine already has there.
    const winner = documents.length ? null : records.find(o => finals.get(o.uid).deferred) || records.find(o => o.local) || [...records].sort((a, b) => a.uid.localeCompare(b.uid))[0];
    if (!winner && records.some(o => finals.get(o.uid).deferred)) continue;
    for (const o of records) if (o !== winner) { moveOut.push(o.uid); planned.add(o.uid); }
  }
  // A new name in the record's own folder: " 2", " 3", ...
  for (const uid of [...moveOut, ...[...finals].filter(([, f]) => f && !f.file).map(([uid]) => uid)]) {
    const f = finals.get(uid), record = f.record || decode(f.text, f.file), folder = f.folder ?? (parented(record) && f.file ? dirOf(f.file) : folderFor(record, find)), name = nameFor(record);
    for (let n = f.file ? 2 : 1; ; n++) {
      const file = prefix + (folder ? folder + '/' : '') + candidateName(name, n);
      if (!names.has(nameKey(file)) && !occupants.has(nameKey(file))) { names.add(nameKey(file)); occupants.set(nameKey(file), [{ uid, file }]); finals.set(uid, { ...f, file, text: f.text || encode(record) }); break; }
    }
  }
  if (!planned.size) return null;

  // The merged content of every path a planned record was, is or will be on.
  const affected = new Set();
  for (const uid of planned) { const e = place.get(uid); for (const v of [e.base, e.local, e.remote, finals.get(uid)]) if (v?.file) affected.add(v.file); }
  const writes = new Map(), deletes = new Set(), deferred = new Set(), ownerOf = new Map();
  for (const [uid, f] of finals) if (f?.file) ownerOf.set(f.file, f);
  for (const file of affected) {
    const f = ownerOf.get(file);
    if (f?.deferred) deferred.add(file);
    else if (f) writes.set(file, f.text);
    else {
      // A page that is not a record keeps its place, as this machine has it.
      const page = versions.get('local:' + file)?.document ? versions.get('local:' + file) : versions.get('remote:' + file)?.document ? versions.get('remote:' + file) : null;
      if (page) writes.set(file, page.text); else deletes.add(file);
    }
  }
  return { writes, deletes, reviews, deferred };
}
