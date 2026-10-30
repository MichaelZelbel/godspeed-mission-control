// THE OLD FILES ARE RETIRED, NEVER DELETED, AND NEVER IN THE OWNER'S WAY (2026-10-30, #90).
//
// A reminder was a file due/<slug>.md and its closing a second file in world/events/. Ticket 02
// copied every one of them into the notebook's own records and keeps them level (due-copy.mjs);
// ticket 03 made tools/due.js read and write those records and nothing else (due-records.mjs).
// What is left is the files themselves, and this is what becomes of them.
//
// NOTHING IS RETIRED UNTIL THE CHECK AGREES. due-copy.mjs's sameThroughRecords runs the very same
// program over the files and over the records and holds every reminder's state, windows, `today`
// sentence and what closed it side by side. Only when it reports no difference for the whole set
// does anything move; a difference moves nothing and is said in the reminders in one plain
// sentence, the way a file that needs a look is said today, until it is fixed.
//
// AND HOW THEY ARE RETIRED DEPENDS ON WHOSE FILES THEY ARE.
//
// - Where the notebook owns them (no repository, or one the notebook made), they go to
//   archives/<day>-due-moved-to-the-notebook/ with the same paths below it. Moved, never deleted.
// - In folder mode, where the mission control is the owner's own Git repository and the notebook
//   commits only notebook/, not one of them is touched. They get one note beside them instead.
//   Why: deleting tracked files there would leave uncommitted changes in the owner's repository,
//   and their next `git pull` stops the moment another machine still on the old version commits a
//   change to one of those files. Michael's server takes every merge into main by itself, so that
//   is not a rare case but the expected one.
//
// A SECOND RUN RETIRES NOTHING MORE, and it needs no new bookkeeping to know that: in folder mode
// the note is there, and otherwise every file the copy took in has already left where it was.
//
// THE CALLER HOLDS THE WORKSPACE LOCK (tools/due.js, inTheNotebook). The lock is one writer at a
// time and is never re-entered, and this is called in the same breath as ticket 02's copy.
import fs from 'node:fs';
import path from 'node:path';
import { COPY_TYPE, sameThroughRecords, noteOf, writeNote } from './due-copy.mjs';
import { readSyncConfig } from './sync/git.mjs';

// The two sentences the owner finds in due/ in folder mode. Two, because that is all there is to
// say: where the reminders are now, and that nothing here is read any more.
export const MOVED_NOTE = 'due/MOVED-TO-THE-NOTEBOOK.md';
export const movedNoteText =
  '# These reminders live in the notebook now\n\n' +
  'Every reminder that was a file in this folder, and every closing that was a file in ' +
  '`world/events/`, is now a page under `notebook/Deadlines/` and a moment under ' +
  '`notebook/Timeline/`, where the notebook\'s sync carries it to your other computers by itself. ' +
  'Nothing in this folder is read any more, except to take in a change a computer still running an ' +
  'older version writes here, so the files below are left exactly as they are.\n';

// The mission control is the owner's own Git repository and the notebook commits only its own
// paths (notebook/core/sync/git.mjs, `godspeed sync folder`).
export const folderMode = store => readSyncConfig(store.state)?.repository === 'folder';
// Every old file the copy says it has taken in, and what each became. Anything else in due/ or
// world/events/ - a file nobody can read, a life event, an owner's own note - was never taken in
// and is never touched.
const takenIn = store => store.list(COPY_TYPE).filter(record => record.file && record.file_hash && !record.review_item);

// What `retireOldFiles` answers: {done, moved, note, differences, reason}. `differences` is what
// the reminders say in one plain sentence while anything is still out of step.
export function retireOldFiles(store, { day, force = false } = {}) {
  const root = store.root;
  const files = takenIn(store);
  const folder = folderMode(store);
  if (folder && fs.existsSync(path.join(root, ...MOVED_NOTE.split('/'))))
    return { done: true, moved: [], note: MOVED_NOTE, differences: [], reason: 'the note is already there' };
  const left = files.filter(record => fs.existsSync(path.join(root, ...record.file.split('/'))));
  if (!files.length || !left.length)
    return { done: true, moved: [], note: '', differences: [], reason: files.length ? 'everything taken in has been moved' : 'there is nothing to retire' };

  // The check is the whole program run twice over the same set, so it is asked once a day and only
  // when the old files changed since it last agreed, never on every reminder of every morning.
  const note = noteOf(root), seen = note.files || '';
  if (!force && note.checked && note.checked.day === day && note.checked.files === seen && note.checked.differences?.length)
    return { done: false, moved: [], note: '', differences: note.checked.differences, reason: 'the check already said so today' };
  const check = sameThroughRecords(store, { day });
  writeNote(root, { checked: { day, files: seen, differences: check.differences } });
  if (!check.same) return { done: false, moved: [], note: '', differences: check.differences, reason: 'the records and the files do not agree yet' };

  if (folder) {
    fs.writeFileSync(path.join(root, ...MOVED_NOTE.split('/')), movedNoteText);
    return { done: true, moved: [], note: MOVED_NOTE, differences: [], reason: 'folder mode: one note, and not one file changed' };
  }
  const into = 'archives/' + day + '-due-moved-to-the-notebook';
  const moved = [];
  for (const record of left) {
    const from = path.join(root, ...record.file.split('/'));
    const to = path.join(root, ...into.split('/'), ...record.file.split('/'));
    try {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      // Moved, never deleted. A rename across devices (an archive on another disk) answers EXDEV,
      // and then the copy is written first and only the file that is surely there is unlinked.
      try { fs.renameSync(from, to); }
      catch (error) {
        if (error.code !== 'EXDEV') throw error;
        fs.copyFileSync(from, to);
        if (fs.statSync(to).size !== fs.statSync(from).size) throw new Error('the copy into ' + into + ' did not come out whole');
        fs.unlinkSync(from);
      }
      moved.push(record.file);
    } catch (error) {
      // A file that could not be moved stays where it is and is tried again on the next run. It is
      // still a reminder in the notebook, so nothing of it is lost by waiting.
      if (process.env.GODSPEED_DUE_COPY === 'say') console.error('due-retire: ' + record.file + ': ' + error.message);
    }
  }
  return { done: moved.length === left.length, moved, note: '', differences: [], reason: 'moved into ' + into };
}
