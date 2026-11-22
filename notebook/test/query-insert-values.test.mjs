import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createService } from '../server/main.mjs';

// An insert whose record arrives under a misnamed field (the assistant's
// "data" instead of "values") used to crash inside the query service and
// answer the server's generic sentence, leaving the writer no hint how to fix
// its request (#914). It answers a 400 that names the field instead.

const temporary=()=>fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-insert-values-'));
const post=async(base,body)=>await(await fetch(base+'/api/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));

test('an insert with a missing or misnamed values gets a 400 whose message names the field',async()=>{
  const root=temporary(),service=await createService({root,port:0}),base='http://127.0.0.1:'+service.address.port;
  try{
    let reply=await post(base,{table:'notes',operation:'insert',data:{title:'x'}});
    assert.equal(reply.status,400);
    let answer=await reply.json();
    assert.match(answer.error,/"values"/,'the refusal names the field the writer must send');
    assert.match(answer.error,/"data"/,'and says which field the request sent instead');
    reply=await post(base,{table:'notes',operation:'insert'});
    assert.equal(reply.status,400);
    answer=await reply.json();
    assert.match(answer.error,/"values"/,'a request with no record at all is refused the same way');
    reply=await post(base,{table:'notes',operation:'upsert',data:{title:'x'}});
    assert.equal(reply.status,400);
    answer=await reply.json();
    assert.match(answer.error,/"values"/,'an upsert with a misnamed record is refused the same way');
    // Every request that was valid before still behaves as before.
    reply=await post(base,{table:'notes',operation:'insert',values:[{title:'ok'}]});
    assert.equal(reply.status,200);
    assert.equal((await(await fetch(base+'/api/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({table:'notes',operation:'select'})})).json()).data.length,1,'the valid insert still inserts');
    reply=await post(base,{table:'notes',operation:'insert',values:[]});
    assert.equal(reply.status,200,'an empty list of records stays a no-op');
  }finally{await service.close();fs.rmSync(root,{recursive:true,force:true});}
});
