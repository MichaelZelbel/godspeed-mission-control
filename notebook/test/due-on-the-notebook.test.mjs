// tools/due.js READS AND WRITES THE NOTEBOOK, AND THE OLD FILES ARE RETIRED (2026-10-30, #90).
//
// A reminder was a file due/<slug>.md and its closing a second file in world/events/, and on a
// mission control that is its own repository the notebook's sync carries only notebook/, so neither
// travelled unless a session committed it: on 19 October 2026 only the first of the two was
// committed and the morning brief asked its owner for nine mornings about something he had
// finished. Ticket 01 gave both a home inside notebook/, ticket 02 filled it from the old files,
// and this is the switch: the records are the storage, and what is left of the files is retired
// where that is safe.
//
// What is held here is the one thing that matters about a switch of storage: THE PROGRAM SAYS
// EXACTLY WHAT IT SAID. The same seeded mission control is read by the same program twice, once
// with the old files as its storage and once with the notebook's records, and `list`, `today` and
// `state --json` are compared byte for byte. Then: the files in archives/ where the notebook owns
// them, untouched with one note beside them in folder mode, a second run that changes nothing, and
// a reminder added and closed the way a user's assistant does it.
// Everything in here is made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { Store } from '../core/records/store.mjs';
import { copyOldReminders, sameThroughRecords } from '../core/due-copy.mjs';
import { MOVED_NOTE, movedNoteText, folderMode } from '../core/due-retire.mjs';
import { dueCommand } from '../core/native-due.mjs';
import { write, SEED, EVENTS } from './due-seed.mjs';

for (const key of Object.keys(process.env)) if (/^(GODSPEED_|HERMES_)/.test(key)) delete process.env[key];

const DAY = '2026-10-30';
const ARCHIVE = 'archives/' + DAY + '-due-moved-to-the-notebook';
const due = fileURLToPath(new URL('../../tools/due.js', import.meta.url));
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const { createDueCommands } = createRequire(import.meta.url)('../../tools/due.js');
// One command of the program, and the words it answered with. `files: true` is the storage every
// version before 30 October 2026 read; without it, the notebook's records are.
function spoken(root, args, how) {
  const out = [], log = console.log;
  console.log = (...said) => out.push(said.join(' '));
  try { createDueCommands({ root, commandArgs: args, date: DAY, ...how }).run(); } finally { console.log = log; }
  return out.join('\n');
}

function seeded(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'godspeed-due-switch-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root);
  return root;
}
// The program, run the way a person runs it, with the day fixed so every sentence is the same on
// every run of this test.
const say = (root, ...args) => execFileSync(process.execPath, [due, '--godspeed', root, ...args],
  { encoding: 'utf8', windowsHide: true, env: { ...process.env, GODSPEED_TODAY: DAY }, stdio: ['ignore', 'pipe', 'pipe'] });
const files = (root, folder) => {
  try { return fs.readdirSync(path.join(root, ...folder.split('/'))).filter(name => name.endsWith('.md')).sort(); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
};
// Every file of a mission control with its bytes, apart from this computer's own state: what "a
// second run changes nothing" is measured against.
function everything(root) {
  const out = new Map(), walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.godspeed' || entry.name === '.git') continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else out.set(path.relative(root, file).split(path.sep).join('/'), fs.readFileSync(file, 'utf8'));
    }
  };
  walk(root);
  return out;
}

// ---------------------------------------------------------------- the same words, the other storage

test('the same program says the same thing from the files and from the records', t => {
  const root = seeded(t);
  // `files: true` is the storage every version before this read; without it, the notebook's
  // records are. The same folder, the same day, the same program.
  const store = new Store(root, { device: 'pc' });
  store.save('settings', { id: 'installation', owner: 'pc', timezone: 'UTC' });
  copyOldReminders(store, { day: DAY });
  const check = sameThroughRecords(store, { day: DAY });
  assert.deepEqual(check.differences, [], 'every reminder says the same through the records');
  assert.deepEqual(check.needsALook, ['broken'], 'and the file that does not read is named, through both');

  // And what a person actually reads: the three answers, byte for byte. Two copies of one seeded
  // mission control, because each storage changes what it keeps as it answers (a window grows, the
  // brief writes down what it said), and the two must do the same thing from the same start.
  const onFiles = seeded(t), onRecords = seeded(t);
  for (const args of [['list'], ['today'], ['state', '--json']]) {
    assert.equal(spoken(onRecords, args, {}), spoken(onFiles, args, { files: true, copy: false }), 'mc-due ' + args.join(' '));
  }
});

