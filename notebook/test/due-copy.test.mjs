// EVERY OLD REMINDER AND CLOSING IS COPIED INTO THE NOTEBOOK, AND KEPT LEVEL (2026-10-30, #90).
//
// A reminder with a day attached is still a file due/<slug>.md written by tools/due.js, and its
// closing or drop still a second file in world/events/; on a mission control that is its own
// repository the notebook's sync carries only notebook/, so neither file travels unless a session
// commits it, and on 19 October 2026 only the first of the two was committed. Ticket 01 gave both a
// home inside notebook/; this fills it, while tools/due.js goes on reading and writing the files.
//
// These tests hold the copy to what the ticket asks: a seeded mission control copied with nothing
// lost (the check of item 5 says so, by running the same program over the files and over the
// records), nothing of the owner's touched, a second run that changes nothing, two machines that
// end with one record each, a late file and a late closing taken in, a changed file that updates
// its page, a changed file whose page also changed kept as one review item, a file that does not
// read left alone, and a year of the brief's daily mentions that does not fill the notebook. The
// last four, at the end, are what a second review found missing afterwards: a page kept for review
// that must stay the owner's, the copy of tools/due.js in the assistant's command folder, the list
// Settings reads, and an edited closing event.
// Everything in here is made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Store, hash } from '../core/records/store.mjs';
import { QueryService } from '../core/query.mjs';
import { FileSync } from '../core/sync/git.mjs';
import { deadlineUid } from '../core/deadline-records.mjs';
import { fileURLToPath } from 'node:url';
import { copyOldReminders, sameThroughRecords, liveMoments, COPY_TYPE, BOTH_CHANGED } from '../core/due-copy.mjs';
import { dueCommand, dueDelivered, dueRows } from '../core/native-due.mjs';

for (const key of Object.keys(process.env)) if (/^(GODSPEED_|HERMES_)/.test(key)) delete process.env[key];

const DAY = '2026-10-30';
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();

// The seeded mission control, in one place for every test and for ticket 03's own checks.
import { SEED, EVENTS, write } from './due-seed.mjs';

