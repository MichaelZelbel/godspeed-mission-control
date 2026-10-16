import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createService} from '../server/main.mjs';

// A save names the version it started from. When the note changed since, the
// server compares field by field against that version from the note's own
// history: a field only the saver changed is saved, a field both changed is a
// conflict. Until 16 October 2026 it compared against the copy the screen sent
// along, and the notes list's copy has no text, so the notebook's own
// processing (tags, summary) got the next save of the text refused under an
// open editor, and so did a save sent with no copy at all.
const root=()=>fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-note-fields-'));
const conflicts=dir=>{const folder=path.join(dir,'conflicts');return fs.existsSync(folder)?fs.readdirSync(folder).filter(name=>name.endsWith('.json')):[];};
const query=(base,body)=>fetch(base+'/api/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(async r=>({status:r.status,...await r.json()}));
const listCopy=note=>({id:note.id,title:note.title,content_preview:String(note.content).slice(0,400),tags:note.tags,metadata:note.metadata,updated_at:note.updated_at,_hash:note._hash});

for(const [label,baseline] of [['with no copy of the note',()=>undefined],["with the notes list's copy",listCopy]]){
  test("a save of the text goes through after the notebook's processing changed the tags and summary, "+label,async()=>{
    const service=await createService({root:root(),port:0}),base='http://127.0.0.1:'+service.address.port;
    try{
      const note=service.store.save('notes',{id:'processed-under-editor',title:'Note',content:'What I typed so far'});
      const seen={...service.store.get('notes',note.id)};
      // The processing writes tags, metadata and its status, never the text.
      service.store.save('notes',{id:note.id,tags:['travel'],metadata:{summary:'A note about a trip'},processing_status:'processed',processed_at:new Date().toISOString()});
      const copy=baseline(seen);
      const result=await query(base,{table:'notes',operation:'update',values:{content:'What I typed so far, and more'},filters:[['eq','id',note.id]],selection:'*',single:true,expected:{[note.id]:seen._hash},baselines:copy?{[note.id]:copy}:{}});
      assert.equal(result.status,200,'the save must not be refused: '+JSON.stringify(result));
      const saved=service.store.get('notes',note.id);
      assert.equal(saved.content,'What I typed so far, and more');
      assert.deepEqual(saved.tags,['travel'],"and the processing's tags stay");
      assert.equal(saved.metadata.summary,'A note about a trip');
      assert.deepEqual(conflicts(service.store.root),[]);
    }finally{await service.close();}
  });
}

test('two changes to the same text still become a conflict with both versions kept',async()=>{
  const service=await createService({root:root(),port:0}),base='http://127.0.0.1:'+service.address.port;
  try{
    const note=service.store.save('notes',{id:'both-typed',title:'Note',content:'Start'});
    const seen={...service.store.get('notes',note.id)};
    service.store.save('notes',{id:note.id,content:'Changed on the phone'});
    const result=await query(base,{table:'notes',operation:'update',values:{content:'Changed on the laptop'},filters:[['eq','id',note.id]],selection:'*',single:true,expected:{[note.id]:seen._hash},baselines:{}});
    assert.equal(result.status,409);assert.equal(result.code,'CONFLICT');
    assert.equal(service.store.get('notes',note.id).content,'Changed on the phone','the newer version is not overwritten unseen');
    const kept=JSON.parse(fs.readFileSync(path.join(service.store.root,'conflicts',conflicts(service.store.root)[0]),'utf8'));
    assert.equal(kept.local.content,'Changed on the laptop');assert.equal(kept.remote.content,'Changed on the phone');
    assert.equal(kept.base?.content,'Start','the review shows the version both started from');
  }finally{await service.close();}
});

test('the version a save started from is found in the history after a restart, when every record is read from disk',async()=>{
  const dir=root();
  let service=await createService({root:dir,port:0});
  const note=service.store.save('notes',{id:'after-restart',title:'Note',content:'Before the reboot\n\nwith a second paragraph, ümlauts and "quotes"',tags:['a'],metadata:{nested:{list:[1,'two',null]}}});
  const seen={...service.store.get('notes',note.id)};
  service.store.save('notes',{id:note.id,tags:['a','b'],metadata:{nested:{list:[1,'two',null]},summary:'later'}});
  await service.close();
  service=await createService({root:dir,port:0});
  try{
    const current=service.store.get('notes',note.id),found=service.store.versionOf(current,seen._hash);
    assert.ok(found,'the earlier version is found by its hash');
    assert.equal(found.content,seen.content);assert.deepEqual(found.tags,['a']);
    const base='http://127.0.0.1:'+service.address.port;
    const result=await query(base,{table:'notes',operation:'update',values:{content:'After the reboot'},filters:[['eq','id',note.id]],selection:'*',single:true,expected:{[note.id]:seen._hash},baselines:{}});
    assert.equal(result.status,200,JSON.stringify(result));
    assert.deepEqual(service.store.get('notes',note.id).tags,['a','b']);
  }finally{await service.close();}
});

test('a version the server cannot find in the history is compared against the copy the screen sent, as before',async()=>{
  const service=await createService({root:root(),port:0}),base='http://127.0.0.1:'+service.address.port;
  try{
    const note=service.store.save('notes',{id:'unknown-version',title:'Note',content:'Start'});
    const seen={...service.store.get('notes',note.id)};
    const result=await query(base,{table:'notes',operation:'update',values:{content:'Mine'},filters:[['eq','id',note.id]],selection:'*',single:true,expected:{[note.id]:'0'.repeat(64)},baselines:{[note.id]:{...seen,_hash:'0'.repeat(64)}}});
    assert.equal(result.status,200,'the text nobody else changed since the copy is saved: '+JSON.stringify(result));
    const refused=await query(base,{table:'notes',operation:'update',values:{content:'Mine again'},filters:[['eq','id',note.id]],selection:'*',single:true,expected:{[note.id]:'1'.repeat(64)},baselines:{}});
    assert.equal(refused.status,409,'with no copy and no history, a changed field is a conflict');
  }finally{await service.close();}
});
