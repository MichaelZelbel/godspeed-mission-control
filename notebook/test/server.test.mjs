import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createService } from '../server/main.mjs';
import {Store} from '../core/records/store.mjs';

test('read-only people RPCs do not rebuild the full index while mutating RPCs still refresh it',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-read-rpc-')),seed=new Store(root),person=seed.save('contacts',{name:'Fictional index check'}),template=seed.save('collection_templates',{title:'Fictional template',usage_count:0}),service=await createService({root,port:0}),base='http://127.0.0.1:'+service.address.port;let rebuilds=0;const original=service.index.rebuild.bind(service.index);service.index.rebuild=()=>{rebuilds++;return original();};
 const rpc=async(name,args)=>{const response=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rpc:name,args})});assert.equal(response.status,200);return response.json();};
 try{const read=await rpc('search_contacts_page',{search_text:'Fictional index'});assert.equal(read.data.rows[0].id,person.id);await rpc('notes_mentioning_people',{names:['Fictional index']});await rpc('my_staff_access_log',{});assert.equal(rebuilds,0);await rpc('increment_collection_template_usage',{template_id:template.id});assert.equal(rebuilds,1);assert.ok(service.index.search('"usage_count":1').some(r=>r.id===template.id));}finally{await service.close();}
});

test('latest work excludes failed drafts and reports a changed checked result',async()=>{
 const s=await createService({root:fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-work-display-')),port:0}),base='http://127.0.0.1:'+s.address.port;
 try{
  const accepted=s.store.save('notes',{title:'Fictional checked result',content:'Checked rain rule',source_app:'goal-work'});
  s.store.save('work_items',{title:'Fictional checked task',state:'verified',result_id:accepted.id,verification:{content_hash:s.store.get('notes',accepted.id)._hash,evidence:'Checked against the task'}});
  s.store.save('notes',{title:'Fictional failed draft',content:'Unchecked draft',source_app:'goal-work'});
  let response=await fetch(base+'/api/latest-work');assert.equal(response.status,200);let result=await response.json();assert.equal(result.data[0].id,accepted.id);assert.equal(result.verification_current,true);
  s.store.save('notes',{id:accepted.id,content:'Changed after the check'});result=await(await fetch(base+'/api/latest-work')).json();assert.equal(result.verification_current,false);
 }finally{await s.close();}
});

test('enabling a routine repeatedly updates its one schedule and preserves other pauses',async()=>{
 const service=await createService({root:fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-routine-choice-')),port:0}),base='http://127.0.0.1:'+service.address.port;
 const post=async(route,input)=>{const r=await fetch(base+'/api/'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});assert.equal(r.status,200);return r.json();};
 try{
  service.scheduler.configure({goal:'Fictional schedule acceptance',timezone:'Europe/Berlin'});service.store.save('jobs',{id:'coaching',paused:true});
  for(let i=0;i<3;i++)await post('jobs/add',{kind:'goal-decision',interval_ms:60000});
  assert.equal(service.store.list('jobs').filter(j=>j.kind==='goal-decision').length,1);assert.equal(service.store.get('jobs','goal-decision').interval_ms,60000);assert.equal(service.store.get('jobs','coaching').paused,true);
 }finally{await service.close();}
});

test('installed recovery restores a separate empty copy and verifies bytes without replacing the active workspace',async()=>{
 const service=await createService({root:fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-recovery-controls-')),port:0}),base='http://127.0.0.1:'+service.address.port;
 const post=async(route,input)=>{const r=await fetch(base+'/api/'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});assert.equal(r.status,200,await r.clone().text());return r.json();};
 try{
  const original=service.store.save('notes',{title:'Fictional recovery',content:'Exact fictional rain rule'});
  const saved=await post('backup',{}),id=path.basename(saved.path);service.store.save('notes',{id:original.id,content:'Later fictional edit'});
  const result=await post('restore-copy',{backup_id:id});assert.equal(result.verified,true);assert.ok(result.compared_files>0);
  assert.equal(service.store.get('notes',original.id).content,'Later fictional edit');assert.match(fs.readFileSync(path.join(result.workspace,'notebook/notes',original.id+'.md'),'utf8'),/Exact fictional rain rule/);
  const refused=await fetch(base+'/api/restore-copy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({backup_id:'../outside'})});assert.equal(refused.status,400);
 }finally{await service.close();}
});
test('actual HTTP notebook CRUD, media preview, profile review, backup and restart',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-service-test-'));
  let service=await createService({root,port:0,provider:async()=> 'A concrete conversation draft.'});
  let base='http://127.0.0.1:'+service.address.port;
  const post=async(route,value)=>{const response=await fetch(base+'/api/'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data;};
  try{
    await post('setup',{goal:'Prepare a conversation',timezone:'Europe/Berlin'});
    const note=(await post('query',{table:'notes',operation:'insert',values:{title:'My note',content:'Local'},single:true})).data;
    const person=(await post('query',{table:'contacts',operation:'insert',values:{name:'Alex'},single:true})).data;
    await post('functions/normalize-profile',{action:'write_fact',contact_id:person.id,label:'Home city',value:'A town'});
    assert.equal((await post('query',{table:'world_claims'})).data.length,1);
    const form=new FormData();form.append('file',new Blob(['candidate media'],{type:'text/plain'}),'example.txt');form.append('path','owner/example.txt');
    const uploaded=await fetch(base+'/api/media/upload',{method:'POST',body:form});assert.equal(uploaded.status,200);
    const downloaded=await fetch(base+'/api/media/file/'+encodeURIComponent('owner/example.txt'));assert.equal(await downloaded.text(),'candidate media');
    const backup=await post('backup',{});assert.ok(fs.existsSync(backup.path));
    await service.close();service=await createService({root,port:0});base='http://127.0.0.1:'+service.address.port;
    assert.equal((await post('query',{table:'notes',filters:[['eq','id',note.id]],single:true})).data.content,'Local');
    const denied=await fetch(base+'/api/query',{method:'POST',headers:{'Content-Type':'application/json','Origin':'https://unrelated.example'},body:'{}'});assert.equal(denied.status,403);
  }finally{await service.close();}
});