function seeded(t, { device = 'pc' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'godspeed-due-copy-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root);
  const store = new Store(root, { device });
  store.save('settings', { id: 'installation', owner: device, timezone: 'UTC' });
  return store;
}
const pages = store => filesIn(path.join(store.root, 'notebook', 'Deadlines'));
const timeline = store => filesIn(path.join(store.root, 'notebook', 'Timeline'));
function filesIn(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isFile()).map(e => e.name).sort(); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
// Every file under notebook/, with its bytes: what one copy added, and what a second one did not.
function notebookFiles(root) {
  const out = new Map(), walk = dir => {
    for (const entry of filesIn0(dir)) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else out.set(path.relative(root, file).split(path.sep).join('/'), fs.readFileSync(file, 'utf8'));
    }
  };
  walk(path.join(root, 'notebook'));
  return out;
}
const filesIn0 = dir => { try { return fs.readdirSync(dir, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return []; throw error; } };
// The owner's own files, as they are this moment.
function oldFiles(root) {
  const out = new Map();
  for (const folder of ['due', 'world/events']) {
    for (const name of filesIn(path.join(root, ...folder.split('/')))) out.set(folder + '/' + name, fs.readFileSync(path.join(root, ...folder.split('/'), name), 'utf8'));
  }
  return out;
}
const slugsOf = store => store.list('deadlines').filter(r => r.native_slug).map(r => r.native_slug).sort();
const closings = store => store.list('moments').filter(r => r.category === 'obligation');

// ---------------------------------------------------------------- the seeded set, copied

test('the seeded set is copied, and every reminder says the same through the records', t => {
  const store = seeded(t);
  // The key in secrets/expires.txt becomes a file in due/ the moment tools/due.js runs, and that
  // run is also what copies: this is the path a command, the brief and the 08:00 reminders take.
  dueCommand(store, ['state']);

  assert.deepEqual(slugsOf(store),
    ['deadline-only', 'key-made-up-api-key', 'letter-pay', 'old-plan', 'present', 'rates', 'tax-return'],
    'every reminder that reads has a page, the key picked up out of secrets/expires.txt included');
  assert.ok(!slugsOf(store).includes('broken'), 'and the file that does not read has none');
  assert.deepEqual(pages(store).sort(), ['Buy Priya a present.md', 'Move the shed.md', 'Pay the invented water bill.md',
    'Pay the quarterly rates.md', 'Service the boiler.md', 'The key that signs the invented receipts needs replacing.md',
    'The tax return.md'], 'each one a page a person can read: ' + pages(store).join(', '));

  // The uid is derived from the file's name, as ticket 01 derives it, and the id is the one the
  // notebook's rows have always given this reminder.
  const rates = store.list('deadlines').find(r => r.native_slug === 'rates');
  assert.equal(rates.uid, deadlineUid('rates'));
  assert.equal(rates.id, 'due-rates');
  // Three windows, and the ones tools/due.js has opened since (growWindows) on top.
  assert.ok(rates.windows.length >= 3, 'every window, three of them seeded: ' + rates.windows.length);
  assert.equal(rates.windows[1].moved, '2026-06-22', 'with the day one of them was moved to');
  assert.deepEqual(rates.windows[2].extra, ['asked'], 'and the word on the line that nothing knows, kept');
  const letter = store.list('deadlines').find(r => r.native_slug === 'letter-pay');
  assert.equal(letter.addon, 'an-addon');
  assert.equal(letter.addon_key, 'a1b2c3#1');
  assert.equal(letter.calendar_marker, 'made-up-calendar:7', 'an add-on obligation keeps whose it is and its calendar entry');

  // A closing and a drop are moments on the timeline, each naming its reminder by uid.
  assert.equal(closings(store).length, 2);
  const done = closings(store).find(m => m.obligation_kind === 'closes');
  assert.equal(done.title, 'Done: Pay the quarterly rates');
  assert.equal(done.happened_at, '2026-03-12');
  assert.equal(done.obligation_window, '2026-01-05');
  assert.equal(done.evidence, 'the statement of 12 March shows the payment');
  assert.equal(done.moved_from, 'world/events/2026-03-12-rates-closed.md');
  assert.deepEqual(done.references, [{ type: 'deadlines', id: 'due-rates', uid: deadlineUid('rates'), field: 'deadline_id' }]);
  const dropped = closings(store).find(m => m.obligation_kind === 'drops');
  assert.equal(dropped.title, 'Dropped: Move the shed');
  assert.deepEqual(timeline(store), ['2026-03-12 Done Pay the quarterly rates.md', '2026-10-05 Dropped Move the shed.md']);
  assert.deepEqual(store.problems, [], 'and nothing in the notebook is a problem');

  // The check ticket 03 relies on: the same state, the same windows and the same `today` sentence.
  const check = sameThroughRecords(store, { day: DAY });
  assert.deepEqual(check.differences, [], 'no difference between the files and the records');
  assert.equal(check.same, true);
  assert.deepEqual(check.needsALook, ['broken'], 'the file that does not read is named, not copied');

  // And the readers see exactly what they saw: one row per reminder, not two.
  const rows = new QueryService(store).rows('deadlines');
  assert.equal(rows.filter(r => r.native_slug === 'rates').length, 1, 'one row for the reminder, not one for the page as well');
  assert.equal(rows.length, dueRows(store).length, 'and the list is the one the files give');
});

test('per old file, the hash that was copied, and a second run that changes nothing', t => {
  const store = seeded(t);
  dueCommand(store, ['state']);
  const book = store.list(COPY_TYPE);
  // Six reminders that read, plus the two closing events. The seventh reminder is the one made out
  // of secrets/expires.txt, which is a page straight away now and never a file to copy.
  assert.equal(book.length, 8, 'one note per old file: ' + book.map(r => r.file).join(', '));
  const rates = book.find(r => r.file === 'due/rates.md');
  assert.equal(rates.file_hash, hash(SEED.rates), 'the hash of the file it took in, which is now in archives/');
  assert.equal(rates.record_uid, deadlineUid('rates'));
  assert.equal(rates.kind, 'reminder');
  assert.equal(book.find(r => r.file === 'world/events/2026-10-05-old-plan-dropped.md').kind, 'closing');
  assert.ok(!book.some(r => r.file === 'due/broken.md'), 'a file that does not read is not remembered as copied');
  assert.equal(fs.readFileSync(path.join(store.root, 'due', 'broken.md'), 'utf8'), SEED.broken,
    'and it stays where it is, to be said in the reminders every day until it is fixed');
  // And every file that WAS taken in is out of the owner's way, byte for byte as it was
  // (notebook/core/due-retire.mjs). Nothing is deleted, ever.
  // dueCommand is the notebook's own command and runs on the real day, so the folder is that day's
  // (fixed on 31 October 2026, when a DAY written here failed the first run after midnight).
  const moved = fs.readdirSync(path.join(store.root, 'archives')).filter(name => name.endsWith('-due-moved-to-the-notebook'));
  assert.equal(moved.length, 1, 'one archive folder: ' + moved.join(', '));
  const archive = path.join(store.root, 'archives', moved[0]);
  assert.equal(fs.readFileSync(path.join(archive, 'due', 'rates.md'), 'utf8'), SEED.rates);
  assert.equal(fs.existsSync(path.join(store.root, 'due', 'rates.md')), false, 'and is not in due/ any more');
  assert.equal(store.file(rates).split(path.sep).slice(-3).join('/'), '_system/due_copies/' + rates.id + '.json',
    'it is bookkeeping, in the system folder, where it syncs with everything else');

  const before = notebookFiles(store.root);
  const again = copyOldReminders(store, { day: DAY });
  assert.equal(again.unchanged, true, 'a second run has nothing to do');
  assert.deepEqual(again.copied, []);
  assert.deepEqual(again.updated, []);
  assert.deepEqual([...notebookFiles(store.root)], [...before], 'and the notebook is byte for byte what it was');
  assert.equal(store.list('record_history').length, 0, 'no copy of anything was kept: the copy prunes its own');
});

test('in a mission control that is its own Git repository, the copy touches nothing of the owner', t => {
  const store = seeded(t);
  dueCommand(store, ['state']);
  const root = store.root;
  git(root, 'init', '--initial-branch=main');
  git(root, 'config', 'user.name', 'A Tester');
  git(root, 'config', 'user.email', 'tester@localhost');
  // A folder-mode mission control, as the kit leaves one: the owner's repository carries their
  // folders, its .gitignore keeps this computer's own state out of it (.godspeed/ holds the
  // workspace lock, what changed, and this copy's own note of the files it has seen), and the
  // notebook's sync commits notebook/ and nothing else.
  fs.writeFileSync(path.join(root, '.gitignore'), '/.godspeed/\n/conflicts/\n');
  fs.writeFileSync(path.join(root, '.godspeed', 'sync-config.json'), JSON.stringify({ enabled: true, repository: 'folder', paths: ['notebook'] }));
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'the mission control as it stands');
  assert.equal(git(root, 'status', '--porcelain'), '', 'everything the owner keeps is committed');

  // A reminder and a closing written the old way, committed: what one machine still on the old
  // version sends to the others.
  fs.writeFileSync(path.join(root, 'due', 'passport.md'), `TITLE: Renew the passport
DONE-WHEN: The new passport is in the drawer.
COST-IF-MISSED: No travel.
SELF-CHECK: none
REPEATS: no
SOURCE: me, 2026-10-29

## Windows
STRIP: 2026-10-29 2027-03-31

## Log
- 2026-10-29 created, window 2026-10-29 to 2027-03-31
`);
  fs.writeFileSync(path.join(root, 'world', 'events', '2026-10-28-boiler-closed.md'), `---
date: 2026-10-28
participants: [me]
closes: [due/deadline-only]
evidence: the engineer left a receipt
source: me, in a session
---

Service the boiler: finished.
`);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'a reminder and a closing written the old way');
  const status = git(root, 'status', '--porcelain');
  const mine = oldFiles(root);

  const report = copyOldReminders(store, { day: DAY });
  assert.deepEqual(report.copied, ['passport'], 'the late reminder became a page');
  assert.ok(report.closed.some(title => title === 'Done: Service the boiler'), 'and the late closing a moment: ' + report.closed.join(', '));

  assert.deepEqual([...oldFiles(root)], [...mine], 'not one byte of due/ or world/events/ changed');
  assert.equal(git(root, 'status', '--porcelain', '--', 'due', 'world'), '', 'so the owner\'s repository has nothing to say about them');
  // Git puts a name with a space in it in quotes, so the quote comes off before the folder is read.
  const named = line => line.slice(3).replace(/^"/, '');
  const left = git(root, 'status', '--porcelain').split('\n').filter(line => line.trim() && !named(line).startsWith('notebook/'));
  assert.deepEqual(left, status ? status.split('\n') : [], 'and nothing else outside the notebook changed either: ' + left.join(' | '));

  const check = sameThroughRecords(store, { day: DAY });
  assert.deepEqual(check.differences, [], 'the records still say what the files say');
  assert.equal(new QueryService(store).rows('deadlines').find(r => r.native_slug === 'deadline-only').status, 'closed',
    'and the closing written the old way is what the reader sees, as before');
});

