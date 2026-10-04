import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store,atomic,hash} from '../core/records/store.mjs';
import {conflictView,resolveSavedConflict} from '../core/conflicts.mjs';
import {createService} from '../server/main.mjs';

function fixture(){return new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-conflict-review-')));}
function write(store,conflict){atomic(path.join(store.root,'conflicts',conflict.id+'.json'),JSON.stringify(conflict));return conflict;}
test('old record conflict cannot roll back an outcome saved during review; keeping current retains every copy',()=>{
  const store=fixture(),goal=store.save('goals',{title:'Fictional review',status:'adopted',progress:[]});
  const conflict=write(store,{id:'old-goal',kind:'stale-write',type:'goals',record_id:goal.id,local:{...goal,status:'paused'},remote:goal});
  const viewed=conflictView(store,conflict.id);store.save('goals',{id:goal.id,progress:[{result:5,evidence:'Fictional actual review'}]});
  assert.throws(()=>resolveSavedConflict(store,{id:conflict.id,choice:'remote',expected_hash:viewed.current_hash}),/changed again/);
  assert.equal(store.get('goals',goal.id).progress[0].result,5);
  assert.throws(()=>resolveSavedConflict(store,{id:conflict.id,choice:'local'}),/Reload/);
  const current=conflictView(store,conflict.id),bytes=fs.readFileSync(store.file(goal));
  const resolved=resolveSavedConflict(store,{id:conflict.id,choice:'current',expected_hash:current.current_hash});
  assert.deepEqual(fs.readFileSync(store.file(goal)),bytes);assert.deepEqual(resolved.local,conflict.local);assert.deepEqual(resolved.remote,conflict.remote);
  assert.equal(resolved.reviewed_hash,hash(bytes));assert.equal(resolved.reviewed_current,bytes.toString());
});
test('merged current note preserves identity, history and both conflicting versions',()=>{
  const store=fixture(),note=store.save('notes',{title:'Fictional merge',content:'Current'}),file=path.relative(store.root,store.file(note)).replaceAll('\\','/');
  write(store,{id:'note-merge',kind:'git',path:file,local:fs.readFileSync(store.file(note),'utf8'),remote:'Retained remote text'});
  const view=conflictView(store,'note-merge'),merged=view.current.replace('Current','Combined current and remote');
  resolveSavedConflict(store,{id:'note-merge',choice:'merged',text:merged,expected_hash:view.current_hash});
  assert.equal(store.get('notes',note.id).content,'Combined current and remote');assert.equal(store.get('notes',note.id).uid,note.uid);
  assert.ok(store.list('record_history').some(r=>r.source_uid===note.uid&&r.snapshot.content==='Current'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(store.root,'conflicts/note-merge.json'))).remote,'Retained remote text');
});
test('a legacy Git choice refuses a newer current file; binary choices verify retained hashes',()=>{
  const store=fixture(),file='skills/fictional/SKILL.md';atomic(path.join(store.root,file),'Later actual method');
  write(store,{id:'method',kind:'git',path:file,local:'Old method',remote:'Other old method'});
  assert.throws(()=>resolveSavedConflict(store,{id:'method',choice:'remote'},{legacyLocalCheck:true}),/changed again/);
  const binary=Buffer.from([0,1,255]),remote=Buffer.from([0,2,254]),binaryFile='skills/fictional/image.bin';atomic(path.join(store.root,binaryFile),binary);
  write(store,{id:'binary',kind:'git',path:binaryFile,encoding:'base64',local:binary.toString('base64'),remote:remote.toString('base64'),digests:{local:hash(binary),remote:'wrong'}});
  const view=conflictView(store,'binary');assert.equal(view.current_encoding,'base64');
  assert.throws(()=>resolveSavedConflict(store,{id:'binary',choice:'remote',expected_hash:view.current_hash}),/integrity/);assert.deepEqual(fs.readFileSync(path.join(store.root,binaryFile)),binary);
});
test('HTTP conflict resolution checks the displayed current version before applying a retained edit',async()=>{
  const store=fixture(),note=store.save('notes',{title:'Fictional browser conflict',content:'Original'});
  write(store,{id:'browser-conflict',kind:'stale-write',type:'notes',record_id:note.id,local:{...note,content:'Pending'},remote:note});
  const service=await createService({root:store.root,port:0}),base='http://127.0.0.1:'+service.address.port;
  try{
    const viewed=(await(await fetch(base+'/api/conflicts')).json()).data[0];assert.match(viewed.current,/Original/);
    service.store.save('notes',{id:note.id,content:'Newer saved reply'});
    const post=body=>fetch(base+'/api/conflicts/resolve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const stale=await post({id:viewed.id,choice:'local',expected_hash:viewed.current_hash});assert.equal(stale.status,400);assert.match((await stale.json()).error,/changed again/);
    const current=(await(await fetch(base+'/api/conflicts')).json()).data[0];assert.match(current.current,/Newer saved reply/);
    assert.equal((await post({id:current.id,choice:'current',expected_hash:current.current_hash})).status,200);
    assert.equal(service.store.get('notes',note.id).content,'Newer saved reply');assert.equal((await(await fetch(base+'/api/conflicts')).json()).data.length,0);
  }finally{await service.close();}
});
test('assistant method resolution preserves the reviewed current file and rejects edits made after its display',()=>{
  const store=fixture(),home=path.join(store.state,'fictional-assistant'),target=path.join(home,'skills/fictional/SKILL.md'),descriptor=path.join(store.state,'assistant.json');
  atomic(descriptor,JSON.stringify({home}));atomic(target,'Actual current isolated method');
  write(store,{id:'assistant-method',kind:'assistant-skill',target,local:'Older customized method',remote:'Older packaged method'});
  const options={assistantPath:descriptor},view=conflictView(store,'assistant-method',options);atomic(target,'Changed method during review');
  assert.throws(()=>resolveSavedConflict(store,{id:view.id,choice:'remote',expected_hash:view.current_hash},options),/changed again/);
  const current=conflictView(store,view.id,options);resolveSavedConflict(store,{id:view.id,choice:'local',expected_hash:current.current_hash},options);
  assert.equal(fs.readFileSync(target,'utf8'),'Older customized method');
  assert.equal(fs.readFileSync(path.join(store.root,'skills/package-history',hash(target),current.current_hash+'.txt'),'utf8'),'Changed method during review');
});
test('merging a conflict cannot rename a record or rewrite an event',()=>{
  const store=fixture(),note=store.save('notes',{title:'Fictional identity',content:'Saved'});
  write(store,{id:'identity',kind:'stale-write',type:'notes',record_id:note.id,local:note,remote:note});
  const view=conflictView(store,'identity');
  assert.throws(()=>resolveSavedConflict(store,{id:view.id,choice:'merged',text:JSON.stringify({...note,id:'different'}),expected_hash:view.current_hash}),/identity/);
  assert.throws(()=>resolveSavedConflict(store,{id:view.id,choice:'merged',text:JSON.stringify({...note,uid:'different'}),expected_hash:view.current_hash}),/identity/);
  const event=store.save('moments',{title:'Fictional event',content:'Happened once'});write(store,{id:'event',kind:'stale-write',type:'moments',record_id:event.id,local:{...event,content:'Rewritten'},remote:event});
  const ev=conflictView(store,'event');assert.throws(()=>resolveSavedConflict(store,{id:ev.id,choice:'local',expected_hash:ev.current_hash}),/append-only/);
  resolveSavedConflict(store,{id:ev.id,choice:'current',expected_hash:ev.current_hash});assert.equal(store.get('moments',event.id).content,'Happened once');
});
