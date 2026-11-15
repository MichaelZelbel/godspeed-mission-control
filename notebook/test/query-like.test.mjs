import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
// The screens' own helpers, so these filters are exactly what they send.
import {escapeLike,pgOrValue,ilikeContains} from '../ui/src/lib/postgrest.ts';

// The screens were written against Postgres: LIKE's % runs across line
// breaks, a backslash makes % and _ literal, and or() values are PostgREST
// quoted. Until 6 October 2026 none of that held here.
const setup=()=>{const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-like-')));return {store,query:new QueryService(store)};};
const ids=result=>result.data.map(r=>r.id).sort();

test('the notes search finds a phrase in a note of several lines',()=>{
  const {store,query}=setup();
  store.save('notes',{id:'garden',title:'Garden plan',content:'Line one\nWe need a rain sensor\nLine three'});
  store.save('notes',{id:'single',title:'Single',content:'We need a RAIN sensor'});
  store.save('notes',{id:'other',title:'Other',content:'Rain\nsensor'});
  // useNotes fetchKeywordCandidates, the broad pass.
  const filters=[['eq','user_id','owner'],['eq','is_trashed',false],['or','',[ilikeContains('title','rain sensor'),ilikeContains('content','rain sensor')].join(',')]];
  assert.deepEqual(ids(query.execute({table:'notes',filters})),['garden','single']);
  // _ is one character, a line break too.
  assert.deepEqual(ids(query.execute({table:'notes',filters:[['ilike','content','rain_sensor']]})),['other']);
});

test('a name with _ already in People is found, so it is not added twice',()=>{
  const {store,query}=setup();
  store.save('contacts',{id:'cool',name:'Cool_Cat'});store.save('contacts',{id:'near',name:'coolXcat'});
  // AddEventDialog and ReviewQueue: .ilike("name", name.replace(/[%_\\]/g, ch => "\\" + ch))
  const lookup=name=>ids(query.execute({table:'contacts',filters:[['is','merged_into',null],['ilike','name',name.replace(/[%_\\]/g,ch=>'\\'+ch)]]}));
  assert.deepEqual(lookup('cool_cat'),['cool']);
  assert.deepEqual(lookup('Cool_Cat'),['cool']);
  assert.deepEqual(lookup('cool'),[],'the whole name has to match');
  assert.deepEqual(ids(query.execute({table:'contacts',filters:[['like','name',escapeLike('cool_cat')]]})),[],'LIKE keeps case');
});

test('deleting a folder with _ in its name takes its subfolders',()=>{
  const {store,query}=setup();
  for(const [id,folder_path] of [['top','Work_2026'],['sub','Work_2026/Sub'],['deep','Work_2026/Sub/Deeper'],['lookalike','WorkX2026/Sub'],['longer','Work_2026b']])store.save('notes',{id,title:id,content:'x',folder_path});
  // Notes.tsx, the folder delete.
  const folder='Work_2026',or=`folder_path.eq.${pgOrValue(folder)},folder_path.like.${pgOrValue(escapeLike(folder)+'/%')}`;
  assert.deepEqual(ids(query.execute({table:'notes',filters:[['eq','is_trashed',false],['or','',or]]})),['deep','sub','top']);
});

test('a wikilink finds the note whose title has _, %, quotes, commas or backslashes',()=>{
  const {store,query}=setup();
  const titles={under:'my_note',percent:'50% done',quoted:'Plan, "final" (v2)',slash:'C:\\notes\\2026'};
  for(const [id,title] of Object.entries(titles))store.save('notes',{id,title,content:''});
  for(const [id,title] of [['underX','myXnote'],['percentX','50 is done'],['slashX','C:Xnotes\\2026']])store.save('notes',{id,title,content:''});
  // NoteEditor: .or(rawTitles.map(t => `title.ilike.${pgOrValue(escapeLike(t))}`).join(","))
  const resolve=list=>ids(query.execute({table:'notes',filters:[['or','',list.map(t=>`title.ilike.${pgOrValue(escapeLike(t))}`).join(',')]]}));
  for(const [id,title] of Object.entries(titles))assert.deepEqual(resolve([title]),[id],title);
  assert.deepEqual(resolve(Object.values(titles).map(t=>t.toUpperCase())),Object.keys(titles).sort());
});

test('or() and in() values are read as PostgREST quotes them',()=>{
  const {store,query}=setup();
  store.save('notes',{id:'q',title:'a,b "c" \\ d',content:''});store.save('notes',{id:'r',title:'plain',content:''});
  assert.deepEqual(ids(query.execute({table:'notes',filters:[['or','',`title.eq.${pgOrValue('a,b "c" \\ d')},title.eq.nothing`]]})),['q']);
  assert.deepEqual(ids(query.execute({table:'notes',filters:[['or','','id.in.("q",x)']]})),['q']);
  assert.deepEqual(ids(query.execute({table:'notes',filters:[['or','','and(id.eq.r,title.eq.plain),not.or(id.eq.r,id.eq.q)']]})),['r']);
});

test('LIKE as Postgres has it: NULL never matches, a dangling escape is refused, a long text stays fast',()=>{
  const {store,query}=setup();
  store.save('notes',{id:'empty',content:''});store.save('notes',{id:'long',title:'long',content:'a'.repeat(200000)});
  assert.deepEqual(ids(query.execute({table:'notes',filters:[['ilike','title','%']]})),['long'],'a note without a title is not matched by %');
  assert.throws(()=>query.execute({table:'notes',filters:[['like','title','long\\']]}),/escape/);
  const started=Date.now();
  assert.deepEqual(ids(query.execute({table:'notes',filters:[['like','content','%a%a%a%b%']]})),[]);
  assert.ok(Date.now()-started<2000,'several % in one pattern must not backtrack through a long note');
  assert.deepEqual(ids(query.execute({table:'notes',filters:[['ilike','content','A%a_a']]})),['long']);
});