// ---------------------------------------------------------------- kept level

test('a changed reminder file updates its page while the page has not changed since', t => {
  const store = seeded(t);
  dueCommand(store, ['state']);
  const before = store.list('deadlines').find(r => r.native_slug === 'tax-return');

  // The old way: a new day written into the file by tools/due.js itself.
  dueCommand(store, ['target', 'tax-return', '2027-02-10']);
  const after = store.list('deadlines').find(r => r.native_slug === 'tax-return');
  assert.equal(after.uid, before.uid, 'the same reminder, not a second one');
  assert.equal(after.windows[0].moved, '2027-02-10', 'the page follows the file');
  assert.equal(store.list('deadlines').filter(r => r.native_slug === 'tax-return').length, 1);
  assert.deepEqual(sameThroughRecords(store, { day: DAY }).differences, []);

  // The brief's daily line is such a change too, and it must not make a second page either.
  dueDelivered(store, ['present'], new Date(DAY + 'T07:00:00Z'));
  const present = store.list('deadlines').find(r => r.native_slug === 'present');
  assert.match(present.log, new RegExp('- ' + DAY + ' SAID brief'), 'the line the brief writes is in the page\'s log');
  assert.equal(store.list('deadlines').filter(r => r.native_slug === 'present').length, 1);
});