// ---------------------------------------------------------------- retired, never deleted

test('where the notebook owns the files they go to the archive, and a second run changes nothing', t => {
  const root = seeded(t);
  const said = say(root, 'state');
  assert.match(said, /OPEN\s+deadline-only/, 'it answers from the records: ' + said.split('\n')[0]);

  // Every file that was taken in is out of the owner's way, byte for byte as it was.
  for (const [name, text] of Object.entries(SEED)) {
    if (name === 'broken') continue;
    assert.equal(fs.readFileSync(path.join(root, ARCHIVE, 'due', name + '.md'), 'utf8'), text, name + ' is in the archive as it was');
  }
  for (const [name, text] of Object.entries(EVENTS)) {
    assert.equal(fs.readFileSync(path.join(root, ARCHIVE, 'world', 'events', name), 'utf8'), text, name + ' too');
  }
  assert.deepEqual(files(root, 'due'), ['broken.md'], 'only the file nobody can read is left where it is');
  assert.deepEqual(files(root, 'world/events'), [], 'and no closing is left in the owner\'s way');
  assert.match(say(root, 'list'), /due\/broken\.md/, 'which is still said in the list, every day until it is fixed');
  assert.ok(fs.existsSync(path.join(root, 'secrets', 'expires.txt')), 'the list of what runs out stays where it is');
  assert.match(say(root, 'state'), /key-made-up-api-key/, 'and the key in it is still a reminder');

  const before = everything(root);
  say(root, 'state');
  assert.deepEqual([...everything(root)], [...before], 'a second run changes not one byte');
});

test('in folder mode not one file is changed, and one note is left beside them', t => {
  const root = seeded(t);
  git(root, 'init', '--initial-branch=main');
  git(root, 'config', 'user.name', 'A Tester');
  git(root, 'config', 'user.email', 'tester@localhost');
  git(root, 'config', 'core.autocrlf', 'false');
  fs.writeFileSync(path.join(root, '.gitignore'), '/.godspeed/\n/conflicts/\n');
  fs.mkdirSync(path.join(root, '.godspeed'), { recursive: true });
  // The mission control is the owner's own repository and the notebook commits only notebook/
  // (`godspeed sync folder`). Deleting a tracked file here would leave them uncommitted changes,
  // and their next `git pull` would stop the moment another machine still on the old version
  // committed a change to one of these files.
  fs.writeFileSync(path.join(root, '.godspeed', 'sync-config.json'), JSON.stringify({ enabled: true, repository: 'folder', paths: ['notebook'] }));
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'the mission control as it stands');
  assert.equal(git(root, 'status', '--porcelain'), '', 'everything the owner keeps is committed');
  assert.equal(folderMode(new Store(root, { device: 'pc' })), true);
  const mine = new Map([...everything(root)].filter(([name]) => name.startsWith('due/') || name.startsWith('world/')));

  say(root, 'state');

  const now = new Map([...everything(root)].filter(([name]) => name.startsWith('due/') || name.startsWith('world/')));
  now.delete(MOVED_NOTE);
  assert.deepEqual([...now], [...mine], 'not one byte of due/ or world/ was changed');
  assert.equal(fs.existsSync(path.join(root, 'archives')), false, 'and nothing was moved into an archive');

  const note = fs.readFileSync(path.join(root, ...MOVED_NOTE.split('/')), 'utf8');
  assert.match(note, /notebook\/Deadlines\//, 'the note says where the reminders are now');
  assert.match(note, /read/, 'and that nothing here is read except to take in an older version\'s change');
  // What the owner's own repository has to say about it: that one note, and nothing else. What the
  // notebook keeps under notebook/ is the notebook's own, committed by its sync.
  const left = git(root, 'status', '--porcelain').split('\n').filter(line => line.trim())
    .map(line => line.slice(3).replace(/^"/, '').replace(/"$/, '')).filter(name => !name.startsWith('notebook/'));
  assert.deepEqual(left, [MOVED_NOTE], 'git status says only that one note: ' + left.join(' | '));

  const before = everything(root);
  say(root, 'state');
  assert.deepEqual([...everything(root)], [...before], 'and a second run retires nothing more');

  // The note is never read as a reminder. Until 31 October 2026 it was a .md file, which every
  // reader of due/ took for one, and the reminders said each day that its file needed a look.
  assert.doesNotMatch(say(root, 'state'), /MOVED-TO-THE-NOTEBOOK/, 'the note is not a reminder');
  // The one machine that got the .md note has it renamed, and nothing else changes.
  fs.renameSync(path.join(root, ...MOVED_NOTE.split('/')), path.join(root, 'due', 'MOVED-TO-THE-NOTEBOOK.md'));
  const state = say(root, 'state');
  assert.equal(fs.existsSync(path.join(root, 'due', 'MOVED-TO-THE-NOTEBOOK.md')), false, 'the old note is gone');
  assert.equal(fs.readFileSync(path.join(root, ...MOVED_NOTE.split('/')), 'utf8'), movedNoteText, 'under its new name');
  assert.doesNotMatch(state, /MOVED-TO-THE-NOTEBOOK/, 'and it is not a reminder either');
  // Both names at once (the old note came back from another machine): the old copy goes.
  fs.writeFileSync(path.join(root, 'due', 'MOVED-TO-THE-NOTEBOOK.md'), movedNoteText);
  const both = say(root, 'state');
  assert.equal(fs.existsSync(path.join(root, 'due', 'MOVED-TO-THE-NOTEBOOK.md')), false, 'the old copy is gone');
  assert.equal(fs.readFileSync(path.join(root, ...MOVED_NOTE.split('/')), 'utf8'), movedNoteText, 'the note stays');
  assert.doesNotMatch(both, /MOVED-TO-THE-NOTEBOOK/, 'and neither is a reminder');
});

