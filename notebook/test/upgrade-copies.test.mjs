import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';import {spawnSync,execFileSync} from 'node:child_process';
import {pruneUpgradeCopies,upgradeCopiesKept} from '../core/upgrade-copies.mjs';
import {Store} from '../core/records/store.mjs';
import {makeUpdateCopy} from '../core/update-copy.mjs';

// The copies an installer makes before it updates the notebook. Until 15 October 2026 none was
// ever removed, and one server had 35 of them (7.2 GB) after eight days of updates; until 21
// October 2026 the newest three stayed, and one computer still had nine whole ones (36 GB).
const folder=()=>fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-upgrade-copies-'));
const copy=(dir,name)=>{fs.mkdirSync(path.join(dir,name),{recursive:true});fs.writeFileSync(path.join(dir,name,'backup.json'),'{"format":1,"files":[]}');fs.writeFileSync(path.join(dir,name,'note.md'),'kept knowledge');return name;};
const names=dir=>fs.readdirSync(dir).sort();
const commit=n=>String(n).repeat(40).slice(0,40);
const linux=(day,n=1)=>`202610${String(day).padStart(2,'0')}-120000-${commit(n)}`;

test('after an update that worked, the copy it made stays and every older one goes',()=>{
  const dir=folder();
  const older=[1,2,3,4,5].map(day=>copy(dir,linux(day)));
  const made=copy(dir,linux(15));
  assert.equal(upgradeCopiesKept,1);
  const outcome=pruneUpgradeCopies(dir,{made:path.join(dir,made)});
  assert.deepEqual(outcome.kept,[made]);
  assert.deepEqual(outcome.removed.sort(),older.sort());
  assert.deepEqual(outcome.failed,[]);
  assert.deepEqual(names(dir),[made]);
  assert.equal(fs.readFileSync(path.join(dir,made,'note.md'),'utf8'),'kept knowledge','the copy that stays is left as it was');
  // Run again with nothing new: nothing more goes.
  assert.deepEqual(pruneUpgradeCopies(dir,{made}).removed,[]);
  assert.equal(names(dir).length,1);
});

test('more can be kept when asked, the newest first',()=>{
  const dir=folder();
  const older=[1,2,3,4,5].map(day=>copy(dir,linux(day)));
  const made=copy(dir,linux(15));
  assert.deepEqual(pruneUpgradeCopies(dir,{made,keep:3}).kept,[made,older[4],older[3]]);
  assert.deepEqual(names(dir),[older[3],older[4],made].sort());
});

test('the copy just made always stays, even when the clock made it look older',()=>{
  const dir=folder();
  for(const day of [10,11,12,13])copy(dir,linux(day));
  const made=copy(dir,linux(1));
  const outcome=pruneUpgradeCopies(dir,{made});
  assert.deepEqual(outcome.kept,[made]);
  assert.deepEqual(names(dir),[made]);
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
  assert.deepEqual(outcome.removed.sort(),[linux(1),linux(2),linux(3),linux(4)]);
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
  assert.deepEqual(pruneUpgradeCopies(windows,{made:madeWindows,keep:3}).removed.sort(),['20261001-090000-001','20261002-090000-002']);
  assert.deepEqual(names(windows),['20261003-090000-003','20261003-090000-004',madeWindows].sort(),'the milliseconds tell two copies of one second apart');
  assert.deepEqual(pruneUpgradeCopies(windows,{made:madeWindows}).removed.sort(),['20261003-090000-003','20261003-090000-004']);
  const server=folder();
  for(const day of [1,2,3])copy(server,`before-update-202610${String(day).padStart(2,'0')}-120000`);
  copy(server,'20260930-120000');
  const madeServer=copy(server,'before-update-20261015-120000');
  assert.deepEqual(pruneUpgradeCopies(server,{made:madeServer}).removed.sort(),['before-update-20261001-120000','before-update-20261002-120000','before-update-20261003-120000']);
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
  assert.deepEqual(outcome.removed.sort(),[linux(1),linux(2),linux(3),linux(4)]);
  assert.deepEqual(names(dir),[made]);
});

