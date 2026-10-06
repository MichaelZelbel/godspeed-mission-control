import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store, atomic, encode } from '../core/records/store.mjs';
import { FileSync } from '../core/sync/git.mjs';
import { convertNotebook } from '../core/convert-notebook.mjs';
import { legacyWorkspace, legacyEncode, legacyFile } from './legacy-workspace.mjs';

const files=dir=>{const out=new Map(),walk=(d,rel)=>{if(!fs.existsSync(d))return;for(const e of fs.readdirSync(d,{withFileTypes:true})){const r=rel?rel+'/'+e.name:e.name;if(e.isDirectory())walk(path.join(d,e.name),r);else out.set(r,fs.readFileSync(path.join(d,e.name)));}};walk(dir,'');return out;};
const readable=root=>[...files(path.join(root,'notebook')).keys()].filter(f=>!f.startsWith('_system/')).sort();
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();

test('the converter turns an old workspace into readable files, keeps every record exactly, and a second run changes nothing',()=>{
  const {root,records,ids}=legacyWorkspace(),before=files(path.join(root,'notebook')),media=files(path.join(root,'.godspeed','media'));
  const store=new Store(root);assert.deepEqual(store.problems,[]);assert.equal(store.records.size,records.length,'The old layout is read as it is');

  const dry=convertNotebook(store,{dryRun:true});
  assert.equal(dry.converted,false);assert.equal(dry.changed,records.length);assert.equal(dry.renamed.length,records.length);
  assert.deepEqual(files(path.join(root,'notebook')),before,'A dry run changes nothing');
  assert.ok(!fs.existsSync(path.join(root,'.godspeed','backups')));
  assert.deepEqual(new Set(dry.renamed.map(r=>r.from)),new Set(records.map(r=>legacyFile(r).slice('notebook/'.length).split(path.sep).join('/'))),'Every old file is listed');

  const done=convertNotebook(store);
  assert.equal(done.converted,true);assert.deepEqual(done.renamed,dry.renamed,'The dry run listed exactly what changed');

  // Every note is <folder>/<Title>.md, every person People/<Name>.md.
  const at=(type,id)=>dry.renamed.find(r=>r.type===type&&r.id===id).to;
  const note=i=>at('notes',ids.notes[i]);
  assert.equal(note(0),'Projects/Q3Q4 plan draft v2.md');
  assert.equal(note(1),'Projects/2026/Q4/\u{1F389} Launch party.md');
  assert.equal(note(2),'A'.repeat(200)+'.md');
  assert.equal(note(3),'\u00c4rger/\u00d6lung/Gr\u00fc\u00dfe aus M\u00fcnchen.md');
  assert.deepEqual([note(4),note(5),note(6)],['Untitled.md','Untitled 2.md','Untitled 3.md']);
  assert.deepEqual([note(7),note(8),note(9),note(10)],['Projects/Duplicate.md','Projects/Duplicate 2.md','Projects/Duplicate 3.md','Projects/duplicate 4.md'],'Same title, and a title or folder differing only in case, never share one file');
  assert.equal(note(11),'CON_.md');assert.equal(note(12),'hidden notes.md');assert.equal(note(13),'Trailing dots.md');
  assert.equal(note(14),'_system/notes/'+ids.notes[14]+'.md','A removed note leaves the readable folders');
  assert.equal(note(15),'\u00dcnicode decomposed.md','Names are written composed, as every system shows them');
  assert.ok(Buffer.byteLength(path.basename(note(16)))<=203,'A long emoji title fits the file system');
  assert.equal(note(17),'Folder with colon/Backslash and pipe.md');
  assert.equal(note(18),'escape/Outside.md');assert.equal(note(19),'Dots.md','A folder path never leaves the notebook');
  assert.equal(note(20),'Leading/slash/Leading slash.md');
  assert.equal(at('notes',ids.trashed),'Trash/Projects/Thrown away.md');
  assert.equal(at('contacts',ids.ada),'People/Ada Lovelace.md');assert.equal(at('contacts',ids.ada2),'People/Ada Lovelace 2.md');
  assert.equal(at('contacts',ids.jose),'People/Jos\u00e9 M\u00fcller-Schmidt.md');assert.equal(at('contacts',ids.merged),'_system/contacts/'+ids.merged+'.md');
  assert.equal(at('contact_groups',ids.club),'Groups/Book club.md');assert.equal(at('moments',ids.moved),'Timeline/2025-01-01 Moved to Berlin.md');
  assert.equal(at('collections',ids.books),'Collections/Books.md');
  assert.deepEqual(readable(root),['A'.repeat(200)+'.md','CON_.md','Collections/Books.md','Collections/Books/Dune 2.md','Collections/Books/Dune.md','Dots.md','Facts/Earlier/city - Hamburg.md','Facts/city - Berlin.md',
    'Folder with colon/Backslash and pipe.md','Groups/Book club.md','Leading/slash/Leading slash.md','Lexicon/Personal AI.md','People/Ada Lovelace 2.md','People/Ada Lovelace.md','People/Jos\u00e9 M\u00fcller-Schmidt.md',
    'Projects/2026/Q4/\u{1F389} Launch party.md','Projects/Duplicate 2.md','Projects/Duplicate 3.md','Projects/Duplicate.md','Projects/Q3Q4 plan draft v2.md','Projects/duplicate 4.md','README.md',
    'Timeline/2025-01-01 Moved to Berlin.md','Trailing dots.md','Trash/Projects/Thrown away.md','Untitled 2.md','Untitled 3.md','Untitled.md','World/Acme Robotics.md','escape/Outside.md','hidden notes.md',
    '\u00c4rger/\u00d6lung/Gr\u00fc\u00dfe aus M\u00fcnchen.md','\u00dcnicode decomposed.md',path.basename(note(16))].sort(),'Only readable pages outside the system folder, and no empty old folders');
  assert.deepEqual(fs.readdirSync(path.join(root,'notebook','_system')).sort(),['contact_group_memberships','contacts','import_mappings','jobs','moment_participants','note_attachments','notes','record_history','settings']);

  // Plain YAML frontmatter Obsidian reads, Menerio's field names, the text as the body.
  const page=fs.readFileSync(path.join(root,'notebook','\u00c4rger','\u00d6lung','Gr\u00fc\u00dfe aus M\u00fcnchen.md'),'utf8');
  assert.match(page,/^---\nid: [0-9a-f-]{36}\ntype: note\ntitle: Gr\u00fc\u00dfe aus M\u00fcnchen\ncreated: 2024-[^\n]+\nmodified: [^\n]+\ntags:\n  - tagged\n/);
  assert.match(page,/\nuid: [0-9a-f-]{36}\n/);assert.match(page,/\n---\n# Note 3\n\nSee \[\[Personal AI\]\] and !\[\[photo\.png\]\]\.\nEdited once\.\n$/);
  const person=fs.readFileSync(path.join(root,'notebook','People','Ada Lovelace.md'),'utf8');
  assert.match(person,/^---\nid: [0-9a-f-]{36}\ntype: person\nname: Ada Lovelace\nemail: ada@example\.com\n/);assert.match(person,/\n---\nMet at the conference$/);
  assert.equal(fs.readFileSync(path.join(root,'notebook','README.md'),'utf8'),'# My notebook\n\nWritten by hand.\n','The owner\'s own page is left alone');

  // Every record holds exactly what it held: the same text once written in
  // today's form, the same revision, no new history, references intact.
  const after=new Store(root);assert.deepEqual(after.problems,[]);assert.equal(after.records.size,records.length);
  for(const r of records){const now=after.get(r.type,r.id);assert.ok(now,r.type+'/'+r.id);assert.equal(encode(now),encode(r));assert.equal(now.revision,r.revision);}
  assert.equal(after.list('record_history').length,records.filter(r=>r.type==='record_history').length);
  assert.equal(after.get('notes',ids.notes[0]).references.find(ref=>ref.field==='contact_id').uid,after.get('contacts',ids.ada).uid);
  assert.deepEqual(files(path.join(root,'.godspeed','media')),media,'Attachment bytes and their mappings are not touched');

  // The backup holds the old notebook byte for byte.
  const backup=done.backup,saved=JSON.parse(fs.readFileSync(path.join(backup,'backup.json'),'utf8'));
  assert.equal(saved.files.length,before.size);
  for(const [rel,bytes] of before)assert.deepEqual(fs.readFileSync(path.join(backup,'notebook',...rel.split('/'))),bytes);
  assert.ok(fs.existsSync(path.join(backup,'conversion-report.json')));

  const again=convertNotebook(new Store(root));
  assert.equal(again.changed,0);assert.deepEqual(again.renamed,[]);assert.equal(fs.readdirSync(path.join(root,'.godspeed','backups')).length,1,'Nothing to do, nothing copied');
});

test('the converter refuses a notebook with validation problems and changes nothing',()=>{
  const {root}=legacyWorkspace();atomic(path.join(root,'notebook','notes','broken.md'),'---\n{"format":1,"type":"notes"\n---\n');
  const before=files(path.join(root,'notebook')),result=convertNotebook(new Store(root));
  assert.equal(result.converted,false);assert.ok(result.problems.length);assert.deepEqual(files(path.join(root,'notebook')),before);
});

test('an unconverted workspace keeps working, and a saved record moves to its readable file',()=>{
  const {root,ids}=legacyWorkspace(),store=new Store(root),old=store.get('contacts',ids.ada);
  store.save('contacts',{...old,phone:'+49 30 1234'},old._hash);
  assert.ok(fs.existsSync(path.join(root,'notebook','People','Ada Lovelace.md')));
  assert.ok(!fs.existsSync(path.join(root,'notebook','contacts',ids.ada+'.json')));
  assert.equal(new Store(root).get('contacts',ids.ada).phone,'+49 30 1234');
  const result=convertNotebook(new Store(root));assert.equal(result.converted,true);assert.ok(!result.renamed.some(r=>r.id===ids.ada),'What is already readable stays where it is');
});

test('the convert-notebook command lists the plan with --dry-run and converts without it',()=>{
  const {root}=legacyWorkspace(),cli=fileURLToPath(new URL('../bin/godspeed.mjs',import.meta.url));
  const run=(...args)=>JSON.parse(execFileSync(process.execPath,[cli,'convert-notebook',...args],{env:{...process.env,GODSPEED_WORKSPACE:root},encoding:'utf8'}));
  const dry=run('--dry-run');assert.equal(dry.dryRun,true);assert.ok(dry.renamed>40);assert.match(dry.first_renames[0],/ -> /);
  const list=JSON.parse(fs.readFileSync(dry.full_list,'utf8'));assert.equal(list.renamed.length,dry.renamed);
  assert.ok(fs.existsSync(path.join(root,'notebook','notes')),'Still the old layout after a dry run');
  const done=run();assert.equal(done.converted,true);assert.equal(done.renamed,dry.renamed);assert.ok(fs.existsSync(done.backup));
  assert.equal(run().changed,0);
});

// One machine converts, the other still has the old layout and an edit it
// made offline. After both sync, the edit is in the readable file, once.
test('a conversion on one machine and an offline edit in the old layout on another end as one edited note',()=>{
  const {root:seed,ids}=legacyWorkspace(),base=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-convert-sync-')),origin=path.join(base,'origin.git');
  fs.mkdirSync(origin);git(origin,'init','--bare','--initial-branch=main');
  git(seed,'init','-q','-b','main');git(seed,'config','user.name','Owner');git(seed,'config','user.email','owner@localhost');
  atomic(path.join(seed,'.gitignore'),'/.godspeed/\n/conflicts/\n/FULL-ALPHA.md\n/assistant-state/\n');git(seed,'add','-A');git(seed,'commit','-qm','Old layout');git(seed,'remote','add','origin',origin);git(seed,'push','-q','origin','main');
  const machine=name=>{const dir=path.join(base,name);git(base,'clone','-q','-c','core.autocrlf=false',origin,dir);git(dir,'config','user.name','Owner');git(dir,'config','user.email','owner@localhost');
    const store=new Store(dir,{device:name});atomic(path.join(store.state,'sync-config.json'),JSON.stringify({enabled:true,repository:'folder',paths:['notebook']}));return {dir,store,sync:new FileSync(store)};};
  const a=machine('desktop'),b=machine('laptop');
  // The laptop edits a note in the old file, as an older version would have.
  const file=path.join(b.dir,'notebook','notes',ids.notes[3]+'.md'),note=b.store.get('notes',ids.notes[3]);
  atomic(file,legacyEncode({...note,content:note.content+'Written offline on the laptop.\n',revision:note.revision+1,updated_at:'2026-10-05T12:00:00.000Z'}));
  assert.equal(convertNotebook(a.store).converted,true);
  assert.equal(a.sync.reconcile().state,'synced');
  assert.equal(b.sync.reconcile().state,'synced',JSON.stringify(b.sync.last));
  assert.equal(a.sync.reconcile().state,'synced');
  for(const m of [a,b]){
    const fresh=new Store(m.dir);assert.deepEqual(fresh.problems,[]);
    assert.match(fresh.get('notes',ids.notes[3]).content,/Written offline on the laptop/);
    assert.equal(fresh.list('notes').filter(n=>n.uid===note.uid).length,1);
    assert.ok(fs.existsSync(path.join(m.dir,'notebook','\u00c4rger','\u00d6lung','Gr\u00fc\u00dfe aus M\u00fcnchen.md')));
    assert.ok(!fs.existsSync(path.join(m.dir,'notebook','notes')),'No old file is left on either machine');
    assert.deepEqual(m.sync.pendingConflicts(),[]);
  }
  assert.deepEqual(readable(a.dir),readable(b.dir));
});
