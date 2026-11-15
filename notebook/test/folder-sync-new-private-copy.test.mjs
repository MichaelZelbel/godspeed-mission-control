import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store, atomic } from '../core/records/store.mjs';
import { FileSync, joinRepository, useFolderRepository } from '../core/sync/git.mjs';
import { firstCommit } from '../core/first-commit.mjs';
import { dueCommand } from '../core/native-due.mjs';

for (const key of Object.keys(process.env)) if (/^(GODSPEED_|HERMES_)/.test(key)) delete process.env[key];

// A reader without a server gives their mission control a new, empty private copy on GitHub and
// joins it with `godspeed sync folder notebook`. Until 2 November 2026 the first round took the
// empty copy's missing branch for "offline" and answered "pending" for ever, so a second computer
// cloned an empty repository (issue #125, the folder half of reminder-closed-elsewhere on
// 2.0.0-beta.14). Real repositories; a bare one on this machine is the private copy, and the check
// that the address is a private GitHub one (which asks api.github.com) is the one thing stubbed.
const starter = fileURLToPath(new URL('../../starter-godspeed', import.meta.url));
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const tracked = (dir, ref = 'HEAD') => git(dir, 'ls-tree', '-r', '--name-only', ref).split('\n');

function world(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'godspeed-new-private-copy-'));
  const original = FileSync.prototype.verifyRemote;
  FileSync.prototype.verifyRemote = async () => {};
  t.after(() => { FileSync.prototype.verifyRemote = original; fs.rmSync(base, { recursive: true, force: true }); });
  const copy = path.join(base, 'github', 'copy.git');
  fs.mkdirSync(copy, { recursive: true });
  git(copy, 'init', '-q', '--bare', '--initial-branch=main');
  return { base, copy };
}
// A new installation: the starter, a repository, its first commit, and the copy as origin.
function newMissionControl({ base, copy }, name = 'a') {
  const dir = path.join(base, name);
  fs.cpSync(starter, dir, { recursive: true });
  atomic(path.join(dir, 'NOTEBOOK.md'), '# Your notebook\n'); // what `godspeed.mjs init` writes before the first commit
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'Owner');
  git(dir, 'config', 'user.email', 'owner@localhost');
  assert.equal(firstCommit(dir).made, true);
  git(dir, 'remote', 'add', 'origin', copy);
  return dir;
}
const round = store => new FileSync(store).reconcile();
const stateOf = (store, slug) => JSON.parse(dueCommand(store, ['state', '--json']).result).find(r => r.slug === slug);

test('the first round sends the mission control to an empty private copy, and a computer joined from it gets a reminder closed on the first', async t => {
  const w = world(t), a = newMissionControl(w);
  // The ignore lines are written by the test itself here, so this one is about the push alone.
  atomic(path.join(a, '.gitignore'), fs.readFileSync(path.join(a, '.gitignore'), 'utf8') + '/NOTEBOOK.md\n/assistant-state/\n');
  git(a, 'rm', '-q', '--cached', 'NOTEBOOK.md');
  git(a, 'add', '.gitignore');
  git(a, 'commit', '-qm', 'Ignore what the notebook keeps on each machine');
  const storeA = new Store(a, { device: 'computer-a' });
  assert.equal((await useFolderRepository(storeA, ['notebook'])).repository, 'folder');
  assert.equal(git(w.copy, 'for-each-ref'), '', 'the private copy is empty');
  const first = round(storeA);
  assert.equal(first.state, 'synced', JSON.stringify(first));
  assert.ok(tracked(w.copy, 'main').includes('AGENTS.md'), 'the whole mission control reached the copy');

  const b = path.join(w.base, 'b');
  git(w.base, 'clone', '-q', w.copy, b);
  git(b, 'config', 'user.name', 'Owner');
  git(b, 'config', 'user.email', 'owner@localhost');
  const storeB = new Store(b, { device: 'computer-b' });
  assert.equal((await joinRepository(storeB)).repository, 'folder');

  dueCommand(storeA, ['add', 'passport-renewal', '--title', 'Renew my passport', '--to', '2099-01-01', '--cost', 'I cannot travel.', '--done-when', 'The passport is in my hand.']);
  assert.equal(round(storeA).state, 'synced');
  assert.equal(round(storeB).state, 'synced');
  assert.equal(stateOf(storeB, 'passport-renewal').state, 'open', 'the reminder reached the second computer');
  dueCommand(storeA, ['done', 'passport-renewal', '--evidence', 'I posted it, receipt 4711']);
  assert.equal(round(storeA).state, 'synced');
  assert.equal(round(storeB).state, 'synced');
  const closed = stateOf(storeB, 'passport-renewal');
  assert.equal(closed.state, 'closed');
  assert.match(fs.readFileSync(path.join(b, closed.closedBy), 'utf8'), /receipt 4711/, 'with the words it was closed with');
});

