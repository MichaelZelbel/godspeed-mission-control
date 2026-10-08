import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store, atomic, encode, decode } from '../core/records/store.mjs';
import { sanitizeName } from '../core/records/layout.mjs';
import { stringify, parse } from '../core/records/yaml.mjs';
import { mergeRecords } from '../core/sync/identity.mjs';
import { SearchIndex } from '../core/index/search.mjs';
import { QueryService } from '../core/query.mjs';
import { conflictView, resolveSavedConflict } from '../core/conflicts.mjs';

const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-readable-'));
const inNotebook=(store,record)=>path.relative(store.recordsRoot,store.file(record)).split(path.sep).join('/');
const edit=(store,type,id,patch)=>{const r=store.get(type,id);return store.save(type,{...r,...patch},r._hash);};

test('file names follow Menerio and stay valid on every system',()=>{
  assert.equal(sanitizeName('Plan / Q4: "draft" <v2>?*|\\'),'Plan Q4 draft v2');
  assert.equal(sanitizeName('  many   spaces\tand\nbreaks  '),'many spaces and breaks');
  assert.equal(sanitizeName(''),'Untitled');assert.equal(sanitizeName(null),'Untitled');assert.equal(sanitizeName(' . '),'Untitled');
  assert.equal(sanitizeName('x'.repeat(250)),'x'.repeat(200));
  assert.ok(Buffer.byteLength(sanitizeName('\u{1F600}'.repeat(100)))<=200);
  assert.equal(sanitizeName('\u{1F600}'.repeat(100)),'\u{1F600}'.repeat(50),'No emoji is cut in half');
  assert.equal(sanitizeName('..secret'),'secret');assert.equal(sanitizeName('end. '),'end');
  assert.equal(sanitizeName('aux'),'aux_');assert.equal(sanitizeName('COM1.txt'),'COM1_.txt');assert.equal(sanitizeName('console'),'console');
  assert.equal(sanitizeName('U\u0308ber'),'\u00dcber');
});

test('frontmatter is plain YAML that reads back exactly, also after Obsidian rewrites it',()=>{
  const value={id:'n-1',title:'It\'s: "quoted" # not a comment',count:3,ratio:1.5,flag:false,none:null,date:'2026-10-05',number_text:'0123',yes:'yes',list:['a','b c',''],nested:{deep:[{x:1,y:'two'},[]],empty:{}},multi:'line one\nline two\n',unicode:'Gr\u00fc\u00dfe \u{1F389}'};
  const text=stringify(value);assert.deepEqual(parse(text),value);
  assert.match(text,/^title: "It's: \\"quoted\\" # not a comment"$/m);assert.match(text,/^date: 2026-10-05$/m);assert.match(text,/^number_text: "0123"$/m);
  // What Obsidian's property editor writes: block lists, single quotes, | blocks.
  assert.deepEqual(parse("title: 'It''s mine'\ntags:\n- one\n- two words\nsummary: |\n  First\n  Second\naliases: []\ncount: 7\n"),{title:"It's mine",tags:['one','two words'],summary:'First\nSecond\n',aliases:[],count:7});
});

