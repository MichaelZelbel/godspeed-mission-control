import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';

// Reviewed on 7 October 2026 (storage review):
//  - a multi-record save (a collection rename, a merge, a conversion group) that
//    died mid-write deleted the old files before writing the new ones, so the
//    not-yet-written records were in no file at all (fix: write before delete);
//  - a prepared save was replayed by file state alone, so one whose record had
//    since moved to a third file came back as a second file with the same uid
//    (fix: judge staleness by record identity and revision too);
//  - a failed save whose rollback also failed stayed prepared and was replayed
//    forward later (fix: set it aside instead).
const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-tx-ordering-'));
const cleanup=root=>{try{fs.rmSync(root,{recursive:true,force:true});}catch{}};
const transactions=store=>{const dir=path.join(store.state,'transactions');return fs.existsSync(dir)?fs.readdirSync(dir):[];};
const setAside=store=>{const dir=path.join(store.state,'transactions-set-aside');return fs.existsSync(dir)?fs.readdirSync(dir):[];};
const mdFiles=dir=>fs.readdirSync(dir).filter(n=>n.endsWith('.md'));
const dupUuid=store=>store.problems.filter(p=>p.error==='Duplicate UUID').length;

test('a multi-record move interrupted mid-write never leaves a record with no file',t=>{
  const root=temp(),server=new Store(root,{device:'server'});
  const books=server.save('collections',{name:'Books',description:'what I read'}),items=[];
  for(let i=1;i<=5;i++)items.push(server.save('collection_items',{title:'Book '+i,collection_id:books.id,data:{note:'notes on book '+i},references:[{type:'collections',id:books.id,uid:books.uid}]}));

  // The assistant renames the collection, which moves its five items. That
  // program dies the instant it tries to remove Book 3's old file: a realistic
  // "process killed" (crash, so nothing is rolled back).
  const cli=new Store(root,{device:'cli'}),unlink=fs.unlinkSync;
  t.mock.method(fs,'unlinkSync',(p,...rest)=>{if(String(p).endsWith(path.join('Books','Book 3.md')))throw Object.assign(new Error('process killed'),{crash:true});return unlink(p,...rest);});
  assert.throws(()=>cli.save('collections',{...cli.get('collections',books.id),name:'Novels'}),/process killed/);
  t.mock.restoreAll();

  // Every record that was being moved still has a file: none is in no file at
  // all. On the committed code the collection and the first items were lost
  // (their old file was deleted before their new one was written).
  server.scan(true);
  assert.ok(server.get('collections',books.id),'the collection still has a file');
  for(const item of items)assert.ok(server.get('collection_items',item.id),item.title+' still has a file');

  // On the next start, recovery finishes the interrupted move cleanly.
  const reopened=new Store(root,{device:'server'});
  assert.ok(reopened.get('collections',books.id),'the collection survives recovery');
  for(const item of items)assert.ok(reopened.get('collection_items',item.id),item.title+' survives recovery');
  assert.equal(reopened.list('collection_items').length,5);
  assert.equal(dupUuid(reopened),0,'no duplicate uid is left behind');
  assert.deepEqual(transactions(reopened),[],'the interrupted move was finished, not left pending');
  cleanup(root);
});

test('a prepared save is not replayed over a newer save that moved the record to a third file',()=>{
  const root=temp(),server=new Store(root,{device:'server'});
  const note=server.save('notes',{title:'Alpha',content:'first text'});
  // A command-line program prepares a rename, then dies before touching a file.
  const cli=new Store(root,{device:'cli'});
  cli.applyTransaction=function(){throw Object.assign(new Error('process killed'),{crash:true});};
  assert.throws(()=>cli.save('notes',{...cli.get('notes',note.id),title:'Beta',content:'typed in the command line'}),/process killed/);
  assert.equal(transactions(cli).length,1,'the rename is left prepared');
  // The still-running server saves the same note again; its title moves its file.
  server.scan(true);
  server.save('notes',{...server.get('notes',note.id),title:'Gamma',content:'newest text, typed after the crash'});
  // Next start: the stale prepared save must not come back as a second file.
  const reopened=new Store(root,{device:'server'});
  assert.deepEqual(mdFiles(reopened.recordsRoot),['Gamma.md'],'only the newest file, no duplicate');
  assert.equal(reopened.get('notes',note.id).content,'newest text, typed after the crash');
  assert.equal(dupUuid(reopened),0,'no Duplicate UUID that would stop sync');
  assert.equal(setAside(reopened).length,1,'the stale prepared save is kept for review');
  cleanup(root);
});

test('a prepared save is still replayed forward when its record was not saved again since',()=>{
  const root=temp(),store=new Store(root),note=store.save('notes',{title:'Plan',content:'v1'});
  // Interrupted after the contact was written, before the note and its history.
  store.failAfter=1;
  assert.throws(()=>store.withLock(()=>store.commit([store.prepare('contacts',{name:'Alex'}),store.prepare('notes',{content:'v2'},store.get('notes',note.id))])),/Injected crash/);
  store.failAfter=null;
  const reopened=new Store(root);
  assert.equal(reopened.get('notes',note.id).content,'v2','nothing changed since, so it is completed');
  assert.equal(reopened.list('contacts').length,1);
  assert.deepEqual(setAside(reopened),[]);assert.deepEqual(reopened.problems,[]);
  cleanup(root);
});

test('a failed save whose rollback also fails is set aside, never replayed forward',t=>{
  const root=temp(),store=new Store(root);
  const a=store.prepare('notes',{title:'Note A',content:'a'}),b=store.prepare('notes',{title:'Note B',content:'b'});
  // Writing Note B fails, and undoing Note A fails too (a locked file, a full
  // disk during the undo).
  const rename=fs.renameSync,unlink=fs.unlinkSync;
  t.mock.method(fs,'renameSync',(from,to,...rest)=>{if(String(to).endsWith(path.join('notebook','Note B.md')))throw Object.assign(new Error('EIO: the fictional disk refused'),{code:'EIO'});return rename(from,to,...rest);});
  t.mock.method(fs,'unlinkSync',(p,...rest)=>{if(String(p).endsWith(path.join('notebook','Note A.md')))throw Object.assign(new Error('EIO: the fictional disk refused'),{code:'EIO'});return unlink(p,...rest);});
  assert.throws(()=>store.withLock(()=>store.commit([a,b])),/fictional disk refused/);
  t.mock.restoreAll();
  assert.deepEqual(transactions(store),[],'nothing is left prepared for a later start to replay');
  // On the next start the save the caller was told failed does not reappear.
  const reopened=new Store(root);
  assert.equal(reopened.get('notes',b.id),undefined,'the failed save does not come back');
  assert.ok(reopened.problems.some(p=>p.set_aside),'and it is reported as set aside');
  cleanup(root);
});
