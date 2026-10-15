import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';
import {pruneUpgradeCopies,upgradeCopiesKept} from '../core/upgrade-copies.mjs';

// The copies an installer makes before it updates the notebook. Until 15 October 2026 none was
// ever removed, and Michael's server had 35 of them (7.2 GB) after eight days of updates.
const folder=()=>fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-upgrade-copies-'));
const copy=(dir,name)=>{fs.mkdirSync(path.join(dir,name),{recursive:true});fs.writeFileSync(path.join(dir,name,'backup.json'),'{"format":1,"files":[]}');fs.writeFileSync(path.join(dir,name,'note.md'),'kept knowledge');return name;};
const names=dir=>fs.readdirSync(dir).sort();
const commit=n=>String(n).repeat(40).slice(0,40);
const linux=(day,n=1)=>`202610${String(day).padStart(2,'0')}-120000-${commit(n)}`;

test('after an update that worked, the newest three copies stay and the older ones go',()=>{
  const dir=folder();
  const older=[1,2,3,4,5].map(day=>copy(dir,linux(day)));
  const made=copy(dir,linux(15));
  assert.equal(upgradeCopiesKept,3);
  const outcome=pruneUpgradeCopies(dir,{made:path.join(dir,made)});
  assert.deepEqual(outcome.kept,[made,older[4],older[3]]);
  assert.deepEqual(outcome.removed.sort(),older.slice(0,3).sort());
  assert.deepEqual(outcome.failed,[]);
  assert.deepEqual(names(dir),[older[3],older[4],made].sort());
  assert.equal(fs.readFileSync(path.join(dir,older[3],'note.md'),'utf8'),'kept knowledge','a copy that stays is left as it was');
  // Run again with nothing new: nothing more goes.
  assert.deepEqual(pruneUpgradeCopies(dir,{made}).removed,[]);
  assert.equal(names(dir).length,3);
});

test('with three or fewer copies nothing is removed',()=>{
  const dir=folder();copy(dir,linux(1));const made=copy(dir,linux(2));
  assert.deepEqual(pruneUpgradeCopies(dir,{made}).removed,[]);
  assert.equal(names(dir).length,2);
});

test('the copy just made always stays, even when the clock made it look older',()=>{
  const dir=folder();
  for(const day of [10,11,12,13])copy(dir,linux(day));
  const made=copy(dir,linux(1));
  const outcome=pruneUpgradeCopies(dir,{made});
  assert.deepEqual(outcome.kept,[made,linux(13),linux(12)]);
  assert.ok(fs.existsSync(path.join(dir,made)));
  assert.deepEqual(names(dir),[made,linux(12),linux(13)].sort());
});

test('folders an installer did not make are never touched',()=>{
  const dir=folder();
  for(const day of [1,2,3,4])copy(dir,linux(day));
  const made=copy(dir,linux(15));
  const foreign=[
    '1760000000000',                        // a nightly backup (backup-schedule.mjs keeps its own)
    'move-1760000000000-abcdef123456',      // the copy a workspace move made
    '20261001-120000',                      // one the owner made with manage.sh backup
    'my photos',                            // the owner's own folder
    'before-update-20261001-120000',        // the right name, but no backup.json: not a copy
    '.partial-my photos',                   // looks part-way, but not by any installer's name
  ];
  for(const name of foreign)copy(dir,name);
  fs.rmSync(path.join(dir,'before-update-20261001-120000','backup.json'));
  fs.writeFileSync(path.join(dir,linux(0)),'a file with a copy\'s name');
  fs.writeFileSync(path.join(dir,'notes.txt'),'the owner\'s file');
  // A link to a folder somewhere else, named like an old copy: neither followed nor removed.
  const elsewhere=folder();copy(elsewhere,'outside');
  let linked=false;try{fs.symlinkSync(path.join(elsewhere,'outside'),path.join(dir,linux(1,7)),'junction');linked=true;}catch{}
  const outcome=pruneUpgradeCopies(dir,{made});
  assert.deepEqual(outcome.removed.sort(),[linux(1),linux(2)]);
  for(const name of [...foreign,linux(0),'notes.txt'])assert.ok(fs.existsSync(path.join(dir,name)),name+' stays');
  assert.ok(outcome.ignored.includes('1760000000000')&&outcome.ignored.includes('my photos'));
  if(linked){
    assert.ok(fs.lstatSync(path.join(dir,linux(1,7))).isSymbolicLink(),'the link stays');
    assert.ok(fs.existsSync(path.join(elsewhere,'outside','note.md')),'and what it points at is untouched');
  }
});

