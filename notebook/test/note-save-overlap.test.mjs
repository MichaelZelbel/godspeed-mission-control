import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createService} from '../server/main.mjs';
import {createRecordWrites} from '../ui/src/integrations/supabase/record-writes.mjs';
import {saveNoteText,refusedNoteReason,OTHER_VERSION_KEPT} from '../ui/src/lib/note-save.mjs';

const root=()=>fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-note-overlap-'));
const conflicts=dir=>{const folder=path.join(dir,'conflicts');return fs.existsSync(folder)?fs.readdirSync(folder).filter(name=>name.endsWith('.json')):[];};
// The dashboard's own transport: every write carries the version hash the
// screen last saw, which is what makes a second in-flight save a conflict.
const transport=base=>({send:async state=>{
  const response=await fetch(base+'/api/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(state)});
  const result=await response.json();
  return response.ok?result:{data:null,error:{message:result.error,code:result.code}};
}});

test('every overlapping save of one note is kept, and none is written away as a conflict',async()=>{
  const service=await createService({root:root(),port:0}),base='http://127.0.0.1:'+service.address.port;
  try{
    const writes=createRecordWrites(transport(base));
    const made=await writes.perform({table:'notes',operation:'insert',values:{id:'overlapping-save',title:'Note',content:'start'},filters:[],selection:'*',single:true});
    assert.equal(made.error,null,'the note must be created: '+JSON.stringify(made.error));
    // One person typing in one note. A save takes long enough that the
    // autosave fires again behind it, and so does the editor's flush on a tab
    // change, a note switch or a wikilink click.
    const results=await Promise.all(Array.from({length:10},(_,i)=>
      writes.perform({table:'notes',operation:'update',values:{content:'edit '+i},filters:[['eq','id','overlapping-save']],selection:'*',single:true})));
    assert.deepEqual(results.filter(r=>r.error).map(r=>r.error.message),[],'no save of one note may be refused');
    assert.deepEqual(conflicts(service.store.root),[],'one editor in one note must never produce a conflict record');
    assert.equal(service.store.get('notes','overlapping-save').content,'edit 9','the newest edit is what the note keeps');
  }finally{await service.close();}
});

test('a save queued behind another carries the version the server just returned',async()=>{
  const service=await createService({root:root(),port:0}),base='http://127.0.0.1:'+service.address.port;
  try{
    const sent=[],inner=transport(base);
    const writes=createRecordWrites({send:state=>{sent.push(state);return inner.send(state);}});
    await writes.perform({table:'notes',operation:'insert',values:{id:'queued-save',title:'Note',content:'start'},filters:[],selection:'*',single:true});
    const first=writes.perform({table:'notes',operation:'update',values:{content:'first'},filters:[['eq','id','queued-save']],selection:'*',single:true});
    const second=writes.perform({table:'notes',operation:'update',values:{content:'second'},filters:[['eq','id','queued-save']],selection:'*',single:true});
    const [a,b]=await Promise.all([first,second]);
    assert.equal(a.error,null);assert.equal(b.error,null);
    const updates=sent.filter(state=>state.operation==='update');
    assert.equal(updates.length,2);
    assert.notEqual(updates[1].expected['queued-save'],updates[0].expected['queued-save'],'the queued save must be stamped after the first one returned, not beside it');
    assert.equal(updates[1].expected['queued-save'],a.data._hash,'and it must carry exactly the version the first save produced');
  }finally{await service.close();}
});

test('writes to different notes still run side by side',async()=>{
  const service=await createService({root:root(),port:0}),base='http://127.0.0.1:'+service.address.port;
  try{
    const writes=createRecordWrites(transport(base));
    for(const id of ['note-one','note-two'])await writes.perform({table:'notes',operation:'insert',values:{id,title:id,content:'start'},filters:[],selection:'*',single:true});
    let open=0,overlapped=false;
    const watched=createRecordWrites({send:async state=>{open++;if(open>1)overlapped=true;try{return await transport(base).send(state);}finally{open--;}}});
    await watched.perform({table:'notes',operation:'select',selection:'*',filters:[]});
    const results=await Promise.all([
      watched.perform({table:'notes',operation:'update',values:{content:'a'},filters:[['eq','id','note-one']],selection:'*',single:true}),
      watched.perform({table:'notes',operation:'update',values:{content:'b'},filters:[['eq','id','note-two']],selection:'*',single:true}),
    ]);
    assert.deepEqual(results.filter(r=>r.error).map(r=>r.error.message),[],'both notes must save');
    assert.equal(overlapped,true,'serialising one note must not serialise the whole dashboard');
  }finally{await service.close();}
});

// 16 October 2026, a note about one person: the notes list (1,374 notes, slow after a
// reboot) was answered by the server between two saves of the open note and
// reached the screen after the second one. Its row carried the version from
// before that save, the screen took it, and every later save of the note was
// stamped with that older version and refused, four times in thirty seconds,
// while the text existed only in the conflict pile.
const LIST_COLUMNS='id, title, content_preview, metadata, tags, updated_at';
const listRead=()=>({table:'notes',operation:'select',selection:LIST_COLUMNS,filters:[['eq','is_trashed',false]],orders:[]});
const update=(id,values)=>({table:'notes',operation:'update',values,filters:[['eq','id',id]],selection:'*',single:true});

test('a slow read answered before a save but arriving after it does not take the note back to the older version',async()=>{
  const service=await createService({root:root(),port:0}),base='http://127.0.0.1:'+service.address.port;
  try{
    const inner=transport(base),sent=[];let hold=null;
    const writes=createRecordWrites({send:async state=>{
      sent.push(state);const result=await inner.send(state);
      // The server has answered this read; its answer reaches the screen later.
      if(state.operation==='select'&&hold){const gate=hold;hold=null;gate.answered();await gate.released;}
      return result;
    }});
    await writes.perform({table:'notes',operation:'insert',values:{id:'slow-read',title:'Note',content:'start'},filters:[],selection:'*',single:true});
    assert.equal((await writes.perform(update('slow-read',{content:'one'}))).error,null);
    let release;const gate={released:new Promise(resolve=>{release=resolve;})};
    const served=new Promise(resolve=>{gate.answered=resolve;});hold=gate;
    const list=writes.perform(listRead());
    await served;
    const second=await writes.perform(update('slow-read',{content:'two'}));
    assert.equal(second.error,null,'the save after the read was served must go through');
    release();assert.equal((await list).error,null);
    const third=await writes.perform(update('slow-read',{content:'three'}));
    assert.equal(third.error,null,'a save after the late read must not be refused: '+JSON.stringify(third.error));
    assert.equal(sent.filter(s=>s.operation==='update').at(-1).expected['slow-read'],second.data._hash,"and it carries the version the screen's own save produced");
    assert.deepEqual(conflicts(service.store.root),[],'one person typing in one note must never produce a conflict record');
    assert.equal(service.store.get('notes','slow-read').content,'three');
  }finally{await service.close();}
});

test('after a refused save the next save of the same note goes through and keeps the typed text',async()=>{
  const service=await createService({root:root(),port:0}),base='http://127.0.0.1:'+service.address.port;
  try{
    const mine=createRecordWrites(transport(base)),theirs=createRecordWrites(transport(base));
    await mine.perform({table:'notes',operation:'insert',values:{id:'refused-once',title:'Note',content:'start'},filters:[],selection:'*',single:true});
    // Another window changes the same words at the same time: a real overlap.
    await theirs.perform({table:'notes',operation:'select',selection:'*',filters:[['eq','id','refused-once']],orders:[]});
    assert.equal((await theirs.perform(update('refused-once',{content:'their words'}))).error,null);
    const refused=await mine.perform(update('refused-once',{content:'my words'}));
    assert.equal(refused.error?.code,'CONFLICT','both changed the text, so this one is kept for review');
    assert.equal(conflicts(service.store.root).length,1);
    const next=await mine.perform(update('refused-once',{content:'my words and more'}));
    assert.equal(next.error,null,'the next save must not fail forever: '+JSON.stringify(next.error));
    assert.equal(service.store.get('notes','refused-once').content,'my words and more');
    assert.equal(conflicts(service.store.root).length,1,'and it adds no second conflict record');
  }finally{await service.close();}
});

test('typed text refused once is sent again and saved, the other version is kept, and the screen says where it is',async()=>{
  const service=await createService({root:root(),port:0}),base='http://127.0.0.1:'+service.address.port;
  try{
    const mine=createRecordWrites(transport(base)),theirs=createRecordWrites(transport(base));
    await mine.perform({table:'notes',operation:'insert',values:{id:'text-kept',title:'Note',content:'start',tags:[]},filters:[],selection:'*',single:true});
    await theirs.perform({table:'notes',operation:'select',selection:'*',filters:[['eq','id','text-kept']],orders:[]});
    await theirs.perform(update('text-kept',{content:'their words',tags:['theirs']}));
    const typed=await saveNoteText(()=>mine.perform(update('text-kept',{content:'my words'})),{content:'my words'});
    assert.equal(typed.error,null,'the text in the editor is saved: '+JSON.stringify(typed.error));
    assert.equal(typed.kept,true,'and the screen is told the other version was kept');
    assert.equal(service.store.get('notes','text-kept').content,'my words');
    const pile=conflicts(service.store.root).map(name=>JSON.parse(fs.readFileSync(path.join(service.store.root,'conflicts',name),'utf8')));
    assert.equal(pile.length,1);assert.equal(pile[0].remote.content,'their words','the other version is in the conflict pile');
    // A tag is not typed text: it is not sent again over someone else's.
    await theirs.perform(update('text-kept',{tags:['theirs','again']}));
    const tag=await saveNoteText(()=>mine.perform(update('text-kept',{tags:['mine']})),{tags:['mine']});
    assert.equal(tag.error?.code,'CONFLICT');assert.equal(tag.kept,false);
    assert.deepEqual(service.store.get('notes','text-kept').tags,['theirs','again']);
    // What the screen says: what happened and what to do, in plain words.
    for(const text of [OTHER_VERSION_KEPT,refusedNoteReason(tag.error,{tags:['mine']}),refusedNoteReason(tag.error,{content:'x'})]){
      assert.match(text,/Review conflicting edits/);assert.doesNotMatch(text,/record|try again|Both versions/i);
    }
    assert.match(refusedNoteReason(tag.error,{content:'x'}),/still in the editor/);
    assert.match(refusedNoteReason(tag.error,{tags:['x']}),/make the change again/);
    assert.equal(refusedNoteReason({message:'offline'},{content:'x'}),null,'other failures keep their own message');
  }finally{await service.close();}
});

test('a list read of the same version does not replace the full copy the next save compares against',async()=>{
  const service=await createService({root:root(),port:0}),base='http://127.0.0.1:'+service.address.port;
  try{
    const writes=createRecordWrites(transport(base));
    await writes.perform({table:'notes',operation:'insert',values:{id:'kept-copy',title:'Note',content:'start'},filters:[],selection:'*',single:true});
    await writes.perform(update('kept-copy',{content:'typed'}));
    await writes.perform(listRead());
    assert.equal(writes.snapshots.get('notes/kept-copy').content,'typed','the list row lacks the text; the copy the screen holds keeps it');
  }finally{await service.close();}
});
