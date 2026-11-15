import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {copyAccount,verifyBundle,stageAccount,ownership,safeDestination} from '../core/migration.mjs';
import {Store,hash} from '../core/records/store.mjs';
const user='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
function source(){const rows={notes:Array.from({length:1301},(_,i)=>({id:'note-'+i,user_id:user,title:'Note '+i,content:'Complete original '+i,created_at:'2020-01-01T00:00:00Z'})),contacts:[],unsupported_items:[{id:'archived',user_id:user,content:'retain me',access_token:'never copy'}]};return {project:'synthetic',user,rows,catalog:async()=>Object.keys(rows).map(name=>({name,columns:['id','user_id'],primaryKey:['id'],foreignKeys:[]})),fingerprint:async t=>({count:rows[t.name].length,digest:hash(JSON.stringify(rows[t.name]))}),page:async(t,w,offset,size)=>rows[t.name].slice(offset,offset+size),media:async()=>[{bucket:'attachments',name:user+'/file.txt',size:5,contentType:'text/plain'}],download:async()=>Buffer.from('hello')};}
test('full migration paginates past 1300, preserves originals and refuses existing targets',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-migration-')),bundle=path.join(root,'bundle'),target=path.join(root,'staged');const s=source();const manifest=await copyAccount(s,bundle);assert.equal(manifest.tables.find(t=>t.name==='notes').count,1301);assert.equal(s.rows.notes.length,1301);
  const report=stageAccount(bundle,target);assert.equal(report.notes,1301);assert.equal(report.media,1);assert.equal(report.archivedTables[0].table,'unsupported_items');const store=new Store(target);assert.equal(store.get('notes','note-1300').content,'Complete original 1300');assert.equal(store.get('notes','note-1300').created_at,'2020-01-01T00:00:00Z');assert.equal(store.problems.length,0);
  assert.ok(!fs.readFileSync(path.join(bundle,'source/unsupported_items.json'),'utf8').includes('never copy'));assert.throws(()=>stageAccount(bundle,target),/never overwritten/);await assert.rejects(copyAccount(s,bundle),/new empty/);
  fs.appendFileSync(path.join(bundle,'media',path.basename(manifest.media[0].path)),'changed');assert.throws(()=>verifyBundle(bundle),/integrity/);
});
test('changing source stays incomplete; unsafe paths and unowned tables are rejected',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-migration-change-')),bundle=path.join(root,'bundle'),s=source();let calls=0;s.fingerprint=async t=>({count:s.rows[t.name].length,digest:String(++calls)});await assert.rejects(copyAccount(s,bundle),/Source changed/);assert.throws(()=>verifyBundle(bundle),/incomplete/);assert.throws(()=>safeDestination(root,'../outside'),/Unsafe/);
  const rules=ownership([{name:'notes',columns:['user_id'],foreignKeys:[]},{name:'child',columns:['note_id'],foreignKeys:[{parent:'notes',columns:['note_id'],parentColumns:['id']}]},{name:'unowned',columns:['id'],foreignKeys:[]}],user);assert.match(rules.get('child')('s'),/exists.*user_id/);assert.equal(rules.has('unowned'),false);
});
test('legacy collection links and unavailable timeline people preserve their history',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-migration-links-')),bundle=path.join(root,'bundle'),target=path.join(root,'stage'),s=source();
  s.rows.contacts=[{id:'person-one',user_id:user,name:'Person'}];
  s.rows.collections=[{id:'collection-one',user_id:user,name:'Collection',field_schema:[{key:'person',type:'link_person'}]}];
  s.rows.collection_items=[{id:'item-one',user_id:user,collection_id:'collection-one',data:{person:{id:'person-one',type:'person',label:'Person'}}}];
  s.rows.moments=[{id:'event-one',user_id:user,person_id:'11111111-2222-3333-4444-555555555555',title:'Historical event',happened_at:'2020-01-01'}];
  await copyAccount(s,bundle);const report=stageAccount(bundle,target),store=new Store(target);
  assert.equal(report.contacts,1);assert.equal(report.unavailableSourceReferences.length,1);assert.equal(store.problems.length,0);
  assert.deepEqual(store.get('collection_items','item-one').data.person,{id:'person-one',type:'person',label:'Person'});
  assert.equal(store.get('collection_items','item-one').references.find(r=>r.type==='contacts').field,'data.person.id');
  const tombstone=store.get('contacts','11111111-2222-3333-4444-555555555555');assert.ok(tombstone.removed_at);assert.equal(tombstone.name,undefined);assert.equal(tombstone.ai_visibility,'hidden');
});
