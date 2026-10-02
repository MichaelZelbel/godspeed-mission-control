import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

export const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export const slug = value => String(value).normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'record';
export function safe(value) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,180}$/.test(value) || value.includes('..')) throw new Error('Invalid record path');
  return value;
}
export function atomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + randomUUID() + '.tmp';
  const fd = fs.openSync(tmp, 'wx');
  try { fs.writeFileSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}
export function encode(record) {
  if (record.type === 'notes') {
    const { content = '', ...meta } = record;
    return '---\n' + JSON.stringify(meta, null, 2) + '\n---\n' + content;
  }
  return JSON.stringify(record, null, 2) + '\n';
}
export function decode(text, file) {
  const result = file.endsWith('.md') ? (() => {
    const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!match) throw new Error('Expected JSON frontmatter');
    return { ...JSON.parse(match[1]), content: match[2] };
  })() : JSON.parse(text);
  if (result.format !== 1 || !result.id || !result.uid || !result.type) throw new Error('Invalid record contract');
  safe(result.id); safe(result.type);
  if (result.id !== path.basename(file).replace(/\.(json|md)$/, '') || result.type !== path.basename(path.dirname(file))) throw new Error('Record identity differs from path');
  return result;
}
export class Store {
  constructor(root, { device = 'local', failAfter = null } = {}) {
    this.root = path.resolve(root); this.device = safe(device); this.failAfter = failAfter;
    this.recordsRoot = path.join(this.root, 'records'); this.state = path.join(this.root, '.godspeed');
    fs.mkdirSync(this.recordsRoot, { recursive: true }); fs.mkdirSync(this.state, { recursive: true });
    this.withLock(() => this.recover()); this.scan();
  }
  withLock(fn) {
    const lock = path.join(this.state, 'workspace.lock');
    let fd;
    try { fd = fs.openSync(lock, 'wx'); } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let owner;
      try { owner = JSON.parse(fs.readFileSync(lock, 'utf8')); } catch { throw new Error('Workspace lock requires recovery'); }
      try { process.kill(owner.pid, 0); } catch (error) {
        if (error.code === 'ESRCH') { fs.unlinkSync(lock); return this.withLock(fn); }
        throw error;
      }
      throw new Error('Workspace is being written by another process');
    }
    try { fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() })); fs.fsyncSync(fd); return fn(); }
    finally { fs.closeSync(fd); fs.unlinkSync(lock); }
  }
  file(record) { return path.join(this.recordsRoot, safe(record.type), safe(record.id) + (record.type === 'notes' ? '.md' : '.json')); }
  scan() {
    const records = new Map(), problems = [], uids = new Map(), aliases = new Map();
    for (const dir of fs.readdirSync(this.recordsRoot, { withFileTypes: true })) {
      if (!dir.isDirectory() || dir.isSymbolicLink()) continue;
      for (const entry of fs.readdirSync(path.join(this.recordsRoot, dir.name), { withFileTypes: true })) {
        if (!entry.isFile() || !/\.(json|md)$/.test(entry.name)) continue;
        const file = path.join(this.recordsRoot, dir.name, entry.name);
        try {
          const record = decode(fs.readFileSync(file, 'utf8'), file), key = record.type + '/' + record.id;
          if (uids.has(record.uid)) problems.push({ file, error: 'Duplicate UUID', other: uids.get(record.uid) });
          uids.set(record.uid, key); record._hash = hash(encode(record)); records.set(key, record);
          for (const alias of record.removed_at ? [] : [record.id, ...(record.aliases || [])]) {
            const akey = record.type + '/' + alias.toLowerCase();
            if (aliases.has(akey) && aliases.get(akey) !== key) problems.push({ file, error: 'Ambiguous alias', alias });
            aliases.set(akey, key);
          }
        } catch (e) { problems.push({ file, error: e.message }); }
      }
    }
    this.records = records; this.problems = problems; this.lastScan = new Date().toISOString();
    this.problems.push(...this.validateReferences([...records.values()])); return records;
  }
  validateReferences(records) {
    const problems = [], uids = new Set(records.map(r => r.uid));
    const keys = new Set(records.flatMap(r => [r.type + '/' + r.id, ...(r.aliases || []).map(a => r.type + '/' + a)]));
    for (const r of records) for (const ref of r.references || []) {
      if (!(ref.uid ? uids.has(ref.uid) : keys.has(ref.type + '/' + ref.id))) problems.push({ record: r.id, error: 'Missing reference', reference: ref });
    }
    return problems;
  }
  list(type, { removed = false } = {}) { this.scan(); return [...this.records.values()].filter(r => r.type === type && (removed || !r.removed_at)); }
  get(type, id) { this.scan(); return this.records.get(type + '/' + id) || [...this.records.values()].find(r => r.type === type && (r.aliases || []).includes(id)); }
  prepare(type, value, old = null) {
    const now = new Date().toISOString(), uid = old?.uid || value.uid || randomUUID();
    const id = old?.id || value.id || slug(value.name || value.title || type) + '-' + uid.slice(0, 8);
    const record = { tags: [], aliases: [], references: [], metadata: {}, user_id: 'owner', ...old, ...value,
      format: 1, type: safe(type), id: safe(id), uid, device: old?.device || this.device,
      revision: (old?.revision || 0) + 1, created_at: old?.created_at || value.created_at || now, updated_at: now };
    delete record._hash;
    if (type === 'notes') Object.assign(record, { is_favorite: false, is_pinned: false, is_trashed: false,
      folder_path: '', structured_fields: {}, related: [], ai_visibility: 'visible', ...record });
    return record;
  }
  save(type, value, expectedHash) {
    return this.withLock(() => {
      const old = value.id ? this.get(type, value.id) : null;
      if (expectedHash !== undefined && expectedHash !== (old?._hash || null)) {
        const conflict = { id: randomUUID(), type, record_id: value.id, local: value, remote: old, at: new Date().toISOString() };
        atomic(path.join(this.root, 'conflicts', conflict.id + '.json'), JSON.stringify(conflict, null, 2));
        const error = new Error('This record changed. Both versions were saved for review.'); error.code = 'CONFLICT'; throw error;
      }
      if (type === 'moments' && old) throw new Error('Events are append-only; add a correction event');
      const record = this.prepare(type, value, old); this.commit([record]); return record;
    });
  }
  commit(records) {
    this.scan();
    const proposed = new Map(this.records);
    for (const record of records) proposed.set(record.type + '/' + record.id, record);
    const errors = this.validateReferences([...proposed.values()]);
    const ids = new Set();
    for (const r of proposed.values()) { if (ids.has(r.uid)) errors.push({ error: 'Duplicate UUID' }); ids.add(r.uid); }
    if (errors.length) throw new Error('Reference validation failed: ' + JSON.stringify(errors));
    const tx = randomUUID(), dir = path.join(this.state, 'transactions', tx); fs.mkdirSync(dir, { recursive: true });
    const manifest = records.map((record, i) => {
      const file = this.file(record), relative = path.relative(this.root, file).replaceAll('\\', '/');
      atomic(path.join(dir, i + '.after'), encode(record));
      if (fs.existsSync(file)) atomic(path.join(dir, i + '.before'), fs.readFileSync(file, 'utf8'));
      return { file: relative, staged: i + '.after', hash: hash(encode(record)) };
    });
    atomic(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
    atomic(path.join(dir, 'prepared'), tx);
    this.applyTransaction(dir, manifest); this.scan();
  }
  applyTransaction(dir, manifest) {
    for (let i = 0; i < manifest.length; i++) {
      const item = manifest[i], file = path.resolve(this.root, item.file);
      if (!file.startsWith(this.recordsRoot + path.sep)) throw new Error('Invalid transaction target');
      const text = fs.readFileSync(path.join(dir, item.staged), 'utf8');
      if (hash(text) !== item.hash) throw new Error('Corrupt transaction stage');
      atomic(file, text);
      if (this.failAfter === i + 1) throw new Error('Injected crash');
    }
    atomic(path.join(dir, 'completed'), new Date().toISOString());
  }
  recover() {
    const root = path.join(this.state, 'transactions'); if (!fs.existsSync(root)) return;
    for (const name of fs.readdirSync(root)) {
      const dir = path.join(root, name);
      if (fs.existsSync(path.join(dir, 'prepared')) && !fs.existsSync(path.join(dir, 'completed'))) this.applyTransaction(dir, JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')));
    }
  }
  structural(type, id, action, options = {}) {
    return this.withLock(() => {
      const old = this.get(type, id); if (!old) throw new Error('Record not found');
      if (action === 'display-name') { const next = this.prepare(type, { name: options.name }, old); this.commit([next]); return next; }
      if (action === 'remove') { const next = this.prepare(type, { removed_at: new Date().toISOString() }, old); this.commit([next]); return next; }
      if (action === 'merge') {
        const target = this.get(type, options.target); if (!target || old.uid === target.uid) throw new Error('Invalid merge target');
        const changed = [...this.records.values()].filter(r => (r.references || []).some(ref => ref.uid === old.uid || (ref.type === type && ref.id === id)))
          .map(r => {
            const patch = {};
            for (const ref of r.references) if (ref.field && (ref.uid === old.uid || (ref.type === type && ref.id === id))) patch[ref.field] = target.id;
            return this.prepare(r.type, { ...patch, references: r.references.map(ref => ref.uid === old.uid || (ref.type === type && ref.id === id) ? { ...ref, uid: target.uid, id: target.id } : ref) }, r);
          });
        const tombstone = this.prepare(type, { removed_at: new Date().toISOString(), merged_into: target.uid }, old);
        const merged = this.prepare(type, { aliases: [...new Set([...(target.aliases || []), old.id, ...(old.aliases || [])])], merged_sources: [...(target.merged_sources || []), old.uid] }, target);
        // The removed source retains its own id; aliases resolve by UUID provenance.
        this.commit([...changed.filter(r => r.uid !== old.uid && r.uid !== target.uid), tombstone, merged]); return merged;
      }
      throw new Error('Unknown structural operation');
    });
  }
  backup(destination) {
    if (fs.existsSync(destination)) throw new Error('Backup destination already exists');
    return this.withLock(() => {
      this.recover(); fs.mkdirSync(destination, { recursive: true });
      for (const root of ['records', 'conflicts']) if (fs.existsSync(path.join(this.root, root))) fs.cpSync(path.join(this.root, root), path.join(destination, root), { recursive: true });
      atomic(path.join(destination, 'backup.json'), JSON.stringify({ format: 1, at: new Date().toISOString(), records: this.scan().size }));
      return destination;
    });
  }
  restore(source) {
    if (this.scan().size) throw new Error('Restore requires an empty workspace');
    const manifest = JSON.parse(fs.readFileSync(path.join(source, 'backup.json'), 'utf8')); if (manifest.format !== 1) throw new Error('Unsupported backup format');
    return this.withLock(() => {
      fs.cpSync(path.join(source, 'records'), this.recordsRoot, { recursive: true });
      if (fs.existsSync(path.join(source, 'conflicts'))) fs.cpSync(path.join(source, 'conflicts'), path.join(this.root, 'conflicts'), { recursive: true });
      this.scan(); if (this.problems.length) throw new Error('Restored records need review'); return this.records.size;
    });
  }
}