test('a mission control whose .gitignore lacks NOTEBOOK.md and assistant-state/ gets the two lines from the product and is synced', async t => {
  const w = world(t), a = newMissionControl(w);
  assert.ok(tracked(a).includes('NOTEBOOK.md'), 'a new install tracks its note');
  assert.doesNotMatch(fs.readFileSync(path.join(a, '.gitignore'), 'utf8'), /NOTEBOOK\.md|assistant-state\/\n/);
  // Work of the owner's that is staged stays staged.
  atomic(path.join(a, 'rules', 'staged.md'), 'staged by a session\n');
  git(a, 'add', 'rules/staged.md');
  const storeA = new Store(a, { device: 'computer-a' });
  const joined = await useFolderRepository(storeA, ['notebook']);
  assert.equal(joined.repository, 'folder');
  assert.match(joined.said, /NOTEBOOK\.md and assistant-state\/ to \.gitignore and committed it/);
  const text = fs.readFileSync(path.join(a, '.gitignore'), 'utf8');
  assert.equal(text.split('\n').filter(l => l === '/NOTEBOOK.md').length, 1);
  assert.equal(text.split('\n').filter(l => l === '/assistant-state/').length, 1);
  assert.equal(git(a, 'log', '-1', '--format=%s'), 'Keep NOTEBOOK.md and assistant-state/ on this computer');
  assert.equal(tracked(a).includes('NOTEBOOK.md'), false);
  assert.ok(fs.existsSync(path.join(a, 'NOTEBOOK.md')), 'the note stays on this computer');
  assert.equal(git(a, 'diff', '--cached', '--name-only'), 'rules/staged.md', 'the staged work stays staged');
  assert.equal(round(storeA).state, 'synced');
  assert.ok(!tracked(w.copy, 'main').includes('NOTEBOOK.md'));
  assert.match(git(w.copy, 'show', 'main:.gitignore'), /^\/NOTEBOOK\.md$/m);
  // Joined again, nothing more to add and nothing said.
  const again = await useFolderRepository(storeA, ['notebook']);
  assert.equal(again.said, undefined);
});

test('a mission control that ignores them another way is accepted unchanged', async t => {
  const w = world(t), a = newMissionControl(w);
  fs.appendFileSync(path.join(a, '.git', 'info', 'exclude'), '\nNOTEBOOK.md\nassistant-state/\n');
  const before = { ignore: fs.readFileSync(path.join(a, '.gitignore'), 'utf8'), head: git(a, 'rev-parse', 'HEAD') };
  const joined = await useFolderRepository(new Store(a, { device: 'computer-a' }), ['notebook']);
  assert.equal(joined.repository, 'folder');
  assert.equal(joined.said, undefined);
  assert.equal(fs.readFileSync(path.join(a, '.gitignore'), 'utf8'), before.ignore);
  assert.equal(git(a, 'rev-parse', 'HEAD'), before.head);
});

test('a join that is refused for another reason writes and commits nothing', async t => {
  const w = world(t), a = newMissionControl(w);
  fs.appendFileSync(path.join(a, '.gitignore'), 'notebook/**\n');
  git(a, 'add', '.gitignore');
  git(a, 'commit', '-qm', 'Hide the notebook');
  const before = { ignore: fs.readFileSync(path.join(a, '.gitignore'), 'utf8'), head: git(a, 'rev-parse', 'HEAD') };
  await assert.rejects(useFolderRepository(new Store(a, { device: 'computer-a' }), ['notebook']), /hides notebook pages/);
  assert.equal(fs.readFileSync(path.join(a, '.gitignore'), 'utf8'), before.ignore);
  assert.equal(git(a, 'rev-parse', 'HEAD'), before.head);
  assert.ok(tracked(a).includes('NOTEBOOK.md'));
});

test('a private copy that has another branch and no main is not taken for an empty one', async t => {
  const w = world(t), a = newMissionControl(w);
  const other = path.join(w.base, 'other');
  git(w.base, 'clone', '-q', w.copy, other);
  git(other, 'config', 'user.name', 'Other');
  git(other, 'config', 'user.email', 'other@localhost');
  git(other, 'checkout', '-q', '-b', 'trunk');
  atomic(path.join(other, 'README.md'), 'someone else\n');
  git(other, 'add', '-A');
  git(other, 'commit', '-qm', 'trunk');
  git(other, 'push', '-q', 'origin', 'trunk');
  const store = new Store(a, { device: 'computer-a' });
  await useFolderRepository(store, ['notebook']);
  assert.equal(round(store).state, 'pending');
  assert.deepEqual(git(w.copy, 'for-each-ref', '--format=%(refname)').split('\n'), ['refs/heads/trunk'], 'nothing was created in the copy');
});
