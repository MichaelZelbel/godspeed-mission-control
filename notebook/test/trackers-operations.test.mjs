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

test('a tracker names its coaching talk by the area\'s own name, and nothing else',async()=>{
  const {store,domains}=fixture();
  const r=await say(domains,'I want to track invoices sent',[{type:'tracker-create',name:'Invoices',unit:'invoices',talk:'work'}]);
  assert.match(r.operation_results[0].reply,/Your work talk will read it\.$/);assert.equal(trackers(store)[0].tracker.talk,'work');
  await assert.rejects(say(domains,'I want to track naps',[{type:'tracker-create',name:'Naps',unit:'min',talk:'../health'}]),/coaching talk/);
});

test('a German decimal comma is the number he said',async()=>{
  const {store,domains}=fixture();
  await say(domains,'track Bauch 92,5',[{type:'tracker-hold',name:'Bauch',unit:'cm',value:92.5}]);
  const [p]=store.list('tracker_proposals');assert.equal(p.entry.data.value,92.5);
});

const withBelly=async()=>{const f=fixture();await say(f.domains,'track belly 92',[{type:'tracker-hold',name:'Belly',unit:'cm',value:92,talk:'health'}]);const [p]=f.store.list('tracker_proposals');await say(f.domains,'yes',[{type:'tracker-create',proposal_id:p.id}]);return {...f,belly:trackers(f.store)[0]};};

test('the next entry asks nothing and answers with the change',async()=>{
  const {store,domains,belly}=await withBelly();
  const first=entries(store,belly)[0];store.save('collection_items',{...first,data:{...first.data,when:'2026-10-05'},title:'2026-10-05'},first._hash);
  const r=await say(domains,'track belly 91',[{type:'track',tracker:belly.id,value:91}]);
  assert.match(r.operation_results[0].reply,/^Tracked: 91 cm, down 1 since \w+( \w+)?\.$/);
  assert.equal(entries(store,belly).length,2);assert.equal(store.list('tracker_proposals').filter(p=>proposalState(store,p,new Date())==='pending').length,0);
});

test('a second entry on the same day replaces the first',async()=>{
  const {store,domains,belly}=await withBelly();
  const r=await say(domains,'track belly 91',[{type:'track',tracker:belly.id,value:91}]);
  assert.equal(r.operation_results[0].reply,"Today's 92 cm is now 91 cm.");assert.deepEqual(entries(store,belly).map(i=>i.data.value),[91]);
  assert.equal(r.operation_results[0].replaced,true);
});

test('another word for a tracker lands in it, says so, and is remembered',async()=>{
  const {store,domains,belly}=await withBelly();
  const r=await say(domains,'track waist 90 yesterday',[{type:'track',tracker:belly.id,value:90,new_name:'Waist',on:new Date(Date.now()-86400000).toISOString().slice(0,10)}]);
  assert.match(r.operation_results[0].reply,/^Tracked under Belly: 90 cm\.$/);assert.deepEqual(store.get('collections',belly.id).tracker.names,['Belly','Waist']);
  await assert.rejects(say(domains,'track belly 89',[{type:'track',tracker:belly.id,value:89,new_name:'Bauch'}]),/one you used/);
});

test('a correction changes exactly the last entry, and a delete removes exactly one',async()=>{
  const {store,domains,belly}=await withBelly();
  const r=await say(domains,'that was 91, not 92',[{type:'tracker-correct',tracker:belly.id,value:91}]);
  assert.match(r.operation_results[0].reply,/^Changed: Belly on \d+ \w+ is now 91 cm\.$/);
  assert.deepEqual(entries(store,belly).map(i=>i.data.value),[91]);
  const d=await say(domains,'delete the last belly',[{type:'tracker-correct',tracker:belly.id,remove:true}]);
  assert.match(d.operation_results[0].reply,/^Removed: Belly 91 cm of \d+ \w+\.$/);
  assert.equal(entries(store,belly).length,0);
});

test('an ordinary collection with the same name is never a tracker and never changed',async()=>{
  const {store,domains}=fixture();const plain=store.save('collections',{name:'Movies',field_schema:[{key:'title',label:'Title',type:'text',primary:true}]});
  const before=store.get('collections',plain.id)._hash;
  await assert.rejects(say(domains,'track movies 1',[{type:'track',tracker:'Movies',value:1}]),/No tracker/);
  await assert.rejects(say(domains,'track movies 1',[{type:'track',tracker:plain.id,value:1}]),/No tracker/);
  assert.equal(store.get('collections',plain.id)._hash,before);
  // Asking to track it makes a tracker of its own, beside the collection.
  await say(domains,'track movies 1',[{type:'tracker-hold',name:'Movies',value:1}]);
  const [p]=store.list('tracker_proposals');await say(domains,'yes',[{type:'tracker-create',proposal_id:p.id}]);
  assert.equal(trackers(store).length,1);assert.notEqual(trackers(store)[0].id,plain.id);assert.equal(store.get('collections',plain.id)._hash,before);
});

test('a name two trackers share writes nothing and names both',async()=>{
  const {store,domains}=fixture();
  for(const name of ['Sleep hours','Sleep quality'])await say(domains,'I want to track '+name.toLowerCase(),[{type:'tracker-create',name,unit:'h'}]);
  for(const c of trackers(store))store.save('collections',{...c,tracker:{...c.tracker,names:[...c.tracker.names,'Sleep']}},c._hash);
  await assert.rejects(say(domains,'track sleep 7',[{type:'track',tracker:'Sleep',value:7}]),/Which one: Sleep hours or Sleep quality\?/);
  for(const c of trackers(store))assert.equal(entries(store,c).length,0);
});

test('a resting tracker wakes with its next entry, and nothing is written to wake it',async()=>{
  const {store,domains,belly}=await withBelly();
  const first=entries(store,belly)[0];store.save('collection_items',{...first,data:{...first.data,when:'2026-08-01'},title:'2026-08-01'},first._hash);
  const asleep=await domains.invoke('personal-operation',{type:'tracker-list'});assert.equal(asleep.trackers[0].status,'resting');
  const hash=store.get('collections',belly.id)._hash;
  await say(domains,'track belly 90',[{type:'track',tracker:belly.id,value:90}]);
  const awake=await domains.invoke('personal-operation',{type:'tracker-list'});assert.equal(awake.trackers[0].status,'active');
  assert.equal(store.get('collections',belly.id)._hash,hash);
});

test('tracker-list gives each tracker with its hashes, and the live questions',async()=>{
  const {store,domains,belly}=await withBelly();
  await say(domains,'track sauna',[{type:'tracker-hold',name:'Sauna',cadence:'any',fields:[]}]);
  const list=await domains.invoke('personal-operation',{type:'tracker-list',talk:'health',days:7});
  assert.equal(list.trackers.length,1);assert.equal(list.trackers[0].hash,store.get('collections',belly.id)._hash);
  assert.equal(list.trackers[0].today.hash,entries(store,belly)[0]._hash);assert.equal(list.trackers[0].recent.length,1);
  assert.equal(list.trackers[0].last.id,entries(store,belly)[0].id);
  assert.deepEqual(list.pending.map(p=>p.name),['Sauna']);assert.match(list.pending[0].question,/^Start a new tracker called Sauna, counting each time, as often as you like\?$/);
});
