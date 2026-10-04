import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createService} from '../server/main.mjs';

const root=()=>fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-note-cost-'));
const query=(base,body)=>fetch(base+'/api/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
// Count what one request costs, without counting the background refresh the
// file watcher arms afterwards.
function watch(service){
  const start=service.store.reads||0,counts={foregroundRebuilds:0,backgroundRebuilds:0,get reads(){return (service.store.reads||0)-start;}};
  const rebuild=service.index.rebuild.bind(service.index),background=service.index.rebuildBackground.bind(service.index);
  service.index.rebuild=(...args)=>{counts.foregroundRebuilds++;return rebuild(...args);};
  service.index.rebuildBackground=(...args)=>{counts.backgroundRebuilds++;return background(...args);};
  return counts;
}

test('saving a note reads the workspace once, not once per step of the write',async()=>{
  const service=await createService({root:root(),port:0}),base='http://127.0.0.1:'+service.address.port;
  try{
    await query(base,{table:'notes',operation:'insert',values:{id:'save-cost',title:'Note',content:'start'},selection:'*',single:true});
    const read=await(await query(base,{table:'notes',operation:'select',filters:[['eq','id','save-cost']],selection:'*',single:true})).json();
    const counts=watch(service);
    const response=await query(base,{table:'notes',operation:'update',values:{content:'edited'},filters:[['eq','id','save-cost']],selection:'*',single:true,expected:{'save-cost':read.data._hash},baselines:{'save-cost':read.data}});
    const result=await response.json();
    assert.equal(response.status,200,'the save must succeed: '+JSON.stringify(result));
    // A full read of the vault is the whole cost of a save on a real
    // workspace. One to see the records, one to pick up what was written.
    assert.ok(counts.reads<=2,'a save read the whole workspace '+counts.reads+' times; at most 2 are needed');
    // The search index is rebuilt from every record and every workspace file.
    // Waiting for that before answering made a save cost half a second more
    // than the save itself.
    assert.equal(counts.foregroundRebuilds,0,'a save must not wait for the search index to be rebuilt');
    assert.ok(counts.backgroundRebuilds>=1,'a save must still ask for a fresh search index');
  }finally{await service.close();}
});

test('a search straight after a save finds what was just saved',async()=>{
  const service=await createService({root:root(),port:0}),base='http://127.0.0.1:'+service.address.port;
  try{
    await query(base,{table:'notes',operation:'insert',values:{id:'search-freshness',title:'Note',content:'start'},selection:'*',single:true});
    const read=await(await query(base,{table:'notes',operation:'select',filters:[['eq','id','search-freshness']],selection:'*',single:true})).json();
    const response=await query(base,{table:'notes',operation:'update',values:{content:'zimtschnecke recipe'},filters:[['eq','id','search-freshness']],selection:'*',single:true,expected:{'search-freshness':read.data._hash},baselines:{'search-freshness':read.data}});
    assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
    const found=await(await fetch(base+'/api/search?q=zimtschnecke')).json();
    assert.ok(found.data.some(row=>row.id==='search-freshness'),'the words just saved must be findable: '+JSON.stringify(found.data));
  }finally{await service.close();}
});
