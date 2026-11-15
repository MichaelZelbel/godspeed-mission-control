import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store,atomic,copy} from '../core/records/store.mjs';
import {parse} from '../core/records/yaml.mjs';

// Reviewed on 6 October 2026: a save that failed part-way (a file another
// program held, a full disk, a folder that could not be made) stayed
// "prepared", and the next program to open the workspace replayed it over
// everything saved since, without a history copy. These are the cases.
const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-transactions-'));
const transactions=store=>{const dir=path.join(store.state,'transactions');return fs.existsSync(dir)?fs.readdirSync(dir):[];};
const setAside=store=>{const dir=path.join(store.state,'transactions-set-aside');return fs.existsSync(dir)?fs.readdirSync(dir):[];};
const body=file=>fs.readFileSync(file,'utf8').split('---\n').slice(2).join('---\n');
// A write that fails the way a locked file or a full disk does, once, for one target.
function failRename(t,match,code='EIO'){
  const rename=fs.renameSync;let failed=0;
  t.mock.method(fs,'renameSync',(from,to)=>{if(!failed&&match(String(to))){failed++;throw Object.assign(new Error(code+': the fictional disk refused'),{code});}return rename(from,to);});
  return ()=>failed;
}

test('a save that fails while the program runs is undone and never replayed over a later save',t=>{
  const root=temp(),store=new Store(root),note=store.save('notes',{title:'Diary',content:'v1'}),file=store.file(note);
  const failed=failRename(t,to=>to===file);
  assert.throws(()=>store.save('notes',{id:note.id,content:'v2 that never landed'}),/fictional disk/);
  t.mock.restoreAll();assert.equal(failed(),1);
  assert.deepEqual(transactions(store),[],'nothing is left for a later start to replay');
  assert.equal(body(file),'v1');
  store.save('notes',{id:note.id,content:'v3, the newest text'});
  const restarted=new Store(root);
  assert.equal(restarted.get('notes',note.id).content,'v3, the newest text');assert.equal(body(file),'v3, the newest text');
  assert.equal(restarted.list('record_history').some(h=>h.snapshot.content==='v2 that never landed'),false);
  assert.deepEqual(restarted.problems,[]);
});

test('a move that fails after its old file was deleted puts the old file back',t=>{
  const root=temp(),store=new Store(root),note=store.save('notes',{title:'Budget',content:'the original budget note'}),old=store.file(note);
  const failed=failRename(t,to=>to.includes(path.join('Projects','Budget.md')));
  assert.throws(()=>store.save('notes',{...store.get('notes',note.id),folder_path:'Projects'}),/fictional disk/);
  t.mock.restoreAll();assert.equal(failed(),1);
  assert.equal(body(old),'the original budget note','the note is where it was, as it was');
  assert.equal(fs.existsSync(path.join(store.recordsRoot,'Projects')),false,'no folder made for it is left behind');
  assert.equal(new Store(root).get('notes',note.id).content,'the original budget note');
});

test('a temporary file is never left beside a page whose write failed',t=>{
  const root=temp(),file=path.join(root,'notebook','Diary.md');atomic(file,'one');
  failRename(t,to=>to===file);
  assert.throws(()=>atomic(file,'two'),/fictional disk/);t.mock.restoreAll();
  assert.deepEqual(fs.readdirSync(path.dirname(file)),['Diary.md']);assert.equal(fs.readFileSync(file,'utf8'),'one');
});

test('a prepared save whose files changed since is set aside, kept and reported, and the workspace still opens',()=>{
  const root=temp(),store=new Store(root),note=store.save('notes',{title:'Plan',content:'v1'});
  // failAfter stands for the program dying half-way: nothing is undone.
  store.failAfter=1;
  const person=store.prepare('contacts',{name:'Alex'});
  assert.throws(()=>store.withLock(()=>store.commit([person,store.prepare('notes',{content:'v2'},store.get('notes',note.id))])),/Injected crash/);
  store.failAfter=null;assert.equal(transactions(store).length,1);
  store.save('notes',{id:note.id,content:'v3, typed after the crash'});
  const reopened=new Store(root);
  assert.equal(reopened.get('notes',note.id).content,'v3, typed after the crash','the later save is not reverted');
  assert.deepEqual(transactions(reopened),[]);assert.equal(setAside(reopened).length,1,'the unfinished save is kept for review');
  const kept=path.join(reopened.state,'transactions-set-aside',setAside(reopened)[0]);
  assert.ok(fs.existsSync(path.join(kept,'manifest.json'))&&fs.existsSync(path.join(kept,'set-aside.json')));
  assert.equal(reopened.problems.filter(p=>p.set_aside).length,1,'and reported');
  assert.equal(new Store(root).problems.filter(p=>p.set_aside).length,1,'until someone has looked at it');
  fs.writeFileSync(path.join(kept,'reviewed'),'');assert.equal(new Store(root).problems.filter(p=>p.set_aside).length,0);
});

