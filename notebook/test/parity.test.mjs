import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store,encode,hash} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';
import {importExport} from '../core/import.mjs';
import {backup,restore} from '../core/archives.mjs';
const fresh=()=>new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-parity-')));
test('append-only timeline corrections survive restart and preserve the original event',()=>{
  const store=fresh(),query=new QueryService(store),event=query.execute({table:'moments',operation:'insert',values:{title:'Recorded title',happened_at:'2026-09-01'},single:true}).data;
  const before=fs.readFileSync(store.file(event),'utf8');query.execute({table:'moments',operation:'update',values:{title:'Corrected title'},filters:[['eq','id',event.id]],expected:{[event.id]:event._hash}});
  assert.equal(fs.readFileSync(store.file(event),'utf8'),before);assert.equal(new QueryService(new Store(store.root)).rows('moments')[0].title,'Corrected title');
  query.execute({table:'moments',operation:'delete',filters:[['eq','id',event.id]]});assert.equal(query.rows('moments').length,0);assert.equal(store.list('event_corrections').length,2);
});
test('repeatable import retains IDs and a whole staged reference graph, refuses overwriting a later local edit',()=>{
  const store=fresh(),query=new QueryService(store),exported={format:1,records:[{type:'contacts',id:'existing-person',name:'Alex'},{type:'notes',id:'existing-note',title:'Imported note',content:'Original'},{type:'person_documents',id:'existing-link',contact_id:'existing-person',note_id:'existing-note'}]};
  assert.equal(importExport(query,exported).imported,3);assert.equal(importExport(query,exported).imported,0);assert.equal(store.problems.length,0);
  store.save('notes',{id:'existing-note',content:'Offline edit'});const changed=structuredClone(exported);changed.records[1].content='Upstream edit';assert.throws(()=>importExport(query,changed),/edited locally/);
});
test('bulk review applies only approved facts, can roll back its own effects, and rejection suppresses reinference',async()=>{
  const store=fresh(),query=new QueryService(store),domains=new Domains(query);
  const review=store.save('review_queue',{suggestion_type:'add_profile_entry',payload:{label:'Home city',value:'Example town'},status:'pending_review'});
  const response=await domains.invoke('review-queue-bulk',{action:'keep',scope:{ids:[review.id]}});assert.equal(response.succeeded,1);assert.equal(store.list('claims')[0].confidence,'confirmed');
  const rollback=await domains.invoke('review-queue-bulk',{action:'rollback',scope:{ids:[review.id]}});assert.equal(rollback.succeeded,1);assert.equal(query.rows('claims').length,0);
  const rejected=store.save('review_queue',{suggestion_type:'add_profile_entry',payload:{label:'Home city',attribute:'home_city',subject_type:'self',subject_id:null,value:'Wrong town'},status:'pending_review'});
  await domains.invoke('review-queue-bulk',{action:'block',scope:{ids:[rejected.id]}});assert.equal(domains.writeFact(rejected.payload).facts[0].outcome,'suppressed');
});
test('a note conversation edits its requested note, preserves previous contents and creates real files',async()=>{
  const store=fresh(),query=new QueryService(store),note=store.save('notes',{title:'Draft',content:'Old draft'}),domains=new Domains(query,{provider:async()=>JSON.stringify({reply:'Updated your draft.',note_content:'Revised draft',notes_created:[{title:'Follow-up',content:'A second file'}]})});
  const answer=await domains.invoke('note-chat',{note_id:note.id,base_updated_at:note.updated_at,messages:[{role:'user',content:'Revise this draft and make a follow-up note'}]});
  assert.equal(store.get('notes',note.id).content,'Revised draft');assert.equal(answer.note_edit.previous_content,'Old draft');assert.equal(store.list('notes').length,2);assert.equal(store.list('record_history')[0].snapshot.content,'Old draft');
});
test('case-folded IDs cannot overwrite Windows files, structural path changes preserve UUID references',()=>{
  const store=fresh(),person=store.save('contacts',{id:'alex',name:'Alex'});assert.throws(()=>store.save('contacts',{id:'Alex',name:'Another Alex'}),/Ambiguous/);
  const note=store.save('notes',{title:'Person link',references:[{type:'contacts',id:person.id,uid:person.uid,field:'metadata.person_id'}],metadata:{person_id:person.id}});
  const renamed=store.structural('contacts',person.id,'rename',{id:'alex-example'});assert.equal(renamed.uid,person.uid);assert.equal(store.get('contacts','alex').uid,person.uid);assert.equal(store.get('notes',note.id).metadata.person_id,'alex-example');assert.equal(store.problems.length,0);
});
test('backup integrity covers media and readable coaching files, restoration rejects corrupt bytes',()=>{
  const store=fresh(),media=path.join(store.state,'media');fs.mkdirSync(media);fs.writeFileSync(path.join(media,'example.bin'),'media');fs.mkdirSync(path.join(store.root,'coach'));fs.writeFileSync(path.join(store.root,'coach','settings.json'),'{}');store.save('notes',{content:'Saved'});
  const destination=path.join(os.tmpdir(),'godspeed-backup-'+Date.now());backup(store,media,destination);
  const target=fresh();assert.equal(restore(target,path.join(target.state,'media'),destination),1);assert.equal(fs.readFileSync(path.join(target.root,'coach','settings.json'),'utf8'),'{}');assert.equal(fs.readFileSync(path.join(target.state,'media','example.bin'),'utf8'),'media');
  fs.writeFileSync(path.join(destination,'media','example.bin'),'corrupt');const empty=fresh();assert.throws(()=>restore(empty,path.join(empty.state,'media'),destination),/integrity/);assert.equal(empty.records.size,0);
});
