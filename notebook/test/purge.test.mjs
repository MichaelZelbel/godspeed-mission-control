import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';

// A purge leaves nothing of a record in the notebook (D-321, the cycle tracker's "delete my cycle
// tracker"). An ordinary delete keeps the whole record in its tombstone and every earlier version in
// _system/record_history, which is right for most records and wrong for data the person asked to
// be gone. A tombstone marked purged carries no data, gets no history copy, and the history copies
// of that record go with it.
const files=root=>{const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);return walk(root);};
const holding=(root,word)=>files(root).filter(f=>fs.readFileSync(f,'utf8').includes(word)).map(f=>path.relative(root,f).replaceAll('\\','/'));
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-purge-')),store=new Store(root),query=new QueryService(store);
 const c=query.execute({table:'collections',operation:'insert',values:{name:'Private diary',field_schema:[{key:'when',label:'Day',type:'date',primary:true},{key:'what',label:'What',type:'text'}]}}).data[0];
 const i=query.execute({table:'collection_items',operation:'insert',values:{collection_id:c.id,data:{when:'2026-10-01',what:'firstsecret'}}}).data[0];
 query.execute({table:'collection_items',operation:'update',values:{data:{when:'2026-10-01',what:'secondsecret'}},filters:[['eq','id',i.id]]});
 query.execute({table:'collection_items',operation:'update',values:{data:{when:'2026-10-01',what:'thirdsecret'}},filters:[['eq','id',i.id]]});
 return {root,store,query,c,i};
}

test('a purged record leaves no copy of what it held anywhere in the notebook',()=>{
 const {root,store,c,i}=fixture();
 assert.ok(holding(root,'firstsecret').some(f=>f.includes('record_history')),'an earlier version is kept until the purge');
 store.withLock(()=>store.commit([store.purgeRecord(store.get('collection_items',i.id)),store.purgeRecord(store.get('collections',c.id))]));
 for(const word of ['firstsecret','secondsecret','thirdsecret','Private diary'])assert.deepEqual(holding(root,word).filter(f=>!f.startsWith('.godspeed/')),[],word+' is gone');
 assert.equal(store.list('collection_items').some(r=>r.id===i.id),false);
 const tomb=store.list('collection_items',{removed:true}).find(r=>r.id===i.id);
 assert.ok(tomb.removed_at&&tomb.purged===true&&tomb.data===undefined,'a tombstone that holds no data');
 assert.equal(store.list('record_history').filter(h=>[i.uid,c.uid].includes(h.source_uid)).length,0);
 // A fresh read of the folder sees the same.
 const again=new Store(root);assert.equal(again.list('collection_items').some(r=>r.id===i.id),false);assert.equal(again.get('collection_items',i.id).purged,true);assert.equal(again.list('record_history').filter(h=>h.source_uid===i.uid).length,0);
});

test('an ordinary delete is unchanged: its history stays',()=>{
 const {root,query,i}=fixture();
 query.execute({table:'collection_items',operation:'delete',filters:[['eq','id',i.id]]});
 assert.ok(holding(root,'firstsecret').some(f=>f.includes('record_history')));
 assert.ok(holding(root,'thirdsecret').length>0);
});

test('a purge staged in a transaction is a purge when it is published',()=>{
 const {root,store,c,i}=fixture();
 store.transaction(view=>{view.commit([view.purgeRecord(view.get('collection_items',i.id)),view.purgeRecord(view.get('collections',c.id))]);});
 for(const word of ['firstsecret','secondsecret','thirdsecret'])assert.deepEqual(holding(root,word).filter(f=>!f.startsWith('.godspeed/')),[],word+' is gone');
});