test('when the file and the page both changed, the page is kept and both are one review item', t => {
  const store = seeded(t);
  dueCommand(store, ['state']);
  const page = store.list('deadlines').find(r => r.native_slug === 'present');

  // The owner changes the page in the notebook...
  store.save('deadlines', { id: page.id, title: 'Buy Priya a birthday present' });
  // ...and a computer still running an older version writes the file again, the old way.
  fs.writeFileSync(path.join(store.root, 'due', 'present.md'),
    SEED.present.replace('TITLE: Buy Priya a present', 'TITLE: Buy Priya a book'));

  const report = copyOldReminders(store, { day: DAY });
  assert.equal(report.reviews.length, 1, 'one review item');
  const kept = store.list('deadlines').find(r => r.native_slug === 'present');
  assert.equal(kept.title, 'Buy Priya a birthday present', 'the notebook\'s version stays');
  assert.equal(store.list('deadlines').filter(r => r.native_slug === 'present').length, 1, 'and there is no second reminder');

  const item = store.get('review_queue', report.reviews[0]);
  assert.equal(item.suggestion_type, BOTH_CHANGED);
  assert.equal(item.status, 'pending_review');
  assert.equal(item.payload.from_the_file.title, 'Buy Priya a book', 'the file\'s version is in it');
  assert.equal(item.payload.in_the_notebook.title, 'Buy Priya a birthday present', 'and the notebook\'s');
  assert.match(item.description, /due\/present\.md/);

  // However often it runs, it is one item and the page is still the owner's.
  assert.deepEqual(copyOldReminders(store, { day: DAY }).reviews, []);
  copyOldReminders(store, { day: DAY });
  assert.equal(store.list('review_queue').filter(r => r.suggestion_type === BOTH_CHANGED).length, 1);
  assert.equal(store.list('deadlines').find(r => r.native_slug === 'present').title, 'Buy Priya a birthday present');
});

test('a page somebody deleted is written again, and a file that does not read is left alone', t => {
  const store = seeded(t);
  dueCommand(store, ['state']);
  const page = store.list('deadlines').find(r => r.native_slug === 'rates');
  fs.rmSync(store.file(page));
  // And the file comes back, the way a computer still on an older version writes it.
  fs.writeFileSync(path.join(store.root, 'due', 'rates.md'), SEED.rates);
  const fresh = new Store(store.root, { device: 'pc' });
  assert.equal(fresh.list('deadlines').filter(r => r.native_slug === 'rates').length, 0, 'the page is gone');

  const report = copyOldReminders(fresh, { day: DAY });
  assert.deepEqual(report.copied, ['rates'], 'a reminder that is in due/ is a reminder this machine holds');
  assert.equal(fresh.list('deadlines').find(r => r.native_slug === 'rates').uid, deadlineUid('rates'));
  assert.deepEqual(report.needsALook, ['due/broken.md']);
  assert.equal(fs.readFileSync(path.join(store.root, 'due', 'broken.md'), 'utf8'), SEED.broken, 'and the file nobody can read is untouched');
});

test('a closing of a reminder that is not there waits, and lands when the reminder does', t => {
  const store = seeded(t);
  copyOldReminders(store, { day: DAY });
  // A closing written the old way, for a reminder whose file has not arrived yet (another machine
  // committed the one and not the other: the incident of 19 October 2026, the other way round).
  fs.writeFileSync(path.join(store.root, 'world', 'events', '2026-10-29-passport-closed.md'), `---
date: 2026-10-29
participants: [me]
closes: [due/passport]
evidence: the new passport is in the drawer
source: me, in a session
---

Renew the passport: finished.
`);
  const waited = copyOldReminders(store, { day: DAY });
  assert.deepEqual(waited.waiting, ['world/events/2026-10-29-passport-closed.md'],
    'a moment may not name a reminder that is not there, so it waits');
  assert.equal(closings(store).length, 2, 'and nothing was made up in the meantime');
  assert.ok(!store.list(COPY_TYPE).some(r => r.file.includes('passport')), 'nor is the file remembered as copied');

  fs.writeFileSync(path.join(store.root, 'due', 'passport.md'), `TITLE: Renew the passport
DONE-WHEN: The new passport is in the drawer.
COST-IF-MISSED: No travel.
SELF-CHECK: none
REPEATS: no
SOURCE: me, 2026-10-01

## Windows
STRIP: 2026-10-01 2027-03-31

## Log
- 2026-10-01 created, window 2026-10-01 to 2027-03-31
`);
  const landed = copyOldReminders(store, { day: DAY });
  assert.deepEqual(landed.copied, ['passport']);
  assert.deepEqual(landed.waiting, []);
  assert.ok(landed.closed.includes('Done: Renew the passport'), 'and the closing that waited is a moment now');
  assert.deepEqual(sameThroughRecords(store, { day: DAY }).differences, []);
  assert.equal(copyOldReminders(store, { day: DAY }).unchanged, true);
});

