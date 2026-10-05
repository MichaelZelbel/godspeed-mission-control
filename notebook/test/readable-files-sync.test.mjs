import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Store, atomic } from '../core/records/store.mjs';
import { FileSync } from '../core/sync/git.mjs';
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
const read=(...parts)=>fs.readFileSync(path.join(...parts),'utf8');
const exists=(...parts)=>fs.existsSync(path.join(...parts));
const notebookFiles=root=>{const out=[],walk=(dir,rel)=>{if(!fs.existsSync(dir))return;for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(e.name.startsWith('.'))continue;const r=rel?rel+'/'+e.name:e.name;if(e.isDirectory())walk(path.join(dir,e.name),r);else out.push(r);}};walk(path.join(root,'notebook'),'');return out.filter(f=>!f.startsWith('_system/')).sort();};
const edit=(store,type,id,patch)=>{const r=store.get(type,id);return store.save(type,{...r,...patch},r._hash);};

// Two machines and one private repository, in both ways the notebook syncs:
// through the mission control's own repository (folder) and through a
// knowledge repository of its own (knowledge).
function machines(mode){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-readable-sync-')),origin=path.join(root,'origin.git');
  fs.mkdirSync(origin);git(origin,'init','--bare','--initial-branch=main');
  const identity=dir=>{git(dir,'config','user.name','Owner');git(dir,'config','user.email','owner@localhost');};
  if(mode==='folder'){
    const seed=path.join(root,'seed');git(root,'clone',origin,seed);identity(seed);
    atomic(path.join(seed,'.gitignore'),'/.godspeed/\n/conflicts/\n/FULL-ALPHA.md\n/assistant-state/\n');atomic(path.join(seed,'AGENTS.md'),'Owner manual\n');
    git(seed,'add','-A');git(seed,'commit','-m','Owner mission control');git(seed,'push','origin','main');
  }
  const machine=name=>{
    const dir=path.join(root,name);git(root,'clone','-c','core.autocrlf=false',origin,dir);identity(dir);
    const store=new Store(dir,{device:name});
    if(mode==='folder')atomic(path.join(store.state,'sync-config.json'),JSON.stringify({enabled:true,repository:'folder',paths:['notebook']}));
    const sync=new FileSync(store);if(mode==='knowledge')sync.initialize('https://github.com/synthetic/private.git');
    return {dir,store,sync};
  };
  // A second machine joins a repository the first one already started.
  const a=machine('laptop');if(mode==='knowledge')assert.equal(a.sync.reconcile().state,'synced');
  return {a,b:machine('server')};
}
const round=(...list)=>{for(const m of list)assert.equal(m.sync.reconcile().state,'synced',JSON.stringify(m.sync.last));};

