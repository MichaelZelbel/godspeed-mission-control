import fs from 'node:fs';
import path from 'node:path';

// Menerio cut every note into passages (note_chunks) for its search. Most are
// just the note's own text, which the notebook already has. A few hundred are
// text that exists nowhere else: what Menerio read out of an attached PDF.
// Those become `note_chunks` records of their note, so word and meaning search
// find them and lead to the note. The rest stay in the private archive.
const plain = text => String(text || '').replace(/[#*>_`\[\]()|-]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

export function orphanChunks(sourceDir) {
  const read = name => JSON.parse(fs.readFileSync(path.join(sourceDir, name), 'utf8'));
  const chunks = read('note_chunks.json'), notes = new Map(read('notes.json').map(n => [n.id, n])), bodies = new Map();
  return chunks.filter(c => {
    const note = notes.get(c.note_id); if (!note) return false;
    if (!bodies.has(note.id)) bodies.set(note.id, plain(note.title + ' ' + note.content));
    const probe = plain(c.content).slice(0, 120);
    return probe.length >= 20 && !bodies.get(note.id).includes(probe);
  });
}

// Adds them once: a chunk already there (by its Menerio id) is left alone.
export function importOrphanChunks(store, sourceDir) {
  const found = orphanChunks(sourceDir), added = [], missingNote = [];
  store.transaction(view => {
    const batch = [];
    for (const c of found) {
      if (view.get('note_chunks', c.id)) continue;
      const note = view.get('notes', c.note_id);
      if (!note) { missingNote.push(c.id); continue; }
      batch.push(store.prepare('note_chunks', {id: c.id, uid: c.id, note_id: note.id, chunk_index: Number(c.chunk_index) || 0, heading_path: c.heading_path && c.heading_path !== 'None' ? c.heading_path : null,
        content: String(c.content || ''), source: 'menerio', created_at: c.created_at && c.created_at !== 'None' ? new Date(c.created_at.replace(' ', 'T').replace(/\+00$/, 'Z')).toISOString() : undefined,
        references: [{type: 'notes', id: note.id, uid: note.uid, field: 'note_id'}], metadata: {menerio_source_table: 'note_chunks', menerio_source_id: c.id}}));
    }
    view.commit(batch); added.push(...batch.map(b => b.id));
  });
  return {found: found.length, added: added.length, already: found.length - added.length - missingNote.length, missing_note: missingNote.length};
}
