import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Store } from '../core/records/store.mjs';
import { FileSync } from '../core/sync/git.mjs';
import { durableRoots, shared, inUpdateCopy } from '../core/file-policy.mjs';

// WHY THIS TEST EXISTS (2026-10-30, #90, ticket 05). A reminder is a page in the notebook now and
// its closing a moment on the timeline, so nothing durable is left in the old folders. The obvious
// next step was to take `due` out of durableRoots, and that would lose people's reminders:
//
//  - A notebook connected to a repository of its own commits through sync/git.mjs commitLocal,
//    which calls untrackPrivate: `git rm --cached` over every tracked path that shared() now says
//    no to. The file stays on this machine, but the commit records a deletion, so the path leaves
//    the repository - and a computer still running the older version, where `due` IS a durable
//    root, lets that removal through (applyRemote keeps only removals its own shared() allows) and
//    deletes its reminders.
//  - updateCopyRoots is derived from durableRoots, so the copy an installer makes before an update
//    would stop holding the very files the update is about to take in.
//  - The untracking would not wait for ticket 02's check: a file deliberately left in place
//    because the records and the files do not agree yet, or one that needs a look, would be
//    untracked anyway.
//
// So `due` stays in the list, and this holds that decision to its reason.
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'godspeed-due-root-')), remote = path.join(root, 'remote.git');
  fs.mkdirSync(remote); git(remote, 'init', '--bare', '--initial-branch=main');
  const dir = path.join(root, 'device'); fs.mkdirSync(dir);
  const store = new Store(dir, { device: 'desktop' });
  const sync = new FileSync(store); sync.initialize('https://github.com/example-owner/example-private');
  git(dir, 'config', 'user.name', 'Due Root Test'); git(dir, 'config', 'user.email', 'test@localhost');
  git(dir, 'remote', 'set-url', 'origin', remote);
  return { store, sync, dir };
}

const OLD_PLAN = 'due/car-service.md';
const OLD_CLOSING = 'world/events/2026-10-19-car-serviced.md';

function writeOldFiles(dir) {
  fs.mkdirSync(path.join(dir, 'due'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'world', 'events'), { recursive: true });
  fs.writeFileSync(path.join(dir, ...OLD_PLAN.split('/')),
    'TITLE: Car service\nDONE-WHEN: serviced\nCOST-IF-MISSED: the warranty\nSELF-CHECK: none\n\n' +
    '## Windows\n\nSTRIP: 2026-09-01 2027-02-28\n\n## Log\n\n- 2026-09-01 created\n');
  fs.writeFileSync(path.join(dir, ...OLD_CLOSING.split('/')),
    '---\ndate: 2026-10-19\nparticipants: [me]\ncloses: [due/car-service]\nevidence: the invoice\n---\n\nServiced.\n');
}

test('a reminder file of an older version is still carried by a repository the notebook connected', () => {
  const { store, sync, dir } = workspace();
  writeOldFiles(dir);
  store.save('notes', { title: 'A note', content: 'So that there is something to commit' });
  sync.commitLocal();
  const tracked = git(dir, 'ls-files').split('\n').filter(Boolean);
  assert.ok(tracked.includes(OLD_PLAN), 'the plan file must be in the repository: ' + tracked.join(' '));
  assert.ok(tracked.includes(OLD_CLOSING), 'and so must the closing an older version wrote');
  assert.equal(shared(OLD_PLAN), true, 'shared() must still say yes, or untrackPrivate removes it');
  assert.equal(shared(OLD_CLOSING), true);
});

test('and a second commit does not untrack them, so no removal reaches a computer on the older version', () => {
  const { store, sync, dir } = workspace();
  writeOldFiles(dir);
  store.save('notes', { title: 'First', content: 'one' });
  sync.commitLocal();
  const was = git(dir, 'rev-parse', 'HEAD');
  store.save('notes', { title: 'Second', content: 'two' });
  sync.commitLocal();
  const tracked = git(dir, 'ls-files').split('\n').filter(Boolean);
  assert.ok(tracked.includes(OLD_PLAN) && tracked.includes(OLD_CLOSING), 'both are still tracked after a later commit');
  const removed = git(dir, 'diff', '--name-only', '--diff-filter=D', was, 'HEAD').split('\n').filter(Boolean);
  assert.deepEqual(removed, [], 'the commit must record no deletion of them: ' + removed.join(' '));
  // The file itself is of course untouched: this release reads it once and retires it elsewhere
  // (core/due-retire.mjs), never through the policy below.
  assert.ok(fs.existsSync(path.join(dir, ...OLD_PLAN.split('/'))));
});

test('the copy made before an update still holds them', () => {
  assert.equal(inUpdateCopy(OLD_PLAN), true, 'a reminder that exists only as a file must survive an update that fails');
  assert.equal(inUpdateCopy(OLD_CLOSING), true);
});

test('both old roots are still in the list, and the reason is written beside them', () => {
  assert.ok(durableRoots.includes('due'), 'due stays in durableRoots; the comment in file-policy.mjs says why');
  assert.ok(durableRoots.includes('world'), 'world stays: the rest of it moves in a later release');
  const text = fs.readFileSync(new URL('../core/file-policy.mjs', import.meta.url), 'utf8');
  assert.match(text, /#90/, 'file-policy.mjs must say what this release decided about these two roots');
});
