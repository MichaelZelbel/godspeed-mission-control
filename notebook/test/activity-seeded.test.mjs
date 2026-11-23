import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {seed} from '../core/seeds.mjs';
import {formatAction} from '../ui/src/lib/activity-text.mjs';
const setup=()=>{const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-activity-'))),query=new QueryService(store);return {store,query};};
const insert=(query,values)=>query.execute({table:'profile_categories',operation:'insert',values});
const defaults=['Basics','Work','Family'].map((name,i)=>({name,slug:name.toLowerCase(),is_default:true,sort_order:i}));
test("a fresh notebook's seeded records write no activity",()=>{
  const {store,query}=setup();seed(store);insert(query,defaults);
  assert.deepEqual(query.rows('activity_events'),[]);
  assert.deepEqual(new QueryService(new Store(store.root)).rows('activity_events'),[]);
});
test('a category the person adds is logged and named',()=>{
  const {query}=setup();
  for(const extra of [{is_default:false},{}]){
    const name='Hobbies'+JSON.stringify(extra).length;insert(query,{name,slug:name.toLowerCase(),...extra});
    const rows=query.rows('activity_events').filter(r=>r.item_name===name);
    assert.equal(rows.length,1);assert.equal(rows[0].action,'create');assert.equal(rows[0].item_type,'profile category');
    assert.equal(formatAction(rows[0].action,rows[0].item_type,rows[0].metadata,rows[0].item_name),`Created a profile category: ${name}`);
  }
});
test('editing a seeded category is the persons action',()=>{
  const {query}=setup(),[seeded]=insert(query,defaults).data;
  query.execute({table:'profile_categories',operation:'update',values:{name:'Renamed'},filters:[['eq','id',seeded.id]]});
  const rows=query.rows('activity_events');
  assert.deepEqual(rows.map(r=>r.action),['update']);assert.equal(rows[0].item_name,'Renamed');
});
