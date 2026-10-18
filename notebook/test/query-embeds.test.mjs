import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';

// Selections embed other records, PostgREST style, and filters can name the
// embedded columns. Until 6 October 2026 such a filter was checked before the
// embedded record was there, so a person's Groups tab was always empty, and
// !inner and lists of embedded records (a group's memberships) did nothing.
const setup=()=>{
  const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-embeds-'))),query=new QueryService(store);
  const insert=(table,values)=>query.execute({table,operation:'insert',values}).data[0];
  return {store,query,insert};
};
// usePersonGroupMemberships, as the Groups tab of a person sends it.
const personGroups=(query,personId,selection='*, contact_groups:group_id!inner(*)',extra={})=>query.execute({table:'contact_group_memberships',selection,
  filters:[['eq','contact_id',personId],['eq','contact_groups.is_trashed',false],['is','archived_at',null]],orders:[['updated_at',{ascending:false}]],...extra});

test('a person\'s Groups tab shows the live groups they belong to, and not trashed, deleted or archived ones',()=>{
  const {query,insert}=setup();const person=insert('contacts',{name:'Anna'});
  const live=insert('contact_groups',{name:'Dream 100',icon:'Star'}),trashed=insert('contact_groups',{name:'Old club',is_trashed:true}),gone=insert('contact_groups',{name:'Gone'}),left=insert('contact_groups',{name:'Left'});
  for(const group of [live,trashed,gone])insert('contact_group_memberships',{group_id:group.id,contact_id:person.id});
  insert('contact_group_memberships',{group_id:left.id,contact_id:person.id,archived_at:'2026-10-01T00:00:00.000Z'});
  query.execute({table:'contact_groups',operation:'delete',filters:[['eq','id',gone.id]]});
  const rows=personGroups(query,person.id).data;
  assert.deepEqual(rows.map(r=>r.contact_groups.name),['Dream 100']);
  assert.equal(rows[0].contact_groups.icon,'Star');assert.equal(rows[0].contact_groups.type,'custom','the group\'s own type, not the record kind');assert.deepEqual(rows[0].contact_groups.stages,[]);
  // Without !inner the filter empties the embedded group instead of dropping the membership.
  const outer=personGroups(query,person.id,'*, contact_groups:group_id(*)').data;
  assert.deepEqual(outer.map(r=>r.contact_groups?.name??null).sort(),['Dream 100',null,null]);
});

test('!inner and embedded filters count and page the rows that remain',()=>{
  const {query,insert}=setup();const person=insert('contacts',{name:'Ben'});
  for(let i=0;i<5;i++){const group=insert('contact_groups',{name:'Group '+i,is_trashed:i>=3});insert('contact_group_memberships',{group_id:group.id,contact_id:person.id});}
  const page=personGroups(query,person.id,undefined,{options:{count:'exact'},range:[0,1]});
  assert.equal(page.count,3);assert.equal(page.data.length,2);assert.ok(page.data.every(r=>!r.contact_groups.is_trashed));
  // A write never widens to rows an embedded filter would have narrowed.
  assert.throws(()=>query.execute({table:'contact_group_memberships',operation:'update',values:{notes:'x'},selection:'*, contact_groups:group_id!inner(*)',filters:[['eq','contact_groups.is_trashed',true]]}),/embedded/);
});

test('a group embeds its memberships as a list, and !inner leaves out groups without any',()=>{
  const {query,insert}=setup();
  const [ana,bo]=['Ana','Bo'].map(name=>insert('contacts',{name}));
  const busy=insert('contact_groups',{name:'Busy'}),empty=insert('contact_groups',{name:'Empty'});
  const first=insert('contact_group_memberships',{group_id:busy.id,contact_id:ana.id,status:'contacted'});insert('contact_group_memberships',{group_id:busy.id,contact_id:bo.id,status:'met'});
  // Actions.tsx: the stage of the group step an action belongs to.
  const groups=selection=>query.execute({table:'contact_groups',selection,filters:[['eq','user_id','owner'],['in','id',[busy.id,empty.id]]]}).data;
  const inner=groups('id, name, slug, icon, contact_group_memberships!inner(id, status)');
  assert.deepEqual(inner.map(g=>g.name),['Busy']);
  assert.equal(inner[0].contact_group_memberships.length,2);
  assert.equal(inner[0].contact_group_memberships.find(m=>m.id===first.id).status,'contacted');
  const outer=groups('id, name, contact_group_memberships(id, status)');
  assert.deepEqual(outer.map(g=>[g.name,g.contact_group_memberships.length]).sort(),[['Busy',2],['Empty',0]]);
});

test('a foreign key named in the selection decides which record is embedded',()=>{
  const {store,query}=setup();
  const source=store.save('notes',{title:'Where it came from',content:''}),other=store.save('notes',{title:'Another note',content:''});
  store.save('review_queue',{id:'item',title:'Suggestion',note_id:other.id,source_note_id:source.id});
  // useReviewQueue: source_note:notes!review_queue_source_note_id_fkey(title)
  const row=query.execute({table:'review_queue',selection:'id, title, source_note:notes!review_queue_source_note_id_fkey(title)',filters:[['eq','id','item']],single:true}).data;
  assert.equal(row.source_note.title,'Where it came from');
  assert.equal(query.execute({table:'review_queue',selection:'id, notes:note_id(title)',single:true}).data.notes.title,'Another note');
});