test('a difference retires nothing, and is said in the reminders in one plain sentence', t => {
  const root = seeded(t);
  const store = new Store(root, { device: 'pc' });
  store.save('settings', { id: 'installation', owner: 'pc', timezone: 'UTC' });
  // Ticket 02's copy on its own, so the records are there and nothing has been retired yet.
  copyOldReminders(store, { day: DAY });
  // A page that no longer says what its file says, and no file changed to explain it: exactly what
  // nobody may retire a file over. (In life this is a fault to be found, which is why it is said.)
  const page = store.list('deadlines').find(r => r.native_slug === 'deadline-only');
  assert.ok(page, 'the reminder is a page');
  store.save('deadlines', { id: page.id, windows: [{ start: '2026-10-01', deadline: '2026-11-09', target: '', moved: '', extra: [] }] });

  const said = say(root, 'list');
  assert.match(said, /do not agree yet, so nothing in due\/ has been moved aside/, 'the list says so: ' + said.split('\n')[0]);
  assert.match(said, /deadline-only/);
  assert.ok(fs.existsSync(path.join(root, 'due', 'deadline-only.md')), 'and not one file was moved');
  assert.equal(fs.existsSync(path.join(root, 'archives')), false);
  assert.match(say(root, 'today'), /do not agree yet/, 'and the morning brief says it too');
});

// ---------------------------------------------------------------- the way a user's assistant runs it

test('a reminder added and closed through the notebook is a page and a moment, and nothing else', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'godspeed-due-switch-new-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '');
  const store = new Store(root, { device: 'pc' });
  store.save('settings', { id: 'installation', owner: 'pc', timezone: 'UTC' });

  const made = dueCommand(store, ['add', 'dentist', '--title', 'See the dentist', '--target', '2026-12-01',
    '--done-when', 'the appointment has happened']);
  assert.match(made.result, /Made dentist/, made.result);
  const closed = dueCommand(store, ['done', 'dentist', '--evidence', 'the receipt is in my mail']);
  assert.match(closed.result, /^Closed dentist/, closed.result);
  assert.match(dueCommand(store, ['state']).result, /CLOSED\s+dentist/);

  assert.deepEqual(files(root, 'notebook/Deadlines'), ['See the dentist.md'], 'the reminder is a page a person can read');
  assert.equal(files(root, 'notebook/Timeline').length, 1, 'and its closing a moment on the timeline');
  const moment = fs.readFileSync(path.join(root, 'notebook', 'Timeline', files(root, 'notebook/Timeline')[0]), 'utf8');
  assert.match(moment, /title: "Done: See the dentist"/);
  assert.match(moment, /evidence: you said so; the receipt is in my mail/);
  assert.match(moment, /deadline_id: due-dentist/);
  assert.deepEqual(files(root, 'due'), [], 'and no file in due/');
  assert.deepEqual(files(root, 'world/events'), [], 'nor in world/events/');
});
