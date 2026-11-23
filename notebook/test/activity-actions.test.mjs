import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';
import {activityRows,SAVE_GAP_MS} from '../core/activity.mjs';
import {formatAction} from '../ui/src/lib/activity-text.mjs';

const T0=Date.parse('2026-11-01T10:00:00Z'),at=s=>new Date(T0+s*1000).toISOString();
// Versions of one record as the store keeps them: one per write.
const versions=(type,uid,id,writes)=>{let state={type,uid,id};return writes.map(([s,patch],i)=>(state={...state,...patch,revision:i+1,updated_at:at(s)}));};
const rows=(recs,extra={})=>activityRows({records:recs.flat(),history:[],corrections:[],find:()=>null,...extra});
const lines=r=>r.map(x=>formatAction(x.action,x.item_type,x.metadata,x.item_name));

test('adding a person writes one named entry, however often the page is opened',()=>{
  const r=rows([versions('contacts','u1','p1',[[0,{name:'Anna Lindqvist'}],[0.3,{last_viewed_at:at(0.3)}],[400,{last_viewed_at:at(400)}]])]);
  assert.deepEqual(lines(r),['Created a person: Anna Lindqvist']);
});
test('a new note is one entry named by its typed title',()=>{
  const r=rows([versions('notes','u1','n1',[[0,{title:'',content:''}],[2,{title:'Weekend plans'}],[3,{content:'Hike'}]])]);
  assert.deepEqual(lines(r),['Created a note: Weekend plans']);
  assert.deepEqual(lines(rows([versions('notes','u2','n2',[[0,{title:'',content:''}]])])),['Created a note: Untitled']);
  const later=rows([versions('notes','u1','n1',[[0,{title:'A'}],[1,{content:'x'}],[600,{content:'y'}],[601,{content:'z'}]])]);
  assert.deepEqual(lines(later),['Created a note: A','Updated a note: A']);
});
test('one save of several fields and a rename are one entry naming the new name',()=>{
  const r=rows([versions('contacts','u1','p1',[[0,{name:'Anna Lindqvist'}],[600,{name:'Anna Berg',notes:'Moved',references:[{uid:'z'}]}],[601,{last_viewed_at:at(601)}]])]);
  assert.deepEqual(lines(r),['Created a person: Anna Lindqvist','Updated a person: Anna Berg (was Anna Lindqvist)']);
});
test('trash and restore are one entry each, and an edit after a restore is its own',()=>{
  const r=rows([versions('notes','u1','n1',[[0,{title:'X'}],[600,{is_trashed:true,trashed_at:at(600)}],[1200,{is_trashed:false,trashed_at:null}],[1201,{content:'more'}]])]);
  assert.deepEqual(lines(r),['Created a note: X','Moved a note to the trash: X','Restored a note: X','Updated a note: X']);
  assert.deepEqual(r.map(x=>x.action),['create','update','update','update']);
});
test('deletes name what was removed, and a person takes their facts with them',()=>{
  const person=versions('contacts','u1','p1',[[0,{name:'Anna'}],[600,{removed_at:at(600)}]]);
  const fact=versions('claims','u2','c1',[[0,{attribute:'Hobby',value:'Chess',references:[{uid:'u1'}]}],[600.5,{removed_at:at(600.5)}]]);
  const moment=versions('moments','u3','m1',[[0,{title:'Dinner'}]]);
  const r=rows([person,fact,moment],{corrections:[{uid:'k1',moment_id:'m1',sequence:1,patch:{removed_at:at(700)},created_at:at(700)}]});
  assert.deepEqual(lines(r).sort(),['Created a fact: Hobby: Chess','Created a moment: Dinner','Created a person: Anna','Deleted a moment: Dinner','Deleted a person: Anna']);
});
test('the notebook\'s own writes are not the person\'s',()=>{
  const r=rows([
    versions('notes','u1','n1',[[0,{title:'X',content:'a'}],[600,{content:'a'}],[1200,{metadata:{summary:'s'},tags:['t'],processing_status:'processed',processed_at:at(1200)}]]),
    versions('notes','u2','n2',[[0,{title:'Brief',source_app:'morning-brief'}],[5,{content:'text'}]]),
    versions('moments','u3','m1',[[0,{title:'Dinner'}]]),
  ],{corrections:[{uid:'k1',moment_id:'m1',sequence:1,patch:{title:'Dinner'},created_at:at(700)}]});
  assert.deepEqual(lines(r),['Created a note: X','Created a moment: Dinner']);
});
test('a moment edit is named by its new title',()=>{
  const r=rows([versions('moments','u3','m1',[[0,{title:'Dinner'}]])],{corrections:[{uid:'k1',moment_id:'m1',sequence:1,patch:{title:'Lunch'},created_at:at(700)}]});
  assert.deepEqual(lines(r),['Created a moment: Dinner','Updated a moment: Lunch (was Dinner)']);
});