test('a prepared save is still replayed when its files are as it found them or as it leaves them',()=>{
  const root=temp(),store=new Store(root),note=store.save('notes',{title:'Plan',content:'v1'});
  store.failAfter=1;
  assert.throws(()=>store.withLock(()=>store.commit([store.prepare('contacts',{name:'Alex'}),store.prepare('notes',{content:'v2'},store.get('notes',note.id))])),/Injected crash/);
  const reopened=new Store(root);
  assert.equal(reopened.get('notes',note.id).content,'v2');assert.equal(reopened.list('contacts').length,1);
  assert.deepEqual(setAside(reopened),[]);assert.deepEqual(reopened.problems,[]);
});

test('prepared saves are replayed in the order they were prepared, not in the order the folder lists them',()=>{
  const root=temp(),store=new Store(root),note=store.save('notes',{title:'Plan',content:'v1'}),dirs=[];
  for(const content of ['v2, prepared first','v3, prepared second']){
    store.failAfter=1;
    assert.throws(()=>store.withLock(()=>store.commit([store.prepare('contacts',{name:'Person for '+content}),store.prepare('notes',{content},store.get('notes',note.id))])),/Injected crash/);
    dirs.push(transactions(store).find(name=>!dirs.includes(name)));
  }
  // Names that list the second one first.
  const folder=path.join(store.state,'transactions');
  fs.renameSync(path.join(folder,dirs[0]),path.join(folder,'ffffffff-ffff-4fff-bfff-ffffffffffff'));
  fs.renameSync(path.join(folder,dirs[1]),path.join(folder,'00000000-0000-4000-8000-000000000001'));
  const reopened=new Store(root);
  assert.equal(reopened.get('notes',note.id).content,'v2, prepared first','the earlier one is replayed, and the later one, prepared over v1, is then stale');
  assert.equal(setAside(reopened).length,1);
});

test('a target that cannot be written is refused before anything is prepared',()=>{
  const root=temp(),store=new Store(root);
  // An owner's own file, without an extension, where a folder would have to go.
  fs.writeFileSync(path.join(store.recordsRoot,'Projects'),'my plain-text list of projects');
  const note=store.save('notes',{title:'Budget',content:'the original budget note'}),old=store.file(note);
  assert.throws(()=>store.save('notes',{...store.get('notes',note.id),folder_path:'Projects'}),/Invalid transaction target/);
  assert.deepEqual(transactions(store),[]);assert.equal(body(old),'the original budget note');
  const again=store.save('notes',{title:'Budget',content:'a second budget note'});
  const reopened=new Store(root);
  assert.equal(reopened.get('notes',note.id).content,'the original budget note');assert.equal(reopened.get('notes',again.id).content,'a second budget note');
  assert.equal(fs.readFileSync(path.join(store.recordsRoot,'Projects'),'utf8'),'my plain-text list of projects');
});

test('a prepared transaction an older version left with a target it may not write is set aside instead of stopping every start',()=>{
  const root=temp(),store=new Store(root),dir=path.join(store.state,'transactions','3a627637-2f40-4c08-945e-bf14d9ea9d49');
  fs.mkdirSync(dir,{recursive:true});atomic(path.join(dir,'0.after'),'---\nid: x\n---\n');
  atomic(path.join(dir,'manifest.json'),JSON.stringify([{file:'notebook/Collections/Secrets/Grandma soup.md',staged:'0.after',hash:'0'.repeat(64)}]));atomic(path.join(dir,'prepared'),'3a627637-2f40-4c08-945e-bf14d9ea9d49');
  const reopened=new Store(root);
  assert.deepEqual(transactions(reopened),[]);assert.equal(setAside(reopened).length,1);assert.equal(reopened.problems.filter(p=>p.set_aside).length,1);
  reopened.save('notes',{title:'Still saves'});
});

