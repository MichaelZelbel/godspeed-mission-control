import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {Domains} from '../core/domains.mjs';
import {procedure} from '../core/procedures.mjs';
import {headacheTracker} from '../core/native-personal.mjs';

// Headaches have one owner, the Headaches tracker (D-321, step 3). Every reader inside the notebook
// moves with them: the health rows the morning brief and the health summary read come from the
// tracker's rows, and a change made in its table is what they read next.
const fixture=()=>{const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-headache-readers-'))),query=new QueryService(store);store.save('settings',{id:'installation',timezone:'Europe/Berlin'});return {store,query,domains:new Domains(query)};};
const say=(domains,message)=>domains.invoke('conversation-chat',{conversation_id:'c1',message});

test('the notebook\'s health rows and its health summary read the Headaches tracker',async()=>{
  const {store,query,domains}=fixture();
  await say(domains,'/headache start --pain 3 --side right --med "Ibuprofen: 400 mg" --words "Fictional headache"');
  const tracker=headacheTracker(store);assert.ok(tracker,'the first headache starts the tracker');
  assert.equal(tracker.tracker.specialist,'headache');assert.equal(tracker.tracker.talk,'health');
  const [row]=store.list('collection_items').filter(i=>i.collection_id===tracker.id);
  assert.equal(row.data.side,'right');assert.equal(row.data.medication.startsWith('Ibuprofen: 400 mg at '),true);
  assert.equal(fs.existsSync(path.join(store.root,'routines','headache','entries')),false,'no entry file');
  // The add-on wrote these files itself: the notebook reads them as its own, with nothing to fix.
  store.scan(true);assert.deepEqual(store.problems,[]);
  assert.equal(store.file(row),path.join(store.recordsRoot,'Collections','Headaches',row.title.replace(':','')+'.md'));
  assert.deepEqual(row.references,[{type:'collections',id:tracker.id,uid:tracker.uid,field:'collection_id'}]);
  const [episode]=query.rows('health_episodes');assert.equal(episode.pain_max,3);assert.equal(episode.open,true);assert.equal(episode.native_file,'notebook/Collections');
  assert.equal(query.rows('medications').length,1);
  assert.ok((await procedure({id:'health-summary',kind:'health-summary'},{store,query})).verified);
  const summary=JSON.parse(query.rows('notes').find(n=>n.source_app==='health-summary').content);
  assert.equal(summary.headaches_last_30_days,1);assert.equal(summary.medication_days_last_30_days,1);
  // He changes the row in the notebook's table: the strongest pain is now 6, and it is over.
  query.execute({table:'collection_items',operation:'update',values:{data:{...row.data,pain:6,end:row.data.when}},filters:[['eq','id',row.id]]});
  const [changed]=query.rows('health_episodes');assert.equal(changed.pain_max,6);assert.equal(changed.open,false);
  await say(domains,'/headache cancel');
  assert.equal(query.rows('health_episodes').length,0);assert.equal(store.list('collection_items').filter(i=>i.collection_id===tracker.id).length,0);
});
