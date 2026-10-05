// Where each record lives inside notebook/, and what its file looks like.
//
// What a person reads is a Markdown file named after its title, in a folder
// named for what it is (notes in their own folders, People/, Groups/, ...),
// with YAML frontmatter Obsidian shows as properties and the record's text as
// the body. Its identity is the id and uid in that frontmatter, never the file
// name: a renamed title renames the file, and the notebook finds a record by
// its id wherever its file is. Machine bookkeeping stays JSON, one file per
// record named by its id, under the one system folder. Menerio's vault export
// is the model for names, folders and frontmatter fields.
import path from 'node:path';
import { stringify, parse } from './yaml.mjs';

// Inside notebook/. Not a dot folder: sync never carries those.
export const systemFolder = '_system';

const text = value => value === null || value === undefined ? '' : typeof value === 'string' ? value : typeof value === 'object' ? '' : String(value);
const day = value => (/^\d{4}-\d{2}-\d{2}/.exec(text(value)) || [''])[0];
const firstText = data => Object.values(data && typeof data === 'object' ? data : {}).find(v => typeof v === 'string' && v.trim()) || '';

// The readable types. `word` is the frontmatter type; `name` gives the file
// name, `folder` the folder (relative to notebook/), `body` the field written
// as the Markdown body, `first` the fields shown first after id and type.
const layouts = {
  notes: {
    word: 'note', body: 'content', first: ['title'],
    folder: r => {
      const parts = folderParts(r.folder_path);
      // The system folder is never a note folder.
      if (parts[0] && key(parts[0]) === key(systemFolder)) parts.unshift('Notes');
      return [...(r.is_trashed ? ['Trash'] : []), ...parts].join('/');
    },
    name: r => r.title,
  },
  contacts: { word: 'person', folder: () => 'People', name: r => r.name, body: 'notes', first: ['name', 'company', 'role', 'relationship', 'email', 'phone'] },
  contact_groups: { word: 'group', folder: () => 'Groups', name: r => r.name, body: 'description', first: ['name', 'purpose', 'group_type', 'sensitivity'] },
  entities: { word: 'entity', folder: () => 'World', name: r => r.name, body: 'description', first: ['name', 'entity_type'] },
  // A fact that was closed (valid_to) is history; it moves to Facts/Earlier.
  claims: {
    word: 'fact', folder: r => r.valid_to ? 'Facts/Earlier' : 'Facts', first: ['attribute', 'value', 'subject_type', 'subject_id', 'valid_from', 'valid_to'],
    name: r => [text(r.attribute).replaceAll('_', ' ').trim(), text(r.value).trim()].filter(Boolean).join(' - '),
  },
  moments: { word: 'moment', folder: () => 'Timeline', name: r => [day(r.happened_at), text(r.title).trim()].filter(Boolean).join(' '), body: 'description', first: ['title', 'happened_at', 'happened_end', 'category'] },
  wiki_pages: { word: 'lexicon page', folder: () => 'Lexicon', name: r => r.title, body: 'content', first: ['title', 'slug', 'page_type', 'summary'] },
  collections: { word: 'collection', folder: () => 'Collections', name: r => r.name, body: 'description', first: ['name', 'slug'] },
  // Items sit in a folder named after their collection, so renaming a
  // collection moves its items.
  collection_items: {
    word: 'collection item', parent: { type: 'collections', field: 'collection_id' }, first: ['title', 'collection_id', 'data'],
    folder: (r, find) => 'Collections/' + sanitizeName(find?.('collections', r.collection_id)?.name, 'Unfiled'),
    name: r => text(r.title).trim() || firstText(r.data),
  },
  contact_topics: { word: 'topic', folder: () => 'Topics', name: r => r.title, first: ['title', 'status', 'priority', 'mode', 'contact_id'] },
  weekly_reviews: { word: 'weekly review', folder: () => 'Reviews', name: r => 'Week of ' + text(r.week_start), first: ['week_start', 'week_end'] },
};
export const readableTypes = Object.freeze(Object.keys(layouts));
const typeOfWord = new Map(Object.entries(layouts).map(([type, l]) => [l.word, type]));
// Child types and the parent field that places them, by parent type.
export const childrenOf = Object.entries(layouts).filter(([, l]) => l.parent).reduce((map, [type, l]) => map.set(l.parent.type, [...(map.get(l.parent.type) || []), { type, field: l.parent.field }]), new Map());

