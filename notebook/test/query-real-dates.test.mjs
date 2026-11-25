import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createService} from '../server/main.mjs';
import {Store} from '../core/records/store.mjs';
import {Domains} from '../core/domains.mjs';
import {QueryService} from '../core/query.mjs';

// Issue 1125: a date that does not exist was stored from any client.
const post=(base,body)=>fetch(base+'/api/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const rows=async(base,table)=>(await (await post(base,{table})).json()).data;
const withService=async run=>{
  const service=await createService({root:fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-real-dates-')),port:0});
  try{await run('http://127.0.0.1:'+service.address.port);}finally{await service.close();}
};
const BAD=['2026-02-30','2026-04-31','2026-13-05','2026-03-05 25:00','soon'];
const refused=async(base,table,body,field,value)=>{
  const before=JSON.stringify(await rows(base,table)),r=await post(base,{table,operation:'insert',...body});
  assert.equal(r.status,400,field+' '+value);
  const {error}=await r.json();assert.ok(error.includes(field)&&error.includes(value),error);
  assert.equal(JSON.stringify(await rows(base,table)),before);
};
const collection=async(base,field_schema)=>{
  const r=await post(base,{table:'collections',operation:'insert',values:{id:'c1',name:'Things',field_schema}});assert.equal(r.status,200);
};

test('a moment, a collection item, a tracker row and a fact refuse each date that does not exist',()=>withService(async base=>{
  await collection(base,[{key:'name',label:'Name',type:'text',primary:true},{key:'on',label:'Day',type:'date'},{key:'at',label:'At',type:'datetime'},{key:'when',label:'when',type:'date'}]);
  for(const value of BAD){
    await refused(base,'moments',{values:{title:'x',happened_at:value}},'happened_at',value);
    await refused(base,'moments',{values:{title:'x',happened_at:'2026-03-01',happened_end:value}},'happened_end',value);
    await refused(base,'collection_items',{values:{collection_id:'c1',data:{name:'a',on:value}}},'Day (on)',value);
    await refused(base,'collection_items',{values:{collection_id:'c1',data:{name:'a',at:value}}},'At (at)',value);
    await refused(base,'collection_items',{values:{collection_id:'c1',data:{name:'a',when:value}}},'when',value);
    await refused(base,'claims',{values:{attribute:'favourite',value:'tea',valid_from:value}},'valid_from',value);
    await refused(base,'claims',{values:{attribute:'favourite',value:'tea',valid_to:value}},'valid_to',value);
    await refused(base,'claims',{values:{subject_type:'entity',subject_id:'e1',attribute:'founded',value:'x',valid_from:value}},'valid_from',value);
    for(const attribute of ['date-of-birth','birthday'])await refused(base,'claims',{values:{attribute,value}},'value',value);
  }
}));

test('updates and upserts refuse a bad date and keep the stored one',()=>withService(async base=>{
  assert.equal((await post(base,{table:'moments',operation:'insert',values:{id:'m1',title:'T',happened_at:'2026-03-01'}})).status,200);
  assert.equal((await post(base,{table:'claims',operation:'insert',values:{id:'k1',attribute:'favourite',value:'tea',valid_from:'2026-03-01'}})).status,200);
  for(const body of [
    {table:'moments',operation:'update',values:{happened_at:'2026-02-30'},filters:[['eq','id','m1']]},
    {table:'moments',operation:'upsert',values:{id:'m1',happened_at:'soon'}},
    {table:'event_corrections',operation:'insert',values:{moment_id:'m1',sequence:5,patch:{happened_at:'2026-04-31'}}},
    {table:'claims',operation:'update',values:{valid_from:'2026-02-30'},filters:[['eq','id','k1']]},
    {table:'claims',operation:'upsert',values:{id:'k1',valid_to:'soon'}},
  ])assert.equal((await post(base,body)).status,400,JSON.stringify(body));
  assert.equal((await rows(base,'moments'))[0].happened_at.slice(0,10),'2026-03-01');
  assert.equal((await rows(base,'claims'))[0].valid_from,'2026-03-01');
  assert.equal((await rows(base,'event_corrections')).length,0);
}));

test('a batch with one bad date stores no row',()=>withService(async base=>{
  const r=await post(base,{table:'moments',operation:'insert',values:[{title:'ok',happened_at:'2026-03-01'},{title:'bad',happened_at:'2026-02-30'}]});
  assert.equal(r.status,400);assert.deepEqual(await rows(base,'moments'),[]);
  assert.equal((await post(base,{table:'moments',operation:'insert',values:[{title:'a',happened_at:'2026-03-01'},{title:'b',happened_at:'2028-02-29'}]})).status,200);
  assert.equal((await rows(base,'moments')).length,2);
}));

test('real dates in the forms already accepted, 29 February 2028 and empty optional values are stored',()=>withService(async base=>{
  await collection(base,[{key:'name',label:'Name',type:'text',primary:true},{key:'on',label:'Day',type:'date'},{key:'at',label:'At',type:'datetime'}]);
  for(const happened_at of ['2028-02-29','2026-02-28','2026-10-11T06:30','2026-10-11 00:00:00+02:00'])
    assert.equal((await post(base,{table:'moments',operation:'insert',values:{title:'x',happened_at,happened_end:''}})).status,200,happened_at);
  assert.equal((await post(base,{table:'moments',operation:'insert',values:{title:'x',happened_at:'2026-02-29'}})).status,400);
  for(const data of [{name:'a',on:'2028-02-29',at:'2026-10-11T06:30'},{name:'b',on:'',at:'2026-10-11 06:30'},{name:'c'}])
    assert.equal((await post(base,{table:'collection_items',operation:'insert',values:{collection_id:'c1',data}})).status,200);
  for(const [attribute,value] of [['date-of-birth','1 May'],['birthday','1990-05-01'],['born','29 Feb']])
    assert.equal((await post(base,{table:'claims',operation:'insert',values:{attribute,value}})).status,200,value);
  assert.equal((await post(base,{table:'claims',operation:'insert',values:{attribute:'favourite',value:'tea',valid_from:'2026-03-01'}})).status,200);
}));

test('a moment stored with a bad date before the rule still takes a change that leaves it alone',async()=>{
  const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-real-dates-')),{device:'pc'});
  store.save('moments',{id:'old',title:'Old',happened_at:'soon'});
  const query=new QueryService(store);
  await query.executeAsync({table:'moments',operation:'update',values:{title:'Renamed'},filters:[['eq','id','old']]});
  assert.equal(query.rows('moments').find(m=>m.id==='old').title,'Renamed');
});

test('a collection item and a claim stored with a bad date before the rule take a change that leaves it alone, not a change to another bad date',async()=>{
  const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-real-dates-')),{device:'pc'});
  store.save('collections',{id:'c1',name:'Things',field_schema:[{key:'name',label:'Name',type:'text',primary:true},{key:'on',label:'Day',type:'date'}]});
  store.save('collection_items',{id:'i1',collection_id:'c1',data:{name:'a',on:'2026-02-30'}});
  store.save('claims',{id:'k1',attribute:'favourite',value:'tea',valid_from:'2026-02-30'});
  const query=new QueryService(store);
  await query.executeAsync({table:'collection_items',operation:'update',values:{data:{name:'b',on:'2026-02-30'}},filters:[['eq','id','i1']]});
  await query.executeAsync({table:'claims',operation:'update',values:{value:'coffee'},filters:[['eq','id','k1']]});
  assert.equal(query.rows('collection_items').find(r=>r.id==='i1').data.on,'2026-02-30');
  assert.equal(query.rows('claims').find(r=>r.id==='k1').value,'coffee');
  await assert.rejects(query.executeAsync({table:'collection_items',operation:'update',values:{data:{name:'b',on:'2026-04-31'}},filters:[['eq','id','i1']]}),/2026-04-31/);
  await assert.rejects(query.executeAsync({table:'claims',operation:'update',values:{valid_from:'2026-04-31'},filters:[['eq','id','k1']]}),/2026-04-31/);
});

test('writeFact refuses a date that does not exist',()=>{
  const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-real-dates-')),{device:'pc'});
  const domains=new Domains(new QueryService(store));
  assert.throws(()=>domains.writeFact({label:'Likes',value:'tea',valid_from:'2026-02-30'}),/valid_from.*2026-02-30/);
  assert.throws(()=>domains.writeFact({attribute:'date-of-birth',value:'soon'}),/"soon"/);
  assert.doesNotThrow(()=>domains.writeFact({label:'Likes',value:'tea',valid_from:'2026-03-01'}));
});
