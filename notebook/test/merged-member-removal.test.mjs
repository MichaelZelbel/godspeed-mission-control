import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';

const fixture=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-merged-member-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const store=new Store(root),query=new QueryService(store);return {store,query};};
const insert=(query,table,values)=>query.execute({table,operation:'insert',values}).data[0];
const members=(query,group)=>query.rows('contact_group_memberships').filter(m=>m.group_id===group.id);
const remove=(query,id)=>query.execute({table:'contact_group_memberships',operation:'delete',filters:[['eq','id',id]]});

// A membership of a person Menerio merged into another shows as theirs, or
// not at all when they are a member already. Removing that person from the
// group removed only the membership shown, and the hidden one of the merged
// duplicate then showed in its place: the person came back (7 October 2026).
test('a person removed from a group stays removed when a merged duplicate was a member too',t=>{
  const {query}=fixture(t);
  const anna=insert(query,'contacts',{name:'Anna'}),twin=insert(query,'contacts',{name:'Anna (old)',merged_into:anna.id});
  const group=insert(query,'contact_groups',{name:'Dream 100'});
  insert(query,'contact_group_memberships',{group_id:group.id,contact_id:anna.id});
  insert(query,'contact_group_memberships',{group_id:group.id,contact_id:twin.id});
  const shown=members(query,group);
  assert.deepEqual(shown.map(m=>m.contact_id),[anna.id]);
  remove(query,shown[0].id);
  assert.deepEqual(members(query,group),[]);
});

// Two merged duplicates in one group, the person kept not a member: the
// person shows once, and once removed is gone.
test('two merged duplicates in one group show as one member and leave together',t=>{
  const {query}=fixture(t);
  const anna=insert(query,'contacts',{name:'Anna'});
  const group=insert(query,'contact_groups',{name:'Friends'});
  for(const name of ['Anna (old)','Anna B.']){const twin=insert(query,'contacts',{name,merged_into:anna.id});insert(query,'contact_group_memberships',{group_id:group.id,contact_id:twin.id});}
  const shown=members(query,group);
  assert.deepEqual(shown.map(m=>m.contact_id),[anna.id]);
  remove(query,shown[0].id);
  assert.deepEqual(members(query,group),[]);
});

// Removing someone from one group leaves their other groups alone.
test('removing a merged person from one group keeps their other groups',t=>{
  const {query}=fixture(t);
  const anna=insert(query,'contacts',{name:'Anna'}),twin=insert(query,'contacts',{name:'Anna (old)',merged_into:anna.id});
  const one=insert(query,'contact_groups',{name:'One'}),two=insert(query,'contact_groups',{name:'Two'});
  insert(query,'contact_group_memberships',{group_id:one.id,contact_id:anna.id});
  insert(query,'contact_group_memberships',{group_id:one.id,contact_id:twin.id});
  insert(query,'contact_group_memberships',{group_id:two.id,contact_id:twin.id});
  remove(query,members(query,one)[0].id);
  assert.deepEqual(members(query,one),[]);
  assert.deepEqual(members(query,two).map(m=>m.contact_id),[anna.id]);
});
