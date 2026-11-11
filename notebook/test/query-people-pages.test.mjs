import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';

// The People list loads 50 names at a time and asks for the next page after
// the last name it got. The page was sorted by the language's rules but the
// next one was cut by character codes, so after "Ömer" every name from N to Z
// with a capital letter was skipped: Nina and Otto never appeared.
const setup=()=>{const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-people-pages-')));return {store,query:new QueryService(store)};};
const walk=(query,size,search='')=>{const seen=[];let next=null,pages=0;do{const page=query.rpc('search_contacts_page',{search_text:search,after_name:next?.name??null,after_id:next?.id??null,page_size:size});seen.push(...page.rows.map(r=>r.name));next=page.next;}while(next&&++pages<50);return seen;};

test('every person appears once, in name order, whatever the page size',()=>{
  const {store,query}=setup();
  const names=['zoe','Otto','anna','Ömer','Nina','marie','Bernd','Anna','émile','Zebra'];
  for(const name of names)store.save('contacts',{name});
  const ordered=walk(query,names.length);
  assert.deepEqual(ordered,['anna','Anna','Bernd','émile','marie','Nina','Ömer','Otto','Zebra','zoe']);
  for(let size=1;size<=names.length;size++)assert.deepEqual(walk(query,size),ordered,'page size '+size);
});

test('people with the same name are all listed across a page boundary, and search still narrows',()=>{
  const {store,query}=setup();
  for(let i=0;i<5;i++)store.save('contacts',{name:'Kim',aliases:i===2?['Kimmy']:[]});store.save('contacts',{name:'kai'});
  assert.equal(walk(query,2).length,6);
  assert.deepEqual(walk(query,2,'kimm'),['Kim']);
  assert.equal(new Set(query.rpc('search_contacts_page',{search_text:'kim',page_size:2}).rows.map(r=>r.id)).size,2);
});

// Issue 266: a person saved without any name before 2.0.0-beta.14 was listed and counted, since an
// empty search matched the empty text of the missing name. They stay on disk, with what links to them.
test('a person without any name is neither listed nor counted, one known only by a nickname is',()=>{
  const {store,query}=setup();
  const nameless=store.save('contacts',{notes:'met at a fair'});
  store.save('contacts',{name:'  ',aliases:[null,'']});
  store.save('contacts',{name:'Ada'});
  store.save('contacts',{aliases:['Countess']});
  const note=store.save('notes',{content:'about the person from the fair',references:[{type:'contacts',id:nameless.id,uid:nameless.uid}]});
  for(const [search,shown] of [['',['Countess','Ada']],['count',['Countess']],['ad',['Ada']]]){
    const page=query.rpc('search_contacts_page',{search_text:search,page_size:50});
    assert.deepEqual(page.rows.map(r=>r.name??r.aliases[0]),shown);
    assert.equal(page.total,shown.length);
  }
  assert.ok(store.get('contacts',nameless.id),'the nameless person is kept');
  assert.deepEqual(store.get('notes',note.id).references.map(r=>r.id),[nameless.id],'and so is the note that links to them');
});
