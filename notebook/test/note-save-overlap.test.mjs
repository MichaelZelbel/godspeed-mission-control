import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createService} from '../server/main.mjs';
import {createRecordWrites} from '../ui/src/integrations/supabase/record-writes.mjs';

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