// ---------------------------------------------------------------- two machines

test('two machines copy the same folder and end, after both have synced, with one record each', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'godspeed-due-copy-two-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const remote = path.join(root, 'remote.git');
  fs.mkdirSync(remote);
  git(remote, 'init', '--bare', '--initial-branch=main');
  const machine = (name, first) => {
    const dir = path.join(root, name);
    git(root, 'clone', '-q', '-c', 'core.autocrlf=false', remote, dir);
    git(dir, 'config', 'user.name', name);
    git(dir, 'config', 'user.email', name + '@localhost');
    if (first) write(dir);
    const store = new Store(dir, { device: name }), sync = new FileSync(store);
    sync.initialize('https://github.com/synthetic/private.git');
    if (first) store.save('settings', { id: 'installation', owner: 'the owner', timezone: 'UTC' });
    return { dir, store, sync, name };
  };
  // One mission control on two machines: the second one joined the first, so both hold the same
  // reminders and the same closings before either of them has copied anything.
  const desktop = machine('desktop', true);
  assert.equal(desktop.sync.reconcile().state, 'synced');
  const laptop = machine('laptop', false);
  assert.equal(laptop.sync.reconcile().state, 'synced');
  assert.deepEqual(filesIn(path.join(laptop.dir, 'due')).sort(), filesIn(path.join(desktop.dir, 'due')).sort(),
    'the second machine holds the same reminders');
  // secrets/ is never synced (file-policy.mjs): every machine has its own copy of the list of
  // what runs out, so the second one is given it here as the installer gives it.
  fs.mkdirSync(path.join(laptop.dir, 'secrets'), { recursive: true });
  fs.copyFileSync(path.join(desktop.dir, 'secrets', 'expires.txt'), path.join(laptop.dir, 'secrets', 'expires.txt'));

  // Both take this version and copy, before either syncs again.
  for (const one of [desktop, laptop]) {
    dueCommand(one.store, ['state']);
    assert.equal(slugsOf(one.store).length, 7, one.name + ' copied every reminder that reads');
  }
  assert.equal(desktop.sync.reconcile().state, 'synced');
  assert.equal(laptop.sync.reconcile().state, 'synced', 'and neither machine has anything for its owner to settle');
  assert.equal(desktop.sync.reconcile().state, 'synced');

  for (const one of [desktop, laptop]) {
    const store = new Store(one.dir, { device: one.name });
    const slugs = slugsOf(store);
    assert.deepEqual(slugs, [...new Set(slugs)], one.name + ': one page per reminder, not two');
    assert.equal(slugs.length, 7, one.name + ': ' + slugs.join(', '));
    const uids = closings(store).map(m => m.uid);
    assert.deepEqual(uids.sort(), [...new Set(uids)].sort(), one.name + ': one moment per closing');
    assert.equal(uids.length, 2);
    assert.equal(store.list(COPY_TYPE).length, 8, one.name + ': one note per old file');
    assert.deepEqual(store.problems, [], one.name + ': and nothing is a problem');
    assert.deepEqual(store.list('review_queue'), [], one.name + ': and nothing for the owner to settle');
    assert.deepEqual(one.sync.pendingConflicts(), [], one.name + ': no saved conflict');
    assert.deepEqual(sameThroughRecords(store, { day: DAY }).differences, [], one.name + ': and the records say what the files say');
  }
});

// ---------------------------------------------------------------- what it adds to the notebook