test('a part-way copy older than the one just made goes; a newer one may still be in the making',()=>{
  const dir=folder();
  const made=copy(dir,linux(10));
  fs.mkdirSync(path.join(dir,'.partial-'+linux(5)));fs.writeFileSync(path.join(dir,'.partial-'+linux(5),'note.md'),'half');
  fs.mkdirSync(path.join(dir,'.partial-'+linux(20)));
  const outcome=pruneUpgradeCopies(dir,{made});
  assert.deepEqual(outcome.removed,['.partial-'+linux(5)]);
  assert.deepEqual(names(dir),['.partial-'+linux(20),made].sort());
});

test('without a whole copy just made, nothing is removed',()=>{
  const dir=folder();
  for(const day of [1,2,3,4,5])copy(dir,linux(day));
  const before=names(dir);
  // The update's backup failed: there is no copy of it.
  assert.throws(()=>pruneUpgradeCopies(dir,{made:linux(15)}),/Nothing was removed/);
  // A copy that stopped part-way is not one.
  fs.mkdirSync(path.join(dir,linux(16)));
  assert.throws(()=>pruneUpgradeCopies(dir,{made:linux(16)}),/Nothing was removed/);
  fs.rmSync(path.join(dir,linux(16)),{recursive:true});
  // Not named, in another folder, or keeping none.
  assert.throws(()=>pruneUpgradeCopies(dir,{}),/Nothing was removed/);
  const other=folder();copy(other,linux(15));
  assert.throws(()=>pruneUpgradeCopies(dir,{made:path.join(other,linux(15))}),/Nothing was removed/);
  assert.throws(()=>pruneUpgradeCopies(dir,{made:linux(5),keep:0}),/at least one/);
  assert.deepEqual(names(dir),before);
});

test('the Windows setup\'s and the server package\'s copies follow the same rule',()=>{
  const windows=folder();
  for(const name of ['20261001-090000-001','20261002-090000-002','20261003-090000-003','20261003-090000-004'])copy(windows,name);
  const madeWindows=copy(windows,'20261015-101010-123');
  assert.deepEqual(pruneUpgradeCopies(windows,{made:madeWindows}).removed.sort(),['20261001-090000-001','20261002-090000-002']);
  assert.deepEqual(names(windows),['20261003-090000-003','20261003-090000-004',madeWindows].sort(),'the milliseconds tell two copies of one second apart');
  const server=folder();
  for(const day of [1,2,3])copy(server,`before-update-202610${String(day).padStart(2,'0')}-120000`);
  copy(server,'20260930-120000');
  const madeServer=copy(server,'before-update-20261015-120000');
  assert.deepEqual(pruneUpgradeCopies(server,{made:madeServer}).removed,['before-update-20261001-120000']);
  assert.ok(fs.existsSync(path.join(server,'20260930-120000')),'a backup made with manage.sh backup stays');
});

const cli=fileURLToPath(new URL('../bin/godspeed.mjs',import.meta.url));
test('godspeed.mjs prune-backups needs no workspace and says what it did',()=>{
  const dir=folder();
  for(const day of [1,2,3,4])copy(dir,linux(day));
  const made=copy(dir,linux(15));
  const env={...process.env};delete env.GODSPEED_WORKSPACE;
  const refused=spawnSync(process.execPath,[cli,'prune-backups',dir],{encoding:'utf8',env});
  assert.notEqual(refused.status,0,'without the copy just made it refuses');
  assert.equal(names(dir).length,5);
  const run=spawnSync(process.execPath,[cli,'prune-backups',dir,'--made',path.join(dir,made)],{encoding:'utf8',env});
  assert.equal(run.status,0,run.stderr);
  const outcome=JSON.parse(run.stdout);
  assert.deepEqual(outcome.removed.sort(),[linux(1),linux(2)]);
  assert.deepEqual(names(dir),[linux(3),linux(4),made].sort());
  const two=spawnSync(process.execPath,[cli,'prune-backups',dir,'--made',made,'--keep','2'],{encoding:'utf8',env});
  assert.equal(two.status,0,two.stderr);
  assert.deepEqual(names(dir),[linux(4),made].sort());
});