// Readable frontmatter uses Menerio's names for these fields.
const RENAMES = [['created_at', 'created'], ['updated_at', 'modified'], ['is_favorite', 'favorite'], ['is_pinned', 'pinned'], ['is_sensitive', 'sensitive']];

// ---- Names ---------------------------------------------------------------

const RESERVED = /^(con|prn|aux|nul|com[0-9\u00b9\u00b2\u00b3]|lpt[0-9\u00b9\u00b2\u00b3])(?=\.|$)/i;
// Menerio's rule: drop <>:"/\|?*, collapse spaces, trim, at most 200
// characters, "Untitled" when nothing is left. A file name must also work on
// every machine: no control characters, no leading dot (a hidden file sync
// never carries), no trailing dot or space (Windows drops them), no device
// name Windows reserves, and few enough bytes that " 99.md" still fits the
// 255-byte limit of the file system.
export function sanitizeName(value, fallback = 'Untitled') {
  let name = text(value).normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().replace(/^[.\s]+/, '');
  const points = [...name]; let bytes = 0, end = 0;
  for (; end < points.length && end < 200; end++) { bytes += Buffer.byteLength(points[end]); if (bytes > 240) break; }
  name = points.slice(0, end).join('').replace(/[.\s]+$/, '').replace(RESERVED, '$1_');
  return name || fallback;
}
function folderParts(value) { return text(value).split(/[\\/]+/).map(part => sanitizeName(part, '')).filter(Boolean); }
// Two names that are the same file on a case-insensitive file system.
export const key = name => String(name).normalize('NFC').toLowerCase();

// ---- Placement -----------------------------------------------------------

// A readable type is always Markdown. A removed one (a tombstone, a merged
// person) keeps that form but leaves the readable folders for the system
// folder, so it no longer shows among the live pages.
export const isReadableType = type => Object.hasOwn(layouts, type);
export function isReadable(record) {
  return isReadableType(record.type) && !record.removed_at && !(record.type === 'contacts' && record.merged_into);
}
export function systemPath(record) { return systemFolder + '/' + record.type + '/' + record.id + (isReadableType(record.type) ? '.md' : '.json'); }
// The folder a record belongs in, relative to notebook/. `find(type, id)`
// reads another record, for a type placed under its parent.
export function folderFor(record, find) { return isReadable(record) ? layouts[record.type].folder(record, find) : systemFolder + '/' + record.type; }
export function nameFor(record) { return isReadable(record) ? sanitizeName(layouts[record.type].name(record)) : record.id; }
export function candidateName(name, n) { return (n > 1 ? name + ' ' + n : name) + '.md'; }
// Whether the file at `relative` (to notebook/) is a right place for this
// record: its own folder, its own name or that name with a number for a name
// another record already had. A folder spelled in another case still fits, so
// two machines never move a file back and forth over letter case.
export function fits(record, relative, find) {
  if (!isReadable(record)) return relative === systemPath(record);
  if (!relative.endsWith('.md')) return false;
  const dir = path.posix.dirname(relative), folder = folderFor(record, find);
  if (key(dir === '.' ? '' : dir) !== key(folder)) return false;
  const base = path.posix.basename(relative).slice(0, -3).normalize('NFC'), name = nameFor(record);
  return base === name || (base.startsWith(name + ' ') && /^(?:[2-9]|[1-9]\d+)$/.test(base.slice(name.length + 1)));
}

// ---- Files ---------------------------------------------------------------

