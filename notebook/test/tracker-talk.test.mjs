import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';
import {mcp} from '../server/mcp.mjs';
import {trackers} from '../core/trackers.mjs';

// "The health talk may also look at my sleep tracker" and "The health talk no longer needs my sleep
// tracker", for a tracker and a talk that already exist (Mission Control's idea card of 12 October
// 2026). A talk reads the trackers whose own card names it (tracker-list with its talk, the coach
// recipe's "Opening a talk"), so this changes that card; until now only tracker-hold and
// tracker-create could name a talk, when the tracker was made.
function fixture(t,{talks=['health']}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-tracker-talk-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const store=new Store(root),query=new QueryService(store),domains=new Domains(query);
 store.save('settings',{id:'installation',timezone:'Europe/Berlin'});
 for(const area of talks)talkArea(root,area);
 return {root,store,query,domains,op:input=>domains.invoke('personal-operation',input)};
}
const talkArea=(root,area,rhythm='weekly sunday')=>{fs.mkdirSync(path.join(root,'coach',area),{recursive:true});fs.writeFileSync(path.join(root,'coach',area,'area.md'),'AREA: '+area+'\nTITLE: '+area+'\nRHYTHM: '+rhythm+'\nTIME: 19:00\nSTARTS: 2026-10-01\nSTATUS: on\n\n## Preparation\n\nx\n');};
const sleep=async f=>{const held=await f.op({type:'tracker-hold',name:'Sleep',fields:[{label:'Hours',type:'number',unit:'hours'},{label:'Quality',type:'number',min:1,max:5}]});await f.op({type:'tracker-create',proposal_id:held.proposal_id});return trackers(f.store).find(c=>c.name==='Sleep');};
const card=(f,name)=>trackers(f.store).find(c=>c.name===name).tracker;
const read=async(f,talk)=>(await f.op({type:'tracker-list',talk})).trackers.map(x=>x.name);

test('a talk that exists may be told to look at a tracker, and to stop again',async t=>{
 const f=fixture(t);const c=await sleep(f);
 assert.equal(c.tracker.talk,null);assert.deepEqual(await read(f,'health'),[]);
 const on=await f.op({type:'tracker-talk',tracker:'sleep',talk:'health'});
 assert.equal(on.reply,'The health talk may now look at your sleep tracker.');
 assert.equal(on.changed,true);assert.equal(on.talk,'health');
 assert.equal(card(f,'Sleep').talk,'health');assert.deepEqual(await read(f,'health'),['Sleep']);
 // Everything else on the card stays as it was.
 const {talk:_a,...rest}=card(f,'Sleep'),{talk:_b,...was}=c.tracker;assert.deepEqual(rest,was);
 const again=await f.op({type:'tracker-talk',tracker:c.id,talk:'health'});
 assert.equal(again.reply,'The health talk already looks at your sleep tracker.');assert.equal(again.changed,false);
 const off=await f.op({type:'tracker-talk',tracker:'Sleep',talk:'health',remove:true});
 assert.equal(off.reply,'The health talk no longer looks at your sleep tracker.');
 assert.equal(card(f,'Sleep').talk,null);assert.deepEqual(await read(f,'health'),[]);
 const notThere=await f.op({type:'tracker-talk',tracker:'Sleep',talk:'health',remove:true});
 assert.equal(notThere.reply,'The health talk was not looking at your sleep tracker.');assert.equal(notThere.changed,false);
});

test('only a talk that exists, and a tracker keeps one talk unless they say instead',async t=>{
 const f=fixture(t,{talks:['health','work']});talkArea(f.root,'garden','none');const c=await sleep(f);
 const none=await f.op({type:'tracker-talk',tracker:'Sleep',talk:'money'});
 assert.equal(none.reply,'There is no money talk yet. Say when it should happen, and from then on it can look at your sleep tracker.');
 // An area a habit made has no talk (RHYTHM none): the same.
 assert.match((await f.op({type:'tracker-talk',tracker:'Sleep',talk:'garden'})).reply,/^There is no garden talk yet\./);
 assert.equal(card(f,'Sleep').talk,null);
 await f.op({type:'tracker-talk',tracker:'Sleep',talk:'health'});
 const other=await f.op({type:'tracker-talk',tracker:'Sleep',talk:'work'});
 assert.equal(other.reply,'Your sleep tracker is looked at by the health talk, and a tracker has one talk. Should the work talk look at it instead?');
 assert.equal(other.changed,false);assert.equal(card(f,'Sleep').talk,'health');
 const moved=await f.op({type:'tracker-talk',tracker:'Sleep',talk:'work',instead:true});
 assert.equal(moved.reply,'The work talk may now look at your sleep tracker, instead of the health talk.');
 assert.equal(card(f,'Sleep').talk,'work');
 await assert.rejects(f.op({type:'tracker-talk',tracker:'Sleep'}),/Say which talk/);
 await assert.rejects(f.op({type:'tracker-talk',tracker:'Weight',talk:'health'}),/No tracker called Weight/);
 assert.equal(c.id,trackers(f.store).find(x=>x.name==='Sleep').id);
});

