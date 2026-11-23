import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createService} from '../server/main.mjs';

// Issue 936: an update or delete with no filter applied to every record of the
// kind and answered 200. One forgotten filter from a screen, a script or an
// add-on rewrote or wiped a whole kind of record without warning; the
// assistant's writes are guarded by the record-hash check, the local door is not.
const root=()=>fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-write-filter-'));
const post=(base,body)=>fetch(base+'/api/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const people=async base=>(await (await fetch(base+'/api/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({table:'contacts'})})).json()).data;

test('an update or delete with no filter is refused with 400 and changes nothing',async()=>{
  const service=await createService({root:root(),port:0}),base='http://127.0.0.1:'+service.address.port;
  try{
    await post(base,{table:'contacts',operation:'insert',values:[{name:'Ana'},{name:'Bo'}]});
    const updated=await post(base,{table:'contacts',operation:'update',values:{name:'Overwritten'}});
    assert.equal(updated.status,400);
    assert.match((await updated.json()).error,/filter .*\["eq","id","<id>"\]/);
    const removed=await post(base,{table:'contacts',operation:'delete'});
    assert.equal(removed.status,400);
    assert.match((await removed.json()).error,/filter/);
    // values never selects targets: an update whose only targeting is a values.id
    // is still a no-filter request and is refused like one.
    const byValues=await post(base,{table:'contacts',operation:'update',values:{id:'ana',name:'Still overwritten'}});
    assert.equal(byValues.status,400);
    const left=await people(base);
    assert.deepEqual(left.map(c=>c.name).sort(),['Ana','Bo'],'nothing was changed');
    assert.equal(left.length,2);
  }finally{await service.close();}
});

test('a filter that matches nothing still changes nothing and answers as before',async()=>{
  const service=await createService({root:root(),port:0}),base='http://127.0.0.1:'+service.address.port;
  try{
    await post(base,{table:'contacts',operation:'insert',values:{name:'Ana'}});
    const updated=await post(base,{table:'contacts',operation:'update',values:{name:'Renamed'},filters:[['eq','id','no-such-id']]});
    assert.equal(updated.status,200);assert.deepEqual((await updated.json()).data,[]);
    const removed=await post(base,{table:'contacts',operation:'delete',filters:[['eq','id','no-such-id']]});
    assert.equal(removed.status,200);assert.deepEqual((await removed.json()).data,[]);
    const left=await people(base);
    assert.deepEqual(left.map(c=>c.name),['Ana'],'the record the filter did not match was left as it was');
  }finally{await service.close();}
});

// Issue 956: an operation name the door does not know fell into the write
// branch and rewrote every record of the kind.
test('an unknown or wrong-case operation is refused with 400 naming the supported ones and changes nothing',async()=>{
  const service=await createService({root:root(),port:0}),base='http://127.0.0.1:'+service.address.port;
  try{
    await post(base,{table:'contacts',operation:'insert',values:[{name:'Ana'},{name:'Bo'}]});
    const before=JSON.stringify(await people(base));
    for(const body of [
      {table:'contacts',operation:'remove',values:{name:'X'}},
      {table:'contacts',operation:'Update',values:{name:'X'}},
      {table:'contacts',operation:'patch',values:{name:'X'},filters:[['eq','name','Ana']]},
    ]){
      const res=await post(base,body);
      assert.equal(res.status,400,body.operation);
      assert.match((await res.json()).error,/select, insert, upsert, update, delete/);
    }
    assert.equal(JSON.stringify(await people(base)),before,'no record, revision or history changed');
  }finally{await service.close();}
});