export class NotARecord extends Error { constructor(message) { super(message); this.code = 'NOT_RECORD'; } }
export function safe(value) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,180}$/.test(value) || value.includes('..')) throw new Error('Invalid record path');
  return value;
}
function contract(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record) || record.format !== 1 || !record.id || !record.uid || !record.type) throw new Error('Invalid record contract');
  safe(record.id); safe(record.type);
  return record;
}
// JSON's meaning of a value (dates as text, nothing for undefined), so a
// record reads back as exactly what JSON kept before.
const plain = record => JSON.parse(JSON.stringify(record));

export function encode(record) {
  const { _hash, ...value } = record;
  if (!isReadableType(value.type)) return JSON.stringify(value, null, 2) + '\n';
  const l = layouts[value.type], record_ = plain(value), front = { id: record_.id, type: l.word }, used = new Set(['id', 'type']);
  const bodyField = l.body && typeof record_[l.body] === 'string' ? l.body : null;
  if (bodyField) used.add(bodyField);
  for (const [field, shown] of RENAMES) if (Object.hasOwn(record_, shown) && !Object.hasOwn(record_, field)) throw new Error('A record field named ' + shown + ' would be read back as ' + field);
  const renamed = new Map(RENAMES.filter(([field, shown]) => Object.hasOwn(record_, field) && !Object.hasOwn(record_, shown)));
  const put = field => { if (used.has(field) || !Object.hasOwn(record_, field)) return; used.add(field); front[renamed.get(field) || field] = record_[field]; };
  for (const field of l.first || []) put(field);
  for (const field of ['created_at', 'updated_at', 'tags', 'aliases', 'is_favorite', 'is_pinned', 'is_sensitive']) put(field);
  for (const field of Object.keys(record_)) put(field);
  return '---\n' + stringify(front) + '---\n' + (bodyField ? record_[bodyField] : '');
}

const FRONTMATTER = /^---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n([\s\S]*))?$/;
// Reads one record file. A Markdown file without a uid in its frontmatter is
// not a record (an owner's own page in the folder): NotARecord, not an error.
export function decode(source, file) {
  if (file.endsWith('.json')) {
    const record = contract(JSON.parse(source));
    if (record.id !== path.basename(file).replace(/\.json$/, '') || record.type !== path.basename(path.dirname(file))) throw new Error('Record identity differs from path');
    return record;
  }
  if (!source.startsWith('---')) throw new NotARecord('No frontmatter');
  const match = source.match(FRONTMATTER);
  if (!match) throw new NotARecord('No frontmatter');
  const front = match[1] ?? '', body = match[2] ?? '';
  // Before 2026-10-05 a note's frontmatter was JSON.
  if (front.trimStart().startsWith('{')) return contract({ ...JSON.parse(front), content: body });
  let data;
  try { data = parse(front); }
  catch (error) { if (/^\s*"?uid"?\s*:/m.test(front)) throw error; throw new NotARecord('Frontmatter without a record'); }
  if (!Object.hasOwn(data, 'uid')) throw new NotARecord('Frontmatter without a record');
  const type = typeOfWord.get(data.type) || data.type, record = {};
  const shown = new Map(RENAMES.filter(([field, name]) => Object.hasOwn(data, name) && !Object.hasOwn(data, field)).map(([field, name]) => [name, field]));
  for (const [field, value] of Object.entries(data)) record[field === 'type' ? 'type' : shown.get(field) || field] = field === 'type' ? type : value;
  const l = Object.hasOwn(layouts, type) ? layouts[type] : null;
  if (l?.body && (body !== '' || !Object.hasOwn(data, l.body))) record[l.body] = body;
  else if (body.trim()) throw new Error('This file has text below its frontmatter that its record has no place for');
  return contract(record);
}
// Whether a file is a record candidate at all, by where it is (relative to
// notebook/, '/'-separated): Markdown anywhere, JSON only as a system record
// or in the one-folder-per-type layout used before 2026-10-05.
export function candidate(relative) {
  const parts = relative.split('/');
  if (relative.endsWith('.md')) return true;
  if (!relative.endsWith('.json')) return false;
  return (parts.length === 3 && parts[0] === systemFolder) || (parts.length === 2 && /^[a-z][a-z0-9_]*$/.test(parts[0]));
}
