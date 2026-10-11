import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';
import {trackers,entries,proposalState} from '../core/trackers.mjs';

// Trackers, held then created (D-321): "track belly 92" asks once and creates
// nothing; "yes" creates the collection with the 92 in it.
const fixture=()=>{const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-track-ops-'))),query=new QueryService(store);store.save('settings',{id:'installation',timezone:'Europe/Berlin'});return {store,query,domains:new Domains(query)};};
const say=async(domains,message,operations,reply='ok')=>{domains.provider=async()=>({reply,operations:operations.map(o=>({source_quote:message,...o}))});return domains.invoke('conversation-chat',{message,conversation_id:'c1'});};
// A proposal's state is worked out when read, never written back: over MCP an
// assistant may change an existing record only with its current hash, and a
// "yes" names no hash.
const state=(store,p)=>proposalState(store,store.get('tracker_proposals',p.id),new Date());

test('an unknown name is held and asked about, and nothing is created',async()=>{
  const {store,domains}=fixture();
  const r=await say(domains,'track belly 92',[{type:'tracker-hold',name:'Belly',unit:'cm',value:92,talk:'health'}]);
  assert.equal(trackers(store).length,0);
  const [p]=store.list('tracker_proposals');assert.equal(state(store,p),'pending');assert.equal(p.entry.data.value,92);
  assert.match(r.operation_results[0].reply,/^Start a new tracker called Belly, one number in cm, once a day\? I've kept the 92 for today\.$/);
});

test('yes creates the tracker with the held entry, and says how to use it',async()=>{
  const {store,domains}=fixture();
  await say(domains,'track belly 92',[{type:'tracker-hold',name:'Belly',unit:'cm',value:92,talk:'health'}]);
  const [p]=store.list('tracker_proposals');
  const r=await say(domains,'yes',[{type:'tracker-create',proposal_id:p.id}]);
  const [c]=trackers(store);assert.equal(c.name,'Belly');assert.equal(c.tracker.cadence,'daily');
  assert.deepEqual(entries(store,c).map(i=>i.data.value),[92]);
  assert.equal(state(store,p),'created');
  assert.equal(r.operation_results[0].reply,'Tracked: Belly 92 cm. From now on just say "track belly" and the number. Your health talk will read it.');
});

test('asking again replaces the earlier question, which can no longer be answered',async()=>{
  const {store,domains}=fixture();
  await say(domains,'track belly 92',[{type:'tracker-hold',name:'Belly',unit:'cm',value:92}]);
  const [first]=store.list('tracker_proposals');
  await say(domains,'track Belly 93',[{type:'tracker-hold',name:'Belly',unit:'cm',value:93}]);
  assert.equal(state(store,first),'dropped');
  await assert.rejects(say(domains,'yes',[{type:'tracker-create',proposal_id:first.id}]),/expired/);
  assert.equal(trackers(store).length,0);
});

test('yes after a day, or with no question, creates nothing',async()=>{
  const {store,domains}=fixture();
  await say(domains,'track belly 92',[{type:'tracker-hold',name:'Belly',unit:'cm',value:92}]);
  const [p]=store.list('tracker_proposals');
  // A frozen clock 25 hours on (the coach's clock reads GODSPEED_NOW).
  process.env.GODSPEED_NOW=new Date(Date.now()+25*3600000).toISOString();
  try{
    assert.equal(proposalState(store,p,new Date(process.env.GODSPEED_NOW)),'expired');
    await assert.rejects(say(domains,'yes',[{type:'tracker-create',proposal_id:p.id}]),/expired/);
  }finally{delete process.env.GODSPEED_NOW;}
  await assert.rejects(say(domains,'yes',[{type:'tracker-create',proposal_id:'tracker-proposals-missing'}]),/expired/);
  assert.equal(trackers(store).length,0);
});

test('yes with a change takes the change',async()=>{
  const {store,domains}=fixture();
  await say(domains,'track belly 92',[{type:'tracker-hold',name:'Belly',unit:'cm',value:92}]);
  const [p]=store.list('tracker_proposals');
  await say(domains,'yes, but call it Waist',[{type:'tracker-create',proposal_id:p.id,name:'Waist'}]);
  assert.equal(trackers(store)[0].name,'Waist');assert.deepEqual(entries(store,trackers(store)[0]).map(i=>i.data.value),[92]);
});

test('setting one up on purpose makes the columns and no entry',async()=>{
  const {store,domains}=fixture();
  const message='I want to track my sleep: hours and quality 1 to 5';
  await say(domains,message,[{type:'tracker-create',name:'Sleep',fields:[{key:'hours',label:'Hours',type:'number'},{key:'quality',label:'Quality',type:'number'}],talk:'health'}]);
  const [c]=trackers(store);assert.deepEqual(c.field_schema.map(f=>f.key),['when','hours','quality','note']);assert.equal(entries(store,c).length,0);
});

test('a number he did not say, a future day, or a quoted track writes nothing',async()=>{
  const {store,domains}=fixture();
  await assert.rejects(say(domains,'track belly 92',[{type:'tracker-hold',name:'Belly',unit:'cm',value:29}]),/you said/);
  await assert.rejects(say(domains,'track belly 92',[{type:'tracker-hold',name:'Belly',unit:'cm',value:9}]),/you said/);
  await assert.rejects(say(domains,'track belly tomorrow 90',[{type:'tracker-hold',name:'Belly',unit:'cm',value:90,on:'2099-01-01'}]),/future/);
  await assert.rejects(say(domains,'track belly 90',[{type:'tracker-hold',name:'Belly',unit:'cm',value:90,on:'2026-10-01'}]),/which day/);
  await assert.rejects(say(domains,'if I said track belly 92, what would happen?',[{type:'tracker-hold',name:'Belly',unit:'cm',value:92}]),/explicit request/);
  await assert.rejects(say(domains,"don't track belly 92",[{type:'tracker-hold',name:'Belly',unit:'cm',value:92}]),/explicit request/);
  assert.equal(store.list('tracker_proposals').length,0);
});

test('a German decimal comma is the number he said',async()=>{
  const {store,domains}=fixture();
  await say(domains,'track Bauch 92,5',[{type:'tracker-hold',name:'Bauch',unit:'cm',value:92.5}]);
  const [p]=store.list('tracker_proposals');assert.equal(p.entry.data.value,92.5);
});
