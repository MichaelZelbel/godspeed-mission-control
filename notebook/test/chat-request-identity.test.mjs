import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {Domains} from '../core/domains.mjs';
import {conversationOperations} from '../core/personal-operations.mjs';
import {trackers,entries} from '../core/trackers.mjs';
import {addArea} from '../../third-party/addons/godspeed-coach/lib/areas.mjs';
import {addHabit} from '../../third-party/addons/godspeed-coach/lib/habits.mjs';

// The same words twice in one conversation are two requests (D-321, a leftover of steps 2 and 3).
// Until 12 October 2026 a request without a request id was named by its words alone, so "track walk
// to work" on Tuesday replayed Monday's saved result and wrote nothing. A genuine retry (the same
// request id, or the same words before any answer was saved) still replays.
function fixture(now='2026-10-12T05:00:00Z'){
 process.env.GODSPEED_NOW=now;
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-request-identity-'))),query=new QueryService(store),domains=new Domains(query);
 store.save('settings',{id:'installation',timezone:'Europe/Berlin'});
 addArea(store.root,{slug:'health',title:'Health',rhythm:'weekly sunday',starts:'2026-10-04'});
 const walk=addHabit(store.root,{area:'health',slug:'walk-to-work',title:'Walk to work and back',doneMeans:'walked both ways',days:'daily'},'2026-10-04');
 return {store,query,domains,walk};
}
test.after(()=>{delete process.env.GODSPEED_NOW;});
const say=async(domains,message,operations,extra={})=>{domains.provider=async()=>({reply:'Done!',operations:operations.map(o=>({source_quote:message,...o}))});return domains.invoke('conversation-chat',{message,conversation_id:'c1',...extra});};

test('"track walk to work" on two days records two days',async()=>{
 const {domains,walk}=fixture();
 let r=await say(domains,'track walk to work',[{type:'track',tracker:'habit-health-walk-to-work'}]);
 assert.equal(r.reply,'Tracked: walk to work and back, done today.');
 process.env.GODSPEED_NOW='2026-10-13T05:00:00Z';
 r=await say(domains,'track walk to work',[{type:'track',tracker:'habit-health-walk-to-work'}]);
 assert.equal(r.reply,'Tracked: walk to work and back, done today.');
 const days=fs.readFileSync(walk.file,'utf8').match(/^- 2026-10-1\d done/gm);
 assert.deepEqual(days,['- 2026-10-12 done','- 2026-10-13 done']);
});

test('"track belly 92" twice runs twice: the same day replaces, two days give two entries',async()=>{
 const {store,domains}=fixture();
 await say(domains,'I want to track my belly in cm',[{type:'tracker-create',name:'Belly',unit:'cm'}]);
 const [belly]=trackers(store);
 let r=await say(domains,'track belly 92',[{type:'track',tracker:belly.id,value:92}]);
 assert.equal(r.reply,'Tracked: Belly 92 cm.');
 r=await say(domains,'track belly 92',[{type:'track',tracker:belly.id,value:92}]);
 assert.equal(r.reply,"Today's 92 cm is now 92 cm.",'the second one ran, it was not the first answer again');
 process.env.GODSPEED_NOW='2026-10-13T05:00:00Z';
 r=await say(domains,'track belly 92',[{type:'track',tracker:belly.id,value:92}]);
 assert.match(r.reply,/^Tracked: 92 cm, the same as on Monday\.$/);
 assert.deepEqual(entries(store,belly).map(i=>i.data.when),['2026-10-12','2026-10-13']);
});

test('a genuine retry still replays: the same request id, or the same words before any answer',async()=>{
 const {store,domains}=fixture();
 await say(domains,'I want to track sauna as often as I like',[{type:'tracker-create',name:'Sauna',fields:[],cadence:'any'}]);
 const [sauna]=trackers(store);
 // The same request id twice (a client that lost the answer and asks again): one entry.
 await say(domains,'track sauna',[{type:'track',tracker:sauna.id}],{request_id:'11111111-1111-4111-8111-111111111111'});
 await say(domains,'track sauna',[{type:'track',tracker:sauna.id}],{request_id:'11111111-1111-4111-8111-111111111111'});
 assert.equal(entries(store,sauna).length,1);
 // The same words, run again before any answer was saved (a crash after the operations): one more entry, not two.
 const ops=[{type:'track',tracker:sauna.id,source_quote:'track sauna, please'}];
 const first=conversationOperations(domains,{message:'track sauna, please',conversation_id:'c1'},ops);
 const again=conversationOperations(domains,{message:'track sauna, please',conversation_id:'c1'},ops);
 assert.deepEqual(again,first);assert.equal(entries(store,sauna).length,2);
});

test('a caller that saved the message first makes that message the request',async()=>{
 const {store,domains}=fixture();
 await say(domains,'I want to track sauna as often as I like',[{type:'tracker-create',name:'Sauna',fields:[],cadence:'any'}]);
 const [sauna]=trackers(store);
 for(const n of [1,2]){
  const message=store.save('conversation_messages',{role:'user',content:'track sauna',conversation_id:'c1'});
  const [result]=await say(domains,'track sauna',[{type:'track',tracker:sauna.id}]).then(r=>r.operation_results);
  assert.ok(result.entry_id);
  const plan=store.list('command_receipts').find(r=>r.id.startsWith('personal-plan-')&&r.source_id===message.id);
  assert.ok(plan,'request '+n+' is named by its own message');
 }
 assert.equal(entries(store,sauna).length,2);
});
