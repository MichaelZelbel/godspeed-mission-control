import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createService} from '../server/main.mjs';
import {Store,envelopeFields} from '../core/records/store.mjs';

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

// Issue 950: an update or delete whose filter could never pick a record used
// to answer 200 with count 0 and change nothing, so a typo in a field name
// looked the same as "no record matched". Each fault is now refused with 400,
// the way the no-filter refusal above is, while a well-formed filter that
// simply matches nothing keeps answering 200.
test('a filter on a field the kind does not have is refused with 400 and changes nothing',async()=>{
  const service=await createService({root:root(),port:0}),base='http://127.0.0.1:'+service.address.port;
  try{
    await post(base,{table:'contacts',operation:'insert',values:[{name:'Ana'},{name:'Bo'}]});
    const renamed=await post(base,{table:'contacts',operation:'update',values:{name:'Overwritten'},filters:[['eq','nme','Ana']]});
    assert.equal(renamed.status,400);
    assert.match((await renamed.json()).error,/contacts has no field "nme"/);
    const removed=await post(base,{table:'contacts',operation:'delete',filters:[['eq','nme','Ana']]});
    assert.equal(removed.status,400);
    assert.match((await removed.json()).error,/contacts has no field "nme"/);
    // A typo in a JSON path is judged by its head column.
    const byPath=await post(base,{table:'contacts',operation:'update',values:{name:'Overwritten'},filters:[['eq','metadat->>x','1']]});
    assert.equal(byPath.status,400);
    assert.match((await byPath.json()).error,/contacts has no field "metadat"/);
    // The fields an or() expression names are judged the same way.
    const byOr=await post(base,{table:'contacts',operation:'delete',filters:[['or','','nme.eq.Ana,name.eq.Bo']]});
    assert.equal(byOr.status,400);
    assert.match((await byOr.json()).error,/contacts has no field "nme"/);
    // A name Object.prototype carries is not a field of the kind either.
    const byPrototype=await post(base,{table:'contacts',operation:'update',values:{name:'Overwritten'},filters:[['eq','toString','x']]});
    assert.equal(byPrototype.status,400);
    assert.match((await byPrototype.json()).error,/contacts has no field "toString"/);
    const left=await people(base);
    assert.deepEqual(left.map(c=>c.name).sort(),['Ana','Bo'],'nothing was changed');
  }finally{await service.close();}
});

test('a filter clause with no value is refused with 400 and changes nothing',async()=>{
  const service=await createService({root:root(),port:0}),base='http://127.0.0.1:'+service.address.port;
  try{
    await post(base,{table:'contacts',operation:'insert',values:[{name:'Ana'},{name:'Bo'}]});
    const noValue=await post(base,{table:'contacts',operation:'update',values:{name:'Overwritten'},filters:[['eq','id']]});
    assert.equal(noValue.status,400);
    assert.match((await noValue.json()).error,/missing its value/);
    const notNoValue=await post(base,{table:'contacts',operation:'update',values:{name:'Overwritten'},filters:[['not','name',['eq']]]});
    assert.equal(notNoValue.status,400);
    assert.match((await notNoValue.json()).error,/missing its value/);
    const left=await people(base);
    assert.deepEqual(left.map(c=>c.name).sort(),['Ana','Bo'],'nothing was changed');
  }finally{await service.close();}
});