test('godspeed.mjs prune-backups still keeps more when asked',()=>{
  const dir=folder();
  for(const day of [1,2,3,4])copy(dir,linux(day));
  const made=copy(dir,linux(15)),env={...process.env};delete env.GODSPEED_WORKSPACE;
  const two=spawnSync(process.execPath,[cli,'prune-backups',dir,'--made',made,'--keep','2'],{encoding:'utf8',env});
  assert.equal(two.status,0,two.stderr);
  assert.deepEqual(names(dir),[linux(4),made].sort());
});

// A copy made with Git (core/update-copy.mjs) keeps its commit with a ref in the folder's own
// repository. The ref goes with the copy, and one a copy left that stopped part-way or was
// removed by hand goes too; the copy that stays keeps its own.
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();
function repository(){
  const root=folder();
  git(root,'init','-q');git(root,'config','user.name','Fictional');git(root,'config','user.email','fictional@example.invalid');
  fs.writeFileSync(path.join(root,'.gitignore'),'.godspeed/\n');
  const store=new Store(root);store.save('notes',{title:'Fictional',content:'committed'});
  git(root,'add','-A');git(root,'commit','-q','-m','one');
  return {root,store};
}
test('the ref a copy made with Git keeps goes with it, and one left behind goes too',()=>{
  const {root,store}=repository(),dir=folder(),media=path.join(root,'.godspeed','media');
  const first=makeUpdateCopy(store,media,path.join(dir,'20261018-090000-001'));
  store.save('notes',{title:'Second',content:'not committed'});
  const second=makeUpdateCopy(store,media,path.join(dir,'20261019-090000-002'));
  // One that stopped part-way after its ref was made, and a copy removed by hand.
  git(root,'update-ref','refs/godspeed/update-copies/20261017-090000-003','HEAD');
  git(root,'update-ref','refs/godspeed/update-copies/20261016-090000-004','HEAD');
  fs.mkdirSync(path.join(dir,'.partial-20261017-090000-003'));
  // Someone else's ref there, and a newer one that may still be in the making.
  git(root,'update-ref','refs/godspeed/update-copies/my-own','HEAD');
  git(root,'update-ref','refs/godspeed/update-copies/20261030-090000-005','HEAD');
  const outcome=pruneUpgradeCopies(dir,{made:second.path});
  assert.deepEqual(outcome.removed.sort(),['.partial-20261017-090000-003','20261018-090000-001']);
  assert.deepEqual(outcome.released.sort(),[first.ref,'refs/godspeed/update-copies/20261016-090000-004','refs/godspeed/update-copies/20261017-090000-003'].sort());
  assert.deepEqual(git(root,'for-each-ref','--format=%(refname)','refs/godspeed/').split('\n').sort(),[second.ref,'refs/godspeed/update-copies/20261030-090000-005','refs/godspeed/update-copies/my-own'].sort());
  assert.equal(git(root,'status','--porcelain','--untracked-files=no'),'','the folder and its index are as they were');
});

test('a copy that stays keeps its ref',()=>{
  const {root,store}=repository(),dir=folder(),media=path.join(root,'.godspeed','media');
  const older=makeUpdateCopy(store,media,path.join(dir,'20261017-090000-001'));
  const first=makeUpdateCopy(store,media,path.join(dir,'20261018-090000-001'));
  git(root,'commit','-q','--allow-empty','-m','two');
  const second=makeUpdateCopy(store,media,path.join(dir,'20261019-090000-002'));
  const outcome=pruneUpgradeCopies(dir,{made:second.path,keep:2});
  assert.deepEqual(outcome.removed,['20261017-090000-001']);
  assert.deepEqual(outcome.released,[older.ref]);
  assert.equal(git(root,'rev-parse',first.ref),first.commit);
  assert.equal(git(root,'rev-parse',second.ref),git(root,'rev-parse','HEAD'));
});
