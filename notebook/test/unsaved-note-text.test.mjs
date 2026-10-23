import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createService} from '../server/main.mjs';
import {createRecordWrites} from '../ui/src/integrations/supabase/record-writes.mjs';
import {saveNoteText} from '../ui/src/lib/note-save.mjs';

// Issue #29 (23 October 2026): text typed in a note while the notebook was
// away is now kept on the device and sent again, also after a reload
// (ui/src/lib/unsaved-notes.ts). A reloaded page has never seen the version the
// text was typed on, so it pins that version (record-writes.mjs): a change
// made elsewhere in the meantime is then refused and kept for review, as for
// any overlapping save, instead of being written over unseen.

const root=()=>fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-unsaved-text-'));
const conflicts=dir=>{const folder=path.join(dir,'conflicts');return fs.existsSync(folder)?fs.readdirSync(folder).filter(name=>name.endsWith('.json')).map(name=>JSON.parse(fs.readFileSync(path.join(folder,name),'utf8'))):[];};
const transport=(base,sent=[])=>({send:async state=>{
  sent.push(state);
  const response=await fetch(base+'/api/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(state)});
  const result=await response.json();
  return response.ok?result:{data:null,error:{message:result.error,code:result.code}};
}});
const insert=(id,content)=>({table:'notes',operation:'insert',values:{id,title:'Garden plan',content},filters:[],selection:'*',single:true});
const read=id=>({table:'notes',operation:'select',selection:'*',filters:[['eq','id',id]],orders:[]});
const listRead=()=>({table:'notes',operation:'select',selection:'id, title, content_preview, updated_at',filters:[['eq','is_trashed',false]],orders:[]});
const update=(id,values)=>({table:'notes',operation:'update',values,filters:[['eq','id',id]],selection:'*',single:true});

test('text kept from an earlier visit carries the version it was typed on: a change made elsewhere is kept for review, not written over',async()=>{
  const service=await createService({root:root(),port:0}),base='http://127.0.0.1:'+service.address.port;
  try{
    const before=createRecordWrites(transport(base)),elsewhere=createRecordWrites(transport(base));
    const typedOn=(await before.perform(insert('kept-text','Seeds to buy.'))).data;
    // The tab closed with "Compost in spring." unsaved; meanwhile another device saved its own words.
    await elsewhere.perform(read('kept-text'));
    assert.equal((await elsewhere.perform(update('kept-text',{content:'Seeds to buy. Water on Sunday.'}))).error,null);
    // The reloaded page reads the note as it is now, then pins what the text was typed on.
    const sent=[],reloaded=createRecordWrites(transport(base,sent));
    await reloaded.perform(read('kept-text'));
    reloaded.pin('notes','kept-text',typedOn._hash,{content:'Seeds to buy.',title:'Garden plan'});
    await reloaded.perform(listRead());
    const saved=await saveNoteText(()=>reloaded.perform(update('kept-text',{content:'Seeds to buy. Compost in spring.'})),{content:'Seeds to buy. Compost in spring.'});
    assert.equal(saved.error,null,'the typed text is saved: '+JSON.stringify(saved.error));
    assert.equal(saved.kept,true,'and the screen is told the other version was kept');
    assert.equal(sent.filter(s=>s.operation==='update')[0].expected['kept-text'],typedOn._hash,'the first try carried the version the text was typed on, not the one read after the reload');
    assert.equal(service.store.get('notes','kept-text').content,'Seeds to buy. Compost in spring.');
    const pile=conflicts(service.store.root);
    assert.equal(pile.length,1);assert.equal(pile[0].remote.content,'Seeds to buy. Water on Sunday.','the other version is in the conflict pile');
    // The pin went with that answer: the next save is an ordinary one.
    assert.equal((await reloaded.perform(update('kept-text',{content:'Seeds to buy. Compost in spring. Rake.'}))).error,null);
    assert.equal(conflicts(service.store.root).length,1,'and adds no second conflict record');
  }finally{await service.close();}
});

test('kept text for a note nobody changed meanwhile saves without a conflict',async()=>{
  const service=await createService({root:root(),port:0}),base='http://127.0.0.1:'+service.address.port;
  try{
    const before=createRecordWrites(transport(base));
    const typedOn=(await before.perform(insert('unchanged','Seeds to buy.'))).data;
    const reloaded=createRecordWrites(transport(base));
    await reloaded.perform(read('unchanged'));
    reloaded.pin('notes','unchanged',typedOn._hash,{content:'Seeds to buy.'});
    const saved=await saveNoteText(()=>reloaded.perform(update('unchanged',{content:'Seeds to buy. Compost.'})),{content:'Seeds to buy. Compost.'});
    assert.equal(saved.error,null);assert.equal(saved.kept,false);
    assert.deepEqual(conflicts(service.store.root),[]);
  }finally{await service.close();}
});

test('a try that never reached the notebook keeps the version the text was typed on',async()=>{
  const service=await createService({root:root(),port:0}),base='http://127.0.0.1:'+service.address.port;
  try{
    const before=createRecordWrites(transport(base)),elsewhere=createRecordWrites(transport(base));
    const typedOn=(await before.perform(insert('still-away','Seeds to buy.'))).data;
    const sent=[],real=transport(base,sent);let away=true;
    const reloaded=createRecordWrites({send:state=>away&&state.operation==='update'?(sent.push(state),{data:null,error:{message:'Failed to fetch'}}):real.send(state)});
    await reloaded.perform(read('still-away'));
    reloaded.pin('notes','still-away',typedOn._hash,{content:'Seeds to buy.'});
    assert.equal((await reloaded.perform(update('still-away',{content:'Compost.'}))).error.message,'Failed to fetch');
    await elsewhere.perform(read('still-away'));
    await elsewhere.perform(update('still-away',{content:'Water on Sunday.'}));
    await reloaded.perform(read('still-away'));
    away=false;
    const saved=await saveNoteText(()=>reloaded.perform(update('still-away',{content:'Compost.'})),{content:'Compost.'});
    assert.equal(saved.kept,true,'the change made meanwhile was seen and kept');
    assert.deepEqual(sent.filter(s=>s.operation==='update').slice(0,2).map(s=>s.expected['still-away']),[typedOn._hash,typedOn._hash]);
  }finally{await service.close();}
});