test('a year of the brief\'s daily mentions of fifty reminders stays well inside a megabyte', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'godspeed-due-copy-grow-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'due'), { recursive: true });
  fs.mkdirSync(path.join(root, 'world', 'events'), { recursive: true });
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '');
  const REMINDERS = 10, DAYS = 10;
  for (let n = 0; n < REMINDERS; n++) {
    fs.writeFileSync(path.join(root, 'due', 'thing-' + n + '.md'), `TITLE: An invented thing number ${n}
DONE-WHEN: It is done.
COST-IF-MISSED: Something made up.
SELF-CHECK: none
REPEATS: no
SOURCE: me, 2026-01-01

## Windows
STRIP: 2026-01-01 2027-06-30

## Log
- 2026-01-01 created, window 2026-01-01 to 2027-06-30
`);
  }
  const store = new Store(root, { device: 'pc' });
  store.save('settings', { id: 'installation', owner: 'pc', timezone: 'UTC' });
  const slugs = Array.from({ length: REMINDERS }, (_, n) => 'thing-' + n);
  copyOldReminders(store, { day: '2026-10-01' });
  const size = () => [...notebookFiles(root).values()].reduce((bytes, text) => bytes + Buffer.byteLength(text), 0);
  const before = size();
  for (let d = 0; d < DAYS; d++) {
    // What the brief does every morning it mentions them, and the copy that follows it.
    dueDelivered(store, slugs, new Date(Date.parse('2026-10-01T07:00:00Z') + d * 86400000));
  }
  const added = size() - before;
  const year = Math.round(added / (REMINDERS * DAYS) * 50 * 365);
  console.log('    one day of one reminder mentioned adds ' + Math.round(added / (REMINDERS * DAYS)) +
    ' bytes; fifty reminders for a year: about ' + Math.round(year / 1024) + ' KB');
  assert.equal(store.list('record_history').filter(h => h.source_type === 'deadlines' || h.source_type === COPY_TYPE).length, 0,
    'the copy keeps no history copy of what it writes: the whole log is in the record itself');
  assert.ok(year < 1024 * 1024, 'a year of fifty reminders mentioned daily: about ' + Math.round(year / 1024) + ' KB, which must stay inside a megabyte');
  assert.equal(store.list('deadlines').length, REMINDERS, 'and still one page per reminder');
});

// ---------------------------------------------------------------- when the old files change again
//
// Four ways a second review found the copy losing what it promises after the first pass, each one
// reproduced and then held here:
//
// 1. A reminder kept for review because the file AND the page had changed was overwritten from the
//    file as soon as anything else brought that reminder back - the next closing event was enough.
// 2. The installer copies every file in tools/ into the assistant's command folder as well, where
//    there is no notebook beside tools/due.js: `mc-due` typed there copied nothing at all.
// 3. Settings reads its obligations through dueRows, which copied nothing, so that occasion - one
//    the ticket names - never took the old reminders in.
// 4. An edited closing event was passed over: its evidence and its day stayed as they first
//    arrived, and `closes:` written again as `drops:` left the reminder closed AND dropped.

const BOILER = `TITLE: Service the boiler
DONE-WHEN: The boiler has been serviced.
COST-IF-MISSED: The warranty on it ends.
SELF-CHECK: none
REPEATS: no
SOURCE: me, 2026-09-01

## Windows
STRIP: 2026-10-01 2026-12-31

## Log
- 2026-09-01 created, window 2026-10-01 to 2026-12-31
`;
const RATES = `TITLE: Pay the quarterly rates
DONE-WHEN: The payment shows on the statement.
COST-IF-MISSED: A late fee of 40 euro.
SELF-CHECK: none
REPEATS: no
SOURCE: me, 2026-01-05

## Windows
STRIP: 2026-01-05 2026-03-31

## Log
- 2026-01-05 created, window 2026-01-05 to 2026-03-31
`;
const closingEvent = ({ kind = 'closes', ref = 'due/rates', day = '2026-03-12', evidence = 'the statement of 12 March shows the payment' }) => `---
date: ${day}
participants: [me]
${kind}: [${ref}]
evidence: ${evidence}
source: me, in a session
written_by: mc-due
origin: mission control
---

Pay the quarterly rates: finished.
`;

function workspace(t, files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'godspeed-due-level-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'due'), { recursive: true });
  fs.mkdirSync(path.join(root, 'world', 'events'), { recursive: true });
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '');
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
  }
  return root;
}
function opened(root, device = 'pc') {
  const store = new Store(root, { device });
  if (!store.get('settings', 'installation')) store.save('settings', { id: 'installation', owner: 'the owner', timezone: 'UTC' });
  return store;
}
const page = (store, slug) => store.list('deadlines').find(r => r.native_slug === slug);
const obligations = store => liveMoments(store).filter(r => r.category === 'obligation');

// ---------------------------------------------------------------- 1. the page kept for review

