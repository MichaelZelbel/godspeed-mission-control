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

test('World shows a person merged into another once, not twice',()=>{
  const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-world-merged-'))),query=new QueryService(store);
  const kept=store.save('contacts',{name:'Fictional Ana'});store.save('contacts',{name:'Ana (old)',merged_into:kept.uid});store.save('entities',{name:'Fictional Lake',entity_type:'place'});
  assert.deepEqual(query.rows('world_entities').map(e=>e.name).sort(),['Fictional Ana','Fictional Lake']);
});

test('a group shows a person merged into another member once',()=>{
  const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-group-merged-'))),query=new QueryService(store);
  const group=store.save('contact_groups',{name:'Fictional circle'}),kept=store.save('contacts',{name:'Fictional Ana'}),old=store.save('contacts',{name:'Ana (old)',merged_into:kept.id}),lone=store.save('contacts',{name:'Ben (old)'}),ben=store.save('contacts',{name:'Fictional Ben'});
  store.save('contacts',{id:lone.id,merged_into:ben.uid});
  for(const p of [kept,old,lone])store.save('contact_group_memberships',{group_id:group.id,contact_id:p.id,status:'active'});
  assert.deepEqual(query.rows('contact_group_memberships').map(m=>m.contact_id).sort(),[kept.id,ben.id].sort());
});