// Acceptance, through the store the way the screens write (so these run against any build of the log).
const NOW=Date.parse('2026-11-01T10:00:00Z'),MIN=60000;
function bench(t){
  t.mock.timers.enable({apis:['Date'],now:NOW});
  const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-activity-'))),query=new QueryService(store);
  const add=(table,values)=>query.execute({table,operation:'insert',values}).data[0];
  const edit=(table,id,values)=>query.execute({table,operation:'update',values,filters:[['eq','id',id]]}).data[0];
  const drop=(table,id)=>query.execute({table,operation:'delete',filters:[['eq','id',id]]});
  const log=(q=query)=>lines(q.rows('activity_events').sort((a,b)=>a.created_at<b.created_at?-1:a.created_at>b.created_at?1:0));
  return {store,query,add,edit,drop,log,tick:ms=>t.mock.timers.tick(ms)};
}

test('adding a person from People or the quick-add is one entry, however often the page is opened',t=>{
  const b=bench(t),p=b.add('contacts',{name:'Anna Lindqvist'});
  b.tick(300);b.edit('contacts',p.id,{last_viewed_at:new Date().toISOString()});
  b.tick(6*MIN);b.edit('contacts',p.id,{last_viewed_at:new Date().toISOString()});
  assert.deepEqual(b.log(),['Created a person: Anna Lindqvist']);
});
test('adding a person from a moment\'s People picker is one entry',t=>{
  const b=bench(t),m=b.add('moments',{title:'Dinner',happened_at:'2026-10-30T18:00:00.000Z'});
  b.tick(10*MIN);
  const before=b.log().length,ben=b.add('contacts',{name:'Ben Ortiz'});
  b.edit('moments',m.id,{title:m.title,happened_at:m.happened_at});
  b.add('moment_participants',{moment_id:m.id,contact_id:ben.id});
  assert.deepEqual(b.log().slice(before),['Created a person: Ben Ortiz']);
});
test('keeping a suggested person on Review is one entry',async t=>{
  const b=bench(t),domains=new Domains(b.query);
  const item=b.add('review_queue',{title:'Add Cara Voss',suggestion_type:'add_contact',status:'pending_review',origin:'ai',payload:{name:'Cara Voss'}});
  b.tick(MIN);
  const r=await domains.invoke('review-queue-bulk',{action:'keep',scope:{ids:[item.id]}});
  assert.equal(r.errors?.length||0,0);
  assert.deepEqual(b.log(),['Created a person: Cara Voss']);
});
test('adding a note is one entry named by what was typed',t=>{
  const b=bench(t),n=b.add('notes',{title:'',content:''});
  b.tick(3000);b.edit('notes',n.id,{title:'Weekend plans'});
  b.tick(1000);b.edit('notes',n.id,{content:'Hike'});
  assert.deepEqual(b.log(),['Created a note: Weekend plans']);
  b.add('notes',{title:'',content:''});
  assert.ok(b.log().includes('Created a note: Untitled'));
});
test('one save of several fields is one entry, and a rename right after a create is its own',t=>{
  const b=bench(t),p=b.add('contacts',{name:'Anna Lindqvist'});
  b.tick(10*MIN);b.edit('contacts',p.id,{name:'Anna Berg',notes:'Moved',aliases:['AB']});
  assert.deepEqual(b.log(),['Created a person: Anna Lindqvist','Updated a person: Anna Berg (was Anna Lindqvist)']);
  const q=b.add('contacts',{name:'Quick'});
  b.tick(30000);b.edit('contacts',q.id,{name:'Quincy'});
  assert.deepEqual(b.log().slice(2),['Created a person: Quick','Updated a person: Quincy (was Quick)']);
});
test('a note edited in one sitting is one update',t=>{
  const b=bench(t),n=b.add('notes',{title:'Plan',content:''});
  b.tick(10*MIN);
  for(const c of ['a','ab','abc','abcd']){b.edit('notes',n.id,{content:c});b.tick(1000);}
  assert.deepEqual(b.log(),['Created a note: Plan','Updated a note: Plan']);
});
test('trash, restore and delete each name their record',t=>{
  const b=bench(t),n=b.add('notes',{title:'X',content:'c'});
  b.tick(MIN);b.edit('notes',n.id,{is_trashed:true,trashed_at:new Date().toISOString()});
  b.tick(MIN);b.edit('notes',n.id,{is_trashed:false,trashed_at:null});
  assert.deepEqual(b.log(),['Created a note: X','Moved a note to the trash: X','Restored a note: X']);
  const m=b.add('moments',{title:'Dinner',happened_at:'2026-10-30T18:00:00.000Z'});
  b.tick(MIN);b.drop('moments',m.id);
  assert.ok(b.log().includes('Deleted a moment: Dinner'));
});
test('deleting a person is one entry, not one per fact and membership',t=>{
  const b=bench(t),p=b.add('contacts',{name:'Anna'}),g=b.add('contact_groups',{name:'Climbing'});
  b.add('claims',{subject_type:'contact',subject_id:p.id,contact_id:p.id,attribute:'Hobby',value:'Chess'});
  b.add('contact_group_memberships',{contact_id:p.id,group_id:g.id});
  b.tick(MIN);b.drop('contacts',p.id);
  assert.deepEqual(b.log().filter(l=>l.startsWith('Deleted')),['Deleted a person: Anna']);
});
test('nothing the notebook does by itself is the person\'s action',t=>{
  const b=bench(t),p=b.add('contacts',{name:'Anna'}),n=b.add('notes',{title:'X',content:'a'}),m=b.add('moments',{title:'Dinner',happened_at:'2026-10-30T18:00:00.000Z'});
  b.tick(10*MIN);
  const settled=b.log();
  b.edit('contacts',p.id,{name:'Anna'});
  b.edit('moments',m.id,{title:'Dinner',happened_at:m.happened_at});
  b.edit('notes',n.id,{metadata:{summary:'s'},tags:['t'],processing_status:'processed',processed_at:new Date().toISOString()});
  b.add('notes',{title:'Brief',source_app:'morning-brief'});
  assert.deepEqual(b.log(),settled);
  assert.deepEqual(b.log(new QueryService(new Store(b.store.root))),settled,'a restart changes nothing');
});

// These import the pure module, for what the screens above can't reach.
test('a conversation tab autosave on a person folds into one update',()=>{
  const r=rows([versions('contacts','u1','p1',[[0,{name:'A'}],[600,{conversation_notes:'x'}],[605,{conversation_notes:'xy'}],[700,{conversation_notes:'xyz'}]])]);
  assert.deepEqual(lines(r),['Created a person: A','Updated a person: A']);
  assert.ok(SAVE_GAP_MS<120000);
});
