import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {Domains} from '../core/domains.mjs';
import {addArea} from '../../third-party/addons/godspeed-coach/lib/areas.mjs';
import {addHabit,track,setStatus} from '../../third-party/addons/godspeed-coach/lib/habits.mjs';

// Habits on the Trackers shelf (D-321, step 3). The coach's habit file stays the one owner of its
// days: the notebook lists each habit as a tracker made from it, and "track walk to work" runs the
// coach's own track() on that file. No collection, no item, no second copy of a habit day.
const NOW='2026-10-12T10:00:00Z';
function fixture(){
 process.env.GODSPEED_NOW=NOW;
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-habit-trackers-'))),query=new QueryService(store),domains=new Domains(query);
 store.save('settings',{id:'installation',timezone:'Europe/Berlin'});
 addArea(store.root,{slug:'health',title:'Health',rhythm:'weekly sunday',starts:'2026-10-04'});
 let walk=addHabit(store.root,{area:'health',slug:'walk-to-work',title:'Walk to work and back',doneMeans:'walked both ways',days:'daily'},'2026-10-04');
 walk=track(walk,'2026-10-06','done','data','steps 9513');walk=track(walk,'2026-10-07','asked','tick','');
 setStatus(addHabit(store.root,{area:'health',slug:'head-lifts',title:'Neck work with the band',days:'daily'},'2026-09-29'),'paused');
 return {store,query,domains,walk,original:fs.readFileSync(walk.file,'utf8')};
}
test.after(()=>{delete process.env.GODSPEED_NOW;});
const say=async(domains,message,operations)=>{domains.provider=async()=>({reply:'ok',operations:operations.map(o=>({source_quote:message,...o}))});return domains.invoke('conversation-chat',{message,conversation_id:'c1'});};
const op=(domains,input)=>domains.invoke('personal-operation',input);

test('each habit is a tracker with its answered days; an active one is on the shelf, a paused one resting',async()=>{
 const {domains}=fixture();
 const {trackers}=await op(domains,{type:'tracker-list',days:14});
 const walk=trackers.find(t=>t.id==='habit-health-walk-to-work'),lifts=trackers.find(t=>t.id==='habit-health-head-lifts');
 assert.deepEqual({name:walk.name,names:walk.names,specialist:walk.specialist,talk:walk.talk,status:walk.status,cadence:walk.cadence},{name:'Walk to work and back',names:['Walk to work and back','walk to work'],specialist:'habit',talk:'health',status:'active',cadence:'daily'});
 assert.deepEqual(walk.recent.map(d=>[d.when,d.data]),[['2026-10-06',{answer:'done',note:'steps 9513',source:'data'}]],'an asked day is not a tracked day');
 assert.deepEqual(walk.fields.map(f=>f.key),['answer','note']);
 assert.equal(lifts.status,'resting');assert.equal(lifts.habit_status,'paused');
 const health=(await op(domains,{type:'tracker-list',talk:'health'})).trackers.map(t=>t.id);
 assert.ok(health.includes('habit-health-walk-to-work'));assert.ok(!health.includes('habit-health-head-lifts'));
});

test('"track walk to work" runs the coach\'s own track on the habit file and writes no record',async()=>{
 const {store,domains,walk,original}=fixture();
 const r=await say(domains,'track walk to work',[{type:'track',tracker:'habit-health-walk-to-work'}]);
 assert.equal(r.reply,'Tracked: walk to work and back, done today.');
 const text=fs.readFileSync(walk.file,'utf8');
 assert.equal(text,original.replace(/\n?$/,'\n')+'- 2026-10-12 done (notebook) "track walk to work"\n'.replace(/^/,''),'one line, the coach\'s own');
 assert.equal(store.list('collections').length,0);assert.equal(store.list('collection_items').length,0);
 assert.equal(fs.readdirSync(path.join(store.root,'coach','history')).length,1,'the earlier file is kept, as every notebook coach write keeps it');
});

test('a no, another day, a correction and taking it back, all in the same file',async()=>{
 const {domains,walk,original}=fixture();
 let r=await say(domains,'track walk to work yesterday, I did not',[{type:'track',tracker:'walk to work',answer:'no',on:'2026-10-11'}]);
 assert.equal(r.reply,'Tracked: walk to work and back, not done yesterday.');
 r=await say(domains,'track walk to work',[{type:'track',tracker:'habit-health-walk-to-work'}]);
 r=await say(domains,'correct that, it was a skip',[{type:'tracker-correct',tracker:'habit-health-walk-to-work',answer:'skip'}]);
 assert.equal(r.reply,'Changed: walk to work and back is skipped today.');
 r=await say(domains,'delete the last walk to work',[{type:'tracker-correct',tracker:'habit-health-walk-to-work',remove:true}]);
 assert.equal(r.reply,'Removed: walk to work and back, skipped today.');
 // The same words twice in one conversation are a retry and answer as before, so other words here.
 r=await say(domains,'and delete today\'s walk to work as well',[{type:'tracker-correct',tracker:'habit-health-walk-to-work',remove:true}]);
 assert.equal(r.reply,'Removed: walk to work and back, done today.');
 r=await say(domains,'remove the walk to work of yesterday',[{type:'tracker-correct',tracker:'habit-health-walk-to-work',entry_id:'2026-10-11',remove:true}]);
 assert.equal(fs.readFileSync(walk.file,'utf8').replace(/\n+$/,''),original.replace(/\n+$/,''),'the file is as it was');
 await assert.rejects(say(domains,'track walk to work, I did not do it',[{type:'track',tracker:'habit-health-walk-to-work',answer:'done'}]),/contradicts/);
});

test('track never writes the Headaches tracker, and a habit or a headache is never held as a new tracker',async()=>{
 const {store,domains}=fixture();
 const headaches=store.save('collections',{name:'Headaches',field_schema:[{key:'when',label:'Started',type:'datetime',primary:true}],tracker:{names:['Headaches','Headache'],cadence:'any',talk:'health',specialist:'headache'}});
 await assert.rejects(op(domains,{type:'track',tracker:headaches.id,value:3}),/headache/);
 await assert.rejects(op(domains,{type:'tracker-correct',tracker:'Headaches',remove:true}),/headache/);
 await assert.rejects(op(domains,{type:'tracker-hold',name:'Headache'}),/headache tracker/);
 await assert.rejects(op(domains,{type:'tracker-hold',name:'Walk to work'}),/is a habit/);
 assert.equal(store.list('tracker_proposals').length,0);
});
