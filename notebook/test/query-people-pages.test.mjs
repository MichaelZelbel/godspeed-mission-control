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
