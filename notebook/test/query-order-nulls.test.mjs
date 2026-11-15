import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';

// Smaller differences from the Postgres the screens were written against:
// where empty values sort, what a comparison with an empty value answers,
// how a list in a string is read, and which record an upsert replaces.
const setup=()=>{const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-order-')));return {store,query:new QueryService(store)};};
const values=(result,key)=>result.data.map(r=>r[key]??null);

test('empty values sort last ascending and first descending, unless the caller says where',()=>{
  const {store,query}=setup();
  for(const valid_from of [null,'2026-01-01','2025-01-01'])store.save('claims',{subject_type:'self',attribute:'a',value:String(valid_from),valid_from});
  const order=settings=>values(query.execute({table:'claims',orders:[['valid_from',settings]]}),'valid_from');
  // useClaims: the newest dated fact first, undated ones after.
  assert.deepEqual(order({ascending:false,nullsFirst:false}),['2026-01-01','2025-01-01',null]);
  assert.deepEqual(order({ascending:false}),[null,'2026-01-01','2025-01-01']);
  assert.deepEqual(order({}),['2025-01-01','2026-01-01',null]);
  assert.deepEqual(order({ascending:true,nullsFirst:true}),[null,'2025-01-01','2026-01-01']);
  assert.deepEqual(order({ascending:false,nullsFirst:true}),[null,'2026-01-01','2025-01-01']);
});

test('text sorts and compares as the app\'s Postgres collation does, not by character codes',()=>{
  const {store,query}=setup();
  for(const name of ['Zebra','apple','Ärger','banana','Anna'])store.save('contacts',{name});
  assert.deepEqual(values(query.execute({table:'contacts',orders:[['name',{}]]}),'name'),['Anna','apple','Ärger','banana','Zebra']);
  assert.deepEqual(values(query.execute({table:'contacts',orders:[['name',{ascending:false}]]}),'name'),['Zebra','banana','Ärger','apple','Anna']);
  // A range of names is the same range the sort shows.
  assert.deepEqual(values(query.execute({table:'contacts',filters:[['gte','name','a'],['lt','name','b']],orders:[['name',{}]]}),'name'),['Anna','apple','Ärger']);
});

test('a comparison with an empty value is not true, so neq, not and ranges leave it out',()=>{
  const {store,query}=setup();
  for(const [id,status,position] of [['done','done',1],['open','open',2],['none',null,null]])store.save('work_items',{id,title:id,status,position});
  const ids=filters=>query.execute({table:'work_items',filters}).data.map(r=>r.id).sort();
  assert.deepEqual(ids([['neq','status','done']]),['open']);
  assert.deepEqual(ids([['not','status',['eq','done']]]),['open']);
  assert.deepEqual(ids([['lt','position',5]]),['done','open']);
  assert.deepEqual(ids([['or','','status.is.null,status.neq.done']]),['none','open']);
  assert.deepEqual(ids([['or','','not.and(status.eq.done,position.eq.1)']]),['open'],'NOT of unknown stays unknown');
  assert.deepEqual(ids([['not','status',['is',null]]]),['done','open']);
});

test('an action item saved without a status is open, so Actions still lists it',()=>{
  const {store,query}=setup();store.save('action_items',{id:'bare',content:'Call back'});store.save('action_items',{id:'gone',content:'x',status:'dismissed'});
  // Actions.tsx: .neq("status", "dismissed")
  const rows=query.execute({table:'action_items',filters:[['eq','user_id','owner'],['neq','status','dismissed']]}).data;
  assert.deepEqual(rows.map(r=>[r.id,r.status]),[['bare','open']]);
});

test('not in reads the list, not a piece of text',()=>{
  const {store,query}=setup();for(const id of ['ab','abc','a,b','c'])store.save('notes',{id:id.replace(',','-'),title:id,content:''});
  const titles=filters=>query.execute({table:'notes',filters}).data.map(r=>r.title).sort();
  // CollectionDetail.tsx: .not("id", "in", `(${linkedIds.join(",")})`)
  assert.deepEqual(titles([['not','id',['in','(abc)']]]),['a,b','ab','c']);
  assert.deepEqual(titles([['not','title',['in','("a,b",c)']]]),['ab','abc']);
  assert.deepEqual(titles([['in','id','(ab,c)']]),['ab','c']);
});

test('an upsert keyed on user_id finds the record whether or not the caller sent user_id',()=>{
  const {query}=setup();
  const upsert=(values,options)=>query.execute({table:'ai_suggestion_suppressions',operation:'upsert',values,options});
  // suppressFactValue sends no user_id; ReviewQueue's createSuppression sends the owner's.
  upsert({suggestion_type:'claim',normalized_value:'tea',suppression_key:'claim:self:drink:tea'},{onConflict:'user_id,suppression_key'});
  upsert({suggestion_type:'claim',normalized_value:'tea!',suppression_key:'claim:self:drink:tea'},{onConflict:'user_id,suppression_key'});
  upsert({user_id:'owner',suggestion_type:'claim',normalized_value:'tea!!',suppression_key:'claim:self:drink:tea'},{onConflict:'user_id,suppression_key'});
  upsert({suggestion_type:'claim',normalized_value:'coffee',suppression_key:'claim:self:drink:coffee'},{onConflict:'user_id,suppression_key'});
  const rows=query.execute({table:'ai_suggestion_suppressions',orders:[['suppression_key',{}]]}).data;
  assert.deepEqual(rows.map(r=>[r.suppression_key,r.normalized_value]),[['claim:self:drink:coffee','coffee'],['claim:self:drink:tea','tea!!']]);
  // An empty key value never matches another one, as NULLs in a unique key do not.
  upsert({normalized_value:'a'},{onConflict:'user_id,suppression_key'});upsert({normalized_value:'b'},{onConflict:'user_id,suppression_key'});
  assert.equal(query.execute({table:'ai_suggestion_suppressions'}).data.length,4);
});

test('an upsert that ignores duplicates leaves an existing record as it was',()=>{
  const {store,query}=setup();const a=store.save('notes',{title:'A',content:''}),b=store.save('notes',{title:'B',content:''});
  const link={source_note_id:a.id,target_note_id:b.id,connection_type:'manual_link',strength:1,metadata:{}},onConflict='source_note_id,target_note_id,connection_type';
  query.execute({table:'note_connections',operation:'upsert',values:[{...link,metadata:{auto_linked:true}}],options:{onConflict}});
  // NoteEditor's manual links: { onConflict, ignoreDuplicates: true }
  const result=query.execute({table:'note_connections',operation:'upsert',values:[link],options:{onConflict,ignoreDuplicates:true}});
  assert.deepEqual(result.data,[]);
  const rows=query.execute({table:'note_connections'}).data;
  assert.equal(rows.length,1);assert.deepEqual(rows[0].metadata,{auto_linked:true});
});