for(const mode of ['folder','knowledge']){
  test(mode+': a renamed note arrives renamed, as the same note, with no copy left behind',()=>{
    const {a,b}=machines(mode),note=a.store.save('notes',{title:'Groceries',folder_path:'Home',content:'Milk\n'});
    round(a,b);assert.equal(read(b.dir,'notebook','Home','Groceries.md'),read(a.dir,'notebook','Home','Groceries.md'));
    edit(a.store,'notes',note.id,{title:'Einkaufsliste f\u00fcr Gr\u00fc\u00dfe \u{1F389}',folder_path:'Home/Weekly'});
    round(a,b);
    assert.deepEqual(notebookFiles(b.dir),['Home/Weekly/Einkaufsliste f\u00fcr Gr\u00fc\u00dfe \u{1F389}.md']);
    assert.equal(b.store.get('notes',note.id).title,'Einkaufsliste f\u00fcr Gr\u00fc\u00dfe \u{1F389}');assert.equal(b.store.list('notes').length,1);
    assert.deepEqual(notebookFiles(a.dir),notebookFiles(b.dir));
    round(b,a);assert.deepEqual(notebookFiles(a.dir),['Home/Weekly/Einkaufsliste f\u00fcr Gr\u00fc\u00dfe \u{1F389}.md'],'Nothing comes back');
  });

  test(mode+': a rename on one machine and an edit on the other end as one note with both changes',()=>{
    const {a,b}=machines(mode),note=a.store.save('notes',{title:'Plan',content:'First line\n\nSecond line\n'});
    round(a,b);
    edit(a.store,'notes',note.id,{title:'Plan for October'});
    edit(b.store,'notes',note.id,{content:'First line\n\nSecond line, edited on the server\n'});
    round(a,b,a);
    for(const m of [a,b]){
      assert.deepEqual(notebookFiles(m.dir),['Plan for October.md'],m.dir);
      const merged=m.store.get('notes',note.id);
      assert.equal(merged.title,'Plan for October');assert.equal(merged.content,'First line\n\nSecond line, edited on the server\n');
      assert.deepEqual(m.sync.pendingConflicts(),[]);assert.equal(m.store.problems.length,0);
    }
  });

  test(mode+': a note moved to another folder while edited elsewhere keeps the edit in its new folder',()=>{
    const {a,b}=machines(mode),note=a.store.save('notes',{title:'Ideas',folder_path:'Inbox',content:'one\n'});
    round(a,b);
    edit(b.store,'notes',note.id,{folder_path:'Projects/2026'});
    edit(a.store,'notes',note.id,{tags:['later']});
    round(a,b,a);
    for(const m of [a,b]){
      assert.deepEqual(notebookFiles(m.dir),['Projects/2026/Ideas.md']);
      assert.deepEqual(m.store.get('notes',note.id).tags,['later']);
    }
  });

  test(mode+': two different renames of one note end as one note and one review item',()=>{
    const {a,b}=machines(mode),note=a.store.save('notes',{title:'Draft',content:'Text\n'});
    round(a,b);
    edit(a.store,'notes',note.id,{title:'Draft from the laptop'});edit(b.store,'notes',note.id,{title:'Draft from the server'});
    assert.equal(b.sync.reconcile().state,'synced');
    const settled=a.sync.reconcile();
    const reviews=a.sync.pendingConflicts();assert.equal(reviews.length,1,'One review item');
    const review=JSON.parse(read(a.dir,'conflicts',reviews[0]));
    assert.match(review.local,/Draft from the laptop/);assert.match(review.remote,/Draft from the server/);
    assert.deepEqual(notebookFiles(a.dir),['Draft from the laptop.md'],'This machine keeps its version, once');
    assert.equal(a.store.list('notes').length,1);
    a.sync.resolve(reviews[0].replace(/\.json$/,''),'remote');
    round(a,b);
    for(const m of [a,b]){assert.deepEqual(notebookFiles(m.dir),['Draft from the server.md']);assert.equal(m.store.get('notes',note.id).title,'Draft from the server');}
    if(mode==='folder')assert.equal(settled.state,'synced','In the folder mode a review does not hold sync back');
  });

  test(mode+': the same title created on two machines offline stays two notes, " 2" for the one that arrived',()=>{
    const {a,b}=machines(mode);round(a,b);
    const mine=a.store.save('notes',{title:'Meeting notes',content:'Laptop meeting\n'}),theirs=b.store.save('notes',{title:'Meeting notes',content:'Server meeting\n'});
    round(b,a,b);
    for(const m of [a,b]){
      assert.deepEqual(notebookFiles(m.dir),['Meeting notes 2.md','Meeting notes.md'],m.dir);
      assert.equal(m.store.get('notes',mine.id).content,'Laptop meeting\n');assert.equal(m.store.get('notes',theirs.id).content,'Server meeting\n');
      assert.equal(m.store.list('notes').length,2);assert.deepEqual(m.sync.pendingConflicts(),[]);
    }
    assert.match(read(a.dir,'notebook','Meeting notes.md'),/Laptop meeting/,'The machine that merged keeps its own note under the plain name');
  });

  test(mode+': a renamed person, edited elsewhere, and a new person under the old name are both kept',()=>{
    const {a,b}=machines(mode),person=a.store.save('contacts',{name:'Alex Example',notes:'Met at the fair\n'});
    round(a,b);
    a.store.structural('contacts',person.id,'display-name',{name:'Alexandra Example'});
    const other=a.store.save('contacts',{name:'Alex Example',email:'alex@example.com'});
    edit(b.store,'contacts',person.id,{notes:'Met at the fair\nLikes tea\n'});
    round(b,a,b);
    for(const m of [a,b]){
      assert.equal(m.store.get('contacts',person.id).name,'Alexandra Example');assert.equal(m.store.get('contacts',person.id).notes,'Met at the fair\nLikes tea\n');
      assert.equal(m.store.get('contacts',other.id).email,'alex@example.com');
      assert.deepEqual(notebookFiles(m.dir),['People/Alex Example.md','People/Alexandra Example.md'],m.dir);
      assert.match(read(m.dir,'notebook','People','Alex Example.md'),/alex@example\.com/);
    }
  });
}

test('folder: renaming a collection moves its items, on both machines',()=>{
  const {a,b}=machines('folder'),books=a.store.save('collections',{name:'Books'}),item=a.store.save('collection_items',{collection_id:books.id,title:'Dune',data:{author:'Frank Herbert'}});
  round(a,b);assert.ok(exists(b.dir,'notebook','Collections','Books','Dune.md'));
  a.store.structural('collections',books.id,'display-name',{name:'Novels'});
  edit(b.store,'collection_items',item.id,{data:{author:'Frank Herbert',year:1965}});
  round(a,b,a);
  for(const m of [a,b]){
    assert.deepEqual(notebookFiles(m.dir),['Collections/Novels.md','Collections/Novels/Dune.md']);
    assert.deepEqual(m.store.get('collection_items',item.id).data,{author:'Frank Herbert',year:1965});
  }
});

test('folder: a whole notebook renamed at once is not mistaken for a mass removal',()=>{
  const {a,b}=machines('folder'),notes=Array.from({length:40},(_,i)=>a.store.save('notes',{title:'Note '+i,content:'Text '+i+'\n'}));
  round(a,b);
  a.store.withLock(()=>a.store.commit(notes.map(n=>({...a.store.get('notes',n.id),folder_path:'Archive'})).map(r=>{delete r._hash;return r;})));
  round(a,b);
  assert.equal(notebookFiles(b.dir).filter(f=>f.startsWith('Archive/')).length,40);
  const gone=Array.from({length:40},(_,i)=>i);for(const i of gone)fs.unlinkSync(a.store.file(a.store.get('notes',notes[i].id)));
  assert.equal(a.sync.reconcile().state,'synced');
  assert.notEqual(b.sync.reconcile().state,'synced','Removing them all is still stopped for review');
  assert.equal(notebookFiles(b.dir).length,40);
});

test('knowledge: a page written in Obsidian inside the notebook travels as a file and is never taken for a record',()=>{
  const {a,b}=machines('knowledge');round(a,b);
  atomic(path.join(a.dir,'notebook','Ideas','Written in Obsidian.md'),'# Just a page\n\nNo frontmatter.\n');
  a.store.save('notes',{title:'Written in Obsidian',folder_path:'Ideas',content:'A record with the same title\n'});
  round(a,b);
  assert.equal(read(b.dir,'notebook','Ideas','Written in Obsidian.md'),'# Just a page\n\nNo frontmatter.\n');
  assert.match(read(b.dir,'notebook','Ideas','Written in Obsidian 2.md'),/A record with the same title/);
  assert.equal(b.store.problems.length,0);
});
