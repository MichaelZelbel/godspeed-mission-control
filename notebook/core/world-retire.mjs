// THE OLD WORLD FILES ARE RETIRED, NEVER DELETED, AND NEVER IN THE OWNER'S WAY (#90, second slice).
//
// world/events/, world/claims/ and world/entities/ held one file per life event, claim and entity.
// world-copy.mjs copied every one into the notebook's records and keeps the whole text of each in a
// `world_copies` record; the readers read the records. What is left is the files, and this is what
// becomes of them, by the rules due-retire.mjs set for due/ and for the same reasons:
//
// - NOTHING MOVES UNTIL THE CHECK AGREES, for the whole set: every file the copy took in is still
//   the very text it copied, and the record it became is in the notebook. A file edited since the
//   copy is left for the next copy to take in; a record that is not there moves nothing, and is said
//   in one plain sentence where the owner reads (notices.mjs), once.
// - Where the notebook owns the files they go to archives/<day>-world-moved-to-the-notebook/ with
//   the same paths below it. Moved, never deleted.
// - In folder mode (the mission control is the owner's own Git repository) not one file is touched:
//   deleting tracked files there would stop the next `git pull` as soon as another machine still on
//   the old version commits a change to one of them. One note beside them instead, not a .md file,
//   because every reader of these folders takes each .md file there for a record.
//
// A file the copy could not take in is in no `world_copies` record and is never touched.
// THE CALLER HOLDS THE WORKSPACE LOCK, and calls this in the same breath as the copy.
import fs from 'node:fs';
import path from 'node:path';
import { hash } from './records/store.mjs';
import { COPY_TYPE, copyOldWorld, oldFiles } from './world-copy.mjs';
import { read, writable, dayOf } from './due-copy.mjs';
import { folderMode, moveInto } from './due-retire.mjs';
import { queueNotice } from './notices.mjs';

export const MOVED_NOTE = 'world/MOVED-TO-THE-NOTEBOOK.txt';
export const movedNoteText =
  '# Your events, facts and people live in the notebook now\n\n' +
  'Every life event, fact and entity that was a file in `world/events/`, `world/claims/` and ' +
  '`world/entities/` is now a moment on the timeline, a fact and a World page under `notebook/`, ' +
  'where the notebook\'s sync carries it to your other computers by itself. Nothing in these ' +
  'folders is read any more, except to take in a change a computer still running an older version ' +
  'writes here, so the files are left exactly as they are.\n';

const TYPES = { entities: 'entities', claims: 'claims', moments: 'moments' };

// What `retireOldWorld` answers: {done, moved, note, differences, reason}.
export function retireOldWorld(store, { day }) {
  const root = store.root, folder = folderMode(store), note = path.join(root, ...MOVED_NOTE.split('/'));
  if (folder && fs.existsSync(note)) return { done: true, moved: [], note: MOVED_NOTE, differences: [], reason: 'the note is already there' };
  const taken = store.list(COPY_TYPE).filter(record => record.file && record.file_hash);
  const left = taken.filter(record => fs.existsSync(path.join(root, ...record.file.split('/'))));
  if (!taken.length || !left.length)
    return { done: true, moved: [], note: '', differences: [], reason: taken.length ? 'everything taken in has been moved' : 'there is nothing to retire' };

  const differences = [], ready = [];
  for (const record of left) {
    const text = read(path.join(root, ...record.file.split('/')));
    if (text === null || hash(text) !== record.file_hash) continue;
    const type = TYPES[record.record_type];
    if (type && !store.list(type, { removed: true }).some(r => r.uid === record.record_uid)) differences.push(record.file + ': the notebook has no record for it');
    else ready.push(record.file);
  }
  if (differences.length) {
    for (const text of differences) {
      try {
        queueNotice(store, { id: 'world-retire-' + hash(text).slice(0, 20), about: text.split(':')[0], step: 'world-retire',
          text: 'Godspeed did not move the old files of your world out of the way, because ' + text + '. They stay where they are and nothing is lost; it tries again on the next run.' });
      } catch { /* said again on the next run */ }
    }
    return { done: false, moved: [], note: '', differences, reason: 'the records and the files do not agree yet' };
  }
  if (left.length !== ready.length) return { done: false, moved: [], note: '', differences: [], reason: 'a file changed since it was copied; the next copy takes it in' };

  if (folder) {
    fs.writeFileSync(note, movedNoteText);
    return { done: true, moved: [], note: MOVED_NOTE, differences: [], reason: 'folder mode: one note, and not one file changed' };
  }
  const into = 'archives/' + day + '-world-moved-to-the-notebook';
  const moved = moveInto(root, into, ready);
  return { done: moved.length === ready.length, moved, note: '', differences: [], reason: 'moved into ' + into };
}

// The copy and then the retirement, under one lock. For every caller that takes the old files in.
export function takeInOldWorld(store, { day, timeoutMs = 30000 } = {}) {
  const work = () => ({ copy: copyOldWorld(store), retire: retireOldWorld(store, { day }) });
  return store.holding ? work() : store.withLockSoon(work, { timeoutMs });
}

// Once when the notebook starts (server/main.mjs): waits for the workspace without holding the
// notebook up, and does nothing when there is no old file to take in or to retire.
export async function takeInWorldAtStart(store, { timeoutMs = 60000, signal } = {}) {
  if (!writable(store)) return { skipped: 'not writable' };
  if (!oldFiles(store.root).length && !store.list(COPY_TYPE).some(r => r.file && fs.existsSync(path.join(store.root, ...r.file.split('/'))))) return { skipped: 'nothing to take in' };
  return store.withLockAsync(() => takeInOldWorld(store, { day: dayOf(store) }), { timeoutMs, signal });
}
