import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {SearchIndex,searchText} from '../core/index/search.mjs';

// Until 6 October 2026 search was one LIKE '%whole query%': a query of two
// words found only notes holding exactly that phrase.
const root=()=>fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-words-'));
function fixture(){
  const store=new Store(root());
  store.save('notes',{id:'ortho',title:'Orthopäde Termin',content:'Knie MRT am Montag bei Dr. Müller.'});
  store.save('notes',{id:'shop',title:'Groceries',content:'milk, bread and the knee brace'});
  store.save('notes',{id:'compound',title:'Arzttermin verschoben',content:'Neuer Tag folgt.'});
  store.save('notes',{id:'title-hit',title:'Montag',content:'nothing else'});
  store.save('notes',{id:'body-hit',title:'Week',content:'On Montag we start.'});
  store.save('contacts',{id:'yumei',name:'Yumei Example',aliases:['Mei'],notes:'Likes horror worlds'});
  return {store,index:new SearchIndex(store)};
}
const ids=rows=>rows.map(r=>r.id);

test('every word is looked for on its own, in any order',()=>{
  const {index}=fixture();try{
    assert.deepEqual(ids(index.search('Montag Knie')),['ortho']);
    assert.deepEqual(ids(index.search('knie montag')),['ortho']);
  }finally{index.close();}
});
test('case and accents do not matter, both ways',()=>{
  const {index}=fixture();try{
    for(const q of ['orthopade','ORTHOPÄDE','Orthopäde','muller','Müller'])assert.ok(ids(index.search(q)).includes('ortho'),q);
  }finally{index.close();}
});
test('a word may be the start of a longer one, and is found inside a compound',()=>{
  const {index}=fixture();try{
    assert.ok(ids(index.search('ortho')).includes('ortho'));
    assert.ok(ids(index.search('termin')).includes('compound'),'termin finds Arzttermin');
  }finally{index.close();}
});
test('a title match ranks above the same word in the text',()=>{
  const {index}=fixture();try{
    const found=ids(index.search('montag'));
    assert.ok(found.indexOf('title-hit')<found.indexOf('body-hit'),found.join());
  }finally{index.close();}
});
test('people are found by alias and by what is written about them, field names are not words',()=>{
  const {index}=fixture();try{
    assert.ok(ids(index.search('Mei')).includes('yumei'));
    assert.ok(ids(index.search('horror')).includes('yumei'));
    assert.equal(index.search('aliases').length,0,'a field name is not something a person wrote');
    assert.equal(index.search('owner').length,0,'nor is the bookkeeping user id');
  }finally{index.close();}
});
test('words that never appear together still find the closest notes instead of nothing',()=>{
  const {index}=fixture();try{assert.ok(index.search('knee zebra').length>=1);}finally{index.close();}
});
test('quotes, operators and punctuation in a query are just words',()=>{
  const {index}=fixture();try{for(const q of ['"','AND','knie OR','NEAR(','montag)','*','-'])assert.doesNotThrow(()=>index.search(q),q);}finally{index.close();}
});
test('earlier versions of a note are not search results',()=>{
  const {store,index}=fixture();try{
    store.save('notes',{id:'ortho',content:'Knie ist besser.'},store.get('notes','ortho')._hash);
    index.update([store.get('notes','ortho')]);
    assert.ok(index.search('Knie').every(r=>r.type!=='record_history'));
  }finally{index.close();}
});
test('an index of the earlier form is rebuilt into the new one on opening',()=>{
  const {store,index}=fixture();index.close();
  const {DatabaseSync}=globalThis.process.getBuiltinModule('node:sqlite');
  fs.rmSync(path.join(store.state,'search.sqlite'));for(const s of ['-wal','-shm'])fs.rmSync(path.join(store.state,'search.sqlite'+s),{force:true});
  const old=new DatabaseSync(path.join(store.state,'search.sqlite'));old.exec('CREATE TABLE documents (uid TEXT PRIMARY KEY, type TEXT, id TEXT, title TEXT, body TEXT)');old.close();
  const reopened=new SearchIndex(store);try{assert.deepEqual(ids(reopened.search('knie montag')),['ortho']);}finally{reopened.close();}
});
test('the searchable text of a record is its words, not its identifiers',()=>{
  const text=searchText({id:'n1',uid:'3f1c2d3e-0000-4000-8000-000000000000',type:'notes',title:'Plan',content:'Body',created_at:'2026-01-01',contact_id:'x',tags:['work']});
  assert.ok(text.includes('Plan')&&text.includes('Body')&&text.includes('work'));
  assert.ok(!text.includes('3f1c2d3e')&&!text.includes('2026-01-01')&&!text.includes('n1'));
});
