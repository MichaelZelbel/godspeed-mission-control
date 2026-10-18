import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createService} from '../server/main.mjs';
import {createRecordWrites} from '../ui/src/integrations/supabase/record-writes.mjs';

const root=()=>fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-note-payload-'));

test('saving one note stays a small request however many notes the screen has loaded',async()=>{
  const service=await createService({root:root(),port:0}),base='http://127.0.0.1:'+service.address.port;
  try{
    const bodies=[];
    const writes=createRecordWrites({send:async state=>{
      const payload=JSON.stringify(state);
      if(state.operation&&state.operation!=='select')bodies.push({bytes:payload.length,stamped:Object.keys(state.baselines||{}).length});
      const response=await fetch(base+'/api/query',{method:'POST',headers:{'Content-Type':'application/json'},body:payload});
      const result=await response.json();
      return response.ok?result:{data:null,error:{message:result.error,code:result.code}};
    }});
    const filler='x'.repeat(40*1024);
    for(let i=0;i<6;i++){
      const made=await writes.perform({table:'notes',operation:'insert',values:{id:'bulky-'+i,title:'Note '+i,content:filler},selection:'*',single:true});
      assert.equal(made.error,null,'note '+i+' must be created: '+JSON.stringify(made.error));
    }
    // What the notes screen does on load: read every note. The shim remembers
    // each one, to stamp the version it saw onto the next write.
    const listed=await writes.perform({table:'notes',operation:'select',selection:'*',filters:[['eq','is_trashed',false]]});
    assert.equal(listed.data.length,6);
    bodies.length=0;
    const saved=await writes.perform({table:'notes',operation:'update',values:{content:'edited'},filters:[['eq','id','bulky-3']],selection:'*',single:true});
    assert.equal(saved.error,null,'the edit must save: '+JSON.stringify(saved.error));
    // The server only ever reads the version of the records a write changes.
    // Sending every note the screen had seen put all of them in the request:
    // on the test server that made one note's save a 2.1MB request, and the
    // server refuses a body that size, so the screen said the change could not
    // be saved. The size of the vault must not decide whether an edit saves.
    assert.deepEqual(bodies.map(b=>b.stamped),[1],'a save must carry only the version of the note it saves');
    assert.ok(bodies[0].bytes<64*1024,'a save sent '+Math.round(bodies[0].bytes/1024)+'KB for one note of 40KB');
    assert.equal(service.store.get('notes','bulky-3').content,'edited');
  }finally{await service.close();}
});

test('a bulk action still carries the version of each record it names',async()=>{
  const service=await createService({root:root(),port:0}),base='http://127.0.0.1:'+service.address.port;
  try{
    const sent=[];
    const writes=createRecordWrites({send:async state=>{
      if(state.operation==='update')sent.push(state);
      const response=await fetch(base+'/api/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(state)});
      const result=await response.json();
      return response.ok?result:{data:null,error:{message:result.error,code:result.code}};
    }});
    for(const id of ['one','two','three'])await writes.perform({table:'notes',operation:'insert',values:{id,title:id,content:'start'},selection:'*',single:true});
    const moved=await writes.perform({table:'notes',operation:'update',values:{folder_path:'Archive'},filters:[['in','id',['one','three']]],selection:'*'});
    assert.equal(moved.error,null,'the bulk move must save: '+JSON.stringify(moved.error));
    assert.deepEqual(Object.keys(sent[0].expected).sort(),['one','three'],'the records the action names keep their concurrency check');
    assert.equal(service.store.get('notes','two').folder_path,'');
  }finally{await service.close();}
});
