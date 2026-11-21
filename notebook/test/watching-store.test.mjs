import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store,encode} from '../core/records/store.mjs';

// On 6 October 2026 an envy copy of the real notebook (16,000 files, 114 MB)
// answered a health check in 8 to 20 seconds with one dashboard open: every
// request read every file again, a read took longer than the two seconds it
// could be reused, and the server read for 138 of 240 seconds. A watching
// store reads a file only when something says it changed.
const root=()=>fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-watching-'));
const until=async(check,ms=5000)=>{const end=Date.now()+ms;for(;;){const value=check();if(value||Date.now()>end)return value;await new Promise(r=>setTimeout(r,25));}};

test('an idle watching store does not read the vault again, however long it waits',async()=>{
  const dir=root(),seed=new Store(dir);for(let i=0;i<20;i++)seed.save('notes',{id:'n'+i,title:'Note '+i,content:'body'});
  const store=new Store(dir,{watch:true});
  try{
    const reads=store.reads;
    for(let i=0;i<5;i++){store.scan();store.get('notes','n3');await new Promise(r=>setTimeout(r,60));}
    store.withLock(()=>store.scan());
    assert.equal(store.reads-reads,0,'an idle store read the whole vault '+(store.reads-reads)+' times');
  }finally{store.unwatch();}
});

test('under the workspace lock a watching store sees another writer\'s save at once, through the journal',()=>{
  const dir=root(),store=new Store(dir,{watch:true});
  try{
    store.save('notes',{id:'w',title:'W',content:'one'});
    const other=new Store(dir);other.save('notes',{id:'w',content:'two'},other.get('notes','w')._hash);
    // No waiting for the watcher: the save that follows must act on 'two'.
    assert.equal(store.withLock(()=>store.snapshot(()=>store.get('notes','w').content)),'two');
    const reads=store.reads;store.withLock(()=>store.scan());
    assert.equal(store.reads-reads,0,'the journal named the file, so nothing else was read');
  }finally{store.unwatch();}
});

test('a file edited by hand (no lock, no journal) is seen once the watcher reports it',async()=>{
  const dir=root(),store=new Store(dir,{watch:true});
  try{
    const note=store.save('notes',{id:'hand',title:'Hand',content:'before'}),file=store.file(note);
    fs.writeFileSync(file,encode({...note,content:'edited in Obsidian'}));
    assert.equal(await until(()=>store.get('notes','hand').content==='edited in Obsidian'),true);
    // A page that arrives from outside becomes a note: its words, name and place are kept
    // and the notebook gives it frontmatter, so it is listed and searched like any note (#897).
    const other=path.join(store.recordsRoot,'Ideas','Owner page.md');fs.mkdirSync(path.dirname(other),{recursive:true});fs.writeFileSync(other,'# my own words\n');
    assert.equal(await until(()=>{store.scan();return store.list('notes').some(n=>n.title==='Owner page');}),true,'an arriving page becomes a note');
    const adopted=fs.readFileSync(other,'utf8');
    assert.match(adopted,/^---/,'the file gains the record\'s frontmatter in place');
    assert.match(adopted,/---\n# my own words\n$/,'the page\'s words are kept whole as the body');
    assert.equal(store.get('notes',store.list('notes').find(n=>n.title==='Owner page').id).folder_path,'Ideas','the page stays in its folder');
    assert.ok(![...store.documents].some(f=>f===other),'it is a note now, not a page');
    fs.unlinkSync(file);
    assert.equal(await until(()=>!store.get('notes','hand')),true,'a deleted file is gone from the view');
  }finally{store.unwatch();}
});

test('an outside edit to a note that arrived is seen, though the adoption wrote its file by rename',async()=>{
  const dir=root(),store=new Store(dir,{watch:true});
  try{
    // The adoption's atomic write replaces the page's file by rename; the folder-level
    // watch reports the folder's name however often the file under it is replaced, so
    // the outside edits an arrived note exists for are still seen (#897).
    const other=path.join(store.recordsRoot,'Arrived.md');fs.writeFileSync(other,'# arrived words\n');
    assert.equal(await until(()=>{store.scan();return store.list('notes').some(n=>n.title==='Arrived');}),true,'the page becomes a note');
    const note=store.list('notes').find(n=>n.title==='Arrived'),file=store.file(note);
    fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('# arrived words','# arrived words quokkafern'));
    assert.equal(await until(()=>{store.scan();return store.get('notes',note.id)?.content.includes('quokkafern');}),true,'the outside edit reaches the note without a restart');
  }finally{store.unwatch();}
});

test('a folder renamed by hand moves every record in it, without a full read',async()=>{
  const dir=root(),store=new Store(dir,{watch:true});
  try{
    for(let i=0;i<5;i++)store.save('notes',{id:'f'+i,title:'Folder note '+i,content:'x',folder_path:'Old place'});
    const reads=store.reads;
    fs.renameSync(path.join(store.recordsRoot,'Old place'),path.join(store.recordsRoot,'New place'));
    assert.equal(await until(()=>{store.scan();return [0,1,2,3,4].every(i=>store.fileOf.get('notes/f'+i)?.includes('New place'));}),true);
    assert.equal(store.records.size>=5,true);
    assert.equal(store.reads-reads,0);
  }finally{store.unwatch();}
});

test('the safety check finds a change the watcher never reported',async()=>{
  const dir=root(),store=new Store(dir,{watch:true});
  try{
    const note=store.save('notes',{id:'missed',title:'Missed',content:'before'});
    await store.verify();
    // Simulate a lost event: stop watching, write, then ask the safety check.
    store.watcher.close();
    fs.writeFileSync(store.file(note),encode({...note,content:'after, unreported'}));
    store.dirty.clear();
    await store.verify();
    assert.equal(store.get('notes','missed').content,'after, unreported');
  }finally{store.unwatch();}
});

test('a view of the store a transaction makes is never served from the per-type cache',()=>{
  const dir=root(),store=new Store(dir,{watch:true});
  try{
    store.save('notes',{id:'t1',title:'One',content:'a'});
    store.transaction(view=>{view.commit([store.prepare('notes',{id:'t2',title:'Two',content:'b'})]);assert.deepEqual(view.list('notes').map(n=>n.id).sort(),['t1','t2']);});
    assert.deepEqual(store.list('notes').map(n=>n.id).sort(),['t1','t2']);
  }finally{store.unwatch();}
});
