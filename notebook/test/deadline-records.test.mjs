// A REMINDER IS A NOTEBOOK PAGE, AND ITS CLOSING IS A MOMENT (2026-10-29, #90).
//
// Until now a reminder lived in due/<slug>.md and its closing in a second file in world/events/,
// and on a mission control that is its own repository the notebook's sync carries only notebook/:
// on 19 October 2026 only the first of the two was committed and the closing never reached the
// server, so the morning brief asked its owner for nine days about something he had finished.
// These tests hold the two homes inside notebook/ to what the ticket asks of them: a reminder is a
// page under Deadlines/ that keeps every field the plain file keeps and that a person can still
// edit by hand, a closing is an append-only moment that names the reminder by uid, and the
// identities can be derived, so two machines never make one reminder twice.
import test from 'node:test';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store, hash } from '../core/records/store.mjs';
import { QueryService } from '../core/query.mjs';
import { deadlineUid, closingUid, closingMoment, HEAD_FIELDS } from '../core/deadline-records.mjs';
import { dueCommand, dueRows, moveSettingsDeadlines } from '../core/native-due.mjs';

const temporary = t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'godspeed-deadline-records-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
};
const fresh = (t, device = 'pc') => new Store(temporary(t), { device });
const pageOf = (store, record) => path.relative(path.join(store.root, 'notebook'), store.file(record)).split(path.sep).join('/');
// What a person sees in Deadlines/. The store removes a folder it has emptied, so a folder that
// is not there is as empty as an empty one.
const deadlinePages = store => {
  try { return fs.readdirSync(path.join(store.root, 'notebook', 'Deadlines'), { withFileTypes: true }).filter(e => e.isFile()).map(e => e.name); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
};

// A reminder with every field a due/ file holds: the eight lines tools/due.js writes in order,
// the three an add-on adds, the calendar entry, a line the owner wrote by hand, and the log with
// the SAID line the morning brief writes.
const everything = {
  title: 'Car service before the warranty runs out',
  done_when: 'The car has been serviced at a garage the warranty accepts.',
  cost_if_missed: 'The warranty ends. A gearbox after that is mine to pay for.',
  self_check: 'file-newer',
  self_check_arg: 'secrets/expires.txt',
  repeats: 'yearly',
  link: 'https://example.com/book-a-service',
  source: 'me, 2026-08-29',
  addon: 'documents',
  addon_key: 'letter-2026-08-29#2',
  addon_state: 'f00dcafe',
  calendar_marker: 'google:abcdef1234567890',
  head_lines: { 'WHO-ASKED': 'the garage, by letter' },
  native_slug: 'car-service',
  windows: [{ start: '2026-09-01', deadline: '2027-02-28', target: '', moved: '', extra: [] }],
  log: '- 2026-08-29 created, window 2026-09-01 to 2027-02-28\n- 2026-10-29 SAID brief\n',
};
// A repeating one: three windows, one of them a target with no last day, one with a day moved.
const repeating = {
  title: 'Pay the quarterly rates',
  done_when: 'The payment shows on the statement.',
  cost_if_missed: 'A late fee of 40 euro.',
  self_check: 'none',
  self_check_arg: '',
  repeats: 'quarterly',
  link: '',
  source: 'you, 2026-01-05',
  native_slug: 'quarterly-rates',
  windows: [
    { start: '2026-01-05', deadline: '2026-03-31', target: '2026-03-15', moved: '', extra: [] },
    { start: '2026-04-01', deadline: '2026-06-30', target: '2026-06-15', moved: '2026-06-22', extra: [] },
    { start: '2026-07-01', deadline: '', target: '2026-09-15', moved: '', extra: ['asked'] },
  ],
  log: '- 2026-01-05 created, window 2026-01-05 to 2026-03-31, aiming for 2026-03-15\n',
};

// ---------------------------------------------------------------- the page

test('a reminder with every field, and a repeating one with three windows, round-trip exactly', t => {
  const store = fresh(t);
  const one = store.save('deadlines', { ...everything, uid: deadlineUid('car-service') });
  const many = store.save('deadlines', { ...repeating, uid: deadlineUid('quarterly-rates') });

  // Read by a store that knows nothing but the files.
  const again = new Store(store.root, { device: 'pc' });
  assert.deepEqual(again.get('deadlines', one.id), store.get('deadlines', one.id), 'every field of the reminder reads back as it was written');
  assert.deepEqual(again.get('deadlines', many.id), store.get('deadlines', many.id), 'three windows, a target without a last day and a moved day read back too');
  for (const [field, value] of Object.entries(many)) assert.deepEqual(again.get('deadlines', many.id)[field], value, field + ' is unchanged');
  assert.deepEqual(again.problems, [], 'and neither page is a problem');
  assert.equal(again.get('deadlines', many.id).windows.length, 3);
  assert.equal(again.get('deadlines', many.id).windows[1].moved, '2026-06-22');
  assert.equal(again.get('deadlines', one.id).head_lines['WHO-ASKED'], 'the garage, by letter', 'a line the owner wrote by hand survives');
});

test('the page is plain Markdown under Deadlines/, with its frontmatter and its log as the body', t => {
  const store = fresh(t);
  const one = store.save('deadlines', { ...everything, uid: deadlineUid('car-service') });
  assert.equal(pageOf(store, one), 'Deadlines/Car service before the warranty runs out.md',
    'it is a page named after its title, in the folder for reminders');
  const text = fs.readFileSync(store.file(one), 'utf8');
  assert.ok(text.startsWith('---\n'), 'it starts with its frontmatter');
  assert.match(text, /^type: deadline$/m);
  assert.match(text, /^done_when: The car has been serviced at a garage the warranty accepts\.$/m);
  assert.match(text, /^self_check: file-newer$/m);
  assert.ok(!/^status:/m.test(text), 'nothing on the page says whether it is open: that is the moments\' answer');
  assert.ok(text.endsWith(everything.log), 'the log is the Markdown body, the SAID line the brief writes included');
  assert.ok(!text.includes('"title"'), 'no JSON anywhere in it');
});

test('an edit by hand, to the body and to one frontmatter field, reads back', t => {
  const store = fresh(t);
  const one = store.save('deadlines', { ...everything, uid: deadlineUid('car-service') });
  const file = store.file(one);
  const edited = fs.readFileSync(file, 'utf8')
    .replace(/^link: .*$/m, 'link: https://example.com/the-other-garage')
    .replace(/\n$/, '\n- 2026-10-30 rang the garage, nothing free until December\n');
  fs.writeFileSync(file, edited);

  const again = new Store(store.root, { device: 'pc' }).get('deadlines', one.id);
  assert.equal(again.link, 'https://example.com/the-other-garage', 'the field a person changed is the record\'s');
  assert.match(again.log, /rang the garage, nothing free until December/, 'and the line they added is in its log');
  assert.equal(again.uid, one.uid, 'editing the file by hand changes nothing about which record it is');
});

test('renaming the title renames the file and keeps the uid', t => {
  const store = fresh(t);
  const one = store.save('deadlines', { ...everything, uid: deadlineUid('car-service') });
  const was = store.file(one);
  const renamed = store.save('deadlines', { id: one.id, title: 'Car service' });
  assert.equal(pageOf(store, renamed), 'Deadlines/Car service.md', 'the file follows the title');
  assert.ok(!fs.existsSync(was), 'and the old file is gone, not left behind as a second reminder');
  assert.equal(renamed.uid, one.uid, 'the uid is unchanged');
  assert.equal(renamed.id, one.id);
  assert.equal(renamed.done_when, everything.done_when, 'and the rest of the reminder is still there');
});

// ---------------------------------------------------------------- the closing

const closing = (store, deadline, over = {}) => store.save('moments', closingMoment({
  deadline, kind: 'closes', day: '2026-10-19', evidence: 'Michael said so in the session.', source: 'godspeed due done', ...over,
}));

test('a closing is a moment on the timeline that names the reminder by uid', t => {
  const store = fresh(t);
  const one = store.save('deadlines', { ...everything, uid: deadlineUid('car-service') });
  const moment = closing(store, one, { window: '2026-09-01' });

  assert.equal(moment.title, 'Done: Car service before the warranty runs out');
  assert.equal(moment.category, 'obligation');
  assert.equal(moment.obligation_kind, 'closes');
  assert.equal(moment.obligation_window, '2026-09-01', 'which window of the repeating reminder it closes');
  assert.equal(moment.evidence, 'Michael said so in the session.');
  assert.equal(moment.source, 'godspeed due done');
  assert.deepEqual(moment.references, [{ type: 'deadlines', id: one.id, uid: one.uid, field: 'deadline_id' }],
    'a typed reference, by uid, so it survives a rename of either');
  assert.ok(pageOf(store, moment).startsWith('Timeline/2026-10-19 Done'), 'it is on the timeline: ' + pageOf(store, moment));
  assert.deepEqual(store.problems, [], 'and the reference it makes is sound');

  const dropped = store.save('moments', closingMoment({
    deadline: one, kind: 'drops', day: '2026-10-20', evidence: 'Sold the car.', source: 'godspeed due drop',
  }));
  assert.equal(dropped.title, 'Dropped: Car service before the warranty runs out');
  assert.equal(dropped.obligation_kind, 'drops');
});

test('a closing cannot be edited, and says nothing without what shows it', t => {
  const store = fresh(t);
  const one = store.save('deadlines', { ...everything, uid: deadlineUid('car-service') });
  const moment = closing(store, one);
  assert.throws(() => store.save('moments', { id: moment.id, evidence: 'Something else' }), /append-only/,
    'a closing is something that happened: it is added to, never changed');
  assert.throws(() => closingMoment({ deadline: one, kind: 'closes', day: '2026-10-19', evidence: '  ' }), /closes nothing/);
  assert.throws(() => closingMoment({ deadline: one, kind: 'finished', day: '2026-10-19', evidence: 'x' }), /closes or drops/);
  assert.throws(() => closingMoment({ deadline: { ...one, native_slug: '' }, kind: 'closes', day: '2026-10-19', evidence: 'x', from: 'world/events/a.md' }),
    /needs the reminder it names/, 'a closing taken out of an old file can only be derived from the reminder that file names');
});

test('one reminder closed on two machines is two moments, and neither machine settles anything', t => {
  const here = fresh(t, 'pc'), there = fresh(t, 'laptop');
  const mine = here.save('deadlines', { ...everything, uid: deadlineUid('car-service') });
  const theirs = there.save('deadlines', { ...everything, uid: deadlineUid('car-service') });
  assert.equal(mine.uid, theirs.uid, 'the same reminder on both machines is one record');

  const one = closing(here, mine, { evidence: 'Michael closed it on the PC.' });
  const two = closing(there, theirs, { evidence: 'Michael closed it on the laptop.' });
  assert.notEqual(one.uid, two.uid, 'two acts, two moments: neither machine\'s record stands for the other\'s');

  // What the sync does: the other machine's file arrives in this notebook.
  fs.copyFileSync(there.file(two), path.join(here.root, 'notebook', 'Timeline', 'from the laptop.md'));
  const merged = new Store(here.root, { device: 'pc' });
  assert.equal(merged.list('moments').length, 2, 'both closings are there');
  assert.deepEqual(merged.problems, [], 'and nothing is a duplicate or a conflict for the owner to settle');
});

// ---------------------------------------------------------------- identity you can derive

test('the derived identities are the same on every run, for the same input, on two stores', t => {
  const here = fresh(t, 'pc'), there = fresh(t, 'laptop');

  assert.equal(deadlineUid('car-service'), hash('due/car-service').slice(0, 32),
    'a reminder\'s uid is derived from its file name the way native-due.mjs has always derived it');
  assert.equal(deadlineUid('car-service'), deadlineUid('car-service'), 'and it is the same on every run');
  assert.notEqual(deadlineUid('car-service'), deadlineUid('car-service-2'));
  assert.throws(() => deadlineUid('Car Service'), /small letters/);

  // The two machines make the same reminder, and it is one record, not two.
  const mine = here.save('deadlines', { ...everything, uid: deadlineUid('car-service') });
  const theirs = there.save('deadlines', { ...everything, uid: deadlineUid('car-service') });
  assert.equal(mine.uid, theirs.uid);
  assert.equal(mine.id, theirs.id, 'so they write the same file, which the sync merges into one');

  // A closing taken out of the same old world/events/ file is one moment, whichever machine took it.
  const from = 'world/events/2026-10-19-car-service-closed.md';
  const derived = closingUid({ slug: 'car-service', window: '2026-09-01', kind: 'closes', from });
  assert.equal(derived, closingUid({ slug: 'car-service', window: '2026-09-01', kind: 'closes', from }));
  assert.equal(derived.length, 32);
  for (const other of [{ slug: 'quarterly-rates' }, { window: '2026-04-01' }, { kind: 'drops' }, { from: from.replace('19', '20') }]) {
    assert.notEqual(derived, closingUid({ slug: 'car-service', window: '2026-09-01', kind: 'closes', from, ...other }),
      'a closing of something else, of another window, of another kind or out of another file is another moment');
  }
  const taken = { deadline: mine, kind: 'closes', day: '2026-10-19', window: '2026-09-01', evidence: 'the old event file said so', from };
  const ours = here.save('moments', closingMoment(taken));
  const yours = there.save('moments', closingMoment({ ...taken, deadline: theirs }));
  assert.equal(ours.uid, derived);
  assert.equal(ours.uid, yours.uid, 'two machines taking in the same old file make one closing, not two');
  assert.equal(ours.id, yours.id);
  assert.equal(ours.moved_from, from);
});

test('nothing a due/ file holds is lost: every line of one has a field of its own', t => {
  const store = fresh(t);
  store.save('settings', { id: 'installation', owner: 'pc', timezone: 'Europe/Berlin' });
  dueCommand(store, ['add', 'car-service', '--title', everything.title, '--done-when', everything.done_when,
    '--cost', everything.cost_if_missed, '--from', '2026-09-01', '--to', '2027-02-28', '--target', '2027-01-31',
    '--repeats', 'yearly', '--link', everything.link, '--self-check', 'file-newer',
    '--self-check-arg', 'secrets/expires.txt', '--addon', 'documents', '--addon-key', 'letter-2026-08-29#2']);
  dueCommand(store, ['marker', 'car-service', '--set', 'google:abcdef1234567890']);
  // The page written back out as the plain file it replaced (tools/due-files.js, writeFilesFrom):
  // if a line of that format had no field of its own on the page, it could not come back.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'godspeed-deadline-lines-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  createRequire(import.meta.url)('../../tools/due-files.js').createDueFiles({ root: scratch })
    .writeFilesFrom({ deadlines: store.list('deadlines').filter(r => r.native_slug), closings: [] });
  const file = fs.readFileSync(path.join(scratch, 'due', 'car-service.md'), 'utf8');

  // The head lines, read the way tools/due.js reads them (parseFile): the window lines and the
  // log lines are taken first and never reach the head.
  const head = [];
  for (const raw of file.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (/^STRIP:\s*\S+\s+\S+/.test(line) || /^-\s/.test(line)) continue;
    const m = line.match(/^([A-Z][A-Z0-9-]{1,30}):\s?(.*)$/);
    if (m && !head.includes(m[1])) head.push(m[1]);
  }
  assert.ok(head.length >= 12, 'a file with everything on it: ' + head.join(', '));
  for (const line of head) assert.ok(HEAD_FIELDS[line], 'the reminder page has a field for ' + line);
  assert.match(file, /^STRIP: 2026-09-01 2027-02-28 target 2027-01-31$/m, 'and the window line it is read from');

  // And the uid the notebook already gives that file is the uid of its page.
  assert.equal(dueRows(store).find(r => r.native_slug === 'car-service').uid, deadlineUid('car-service'));
});

// ---------------------------------------------------------------- the deadlines Settings saved

test('a deadline Settings saved before 18 October and moved into due/ does not show as a second page', t => {
  const store = fresh(t);
  store.save('settings', { id: 'installation', owner: 'pc', timezone: 'Europe/Berlin' });
  const soon = new Date(Date.now() + 10 * 86400000).toISOString();
  const old = store.save('deadlines', { title: 'Car service', due_at: soon, target_at: null, start_at: new Date().toISOString(),
    timezone: 'Europe/Berlin', status: 'open', recurrence: null, completion_check: null });
  assert.equal(pageOf(store, old), 'Deadlines/Car service.md', 'while it is open and unmoved, it is a page like any reminder');

  assert.deepEqual(moveSettingsDeadlines(store), ['car-service'], 'it is made a file in due/ once, as before');
  const moved = store.get('deadlines', old.id);
  assert.equal(moved.moved_to, 'due/car-service.md');
  assert.equal(pageOf(store, moved), '_system/deadlines/' + moved.id + '.md',
    'and it then keeps its place in the system folder, where nobody reads it as a page');
  // Since 30 October 2026 the reminder in due/ is copied into the notebook as a page of its own
  // (core/due-copy.mjs), so Deadlines/ holds that one page - under the plain name, because the
  // record Settings saved had left the folder before it was written - and never the two of them.
  assert.deepEqual(deadlinePages(store), ['Car service.md'], 'the reminder it was moved to stands there once, not twice');
  assert.equal(store.list('deadlines').filter(d => d.native_slug === 'car-service').length, 1);

  const rows = new QueryService(store).rows('deadlines').filter(d => d.title === 'Car service' && d.status !== 'closed');
  assert.equal(rows.length, 1, 'and the notebook lists that reminder once');
  assert.deepEqual(moveSettingsDeadlines(store), [], 'a second run finds nothing to do');
});
