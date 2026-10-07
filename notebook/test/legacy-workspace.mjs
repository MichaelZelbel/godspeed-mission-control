// A synthetic workspace in the layout version 2 wrote before 2026-10-05: every
// note notebook/notes/<id>.md with JSON on top, every other record
// notebook/<type>/<id>.json. The records come from a Menerio-shaped export
// imported by the notebook itself, so ids, uids and references are real.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store, atomic, hash } from '../core/records/store.mjs';
import { QueryService } from '../core/query.mjs';
import { importExport } from '../core/import.mjs';

export function legacyEncode(record) {
  const { _hash, ...value } = record;
  if (value.type === 'notes') { const { content = '', ...meta } = value; return '---\n' + JSON.stringify(meta, null, 2) + '\n---\n' + content; }
  return JSON.stringify(value, null, 2) + '\n';
}
export const legacyFile = record => path.join('notebook', record.type, record.id + (record.type === 'notes' ? '.md' : '.json'));

// Titles that each break a naive file name, with the folder each note is in.
export const trickyNotes = [
  ['Q3/Q4 plan: "draft" <v2>?', 'Projects'],
  ['\u{1F389} Launch party', 'Projects/2026/Q4'],
  ['A'.repeat(250), ''],
  ['Gr\u00fc\u00dfe aus M\u00fcnchen', '\u00c4rger/\u00d6lung'],
  ['', ''], [null, ''], ['   ', ''],
  ['Duplicate', 'Projects'], ['Duplicate', 'Projects'], ['Duplicate', 'projects'], ['duplicate', 'Projects'],
  ['CON', ''], ['.hidden notes', ''], ['Trailing dots...', ''], ['Tab\tand\nnewline', ''],
  ['U\u0308nicode decomposed', ''], ['\u{1F600}'.repeat(100), ''], ['Back\\slash and | pipe', 'Folder with: colon'],
  ['Outside', '../escape'], ['Dots', '..'], ['Leading slash', '/Leading/slash/'],
];

export function legacyWorkspace({ root = fs.mkdtempSync(path.join(os.tmpdir(), 'godspeed-legacy-')) } = {}) {
  const staging = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'godspeed-legacy-staging-')), { device: 'menerio' }), query = new QueryService(staging);
  let clock = Date.parse('2024-01-01T00:00:00Z');
  const at = () => new Date(clock += 60000).toISOString(), id = () => randomUUID(), rows = [];
  const row = (type, values) => { const value = { id: id(), created_at: at(), updated_at: at(), ...values, type }; rows.push(value); return value; };
  const ada = row('contacts', { name: 'Ada Lovelace', notes: 'Met at the conference', email: 'ada@example.com', tags: ['math'] });
  const ada2 = row('contacts', { name: 'Ada Lovelace', notes: null, company: 'Analytical Engines' });
  const jose = row('contacts', { name: 'Jos\u00e9 M\u00fcller', notes: 'Neighbour' });
  const merged = row('contacts', { name: 'Old duplicate of Jos\u00e9', merged_into: jose.id, notes: null });
  const club = row('contact_groups', { name: 'Book club', description: 'Monthly', purpose: 'Read together', group_type: 'community' });
  row('contact_group_memberships', { group_id: club.id, contact_id: ada.id, status: 'active' });
  row('contact_group_memberships', { group_id: club.id, contact_id: jose.id, status: 'active' });
  row('claims', { subject_type: 'contact', subject_id: ada.id, attribute: 'city', value: 'Berlin', valid_from: '2025-01-01', valid_to: null });
  row('claims', { subject_type: 'contact', subject_id: ada.id, attribute: 'city', value: 'Hamburg', valid_from: '2020-01-01', valid_to: '2025-01-01' });
  const moved = row('moments', { title: 'Moved to Berlin', happened_at: '2025-01-01T09:00:00Z', description: 'With all the books', person_id: ada.id });
  row('moment_participants', { moment_id: moved.id, contact_id: ada.id });
  row('wiki_pages', { title: 'Personal AI', slug: 'personal-ai', content: 'A page about personal AI.\n', page_type: 'concept' });
  const books = row('collections', { name: 'Books', description: 'What I read' });
  row('collection_items', { collection_id: books.id, title: 'Dune', data: { author: 'Frank Herbert' } });
  row('collection_items', { collection_id: books.id, title: 'Dune', data: { author: 'Brian Herbert' } });
  row('entities', { name: 'Acme Robotics', entity_type: 'organization', description: 'A fictional company' });
  const notes = trickyNotes.map(([title, folder_path], i) => row('notes', { title, folder_path, content: '# Note ' + i + '\n\nSee [[Personal AI]] and ![[photo.png]].\n', tags: i % 2 ? ['tagged'] : [], contact_id: i === 0 ? ada.id : undefined, metadata: { people: ['Ada Lovelace'] } }));
  const trashed = row('notes', { title: 'Thrown away', folder_path: 'Projects', is_trashed: true, content: 'Old' });
  row('note_attachments', { note_id: notes[0].id, storage_path: 'owner/' + notes[0].id + '/photo.png', filename: 'photo.png', file_type: 'image/png' });
  for (const r of rows) if (r.contact_id === undefined) delete r.contact_id;
  importExport(query, { format: 1, records: rows });

  // What the notebook adds of its own: settings, a job, an edit with history,
  // a renamed person, a removed note.
  staging.save('settings', { id: 'installation', owner: 'local', timezone: 'Europe/Berlin' });
  staging.save('jobs', { id: 'daily-brief', kind: 'brief', owner: 'local', state: 'pending', next_run: '2030-01-01T07:00:00Z' });
  const edited = staging.get('notes', notes[3].id); staging.save('notes', { ...edited, content: edited.content + 'Edited once.\n' }, edited._hash);
  staging.structural('contacts', jose.id, 'display-name', { name: 'Jos\u00e9 M\u00fcller-Schmidt' });
  staging.structural('notes', notes[14].id, 'remove');
  if (staging.problems.length) throw new Error('Synthetic records need review: ' + JSON.stringify(staging.problems));

  for (const record of staging.records.values()) atomic(path.join(root, legacyFile(record)), legacyEncode(record));
  // The owner's own page in the notebook folder, and a picture of a note.
  atomic(path.join(root, 'notebook', 'README.md'), '# My notebook\n\nWritten by hand.\n');
  const media = path.join(root, '.godspeed', 'media'), bytes = Buffer.from([137, 80, 78, 71, 0, 1, 2, 3]), storage = 'owner/' + notes[0].id + '/photo.png';
  atomic(path.join(media, hash(bytes) + '-photo.png'), bytes);
  atomic(path.join(media, hash(storage) + '.mapping.json'), JSON.stringify({ path: storage, file: hash(bytes) + '-photo.png', sha256: hash(bytes), size: bytes.length, contentType: 'image/png' }));
  return { root, records: [...staging.records.values()].map(r => { const { _hash, ...value } = r; return value; }), ids: { ada: ada.id, ada2: ada2.id, jose: jose.id, merged: merged.id, club: club.id, moved: moved.id, books: books.id, notes: notes.map(n => n.id), trashed: trashed.id } };
}