test('a habit belongs to its own area\'s talk, and the cycle tracker answers as its own',async t=>{
 process.env.GODSPEED_NOW='2026-10-12T08:00:00Z';t.after(()=>{delete process.env.GODSPEED_NOW;});
 const f=fixture(t);
 const {addHabit}=await import('../../third-party/addons/godspeed-coach/lib/habits.mjs');
 addHabit(f.root,{area:'health',slug:'stretching',title:'Stretching',days:'daily'},'2026-10-12');
 await assert.rejects(f.op({type:'tracker-talk',tracker:'stretching',talk:'health'}),/Stretching is a habit: the health talk looks at it with its area, and no other talk can/);
 const held=await f.op({type:'cycle',action:'track',flow:'unspecified',language:'en'});
 await f.op({type:'tracker-create',proposal_id:held.proposal_id});
 const cycle=await f.op({type:'tracker-talk',tracker:'cycle',talk:'health'});
 assert.equal(cycle.reply,'Done: your health talk may now read your cycle tracker.');
 assert.equal(trackers(f.store).find(c=>c.tracker.specialist==='cycle').tracker.talk,'health');
 const off=await f.op({type:'tracker-talk',tracker:'cycle',talk:'health',remove:true});
 assert.equal(off.reply,'Done: no talk reads your cycle tracker.');
 assert.equal(trackers(f.store).find(c=>c.tracker.specialist==='cycle').tracker.talk,null);
});

// Over MCP (the Telegram bot's way in) a change to the tracker's card needs its current hash.
test('the bot changes a tracker\'s talk over MCP only with the tracker\'s hash',async t=>{
 const f=fixture(t),scopes=['actions','collections'];await sleep(f);
 const call=async args=>{const r=await mcp({id:1,method:'tools/call',params:{name:'personal_operation',arguments:args}},{store:f.store,query:f.query,domains:f.domains,scopes});return {error:!!r.result.isError,text:r.result.content[0].text};};
 const listed=JSON.parse((await call({type:'tracker-list'})).text).trackers.find(x=>x.name==='Sleep');
 const words='The health talk may also look at my sleep tracker.';
 const refused=await call({type:'tracker-talk',tracker:listed.id,talk:'health',words});
 assert.equal(refused.error,true);assert.match(refused.text,/hash/);assert.equal(card(f,'Sleep').talk,null);
 const done=await call({type:'tracker-talk',tracker:listed.id,talk:'health',words,expected:{['collections/'+listed.id]:listed.hash}});
 assert.equal(done.error,false,done.text);assert.equal(JSON.parse(done.text).reply,'The health talk may now look at your sleep tracker.');
 const now=JSON.parse((await call({type:'tracker-list'})).text).trackers.find(x=>x.name==='Sleep');
 assert.equal(now.talk,'health');
 const off=await call({type:'tracker-talk',tracker:now.id,talk:'health',remove:true,words:'The health talk no longer needs my sleep tracker.',expected:{['collections/'+now.id]:now.hash}});
 assert.equal(JSON.parse(off.text).reply,'The health talk no longer looks at your sleep tracker.');
});

// The notebook's own chat: the change must be what they said, a talk named, and the right way round.
test('the notebook\'s chat changes which talk looks at a tracker only as they said it',async t=>{
 const f=fixture(t);await sleep(f);
 const say=async(message,operations)=>{f.domains.provider=async()=>({reply:'ok',operations:operations.map(o=>({source_quote:message,...o}))});return f.domains.invoke('conversation-chat',{message,conversation_id:'c1'});};
 const r=await say('The health talk may also look at my sleep tracker.',[{type:'tracker-talk',tracker:'Sleep',talk:'health'}]);
 assert.equal(r.reply,'The health talk may now look at your sleep tracker.');assert.equal(card(f,'Sleep').talk,'health');
 // Taking it away when they asked to add it, or adding when they asked to take it away, is refused.
 await assert.rejects(say('The health talk may also look at my sleep tracker.',[{type:'tracker-talk',tracker:'Sleep',talk:'health',remove:true}]),/Say that the talk no longer needs that tracker/);
 assert.equal(card(f,'Sleep').talk,'health');
 await assert.rejects(say('The health talk no longer needs my sleep tracker.',[{type:'tracker-talk',tracker:'Sleep',talk:'health'}]),/Say that the talk may look at that tracker/);
 assert.equal(card(f,'Sleep').talk,'health');
 const off=await say('The health talk no longer needs my sleep tracker.',[{type:'tracker-talk',tracker:'Sleep',talk:'health',remove:true}]);
 assert.equal(off.reply,'The health talk no longer looks at your sleep tracker.');assert.equal(card(f,'Sleep').talk,null);
 // No talk named in their words: nothing changes.
 await assert.rejects(say('Use my sleep tracker for health.',[{type:'tracker-talk',tracker:'Sleep',talk:'health'}]),/explicit request/);
 assert.equal(card(f,'Sleep').talk,null);
});
