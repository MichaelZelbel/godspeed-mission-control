// THE OLD LIFE EVENTS, CLAIMS AND ENTITIES ARE COPIED INTO THE NOTEBOOK (#90, second slice).
// Held to: nothing lost, a second run that changes nothing, two machines ending with one record
// each, an owner's edit that a later file change does not overwrite, a closing left to due-copy,
// and a file that cannot be copied said once and left alone. Everything in here is made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../core/records/store.mjs';
import { copyOldWorld, copyWorldIfChanged } from '../core/world-copy.mjs';
import { readNotices } from '../core/notices.mjs';

for (const key of Object.keys(process.env)) if (/^(GODSPEED_|HERMES_)/.test(key)) delete process.env[key];

const FILES = {
  'world/entities/peter-mueller.md': '---\nslug: peter-mueller\norigin: mission control\nname: Peter Mueller\ntype: person\naliases: [Peter, Pete]\n---\nA friend from school.\n',
  'world/entities/priya.md': '---\nslug: priya\nname: Priya Rao\nmenerio_id: c-priya\n---\n',
  'world/entities/boiler.md': '---\nslug: boiler\nname: The boiler\ntype: thing\n---\n',
  'world/claims/peter-mueller--city--2026-03-01.md': '---\nsubject: peter-mueller\nattribute: city\nvalue: Krefeld\nvalid_from: 2026-03-01\nconfidence: certain\n---\nHe said so.\n',
  'world/claims/me--wife--2024-01-01.md': '---\nsubject: me\nattribute: relationship\nvalue: wife\nobject: priya\nvalid_from: 2024-01-01\n---\n',
  'world/claims/boiler--hold--2026-10-01.md': '---\nsubject: boiler\nattribute: hold\nvalue: not now\nstance: postponed\nsteps: [interview]\nuntil: peter-mueller--city--2026-03-01\n---\n',
  'world/events/2026-08-11-moved.md': '---\ndate: 2026-08-11\nparticipants: [me, peter-mueller, priya]\nsource: a call\n---\nPeter moved to Krefeld.\n\nHe told me on the phone.\n',
  'world/events/2026-09-01-closing.md': '---\ndate: 2026-09-01\ncloses: boiler\nevidence: serviced\n---\nDone.\n',
};
function seeded(t, { device = 'pc', files = FILES } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'godspeed-world-copy-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(files)) { const p = path.join(root, ...file.split('/')); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); }
  const store = new Store(root, { device });
  store.save('settings', { id: 'installation', owner: device, timezone: 'UTC' });
  store.save('contacts', { id: 'c-priya', name: 'Priya Rao' });
  return store;
}
const snapshot = store => JSON.stringify(['entities', 'claims', 'moments', 'fact_slots', 'moment_participants', 'moment_entities', 'world_copies']
  .map(type => store.list(type).map(r => [r.type, r.uid, r.id, r.created_at, r.updated_at, ...Object.keys(r).filter(k => !['revision', 'device', '_hash'].includes(k)).sort().map(k => r[k])])));

test('every old file becomes a record, keeping what it said', t => {
  const store = seeded(t);
  const report = copyOldWorld(store);
  assert.deepEqual(report.needsALook, []);
  const peter = store.list('entities').find(e => e.slug === 'peter-mueller');
  assert.deepEqual([peter.name, peter.entity_type, peter.aliases, peter.description], ['Peter Mueller', 'person', ['Peter', 'Pete'], 'A friend from school.']);
  assert.equal(store.list('entities').some(e => e.slug === 'priya'), false, 'a person who is a contact already is no second record');
  const city = store.list('claims').find(c => c.attribute === 'city');
  assert.deepEqual([city.subject_type, city.subject_id, city.value, city.valid_from, city.confidence, city.evidence_quote], ['entity', peter.id, 'Krefeld', '2026-03-01', 'certain', 'He said so.']);
  const wife = store.list('claims').find(c => c.attribute === 'relationship');
  assert.deepEqual([wife.subject_type, wife.value, wife.relationship, wife.object_type, wife.object_id], ['self', 'wife: Priya Rao', 'wife', 'contact', 'c-priya']);
  const hold = store.list('claims').find(c => c.attribute === 'hold');
  assert.deepEqual([hold.stance, hold.steps, hold.until], ['postponed', ['interview'], city.uid]);
  assert.ok(store.list('fact_slots').find(s => s.attribute === 'city').show_to_agent, 'the assistant is shown it, as with every claim');
  const moved = store.list('moments').find(m => m.happened_at === '2026-08-11');
  assert.deepEqual([moved.title, moved.description, moved.source], ['Peter moved to Krefeld.', 'Peter moved to Krefeld.\n\nHe told me on the phone.', 'a call']);
  assert.deepEqual(store.list('moment_participants').map(p => p.person_id), ['c-priya']);
  assert.deepEqual(store.list('moment_entities').map(p => p.entity_id), [peter.id]);
  assert.equal(store.list('moments').length, 1, 'a closing is due-copy\'s, not a moment of this copy');
  assert.equal(store.list('world_copies').find(r => r.file === 'world/entities/priya.md').file_text, FILES['world/entities/priya.md']);
});

test('a second run changes nothing, and a cheap look says so', t => {
  const store = seeded(t);
  copyOldWorld(store);
  const before = snapshot(store);
  const again = copyOldWorld(store);
  assert.equal(again.unchanged, true);
  assert.equal(snapshot(store), before);
  assert.equal(copyWorldIfChanged(store.root, { store }).skipped, 'nothing changed');
});