test('a filter with an empty or null value is refused with 400 and changes nothing',async()=>{
  const service=await createService({root:root(),port:0}),base='http://127.0.0.1:'+service.address.port;
  try{
    await post(base,{table:'contacts',operation:'insert',values:[{name:'Ana'},{name:'Bo'}]});
    for(const filter of [['eq','id',''],['eq','id',null],['in','id',null],['not','name',['eq',null]],['neq','name','']]){
      const empty=await post(base,{table:'contacts',operation:'update',values:{name:'Overwritten'},filters:[filter]});
      assert.equal(empty.status,400,JSON.stringify(filter));
      assert.match((await empty.json()).error,/empty value/);
    }
    // ["and","",""] used to match every record: an empty and() answered true,
    // so this one clause rewrote the whole kind and slipped past the no-filter
    // refusal (issue 936).
    const andEmpty=await post(base,{table:'contacts',operation:'update',values:{name:'Overwritten'},filters:[['and','','']]});
    assert.equal(andEmpty.status,400);
    assert.match((await andEmpty.json()).error,/empty value/);
    const left=await people(base);
    assert.deepEqual(left.map(c=>c.name).sort(),['Ana','Bo'],'nothing was changed');
  }finally{await service.close();}
});

test('one faulty clause beside valid ones refuses the whole request',async()=>{
  const service=await createService({root:root(),port:0}),base='http://127.0.0.1:'+service.address.port;
  try{
    await post(base,{table:'contacts',operation:'insert',values:[{name:'Ana'},{name:'Bo'}]});
    const ana=(await people(base)).find(c=>c.name==='Ana');
    for(const filters of [[['eq','id',ana.id],['eq','nme','x']],[['eq','id',ana.id],['eq','name','']],[['eq','id',ana.id],['eq','name']]]){
      const refused=await post(base,{table:'contacts',operation:'update',values:{name:'Overwritten'},filters});
      assert.equal(refused.status,400,JSON.stringify(filters));
    }
    const left=await people(base);
    assert.deepEqual(left.map(c=>c.name).sort(),['Ana','Bo'],'nothing was changed');
  }finally{await service.close();}
});

test('well-formed filters still update and delete the records they match',async()=>{
  const service=await createService({root:root(),port:0}),base='http://127.0.0.1:'+service.address.port;
  try{
    await post(base,{table:'contacts',operation:'insert',values:[{name:'Ana'},{name:'Bo'}]});
    const ana=(await people(base)).find(c=>c.name==='Ana');
    const renamed=await post(base,{table:'contacts',operation:'update',values:{name:'Ana Renamed'},filters:[['eq','id',ana.id]]});
    assert.equal(renamed.status,200);
    assert.equal((await renamed.json()).data.length,1);
    // Null is the value "is" is for, and a "not" may wrap one; both stay accepted.
    for(const filters of [[['is','removed_at',null],['eq','id',ana.id]],[['not','name',['is',null]],['eq','id',ana.id]]]){
      const isNull=await post(base,{table:'contacts',operation:'update',values:{name:'Ana Renamed'},filters});
      assert.equal(isNull.status,200,JSON.stringify(filters));
    }
    // An empty in-list is a well-formed "none of these", not an empty value.
    const none=await post(base,{table:'contacts',operation:'update',values:{name:'No one'},filters:[['in','id',[]]]});
    assert.equal(none.status,200);
    assert.deepEqual((await none.json()).data,[]);
    const removed=await post(base,{table:'contacts',operation:'delete',filters:[['eq','name','Bo']]});
    assert.equal(removed.status,200);
    assert.equal((await removed.json()).data.length,1);
    const left=await people(base);
    assert.deepEqual(left.map(c=>c.name),['Ana Renamed']);
  }finally{await service.close();}
});

test('a schema column no record has set yet still answers a well-formed no-match with 200',async()=>{
  const service=await createService({root:root(),port:0}),base='http://127.0.0.1:'+service.address.port;
  try{
    // The refusal side, on a kind with no records: a typo in a real column is
    // still judged, by the schema alone (a silent parse failure there would
    // restore the 200/count-0 bug this refuses).
    const typo=await post(base,{table:'contact_group_memberships',operation:'delete',filters:[['eq','grp_id','no-such-group']]});
    assert.equal(typo.status,400);
    assert.match((await typo.json()).error,/contact_group_memberships has no field "grp_id"/);
    // The shape CollectionDetail.tsx (collection_id) and ReviewQueue.tsx
    // (moment_id) delete by: a real column the schema knows and no row carries.
    const removed=await post(base,{table:'contact_group_memberships',operation:'delete',filters:[['eq','group_id','no-such-group']]});
    assert.equal(removed.status,200);
    assert.deepEqual((await removed.json()).data,[]);
  }finally{await service.close();}
});

