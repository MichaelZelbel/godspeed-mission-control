import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {Domains} from '../core/domains.mjs';
import {chatContext} from '../core/chat-context.mjs';
import {headacheTracker} from '../core/native-personal.mjs';
import {addArea} from '../../third-party/addons/godspeed-coach/lib/areas.mjs';
import {addHabit} from '../../third-party/addons/godspeed-coach/lib/habits.mjs';

// One listener owns "track" (D-321, step 2), in the notebook's own chat too, with no Hermes: the
// model is given every habit, the Headaches tracker with the open headache, and every tracker, and
// the checks accept "track walk to work" for the habit, "track headache since 6:30, right side"
// for the headache tracker and "track belly 95" for Belly. The model here is a stand-in that
// returns what a model would; the checks and the writes are the notebook's own.
const NOW='2026-10-12T05:00:00Z'; // 07:00 in Berlin
function fixture(){
 process.env.GODSPEED_NOW=NOW;
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-track-handoff-'))),query=new QueryService(store),domains=new Domains(query);
 store.save('settings',{id:'installation',timezone:'Europe/Berlin'});
 fs.mkdirSync(path.join(store.root,'routines','headache'),{recursive:true});
 fs.writeFileSync(path.join(store.root,'routines','headache','settings.json'),JSON.stringify({timezone:'Europe/Berlin',git_sync:'off'}));
 addArea(store.root,{slug:'health',title:'Health',rhythm:'weekly sunday',starts:'2026-10-04'});
 const walk=addHabit(store.root,{area:'health',slug:'walk-to-work',title:'Walk to work and back',doneMeans:'walked both ways',days:'daily'},'2026-10-04');
 return {store,query,domains,walk};
}
test.after(()=>{delete process.env.GODSPEED_NOW;});
const say=async(domains,message,operations)=>{domains.provider=async()=>({reply:'Done!',operations:operations.map(o=>({source_quote:message,...o}))});return domains.invoke('conversation-chat',{message,conversation_id:'c1'});};

test('"track walk to work", "track headache since 6:30, right side" and "track belly 95" each reach their owner',async()=>{
 const {store,query,domains,walk}=fixture();
 await say(domains,'I want to track my belly in cm',[{type:'tracker-create',name:'Belly',unit:'cm',talk:'health'}]);
 // 1. The habit: the model is given it as a tracker with its id.
 let context=chatContext(query,{message:'track walk to work',conversation_id:'c1'});
 const habit=context.personal.trackers.find(t=>t.specialist==='habit');
 assert.deepEqual({id:habit.id,name:habit.name,names:habit.names},{id:'habit-health-walk-to-work',name:'Walk to work and back',names:['Walk to work and back','walk to work']});
 let r=await say(domains,'track walk to work',[{type:'track',tracker:habit.id}]);
 assert.equal(r.reply,'Tracked: walk to work and back, done today.');
 assert.match(fs.readFileSync(walk.file,'utf8'),/- 2026-10-12 done \(notebook\) "track walk to work"\n$/);
 // 2. The headache: no tracker yet, so the first one starts it.
 context=chatContext(query,{message:'track headache since 6:30, right side',conversation_id:'c1'});
 assert.deepEqual(context.personal.headache,{tracker:null,open:'No headache is open.'});
 r=await say(domains,'track headache since 6:30, right side',[{type:'headache',action:'start',at:'06:30',side:'right'}]);
 assert.equal(r.reply,'Tracked: since 06:30, still going (30 min), right. How strong, 1 to 10?');
 const headaches=headacheTracker(store);assert.ok(headaches);
 const [row]=store.list('collection_items').filter(i=>i.collection_id===headaches.id);
 assert.deepEqual(row.data,{when:'2026-10-12 06:30',side:'right',words:'track headache since 6:30, right side',episode:'h-20261012-0630',kind:'headache'});
 context=chatContext(query,{message:'headache over',conversation_id:'c1'});
 assert.match(context.personal.headache.open,/\[godspeed-headache\] Open headache[\s\S]*h-20261012-0630: 2026-10-12: since 06:30/);
 assert.equal(context.personal.trackers.find(t=>t.specialist==='headache').id,headaches.id,'the Headaches tracker is supplied, marked as the headache tracker\'s');
 r=await say(domains,'took one ibuprofen, and the headache is over',[{type:'headache',action:'med',meds:[{med:'Ibuprofen',dose:'1 tablet'}]},{type:'headache',action:'end'}]);
 // He said no time for the pill, so no time is said for it (the capture run of 12 October 2026).
 assert.equal(r.reply,'Tracked: since 06:30, still going (30 min), right, took Ibuprofen 1 tablet. Tracked: 06:30-07:00, 30 min, right, took Ibuprofen 1 tablet.');
 // 3. Belly, an ordinary tracker.
 context=chatContext(query,{message:'track belly 95',conversation_id:'c1'});
 const belly=context.personal.trackers.find(t=>t.name==='Belly');
 r=await say(domains,'track belly 95',[{type:'track',tracker:belly.id,value:95}]);
 assert.equal(r.reply,'Tracked: Belly 95 cm.');
 // The contract the model is given says where "track" goes.
 domains.provider=async input=>{assert.match(input.contract,/a headache, a pain level or a pill is headache|a headache, a pill or a pain level is headache/);assert.match(input.contract,/supplied habit tracker \(specialist habit\) is track/);return {reply:'ok'};};
 await domains.invoke('conversation-chat',{message:'what can I track?',conversation_id:'c2'});
});

test('the checks refuse a pain, a time, a trigger or a medicine he did not say, and a quoted or refused track',async()=>{
 const {store,domains}=fixture();
 const refused=(message,op,pattern)=>assert.rejects(say(domains,message,[{type:'headache',...op}]),pattern);
 await refused('track headache since 6:30',{action:'start',at:'06:30',pain:3},/pain level must be a number you said/);
 await refused('track headache',{action:'start',at:'06:30'},/Say when/);
 await refused('track headache since 6:30',{action:'start',at:'06:30',triggers:['too much coffee']},/trigger must be one you named/);
 await refused('track headache since 6:30',{action:'start',at:'06:30',meds:[{med:'Aspirin'}]},/medicine must be one you named/);
 await refused('if I said track headache since 6:30, what would you do?',{action:'start',at:'06:30'},/explicit request/);
 await refused("don't track my headache, it was nothing",{action:'start'},/explicit request/);
 assert.equal(headacheTracker(store),null,'nothing was written');
 // German, with the pain as a word and the time as he said it.
 const r=await say(domains,'Kopfschmerzen seit halb sieben, Stärke drei, rechts',[{type:'headache',action:'start',at:'06:30',pain:3,side:'rechts'}]);
 assert.equal(r.reply,'Tracked: since 06:30, still going (30 min), pain 3, right.');
});