test('two machines copying the same folder end with one record each', t => {
  const a = seeded(t, { device: 'pc' }), b = seeded(t, { device: 'laptop' });
  copyOldWorld(a); copyOldWorld(b);
  const strip = r => { const { revision, device, _hash, ...rest } = r; return rest; };
  for (const type of ['entities', 'claims', 'moments', 'fact_slots', 'world_copies'])
    assert.deepEqual(a.list(type).map(strip).sort((x, y) => x.uid.localeCompare(y.uid)), b.list(type).map(strip).sort((x, y) => x.uid.localeCompare(y.uid)), type);
});

test('a changed file updates a record the owner has not touched, and never one the owner has', t => {
  const store = seeded(t);
  copyOldWorld(store);
  const file = path.join(store.root, 'world/claims/peter-mueller--city--2026-03-01.md');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('Krefeld', 'Berlin'));
  assert.equal(copyOldWorld(store).updated.length, 1);
  const city = () => store.list('claims').find(c => c.attribute === 'city');
  assert.equal(city().value, 'Berlin');
  store.save('claims', { ...city(), value: 'Hamburg' });
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('Berlin', 'Munich'));
  copyOldWorld(store);
  assert.equal(city().value, 'Hamburg', 'the owner\'s value stays');
  assert.match(store.list('world_copies').find(r => r.file.endsWith('2026-03-01.md')).file_text, /Munich/, 'and the file is still kept whole');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('Munich', 'Cologne'));
  copyOldWorld(store);
  assert.equal(city().value, 'Hamburg', 'nor by the second change of the file');
});

test('a file that does not read is said, and the others are still copied', t => {
  const store = seeded(t);
  const bad = path.join(store.root, 'world/claims/boiler--hold--2026-10-01.md');
  const realRead = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', (f, ...rest) => { if (f === bad) throw Object.assign(new Error('no'), { code: 'EACCES' }); return realRead(f, ...rest); });
  const report = copyOldWorld(store);
  assert.deepEqual(report.needsALook.map(n => n.file), ['world/claims/boiler--hold--2026-10-01.md']);
  assert.match(report.needsALook[0].why, /EACCES/);
  assert.ok(store.list('claims').some(c => c.attribute === 'city'));
  assert.equal(readNotices(store).filter(n => n.step === 'world-copy').length, 1);
});

test('a subject is the contact it names: merged, same-named (oldest), or by alias', t => {
  const files = {
    'world/entities/old-anna.md': '---\nslug: old-anna\nname: Old Anna\nmenerio_id: c-old\n---\n',
    'world/entities/twin.md': '---\nslug: twin\nname: Twin Person\n---\n',
    'world/entities/robbie.md': '---\nslug: robbie\nname: Robbie\naliases: [Rob the Builder]\n---\n',
    'world/entities/jose.md': '---\nslug: jose\n---\n',
    'world/claims/old-anna--city--2026-01-01.md': '---\nsubject: old-anna\nattribute: city\nvalue: Rome\n---\n',
    'world/claims/twin--city--2026-01-01.md': '---\nsubject: twin\nattribute: city\nvalue: Oslo\n---\n',
    'world/claims/robbie--city--2026-01-01.md': '---\nsubject: robbie\nattribute: city\nvalue: Bonn\n---\n',
    'world/claims/jose--city--2026-01-01.md': '---\nsubject: jose\nattribute: city\nvalue: Lima\n---\n',
  };
  const store = seeded(t, { files });
  store.save('contacts', { id: 'c-new', name: 'Anna New', former_ids: ['c-old'] });
  store.save('contacts', { id: 'c-gone', name: 'Anna Gone', merged_into: 'c-new', former_ids: [] });
  store.save('contacts', { id: 'c-mid', name: 'Mid', merged_into: 'c-gone' });
  store.save('contacts', { id: 'c-old', name: 'Old Anna', merged_into: 'c-mid' });
  store.save('contacts', { id: 'c-t2', name: 'Twin Person', created_at: '2026-02-01T00:00:00Z' });
  store.save('contacts', { id: 'c-t1', name: 'Twin Person', created_at: '2025-01-01T00:00:00Z' });
  store.save('contacts', { id: 'c-rob', name: 'Rob the Builder' });
  store.save('contacts', { id: 'c-jose', name: 'José' });
  copyOldWorld(store);
  const who = city => store.list('claims').find(c => c.value === city).subject_id;
  assert.equal(who('Rome'), 'c-new', 'a merged contact is the one it was merged into');
  assert.equal(who('Oslo'), 'c-t1', 'one name twice: the oldest');
  assert.equal(who('Bonn'), 'c-rob', 'by alias');
  assert.equal(who('Lima'), 'c-jose', 'an accented name matches its slug');
  assert.equal(store.list('entities').some(e => e.slug === 'jose'), false);
});

test('a file that cannot be copied is left alone and said once', t => {
  const store = seeded(t, { files: { 'world/events/no-date.md': '---\nsource: x\n---\nSomething.\n', 'world/claims/plain.md': 'no front matter\n' } });
  const first = copyOldWorld(store);
  assert.equal(first.needsALook.length, 2);
  copyOldWorld(store);
  const said = readNotices(store).filter(n => n.step === 'world-copy');
  assert.equal(said.length, 2);
  assert.match(said[0].text, /could not move world\/(events\/no-date|claims\/plain)\.md into your notebook/);
  assert.ok(fs.existsSync(path.join(store.root, 'world/claims/plain.md')));
  assert.equal(store.list('moments').length, 0);
});
