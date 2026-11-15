import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';

// A person's aliases are nicknames, and two people may share one. The store
// used the same field for the ids a record had before, so the second person
// called "Lexi" could not be saved ("Ambiguous case-insensitive identity").
const fresh=()=>new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-former-ids-')));

test('two people may share a nickname',()=>{
  const store=fresh(),query=new QueryService(store);
  query.execute({table:'contacts',operation:'insert',values:{name:'Fictional Alexandra',aliases:['Lexi']},single:true});
  const second=query.execute({table:'contacts',operation:'insert',values:{name:'Fictional Alexis',aliases:['Lexi']},single:true}).data;
  assert.equal(second.name,'Fictional Alexis');assert.deepEqual(store.problems,[]);
});
test('a merged person keeps the other\'s name as a nickname and answers to their id; no id becomes a nickname',()=>{
  const store=fresh(),target=store.save('contacts',{name:'Fictional Ana',aliases:['Annie']}),source=store.save('contacts',{name:'Ana F.',aliases:['A.F.']});
  const topic=store.save('contact_topics',{title:'Fictional topic',contact_id:source.id,references:[{type:'contacts',id:source.id,uid:source.uid,field:'contact_id'}]});
  const merged=store.structural('contacts',source.id,'merge',{target:target.id});
  assert.deepEqual(merged.aliases.sort(),['A.F.','Ana F.','Annie']);
  assert.ok(merged.former_ids.includes(source.id));
  assert.equal(store.get('contacts',source.id).merged_into,target.uid,'the old id finds a marker that names the person it went into');
  assert.equal(store.get('contact_topics',topic.id).contact_id,target.id);
  assert.deepEqual(new Store(store.root).problems,[]);
});
test('a renamed record answers to its old id',()=>{
  const store=fresh(),note=store.save('notes',{id:'plan-old',title:'Plan',content:'x',aliases:['The plan']});
  const renamed=store.structural('notes',note.id,'rename',{id:'plan-new'});
  assert.deepEqual(renamed.aliases,['The plan']);assert.deepEqual(renamed.former_ids,['plan-old']);
  assert.equal(store.get('notes','plan-old').id,'plan-new');
});

// Deleting a person removed only the person; their topics and facts stayed,
// pointing at no one (6 October 2026).
test('deleting a person removes what belongs to them and keeps the notes that mention them',async()=>{
  const store=fresh(),query=new QueryService(store),{Domains}=await import('../core/domains.mjs'),domains=new Domains(query);
  const gone=store.save('contacts',{name:'Fictional Gone'}),kept=store.save('contacts',{name:'Fictional Kept'});
  const ref=p=>[{type:'contacts',id:p.id,uid:p.uid,field:'contact_id'}];
  store.save('contact_topics',{title:'Ask about the trip',contact_id:gone.id,references:ref(gone)});
  domains.writeFact({contact_id:gone.id,label:'Favorite drink',value:'Tea'});domains.writeFact({contact_id:kept.id,label:'Favorite drink',value:'Coffee'});
  query.execute({table:'contact_relationships',operation:'insert',values:{source_type:'contact',source_id:gone.id,target_type:'contact',target_id:kept.id,label:'friend'}});
  const note=store.save('notes',{title:'Trip',content:'Fictional Gone was there.'});
  query.execute({table:'contacts',operation:'delete',filters:[['eq','id',gone.id]]});
  assert.equal(query.rows('contact_topics').length,0);assert.equal(query.rows('contact_relationships').length,0);
  assert.deepEqual(query.rows('profile_facts').map(f=>f.value),['Coffee']);
  assert.ok(store.get('notes',note.id));assert.ok(store.get('contacts',kept.id));assert.deepEqual(new Store(store.root).problems,[]);
});