test('a reminder kept for review stays the owner\'s, however often it comes back', t => {
  const root = workspace(t, { 'due/boiler.md': BOILER });
  const store = opened(root);
  copyOldReminders(store, { day: DAY });

  // The owner renames the page in the notebook, and something changes the file as well.
  store.save('deadlines', { id: page(store, 'boiler').id, title: 'Service the boiler before winter' });
  fs.writeFileSync(path.join(root, 'due', 'boiler.md'), BOILER.replace('TITLE: Service the boiler', 'TITLE: Boiler service'));
  const review = copyOldReminders(store, { day: DAY });
  assert.equal(review.reviews.length, 1, 'one review item, with both versions');
  assert.equal(page(store, 'boiler').title, 'Service the boiler before winter', 'and the notebook\'s version stays');

  // Anything at all that brings this reminder back must leave the owner's page alone: a closing
  // written the old way is enough (until this was fixed, it took the file's title over the owner's).
  fs.writeFileSync(path.join(root, 'world', 'events', '2026-10-28-boiler-closed.md'),
    closingEvent({ ref: 'due/boiler', day: '2026-10-28', evidence: 'the engineer left a receipt' }));
  const later = copyOldReminders(store, { day: DAY });
  assert.equal(page(store, 'boiler').title, 'Service the boiler before winter', 'the page is still the owner\'s');
  assert.deepEqual(later.updated, [], 'nothing of it was taken from the file');
  assert.equal(obligations(store).length, 1, 'and the closing that arrived is a moment');
  assert.equal(store.list('deadlines').filter(r => r.native_slug === 'boiler').length, 1, 'still one reminder');

  // And the file's version is still the one review item, not a second one.
  assert.equal(store.list('review_queue').filter(r => r.suggestion_type === BOTH_CHANGED).length, 1);
  assert.equal(store.get('review_queue', review.reviews[0]).payload.from_the_file.title, 'Boiler service');
  // The way back: once the page says what the file says, the two are level again - the copy sees
  // its own words on the page - and from then on the file's changes are taken as before.
  store.save('deadlines', { id: page(store, 'boiler').id, title: 'Boiler service' });
  const level = copyOldReminders(store, { day: DAY });
  assert.deepEqual(level.reviews, [], 'nothing to review once they agree');
  fs.writeFileSync(path.join(root, 'due', 'boiler.md'), BOILER.replace('TITLE: Service the boiler', 'TITLE: Boiler service, yearly'));
  assert.deepEqual(copyOldReminders(store, { day: DAY }).updated, ['boiler']);
  assert.equal(page(store, 'boiler').title, 'Boiler service, yearly', 'the page follows the file again');
});

// ---------------------------------------------------------------- 2. the copy in the command folder

test('tools/due.js copied into the command folder finds the notebook beside the mission control', t => {
  const root = workspace(t, { 'due/boiler.md': BOILER });
  const store = opened(root);
  // A computer keeps each installed version in .godspeed/integrated-runtime/versions/<commit>, and
  // start.mjs names the one it runs. Here that version's due-copy.mjs is this one.
  const commit = '0'.repeat(39) + '1';
  const version = path.join(root, '.godspeed', 'integrated-runtime', 'versions', commit);
  fs.mkdirSync(path.join(version, 'notebook', 'core'), { recursive: true });
  for (const name of ['due-copy.mjs', 'due-records.mjs', 'due-retire.mjs']) {
    const real = new URL('../core/' + name, import.meta.url).href;
    fs.writeFileSync(path.join(version, 'notebook', 'core', name), 'export * from ' + JSON.stringify(real) + ';\n');
  }
  fs.mkdirSync(path.join(version, 'notebook', 'core', 'records'), { recursive: true });
  const store_ = new URL('../core/records/store.mjs', import.meta.url).href;
  fs.writeFileSync(path.join(version, 'notebook', 'core', 'records', 'store.mjs'), 'export * from ' + JSON.stringify(store_) + ';\n');
  fs.writeFileSync(path.join(root, '.godspeed', 'integrated-runtime', 'start.mjs'),
    'const child=spawn("node",[' + JSON.stringify(path.join(version, 'notebook', 'scripts', 'supervise.mjs')) + ']);\n');

  // The command folder: the files the installer copies there, and no notebook of its own.
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'godspeed-bin-'));
  t.after(() => fs.rmSync(bin, { recursive: true, force: true }));
  for (const name of ['due.js', 'due-files.js']) fs.copyFileSync(fileURLToPath(new URL('../../tools/' + name, import.meta.url)), path.join(bin, name));
  assert.ok(!fs.existsSync(path.join(bin, '..', 'notebook')), 'nothing of the notebook is beside it');

  const said = execFileSync(process.execPath, [path.join(bin, 'due.js'), '--godspeed', root, 'state'],
    { encoding: 'utf8', env: { ...process.env, GODSPEED_TODAY: DAY, GODSPEED_DUE_COPY: 'say' }, stdio: ['ignore', 'pipe', 'pipe'] });
  assert.match(said, /OPEN\s+boiler/, 'it answers as it always did: ' + said.trim());

  const after = opened(root);
  assert.equal(page(after, 'boiler')?.title, 'Service the boiler', 'and the reminder is in the notebook');
  assert.equal(after.list(COPY_TYPE).length, 1, 'with the note of what was copied');
  assert.deepEqual(sameThroughRecords(after, { day: DAY }).differences, []);
});

