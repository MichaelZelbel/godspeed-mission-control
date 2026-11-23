import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createService} from '../server/main.mjs';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';

// Issue 1032: a moment that ends before it starts was stored from any client.
const root=()=>fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-moment-dates-'));
const post=(base,body)=>fetch(base+'/api/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const moments=async base=>(await (await post(base,{table:'moments'})).json()).data;
const withService=async(run)=>{
  const service=await createService({root:root(),port:0});
  try{await run('http://127.0.0.1:'+service.address.port);}finally{await service.close();}
};
const stored=async(base,id='m1')=>{
  const r=await post(base,{table:'moments',operation:'insert',values:{id,title:'Trip',happened_at:'2025-03-05',happened_end:'2025-03-07'}});
  assert.equal(r.status,200);
};

test('an insert of a moment that ends before it starts is refused with 400',()=>withService(async base=>{
  const r=await post(base,{table:'moments',operation:'insert',values:{title:'Backwards',happened_at:'2025-03-05',happened_end:'2025-03-01'}});
  assert.equal(r.status,400);
  assert.match((await r.json()).error,/The end date is before the start date/);
  assert.deepEqual(await moments(base),[]);
}));

test('a change of one date is judged against the stored other date',()=>withService(async base=>{
  await stored(base);
  for(const values of [{happened_end:'2025-03-01'},{happened_at:'2025-03-10'}]){
    const r=await post(base,{table:'moments',operation:'update',values,filters:[['eq','id','m1']]});
    assert.equal(r.status,400);assert.match((await r.json()).error,/end date is before the start date/);
  }
  const up=await post(base,{table:'moments',operation:'upsert',values:{id:'m1',happened_end:'2025-03-01'}});
  assert.equal(up.status,400);
  const [m]=await moments(base);
  assert.equal(m.happened_at.slice(0,10),'2025-03-05');assert.equal(m.happened_end.slice(0,10),'2025-03-07');
}));

test('the same day, a later day and no end still save',()=>withService(async base=>{
  for(const [id,end] of [['a','2025-03-05'],['b','2025-03-09'],['c',undefined]]){
    const r=await post(base,{table:'moments',operation:'insert',values:{id,title:id,happened_at:'2025-03-05',...(end?{happened_end:end}:{})}});
    assert.equal(r.status,200);
  }
  assert.equal((await moments(base)).length,3);
}));

test('a moment stored backwards before the rule still takes a change that leaves its dates alone',async()=>{
  const dir=root(),store=new Store(dir,{device:'pc'});
  store.save('moments',{id:'old',title:'Old',happened_at:'2025-03-05',happened_end:'2025-03-01'});
  const query=new QueryService(store);
  await query.executeAsync({table:'moments',operation:'update',values:{title:'Renamed'},filters:[['eq','id','old']]});
  assert.equal(query.rows('moments').find(m=>m.id==='old').title,'Renamed');
});

test('a correction that would make a moment end before it starts is refused with 400',()=>withService(async base=>{
  await stored(base);
  for(const patch of [{happened_end:'2020-01-01'},{happened_at:'2025-03-10'}]){
    const r=await post(base,{table:'event_corrections',operation:'insert',values:{moment_id:'m1',patch,sequence:1}});
    assert.equal(r.status,400);assert.match((await r.json()).error,/end date is before the start date/);
  }
  const ok=await post(base,{table:'event_corrections',operation:'insert',values:{moment_id:'m1',patch:{happened_end:'2025-03-08'},sequence:1}});
  assert.equal(ok.status,200);
  const [m]=await moments(base);assert.equal(m.happened_end.slice(0,10),'2025-03-08');
}));

test('corrections are judged as the reader merges them: sequence order, replaced patches, moment moves, null end',()=>withService(async base=>{
  await stored(base);
  await stored(base,'m2');
  const corr=values=>post(base,{table:'event_corrections',...values});
  const ins=values=>corr({operation:'insert',values});
  // a later correction clears the end; a correction sorting before it cannot bring one back unnoticed
  assert.equal((await ins({id:'c1',moment_id:'m1',patch:{happened_at:'2025-03-10',happened_end:null},sequence:5})).status,200);
  assert.equal((await ins({id:'c0',moment_id:'m1',patch:{happened_end:'2025-03-01'},sequence:1})).status,200);
  // a correction before a later one that sets a later start is refused
  const low=await ins({id:'c2',moment_id:'m2',patch:{happened_at:'2025-03-10'},sequence:9});
  assert.equal(low.status,400);
  assert.equal((await ins({id:'c3',moment_id:'m2',patch:{happened_end:'2025-03-20'},sequence:9})).status,200);
  const lower=await ins({id:'c4',moment_id:'m2',patch:{happened_at:'2025-04-01'},sequence:2});
  assert.equal(lower.status,400);
  // an update that replaces the patch and drops the end keeps the earlier one
  const replace=await corr({operation:'update',values:{patch:{happened_at:'2025-05-01'}},filters:[['eq','id','c3']]});
  assert.equal(replace.status,400);
  // moving a correction onto another moment is judged there
  const move=await corr({operation:'update',values:{moment_id:'m2',sequence:10},filters:[['eq','id','c0']]});
  assert.equal(move.status,400);
  const byId=Object.fromEntries((await moments(base)).map(m=>[m.id,m]));
  assert.equal(byId.m1.happened_end,null);
  assert.equal(byId.m2.happened_end.slice(0,10),'2025-03-20');
}));
