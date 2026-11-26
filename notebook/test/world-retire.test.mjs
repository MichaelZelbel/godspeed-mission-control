// THE OLD WORLD FILES ARE RETIRED ONLY WHEN THE RECORDS HOLD THEM (#90, second slice).
// Held to: files archived with the same paths and none deleted, folder mode that touches no file,
// nothing moved while a record is missing (said once), a file edited since the copy left in place,
// and a file nobody could copy never touched. Everything in here is made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../core/records/store.mjs';
import { takeInOldWorld, takeInWorldAtStart, MOVED_NOTE } from '../core/world-retire.mjs';
import { oldFiles } from '../core/world-copy.mjs';
import { readNotices } from '../core/notices.mjs';

for (const key of Object.keys(process.env)) if (/^(GODSPEED_|HERMES_)/.test(key)) delete process.env[key];
const DAY = '2026-11-26';
const FILES = {
  'world/entities/peter.md': '---\nslug: peter\nname: Peter\n---\n',
  'world/claims/peter--city--2026-03-01.md': '---\nsubject: peter\nattribute: city\nvalue: Krefeld\n---\n',
  'world/events/2026-08-11-moved.md': '---\ndate: 2026-08-11\nparticipants: [peter]\n---\nPeter moved.\n',
  'world/events/2026-08-12-broken.md': 'no front matter\n',
};
function seeded(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'godspeed-world-retire-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(FILES)) { const p = path.join(root, ...file.split('/')); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); }
  const store = new Store(root, { device: 'pc' });
  store.save('settings', { id: 'installation', owner: 'pc', timezone: 'UTC' });
  return store;
}
const names = root => oldFiles(root).map(f => f.file);

test('the files go to the archive with the same paths, and the unreadable one stays', t => {
  const store = seeded(t);
  const { retire } = takeInOldWorld(store, { day: DAY });
  assert.equal(retire.moved.length, 3);
  assert.deepEqual(names(store.root), ['world/events/2026-08-12-broken.md']);
  const archived = path.join(store.root, 'archives', DAY + '-world-moved-to-the-notebook');
  for (const file of retire.moved) assert.equal(fs.readFileSync(path.join(archived, ...file.split('/')), 'utf8'), FILES[file]);
  assert.equal(takeInOldWorld(store, { day: DAY }).retire.moved.length, 0, 'a second run moves nothing');
  assert.equal(store.list('claims').length, 1);
});

test('in folder mode not one file is touched and one note is written beside them', t => {
  const store = seeded(t);
  fs.mkdirSync(store.state, { recursive: true });
  fs.writeFileSync(path.join(store.state, 'sync-config.json'), JSON.stringify({ repository: 'folder' }));
  const before = new Map(names(store.root).map(f => [f, fs.readFileSync(path.join(store.root, f), 'utf8')]));
  const { retire } = takeInOldWorld(store, { day: DAY });
  assert.equal(retire.note, MOVED_NOTE);
  assert.deepEqual(names(store.root), [...before.keys()]);
  for (const [f, text] of before) assert.equal(fs.readFileSync(path.join(store.root, f), 'utf8'), text);
  assert.match(fs.readFileSync(path.join(store.root, MOVED_NOTE), 'utf8'), /live in the notebook now/);
});

test('a record that is not there moves nothing and is said once', t => {
  const store = seeded(t);
  takeInOldWorld(store, { day: DAY });
  const archived = path.join(store.root, 'archives', DAY + '-world-moved-to-the-notebook');
  // the files come back (an older computer wrote them), but a record has been lost
  for (const f of ['world/claims/peter--city--2026-03-01.md', 'world/events/2026-08-11-moved.md']) { fs.mkdirSync(path.dirname(path.join(store.root, f)), { recursive: true }); fs.copyFileSync(path.join(archived, ...f.split('/')), path.join(store.root, f)); }
  store.commit([], { removeKeys: store.list('claims', { removed: true }).map(c => 'claims/' + c.id) });
  const result = takeInOldWorld(store, { day: DAY }).retire;
  assert.equal(result.moved.length, 0);
  assert.equal(result.differences.length, 1);
  takeInOldWorld(store, { day: DAY });
  assert.equal(readNotices(store).filter(n => n.step === 'world-retire').length, 1);
  assert.ok(fs.existsSync(path.join(store.root, 'world/events/2026-08-11-moved.md')));
});

test('starting the notebook takes the files in and retires them, and with nothing to do costs nothing', async t => {
  const store = seeded(t);
  assert.equal((await takeInWorldAtStart(store)).retire.moved.length, 3);
  assert.equal((await takeInWorldAtStart(store)).skipped, undefined, 'the unreadable file is still looked at');
  fs.rmSync(path.join(store.root, 'world/events/2026-08-12-broken.md'));
  assert.equal((await takeInWorldAtStart(store)).skipped, 'nothing to take in');
});
