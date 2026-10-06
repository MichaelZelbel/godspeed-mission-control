import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {peopleCountQuery} from '../ui/src/local/home-counts.mjs';

test('the dashboard counts the people the People list shows, not people merged into others',()=>{
  const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-home-counts-'))),query=new QueryService(store);
  const kept=store.save('contacts',{name:'Ana'});store.save('contacts',{name:'Ben'});store.save('contacts',{name:'Ana (old)',merged_into:kept.uid});
  const result=query.execute(peopleCountQuery);
  assert.equal(result.count,2);assert.equal(result.data,null,'only the count travels');
  assert.equal(query.rpc('search_contacts_page',{search_text:''}).total,2);
});
