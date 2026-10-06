import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';
import {NoteProcessing,jobFor} from '../core/processing.mjs';
import {shapeProposal} from '../core/proposals.mjs';

// Until 6 October 2026 a captured note was processed only from its own menu;
// the screens' sweep call failed silently. Menerio processed every new note.
const setup=({device='vps',owner='vps'}={})=>{
  const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-processing-')),{device}),query=new QueryService(store),domains=new Domains(query);
  store.save('settings',{id:'installation',owner,timezone:'Europe/Berlin'});
  const ana=store.save('contacts',{name:'Fictional Ana',aliases:['Ani']});
  let calls=0;domains.provider=async input=>{calls++;const text=input.note.text;return {
    metadata:{type:'meeting_note',topics:['climbing'],summary:'Fictional summary',people:['Fictional Ana']},tags:['climbing'],
    suggestions:[
      {type:'add_claim',title:'Ana climbs',payload:{label:'Favorite sport',value:'climbing',subject:ana.id},evidence_quote:text.slice(0,20)},
      {type:'add_moment',title:'Trip',payload:{title:'Climbing trip',happened_at:'2026-10-12',status:'scheduled',participants:['Ani']},evidence_quote:text.slice(0,20)},
      {type:'add_moment',title:'Broken',payload:{label:'Knie',value:'Montag'},evidence_quote:text.slice(0,20)},
      {type:'add_claim',title:'Invented',payload:{label:'x',value:'y'},evidence_quote:'words that are not in the note'}]};};
  return {store,query,domains,ana,calls:()=>calls};
};

test('a note is processed on its own: tags, type, people linked, proposals, and the malformed ones left out',async()=>{
  const {store,query,domains,ana}=setup(),processing=new NoteProcessing({store,query,domains,device:'vps'});
  const t0=Date.now()-1000;
  await processing.tick({now:t0});
  const note=store.save('notes',{title:'Climbing',content:'Fictional Ana and I go climbing on Monday the 12th.'});
  // Within the quiet period after an edit nothing runs.
  assert.equal((await processing.tick({now:Date.parse(note.updated_at)+30000})).processed,0);
  const done=await processing.tick({now:Date.parse(note.updated_at)+180000});
  assert.equal(done.processed,1);
  const saved=store.get('notes',note.id);
  assert.equal(saved.metadata.type,'meeting_note');assert.deepEqual(saved.tags,['climbing']);
  assert.deepEqual(saved.metadata.matched_people.map(p=>p.contact_id),[ana.id],'the person is linked by name');
  const proposals=query.rows('review_queue');
  assert.deepEqual(proposals.map(p=>p.suggestion_type).sort(),['add_claim','add_moment']);
  const moment=proposals.find(p=>p.suggestion_type==='add_moment').payload;
  assert.equal(moment.status,'future_plan');assert.equal(moment.happened_at,'2026-10-12');assert.deepEqual(moment.participants.map(p=>p.contact_id),[ana.id]);
  assert.equal(proposals.find(p=>p.suggestion_type==='add_claim').payload.subject_id,ana.id);
  assert.equal(jobFor(query,note.id).state,'completed');
});

test('what processing writes does not trigger it again; a changed text does; notes from before the start never',async()=>{
  const {store,query,domains,calls}=setup(),processing=new NoteProcessing({store,query,domains,device:'vps'});
  const old=store.save('notes',{title:'Imported',content:'Processed long ago in Menerio, fictional.',updated_at:'2026-09-01T00:00:00Z'});
  store.save('notes',{id:old.id,updated_at:'2026-09-01T00:00:00Z'});
  await processing.tick({now:Date.now()});
  const note=store.save('notes',{title:'New',content:'A fictional new note about climbing with Fictional Ana.'});
  const later=Date.now()+600000;
  await processing.tick({now:later});assert.equal(calls(),1);
  await processing.tick({now:later+600000});assert.equal(calls(),1,'its own metadata and tags are not a new text');
  store.save('notes',{id:note.id,content:'A fictional changed note about climbing with Fictional Ana.'},store.get('notes',note.id)._hash);
  await processing.tick({now:Date.now()+1200000});assert.equal(calls(),2);
  assert.equal(jobFor(query,old.id),null,'the imported note was never processed');
});

test('the owner\'s own metadata stays; the model\'s earlier answer is replaced',async()=>{
  const {store,query,domains}=setup(),processing=new NoteProcessing({store,query,domains,device:'vps'});
  await processing.tick({now:Date.now()});
  const note=store.save('notes',{title:'Plan',content:'A fictional plan with Fictional Ana to climb.',metadata:{summary:'My own words',type:'idea',ai_fields:['type']}});
  await domains.invoke('process-note',{note_id:note.id});
  const m=store.get('notes',note.id).metadata;
  assert.equal(m.summary,'My own words');assert.equal(m.type,'meeting_note');
});

test('another machine, the daily limit and a missing model all leave notes alone',async()=>{
  const a=setup({device:'local',owner:'vps'});
  assert.equal((await new NoteProcessing({store:a.store,query:a.query,domains:a.domains,device:'local'}).tick()).skipped,'another machine runs the routines');
  const b=setup(),processing=new NoteProcessing({store:b.store,query:b.query,domains:b.domains,device:'vps'});
  await processing.tick();b.store.save('settings',{id:'processing',daily_limit:1});
  b.store.save('notes',{title:'One',content:'First fictional note mentioning Fictional Ana.'});b.store.save('notes',{title:'Two',content:'Second fictional note mentioning Fictional Ana.'});
  await processing.tick({now:Date.now()+600000});const second=await processing.tick({now:Date.now()+700000});
  assert.equal(second.skipped,'daily limit reached');assert.equal(b.calls(),1);
  b.domains.provider=null;b.store.save('settings',{id:'processing',daily_limit:10});
  assert.equal((await processing.tick({now:Date.now()+800000})).skipped,'no model connected');
  assert.equal((await b.domains.invoke('sweep-note-processing',{})).waiting,1);
});

test('a timeline proposal without a title or date is left out, and an old one cannot be kept',async()=>{
  const note={id:'n1',uid:'u1'},person=()=>null,cites=()=>true;
  assert.equal(shapeProposal({type:'add_moment',payload:{label:'Knie',value:'Montag'},evidence_quote:'x'},{person,note,cites}),null);
  const {store,domains}=setup();
  const item=store.save('review_queue',{suggestion_type:'add_moment',title:'Old',payload:{label:'Knie',value:'Montag'},status:'pending_review'});
  await assert.rejects(domains.invoke('review-queue-bulk',{action:'keep',scope:{ids:[item.id]}}).then(r=>{if(r.errors?.length)throw new Error(r.errors[0].error||JSON.stringify(r.errors[0]));}),/no title or no date/);
});