// ---------------------------------------------------------------- 3. Settings reading the list

test('the obligations list Settings reads copies them too, and a read-only copy is never written', t => {
  const root = workspace(t, { 'due/boiler.md': BOILER });
  const store = opened(root);
  // What the notebook answers /api/personal with: the rows, read inside one snapshot.
  const query = new QueryService(store);
  const rows = query.withSnapshot(() => query.rows('deadlines'));
  assert.equal(rows.length, 1, 'Settings sees the one reminder, as before');
  assert.equal(rows[0].native_slug, 'boiler');
  assert.equal(page(store, 'boiler')?.title, 'Service the boiler', 'and reading the list copied it');
  assert.deepEqual(sameThroughRecords(store, { day: DAY }).differences, []);

  // A second read writes nothing, and the rows are the same.
  const before = store.get('deadlines', page(store, 'boiler').id)._hash;
  assert.equal(query.withSnapshot(() => query.rows('deadlines')).length, 1);
  assert.equal(store.get('deadlines', page(store, 'boiler').id)._hash, before, 'nothing was written again');

  // The read-only copy a backup or a restore looks at is never written through: it answers from the
  // records it holds and takes nothing in, so a file written the old way waits for a real read.
  fs.writeFileSync(path.join(root, 'due', 'later.md'), RATES.replace('Pay the quarterly rates', 'Pay the rates later'));
  const reading = Store.inspect(root);
  assert.equal(dueRows(reading).length, 1, 'it answers from the records it holds');
  assert.equal(new Store(root, { device: 'pc' }).list('deadlines').length, 1, 'and copied nothing');
});

// ---------------------------------------------------------------- 4. an edited closing event

test('an edited closing event is followed: its words, its day, and closes turned into drops', t => {
  const root = workspace(t, { 'due/rates.md': RATES, 'world/events/2026-03-12-rates-closed.md': closingEvent({}) });
  const store = opened(root);
  copyOldReminders(store, { day: DAY });
  assert.equal(obligations(store).length, 1);
  assert.equal(obligations(store)[0].happened_at, '2026-03-12');

  // The owner corrects the event file: another day, other words.
  fs.writeFileSync(path.join(root, 'world', 'events', '2026-03-12-rates-closed.md'),
    closingEvent({ day: '2026-03-14', evidence: 'the receipt from the bank, found later' }));
  const fixed = copyOldReminders(store, { day: DAY });
  assert.equal(fixed.corrected.length, 1, 'the moment is corrected: ' + fixed.corrected.join('; '));
  const one = obligations(store);
  assert.equal(one.length, 1, 'one closing, not two');
  assert.equal(one[0].happened_at, '2026-03-14');
  assert.equal(one[0].evidence, 'the receipt from the bank, found later');
  assert.deepEqual(sameThroughRecords(store, { day: DAY }).differences, [], 'and the records say what the files say');
  assert.equal(copyOldReminders(store, { day: DAY }).unchanged, true, 'a run after that has nothing to do');

  // And `closes:` written again as `drops:`: the reminder is dropped, not both.
  fs.writeFileSync(path.join(root, 'world', 'events', '2026-03-12-rates-closed.md'),
    closingEvent({ kind: 'drops', day: '2026-03-14', evidence: 'the bill was not ours after all' }));
  const dropped = copyOldReminders(store, { day: DAY });
  assert.ok(dropped.corrected.some(line => /taken back/.test(line)), 'the closing is taken back: ' + dropped.corrected.join('; '));
  const now = obligations(store);
  assert.equal(now.length, 1, 'one moment about this reminder, not a close and a drop: ' + now.map(m => m.title).join(', '));
  assert.equal(now[0].obligation_kind, 'drops');
  assert.equal(new QueryService(store).rows('deadlines').find(r => r.native_slug === 'rates').status, 'closed',
    'the reader sees what the file says: dropped reads as closed, as it always did');
  assert.deepEqual(sameThroughRecords(store, { day: DAY }).differences, []);
  assert.equal(copyOldReminders(store, { day: DAY }).unchanged, true);
  assert.deepEqual(store.problems, [], 'and nothing in the notebook is a problem');
});
