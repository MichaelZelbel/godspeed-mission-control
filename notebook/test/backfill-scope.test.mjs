import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';

// A person's Enrich (backfill-profile-extraction and -moment- with their
// contact_id and limit 200), the notes page's "Classify unclassified notes"
// (backfill-metadata) and the import's profile step took every note: trashed
// and hidden ones too, the person and the limit ignored, notes done already
// processed and paid for again. The first hidden note stopped the whole run
// with "Source note missing" (7 October 2026).
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-backfill-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store=new Store(root),query=new QueryService(store),seen=[];
  const domains=new Domains(query,{provider:async request=>{seen.push(request.note?.id||request.source?.id);return {suggestions:[],metadata:{type:'idea'},tags:[]};}});
  const note=(title,extra={})=>query.execute({table:'notes',operation:'insert',values:{title,content:title+' has enough words to be processed by the notebook',...extra}}).data[0];
  return {store,query,domains,seen,note};
}

test("a person's Enrich processes only that person's visible, untrashed notes not yet done",async t=>{
  const {query,domains,seen,note}=fixture(t);
  const anna=query.execute({table:'contacts',operation:'insert',values:{name:'Anna'}}).data[0];
  const hidden=note('Hidden about Anna',{contact_id:anna.id,ai_visibility:'hidden'});
  const trashed=note('Trashed about Anna',{contact_id:anna.id,is_trashed:true});
  const linked=note('Linked to Anna');query.execute({table:'person_documents',operation:'insert',values:{contact_id:anna.id,note_id:linked.id}});
  const own=note('Written about Anna',{contact_id:anna.id});
  const other=note('About someone else');
  const done=note('Done about Anna',{contact_id:anna.id});
  await domains.invoke('process-note',{note_id:done.id});seen.length=0;
  const result=await domains.invoke('backfill-profile-extraction',{limit:200,contact_id:anna.id});
  assert.deepEqual(seen.sort(),[linked.id,own.id].sort());
  assert.equal(result.processed,2);
  assert.deepEqual(result.errors,[]);
  for(const id of [hidden.id,trashed.id,other.id])assert.ok(!seen.includes(id));
});

test('the limit is honoured, newest first',async t=>{
  const {domains,seen,note}=fixture(t);
  note('First');await new Promise(r=>setTimeout(r,5));note('Second');await new Promise(r=>setTimeout(r,5));const third=note('Third');
  const result=await domains.invoke('backfill-profile-extraction',{limit:1});
  assert.deepEqual(seen,[third.id]);
  assert.equal(result.processed,1);
  assert.equal(result.remaining,2);
});

test('Classify takes only notes without a type, and one failing note does not stop the rest',async t=>{
  const {store,query,domains,seen,note}=fixture(t);
  note('Typed',{metadata:{type:'meeting'}});
  const broken=note('Broken'),plain=note('Plain');
  const provider=domains.provider;domains.provider=async request=>{if(request.note?.id===broken.id)throw new Error('The model could not read this one');return provider(request);};
  const result=await domains.invoke('backfill-metadata',{});
  assert.deepEqual(seen,[plain.id]);
  assert.equal(result.processed,1);
  assert.deepEqual(result.errors.map(e=>e.id),[broken.id]);
  assert.equal(store.get('notes',plain.id).metadata.type,'idea');
});

test("a person's Enrich of events takes only events they were part of",async t=>{
  const {query,domains,seen}=fixture(t);
  const anna=query.execute({table:'contacts',operation:'insert',values:{name:'Anna'}}).data[0];
  const theirs=query.execute({table:'moments',operation:'insert',values:{title:'Anna wedding',description:'Anna married in Lisbon',happened_at:'2024-05-01'}}).data[0];
  query.execute({table:'moment_participants',operation:'insert',values:{moment_id:theirs.id,person_id:anna.id}});
  query.execute({table:'moments',operation:'insert',values:{title:'Other trip',description:'Went to Rome',happened_at:'2024-06-01'}});
  domains.provider=async request=>{seen.push(request.source?.id);return {suggestions:[]};};
  await domains.invoke('backfill-moment-profile-extraction',{limit:200,contact_id:anna.id});
  assert.deepEqual(seen,[theirs.id]);
});
