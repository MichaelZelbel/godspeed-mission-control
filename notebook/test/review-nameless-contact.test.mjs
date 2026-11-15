import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';

const fixture=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-review-nameless-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const store=new Store(root),query=new QueryService(store),domains=new Domains(query);return {store,query,domains};};
const keep=(domains,id)=>domains.invoke('review-queue-bulk',{action:'keep',scope:{ids:[id]}});

// Issue 154: Keep on an "add this person" suggestion with no usable name wrote a person
// with id review-<uuid> and no name, and the People page then failed on it.
for(const [label,payload] of [['no name',{notes:'met at a fair'}],['an empty name',{name:'  '}],['a name that is not text',{name:42}],['a null name',{name:null}]]){
  test('Keep on an add-person suggestion with '+label+' creates no person',async t=>{
    const {store,query,domains}=fixture(t);
    const item=store.save('review_queue',{suggestion_type:'add_contact',status:'pending_review',payload});
    const result=await keep(domains,item.id);
    assert.deepEqual(query.rows('contacts'),[],'no person was written');
    assert.equal(store.list('contacts').length,0);
    assert.notEqual(store.get('review_queue',item.id).status,'kept');
    assert.equal(result.succeeded,0);
    assert.match(result.errors[0].error,/no name, so it cannot become a person/);
  });
}

test('Keep on an add-alias suggestion cannot nameless-ify a person',async t=>{
  const {store,query,domains}=fixture(t);
  const person=query.execute({table:'contacts',operation:'insert',values:{name:'Ada'}}).data[0];
  const item=store.save('review_queue',{suggestion_type:'add_alias',status:'pending_review',payload:{contact_id:person.id,alias:'Countess'}});
  await keep(domains,item.id);
  assert.equal(query.rows('contacts').every(c=>typeof c.name==='string'&&c.name.trim()),true);
});