test('a note is <folder>/<Title>.md with YAML frontmatter, and renaming or moving it moves the file',()=>{
  const store=new Store(temp()),note=store.save('notes',{title:'Plan',folder_path:'Projects',content:'Body\n',tags:['work']});
  assert.equal(inNotebook(store,note),'Projects/Plan.md');
  const text=fs.readFileSync(store.file(note),'utf8');
  assert.match(text,/^---\nid: plan-[0-9a-f]{8}\ntype: note\ntitle: Plan\ncreated: \S+\nmodified: \S+\ntags:\n  - work\n/);
  assert.match(text,/\n---\nBody\n$/);assert.doesNotMatch(text,/^\{/m);
  edit(store,'notes',note.id,{title:'Plan for October'});
  assert.equal(inNotebook(store,note),'Projects/Plan for October.md');assert.ok(!fs.existsSync(path.join(store.recordsRoot,'Projects','Plan.md')));
  edit(store,'notes',note.id,{folder_path:'Archive/2026'});
  assert.equal(inNotebook(store,note),'Archive/2026/Plan for October.md');
  assert.ok(!fs.existsSync(path.join(store.recordsRoot,'Projects')),'An emptied folder goes');
  edit(store,'notes',note.id,{title:'plan for october'});
  assert.equal(inNotebook(store,note),'Archive/2026/plan for october.md','A change of case alone renames the file');
  assert.deepEqual(fs.readdirSync(path.join(store.recordsRoot,'Archive','2026')),['plan for october.md']);
  edit(store,'notes',note.id,{is_trashed:true});assert.equal(inNotebook(store,note),'Trash/Archive/2026/plan for october.md');
  const reopened=new Store(store.root);assert.equal(reopened.get('notes',note.id).title,'plan for october');assert.deepEqual(reopened.problems,[]);
});

test('names other records already use get " 2", " 3", and a page the owner wrote keeps its name',()=>{
  const store=new Store(temp());atomic(path.join(store.recordsRoot,'Ideas','Plan.md'),'# My own plan\n');store.scan();
  const one=store.save('notes',{title:'Plan',folder_path:'Ideas'}),two=store.save('notes',{title:'plan',folder_path:'ideas'}),three=store.save('notes',{title:'Plan',folder_path:'Ideas'});
  assert.deepEqual([one,two,three].map(n=>inNotebook(store,n)),['Ideas/Plan 2.md','Ideas/plan 3.md','Ideas/Plan 4.md']);
  assert.equal(fs.readFileSync(path.join(store.recordsRoot,'Ideas','Plan.md'),'utf8'),'# My own plan\n');
  assert.deepEqual(store.problems,[]);
  edit(store,'notes',one.id,{content:'still here'});assert.equal(inNotebook(store,one),'Ideas/Plan 2.md','A numbered name that still fits stays');
});

test('people, groups, facts, moments, collections and things each have their folder; bookkeeping goes to the system folder',()=>{
  const store=new Store(temp()),person=store.save('contacts',{name:'Ada Lovelace',notes:'Mathematician'}),group=store.save('contact_groups',{name:'Book club',description:'Monthly'});
  const fact=store.save('claims',{attribute:'home_city',value:'London',valid_from:'1815-12-10'}),old=store.save('claims',{attribute:'home_city',value:'Paris',valid_from:'1800-01-01',valid_to:'1815-12-10'});
  const moment=store.save('moments',{title:'First program',happened_at:'1843-09-01T00:00:00Z',description:'Notes on the engine'});
  const books=store.save('collections',{name:'Books'}),item=store.save('collection_items',{collection_id:books.id,title:'Sketch of the engine',data:{year:1843}}),thing=store.save('entities',{name:'Royal Society'});
  const topic=store.save('contact_topics',{title:'Ask about the engine',contact_id:person.id}),review=store.save('weekly_reviews',{week_start:'2026-09-28',week_end:'2026-10-04',review_data:{themes:[]}});
  const settings=store.save('settings',{id:'installation',owner:'local'}),message=store.save('conversation_messages',{role:'user',content:'hi'});
  assert.deepEqual([person,group,fact,old,moment,books,item,thing,topic,review,settings,message].map(r=>inNotebook(store,r)),[
    'People/Ada Lovelace.md','Groups/Book club.md','Facts/home city - London.md','Facts/Earlier/home city - Paris.md','Timeline/1843-09-01 First program.md',
    'Collections/Books.md','Collections/Books/Sketch of the engine.md','World/Royal Society.md','Topics/Ask about the engine.md','Reviews/Week of 2026-09-28.md','_system/settings/installation.json','_system/conversation_messages/'+message.id+'.json']);
  assert.match(fs.readFileSync(store.file(person),'utf8'),/^---\nid: ada-lovelace-[0-9a-f]{8}\ntype: person\nname: Ada Lovelace\n[\s\S]*\n---\nMathematician$/);
  // Renamed, removed or merged, a person's file follows.
  store.structural('contacts',person.id,'display-name',{name:'Augusta Ada King'});assert.equal(inNotebook(store,person),'People/Augusta Ada King.md');
  const twin=store.save('contacts',{name:'Ada (duplicate)'});store.structural('contacts',twin.id,'merge',{target:person.id});
  assert.equal(inNotebook(store,twin),'_system/contacts/'+twin.id+'.md','A merged-away person leaves People/');
  store.structural('contacts',person.id,'rename',{id:'ada-king'});assert.equal(inNotebook(store,store.get('contacts','ada-king')),'People/Augusta Ada King.md','A new id keeps the file');
  store.structural('collections',books.id,'display-name',{name:'Reading list'});assert.equal(inNotebook(store,item),'Collections/Reading list/Sketch of the engine.md','Items follow their collection');
  store.structural('entities',thing.id,'remove');assert.equal(inNotebook(store,thing),'_system/entities/'+thing.id+'.md');
  assert.deepEqual(new Store(store.root).problems,[]);
});

test('a file moved or edited by hand is found by its id, and a save puts it back under its title',()=>{
  const store=new Store(temp()),note=store.save('notes',{title:'Moved by hand',content:'Text'}),moved=path.join(store.recordsRoot,'Somewhere','Else.md');
  fs.mkdirSync(path.dirname(moved));fs.renameSync(store.file(note),moved);store.scan();
  assert.equal(store.get('notes',note.id).content,'Text');assert.equal(store.file(note),moved);
  // Obsidian rewrites the frontmatter its own way when a property is edited.
  const text=fs.readFileSync(moved,'utf8').replace('title: Moved by hand',"title: 'Edited in Obsidian'").replace('tags: []','tags:\n- obsidian');atomic(moved,text);store.scan();
  assert.equal(store.get('notes',note.id).title,'Edited in Obsidian');assert.deepEqual(store.get('notes',note.id).tags,['obsidian']);
  edit(store,'notes',note.id,{content:'Saved again'});
  assert.equal(inNotebook(store,note),'Edited in Obsidian.md');assert.ok(!fs.existsSync(path.join(store.recordsRoot,'Somewhere')));
});

test('a note body edited in the file is the note, and the search finds it',()=>{
  const store=new Store(temp()),note=store.save('notes',{title:'Searchable',folder_path:'Deep/er',content:'before'});
  const file=store.file(note);atomic(file,fs.readFileSync(file,'utf8').replace(/before$/,'after the edit'));
  const index=new SearchIndex(store);try{assert.equal(index.search('after the edit').length,1);}finally{index.close();}
  assert.equal(new QueryService(new Store(store.root)).rows('notes')[0].content,'after the edit');
});

test('a saved conflict about a record follows it after a rename',()=>{
  const store=new Store(temp()),note=store.save('notes',{title:'Before',content:'Current'}),file=path.relative(store.root,store.file(note)).split(path.sep).join('/');
  const remote=encode({...store.get('notes',note.id),content:'Remote text'});
  atomic(path.join(store.root,'conflicts','c1.json'),JSON.stringify({id:'c1',kind:'git',path:file,local:fs.readFileSync(store.file(note),'utf8'),remote,base:null}));
  edit(store,'notes',note.id,{title:'After'});
  const view=conflictView(store,'c1');assert.match(view.current,/title: After/);
  resolveSavedConflict(store,{id:'c1',choice:'remote',expected_hash:view.current_hash});
  assert.equal(store.get('notes',note.id).content,'Remote text');assert.equal(store.list('notes').length,1);
});

test('two machines\' versions of one record merge field by field',()=>{
  const base={id:'n',type:'notes',title:'A',content:'one\ntwo\nthree\n',tags:[],revision:2,updated_at:'2026-01-01T00:00:00Z',device:'x'};
  const merged=mergeRecords(base,{...base,title:'B',revision:3,updated_at:'2026-01-02T00:00:00Z',device:'laptop'},{...base,content:'one\ntwo\nthree\nfour\n',revision:3,updated_at:'2026-01-03T00:00:00Z',device:'server'},(b,l,r)=>l===b?r:r===b?l:null);
  assert.deepEqual(merged.record,{id:'n',type:'notes',title:'B',content:'one\ntwo\nthree\nfour\n',tags:[],revision:3,updated_at:'2026-01-03T00:00:00Z',device:'laptop'});
  assert.deepEqual(mergeRecords(base,{...base,title:'B'},{...base,title:'C'},()=>null).conflicts,['title']);
});

test('decode reads the old layout and refuses text a record has no place for',()=>{
  const old='---\n'+JSON.stringify({format:1,type:'notes',id:'old-note',uid:'5b4b8f61-2c7b-4a5b-9e57-6f0e7d2b1a10',title:'Old'},null,2)+'\n---\nOld body';
  assert.equal(decode(old,'notebook/notes/old-note.md').content,'Old body');
  const fact=encode({format:1,type:'claims',id:'f',uid:'u',attribute:'city',value:'Berlin'});
  assert.throws(()=>decode(fact+'Some text','x.md'),/no place/);
  assert.throws(()=>decode('# Just a page','x.md'),error=>error.code==='NOT_RECORD','A page without a record is not an error');
});