test('a kind the schema does not know is judged by its rows once it holds one',async()=>{
  const service=await createService({root:root(),port:0}),base='http://127.0.0.1:'+service.address.port;
  try{
    await post(base,{table:'record_history',operation:'insert',values:{record_id:'r1'}});
    const typo=await post(base,{table:'record_history',operation:'update',values:{record_id:'r2'},filters:[['eq','recrd_id','r1']]});
    assert.equal(typo.status,400);
    assert.match((await typo.json()).error,/record_history has no field "recrd_id"/);
    const read=await post(base,{table:'record_history',operation:'select'});
    assert.deepEqual((await read.json()).data.map(r=>r.record_id),['r1'],'nothing was changed');
    const renamed=await post(base,{table:'record_history',operation:'update',values:{record_id:'r2'},filters:[['eq','record_id','r1']]});
    assert.equal(renamed.status,200);
  }finally{await service.close();}
});

test('empty kinds with fields declared by their writers refuse an unknown field',async()=>{
  const service=await createService({root:root(),port:0}),base='http://127.0.0.1:'+service.address.port;
  try{
    for(const table of ['comments','goals','note_conversations'])for(const operation of ['update','delete']){
      const body={table,operation,filters:[['eq','titel','x']]};
      if(operation==='update')body.values={title:'Not written'};
      const response=await post(base,body);
      assert.equal(response.status,400,table+' '+operation);
      assert.match((await response.json()).error,new RegExp(table+' has no field "titel"'));
    }
  }finally{await service.close();}
});

test('documented and computed note fields remain well-formed no-match filters when unset',async()=>{
  const service=await createService({root:root(),port:0}),base='http://127.0.0.1:'+service.address.port;
  try{
    for(const field of ['skip_processing','content_preview']){
      const response=await post(base,{table:'notes',operation:'update',values:{title:'Not written'},filters:[['eq',field,'not-set']]});
      assert.equal(response.status,200,field);
      assert.deepEqual((await response.json()).data,[]);
    }
  }finally{await service.close();}
});

test('a nested expression that is true for every record is refused with 400 and changes nothing',async()=>{
  const service=await createService({root:root(),port:0}),base='http://127.0.0.1:'+service.address.port;
  try{
    await post(base,{table:'contacts',operation:'insert',values:[{name:'Ana'},{name:'Bo'}]});
    // An empty and() and an empty not.or() answer true for every row, and a
    // not over an empty in-list turns "none of these" into "all of them":
    // like ["and","",""], each would rewrite or wipe the whole kind.
    for(const filter of [['or','','and()'],['and','','and()'],['or','','not.or()'],['and','','not.or()'],['not','name',['in',[]]]]){
      const vacuous=await post(base,{table:'contacts',operation:'update',values:{name:'Overwritten'},filters:[filter]});
      assert.equal(vacuous.status,400,JSON.stringify(filter));
      assert.match((await vacuous.json()).error,/empty value/);
    }
    const left=await people(base);
    assert.deepEqual(left.map(c=>c.name).sort(),['Ana','Bo'],'nothing was changed');
  }finally{await service.close();}
});