test('a collection called Secrets or node_modules keeps its items, and the workspace keeps opening',()=>{
  const root=temp(),store=new Store(root),secrets=store.save('collections',{name:'Secrets',description:'Family recipes'});
  const item=store.save('collection_items',{title:'Grandma soup',collection_id:secrets.id,data:{notes:'x'},references:[{type:'collections',id:secrets.id,uid:secrets.uid}]});
  assert.match(path.relative(store.recordsRoot,store.file(item)),/^Collections[\\/]Secrets_[\\/]Grandma soup\.md$/);
  const other=store.save('collections',{name:'Passwords to change'});
  const bank=store.save('collection_items',{title:'Bank',collection_id:other.id,references:[{type:'collections',id:other.id,uid:other.uid}]});
  store.save('collections',{...store.get('collections',other.id),name:'node_modules'},store.get('collections',other.id)._hash);
  const reopened=new Store(root);
  assert.equal(reopened.get('collection_items',item.id).title,'Grandma soup');assert.match(path.relative(reopened.recordsRoot,reopened.file(bank)),/^Collections[\\/]node_modules_[\\/]Bank\.md$/);
  assert.deepEqual(reopened.problems,[]);assert.deepEqual(transactions(reopened),[]);
});

test('a broken reference already in the notebook no longer refuses every other save, but a new one is still refused',()=>{
  const root=temp(),store=new Store(root),note=store.save('notes',{title:'Met Alex',content:'Coffee'});
  // A reference that arrived through sync, to a person this machine does not have.
  const file=store.file(note),text=fs.readFileSync(file,'utf8').replace('references: []','references:\n  - type: contacts\n    id: alex-from-the-laptop');
  fs.writeFileSync(file,text);store.scan();
  assert.equal(store.problems.length,1);
  store.save('notes',{title:'Unrelated'});
  store.save('notes',{id:note.id,content:'Coffee, and a walk'});
  assert.throws(()=>store.save('notes',{title:'Another',references:[{type:'contacts',id:'nobody-at-all'}]}),/validation failed/);
  assert.equal(new Store(root).problems.length,1,'the broken reference is still reported');
  assert.equal(store.problems.length,1,'by the store that saved too');
});

test('a __proto__ key in frontmatter is a key like any other',()=>{
  const back=parse('structured_fields:\n  __proto__:\n    isAdmin: true\n  x: 1\nflow: {__proto__: {a: 1}, b: 2}\n');
  assert.equal(Object.getPrototypeOf(back.structured_fields),Object.prototype);assert.equal(back.structured_fields.isAdmin,undefined);
  assert.deepEqual(Object.keys(back.structured_fields),['__proto__','x']);assert.deepEqual(Object.keys(back.flow),['__proto__','b']);
  const value=JSON.parse('{"a":{"__proto__":{"role":"x"},"kept":1}}'),copied=copy(value);
  assert.deepEqual(Object.keys(copied.a),['__proto__','kept']);assert.equal(Object.getPrototypeOf(copied.a),Object.prototype);
  const root=temp(),store=new Store(root),note=store.save('notes',JSON.parse('{"title":"Form","structured_fields":{"__proto__":{"role":"x"},"kept":1}}'));
  for(const view of [store,new Store(root)]){const fields=view.get('notes',note.id).structured_fields;assert.deepEqual(Object.keys(fields),['__proto__','kept']);assert.equal(fields.role,undefined);}
});

// A rename by letter case deletes plan.md and writes Plan.md, which on Windows
// and macOS are one file: what each of the two found and leaves is shared.
test('a rename by letter case that fails is undone to the old name, and one interrupted is finished',t=>{
  const root=temp(),store=new Store(root),note=store.save('notes',{title:'plan',content:'x'}),dir=store.recordsRoot;
  failRename(t,to=>path.basename(to)==='Plan.md');
  assert.throws(()=>store.save('notes',{...store.get('notes',note.id),title:'Plan'}),/fictional disk/);t.mock.restoreAll();
  assert.deepEqual(fs.readdirSync(dir).filter(n=>n.endsWith('.md')),['plan.md']);assert.equal(body(path.join(dir,'plan.md')),'x');
  assert.deepEqual(transactions(store),[]);
  // Interrupted after Plan.md was written, before its history copy.
  store.failAfter=2;
  assert.throws(()=>store.save('notes',{...store.get('notes',note.id),title:'Plan'}),/Injected crash/);store.failAfter=null;
  const reopened=new Store(root);
  assert.deepEqual(fs.readdirSync(dir).filter(n=>n.endsWith('.md')),['Plan.md']);assert.equal(reopened.get('notes',note.id).title,'Plan');
  assert.deepEqual(setAside(reopened),[]);assert.deepEqual(reopened.problems,[]);assert.equal(reopened.list('record_history').length,1);
});
