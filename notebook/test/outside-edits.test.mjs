import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';

// Reviewed on 6 October 2026: edits made outside the notebook (Obsidian, the
// assistant editing a file, another program renaming one) that the server's
// watching store had not been told about yet, and a page saved with a byte
// order mark.
const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-outside-edits-'));
const until=async(check,ms=5000)=>{const end=Date.now()+ms;for(;;){const value=check();if(value||Date.now()>end)return value;await new Promise(r=>setTimeout(r,25));}};

test('a save the server handles before it has heard of an edit in Obsidian is a conflict, not an overwrite',async()=>{
  const root=temp(),server=new Store(root,{watch:true});
  try{
    const note=server.save('notes',{title:'Shopping',content:'milk'});await new Promise(r=>setTimeout(r,200));server.scan();
    const loaded=server.get('notes',note.id),file=server.file(note);
    // Edited by hand; nothing below waits, so the watcher's event cannot have been handled.
    fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace(/milk$/,'milk, eggs, the passport form'));
    assert.throws(()=>server.save('notes',{...loaded,title:'Shopping list'},loaded._hash),{code:'CONFLICT'});
    assert.match(fs.readFileSync(file,'utf8'),/the passport form$/,'the edit is still on disk');
    assert.equal(fs.readdirSync(path.join(root,'conflicts')).length,1,'both versions are kept for review');
  }finally{server.unwatch();}
});

test('a write that does not compare first still keeps an edit it had not heard of in the history',()=>{
  const root=temp(),server=new Store(root,{watch:true});
  try{
    const note=server.save('notes',{title:'Shopping',content:'milk'}),file=server.file(note);server.scan();
    const seen=server.get('notes',note.id);
    fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace(/milk$/,'milk and the passport form'));
    server.withLock(()=>server.commit([server.prepare('notes',{content:'bread'},seen)]));
    assert.equal(server.get('notes',note.id).content,'bread');
    assert.ok(server.list('record_history').some(h=>h.snapshot.content==='milk and the passport form'),'the outside edit is in the history');
  }finally{server.unwatch();}
});

test('a transaction acting on a record edited outside since it read it is a conflict',()=>{
  const root=temp(),server=new Store(root,{watch:true});
  try{
    const note=server.save('notes',{title:'Plan',content:'one'}),file=server.file(note);server.scan();
    assert.throws(()=>server.transaction(view=>{
      const current=view.get('notes',note.id);
      fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace(/one$/,'one, edited by hand'));
      view.commit([server.prepare('notes',{content:'two'},current)]);
    }),{code:'CONFLICT'});
    assert.match(fs.readFileSync(file,'utf8'),/edited by hand$/);
  }finally{server.unwatch();}
});

test('a page renamed by letter case in another program is one record in the server, not two',async()=>{
  const root=temp(),writer=new Store(root),note=writer.save('notes',{title:'plan',content:'x'}),server=new Store(root,{watch:true});
  try{
    writer.save('notes',{...writer.get('notes',note.id),title:'Plan'},writer.get('notes',note.id)._hash);
    assert.ok(fs.readdirSync(writer.recordsRoot).includes('Plan.md'));
    await new Promise(r=>setTimeout(r,400));
    assert.equal(await until(()=>{server.scan();return [...server.entries.values()].some(e=>e.name==='Plan.md');}),true);
    assert.deepEqual(server.problems.map(p=>p.error),[]);
    assert.deepEqual([...server.entries.values()].map(e=>e.name).filter(n=>n.endsWith('.md')&&!n.includes('/')),['Plan.md']);
    // A rename it was only told about by its old name is found too.
    writer.save('notes',{...writer.get('notes',note.id),title:'PLAN'},writer.get('notes',note.id)._hash);
    server.dirty.clear();server.journalAt=server.journalPosition();server.touched('Plan.md');server.scan();
    assert.deepEqual([...server.entries.values()].map(e=>e.name).filter(n=>n.endsWith('.md')&&!n.includes('/')),['PLAN.md']);
    assert.deepEqual(server.problems,[]);
  }finally{server.unwatch();}
});

test('a page saved with a byte order mark stays a record after a restart',()=>{
  const root=temp(),store=new Store(root),person=store.save('contacts',{name:'Anna'});
  const note=store.save('notes',{title:'Met Anna',content:'Coffee',references:[{type:'contacts',id:person.id,uid:person.uid}]}),file=store.file(person);
  fs.writeFileSync(file,'﻿'+fs.readFileSync(file,'utf8'));
  const reopened=new Store(root);
  assert.equal(reopened.list('contacts').length,1);assert.deepEqual(reopened.problems,[]);assert.equal(reopened.documents.has(file),false);
  reopened.save('notes',{id:note.id,content:'Coffee again'});
});

test('a page whose frontmatter names a uid but no longer reads is reported by a fresh start, not taken for an owner page',()=>{
  const root=temp(),store=new Store(root),note=store.save('notes',{title:'Plan',content:'Body'}),file=store.file(note),text=fs.readFileSync(file,'utf8');
  for(const broken of ['\n'+text,text.replace(/\n---\n/,'\n'),' '+text]){
    fs.writeFileSync(file,broken);const reopened=new Store(root);
    assert.equal(reopened.documents.has(file),false,JSON.stringify(broken.slice(0,12)));
    assert.equal(reopened.problems.filter(p=>p.file===file).length,1);
  }
  fs.writeFileSync(file,'# My own page\n\nIt mentions uid: in passing.\n');assert.equal(new Store(root).documents.has(file),true);
  fs.writeFileSync(file,'---\ntags: [mine]\n---\nAn owner page with properties\n');assert.equal(new Store(root).documents.has(file),true);
});