test('a filter part the grammar cannot read is refused even when the kind holds no records',async()=>{
  const service=await createService({root:root(),port:0}),base='http://127.0.0.1:'+service.address.port;
  try{
    // filterExpression and condition read these per row, so on a kind with no
    // records nothing used to refuse them and the request answered 200.
    for(const filter of [['or','','nameeqAna'],['not','name',['q','x']]]){
      const unreadable=await post(base,{table:'contacts',operation:'delete',filters:[filter]});
      assert.equal(unreadable.status,400,JSON.stringify(filter));
    }
    await post(base,{table:'contacts',operation:'insert',values:[{name:'Ana'}]});
    for(const filter of [['or','','nameeqAna'],['not','name',['q','x']]]){
      const unreadable=await post(base,{table:'contacts',operation:'delete',filters:[filter]});
      assert.equal(unreadable.status,400,JSON.stringify(filter));
    }
    const left=await people(base);
    assert.deepEqual(left.map(c=>c.name),['Ana'],'nothing was changed');
  }finally{await service.close();}
});

test('the envelope field list is exactly what records/store.mjs writes',()=>{
  const self={device:'test'},record=Store.prototype.prepare.call(self,'contacts',{}),tombstone=Store.prototype.purgeRecord.call(self,record);
  const written=new Set([...Object.keys(record),...Object.keys(tombstone)].filter(k=>k!=='purged'));
  assert.deepEqual([...envelopeFields].sort(),[...written].sort());
});

test('reads keep every filter they accepted before',async()=>{
  const service=await createService({root:root(),port:0}),base='http://127.0.0.1:'+service.address.port;
  try{
    await post(base,{table:'contacts',operation:'insert',values:[{name:'Ana'}]});
    for(const filters of [['eq','nme','x'],['eq','id'],['eq','id','']]){
      const read=await post(base,{table:'contacts',operation:'select',filters:[filters]});
      assert.equal(read.status,200,JSON.stringify(filters));
      assert.deepEqual((await read.json()).data,[]);
    }
  }finally{await service.close();}
});

test('or/and text inside a not gets the same refusals as top-level text, and a not inside a not is accepted',async()=>{
  const service=await createService({root:root(),port:0}),base='http://127.0.0.1:'+service.address.port;
  try{
    const refused=[['not','name',['or','not.and()']],['not','name',['and','not.and()']],['not','name',['or','or()']],['not','name',['and','or()']],
      ['not','name',['or','and(not.or(name.eq.x),or())']],['not','id',['and','or()']],['not','id',['and','id.in.()']],
      ['not','name',['or','recrd_id.eq.1']],['not','name',['or','nameeqAna']],['not','name',['not',['in',[]]]]];
    for(const empty of [true,false]){
      if(!empty)await post(base,{table:'contacts',operation:'insert',values:[{name:'Ana'},{name:'Bo'}]});
      for(const filter of refused){
        const r=await post(base,{table:'contacts',operation:'update',values:{name:'Wiped'},filters:[filter]});
        assert.equal(r.status,400,JSON.stringify(filter)+(empty?' (empty kind)':''));
      }
    }
    assert.deepEqual((await people(base)).map(c=>c.name).sort(),['Ana','Bo'],'nothing was changed');
    // A well-formed double not still updates, like on main.
    const ok=await post(base,{table:'contacts',operation:'update',values:{name:'Ann'},filters:[['not','name',['not',['eq','Ana']]]]});
    assert.equal(ok.status,200);
    assert.deepEqual((await people(base)).map(c=>c.name).sort(),['Ann','Bo']);
    // A well-formed or inside a not that matches nothing stays a 200.
    const none=await post(base,{table:'contacts',operation:'update',values:{name:'X'},filters:[['not','name',['or','name.eq.Bo,name.eq.Ann']]]});
    assert.equal(none.status,200);
  }finally{await service.close();}
});

test('a not.in over an empty list in or/and text is refused',async()=>{
  const service=await createService({root:root(),port:0}),base='http://127.0.0.1:'+service.address.port;
  try{
    for(const filter of [['or','','id.not.in.()'],['and','','id.not.in.()']]){
      const r=await post(base,{table:'contacts',operation:'delete',filters:[filter]});
      assert.equal(r.status,400,JSON.stringify(filter));
    }
  }finally{await service.close();}
});
