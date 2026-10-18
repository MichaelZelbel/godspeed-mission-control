import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';
import {mcp} from '../server/mcp.mjs';
import {trackers,schemaFor} from '../core/trackers.mjs';
import {createTracker} from '../../third-party/addons/godspeed-headache/lib/notebook.mjs';
import {FIELDS,NAMES} from '../../third-party/addons/godspeed-headache/lib/rows.mjs';

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
 assert.deepEqual(c.tracker.talks,[]);assert.deepEqual(await read(f,'health'),[]);
 const on=await f.op({type:'tracker-talk',tracker:'sleep',talk:'health'});
 assert.equal(on.reply,'The health talk may now look at your sleep tracker.');
 assert.equal(on.changed,true);assert.deepEqual(on.talks,['health']);
 // The tracker's new hash, for the next change (the capture of 12 October 2026 got the old one).
 assert.equal(on.tracker_hash,trackers(f.store).find(x=>x.name==='Sleep')._hash);assert.notEqual(on.tracker_hash,c._hash);
 assert.deepEqual(card(f,'Sleep').talks,['health']);assert.deepEqual(await read(f,'health'),['Sleep']);
 // Everything else on the card stays as it was.
 const {talks:_a,...rest}=card(f,'Sleep'),{talks:_b,...was}=c.tracker;assert.deepEqual(rest,was);
 const again=await f.op({type:'tracker-talk',tracker:c.id,talk:'health'});
 assert.equal(again.reply,'The health talk already looks at your sleep tracker.');assert.equal(again.changed,false);
 const off=await f.op({type:'tracker-talk',tracker:'Sleep',talk:'health',remove:true});
 assert.equal(off.reply,'The health talk no longer looks at your sleep tracker.');
 assert.deepEqual(card(f,'Sleep').talks,[]);assert.deepEqual(await read(f,'health'),[]);
 const notThere=await f.op({type:'tracker-talk',tracker:'Sleep',talk:'health',remove:true});
 assert.equal(notThere.reply,'The health talk was not looking at your sleep tracker.');assert.equal(notThere.changed,false);
});

// The decision of 13 October 2026: any number of talks may read a tracker. Adding one never asks,
// taking one away leaves the others, and only their own "instead" makes it the one talk. Until then
// the second talk was answered with "a tracker has one talk. Should the X talk look at it instead?".
test('any number of talks may look at a tracker: adding never asks, removing takes one, instead replaces them all',async t=>{
 const f=fixture(t,{talks:['health','work','money','psychology']});talkArea(f.root,'garden','none');const c=await sleep(f);
 const none=await f.op({type:'tracker-talk',tracker:'Sleep',talk:'travel'});
 assert.equal(none.reply,'There is no travel talk yet. Say when it should happen, and from then on it can look at your sleep tracker.');
 // An area a habit made has no talk (RHYTHM none): the same.
 assert.match((await f.op({type:'tracker-talk',tracker:'Sleep',talk:'garden'})).reply,/^There is no garden talk yet\./);
 assert.deepEqual(card(f,'Sleep').talks,[]);
 assert.equal((await f.op({type:'tracker-talk',tracker:'Sleep',talk:'health'})).reply,'The health talk may now look at your sleep tracker.');
 const second=await f.op({type:'tracker-talk',tracker:'Sleep',talk:'work'});
 assert.equal(second.reply,'The work talk may now look at your sleep tracker, along with the health talk.');
 assert.equal(second.changed,true);assert.deepEqual(second.talks,['health','work']);assert.deepEqual(card(f,'Sleep').talks,['health','work']);
 const third=await f.op({type:'tracker-talk',tracker:'Sleep',talk:'money'});
 assert.equal(third.reply,'The money talk may now look at your sleep tracker, along with the health and work talks.');
 for(const talk of ['health','work','money'])assert.deepEqual(await read(f,talk),['Sleep'],talk+' reads it');
 assert.equal((await f.op({type:'tracker-talk',tracker:'Sleep',talk:'work'})).reply,'The work talk already looks at your sleep tracker.');
 // Taking one away leaves the others reading it.
 const off=await f.op({type:'tracker-talk',tracker:'Sleep',talk:'health',remove:true});
 assert.equal(off.reply,'The health talk no longer looks at your sleep tracker.');assert.deepEqual(off.talks,['work','money']);
 assert.deepEqual(await read(f,'health'),[]);assert.deepEqual(await read(f,'work'),['Sleep']);assert.deepEqual(await read(f,'money'),['Sleep']);
 // instead replaces every other talk, and the reply names all it replaced.
 const moved=await f.op({type:'tracker-talk',tracker:'Sleep',talk:'psychology',instead:true});
 assert.equal(moved.reply,'The psychology talk may now look at your sleep tracker, instead of the work and money talks.');
 assert.deepEqual(card(f,'Sleep').talks,['psychology']);assert.deepEqual(await read(f,'work'),[]);assert.deepEqual(await read(f,'psychology'),['Sleep']);
 // instead for the one talk it already has changes nothing; for one of several it leaves only that one.
 assert.equal((await f.op({type:'tracker-talk',tracker:'Sleep',talk:'psychology',instead:true})).reply,'The psychology talk already looks at your sleep tracker.');
 await f.op({type:'tracker-talk',tracker:'Sleep',talk:'health'});
 assert.equal((await f.op({type:'tracker-talk',tracker:'Sleep',talk:'health',instead:true})).reply,'The health talk may now look at your sleep tracker, instead of the psychology talk.');
 assert.deepEqual(card(f,'Sleep').talks,['health']);
 await assert.rejects(f.op({type:'tracker-talk',tracker:'Sleep'}),/Say which talk/);
 await assert.rejects(f.op({type:'tracker-talk',tracker:'Weight',talk:'health'}),/No tracker called Weight/);
 assert.equal(c.id,trackers(f.store).find(x=>x.name==='Sleep').id);
});

// "instead" takes the tracker away from every other talk, so only their own words may say it.
test('instead only when their own words say instead',async t=>{
 const f=fixture(t,{talks:['health','work']});await sleep(f);
 await f.op({type:'tracker-talk',tracker:'Sleep',talk:'health'});
 await assert.rejects(f.op({type:'tracker-talk',tracker:'Sleep',talk:'work',instead:true,words:'The work talk may also look at my sleep tracker.'}),/Pass instead only when their own words say/);
 assert.deepEqual(card(f,'Sleep').talks,['health']);
 const moved=await f.op({type:'tracker-talk',tracker:'Sleep',talk:'work',instead:true,words:'The work talk should look at my sleep tracker instead of the health talk.'});
 assert.equal(moved.reply,'The work talk may now look at your sleep tracker, instead of the health talk.');
 assert.deepEqual(card(f,'Sleep').talks,['work']);
});

// A card written before 13 October 2026 names one `talk`; the headache add-on still makes its card so.
// It is read as a list of that one, and the first change writes `talks` and drops `talk`: no migration run.
test('an older card with one talk is read as a list, and written as one',async t=>{
 const f=fixture(t,{talks:['health','work']});
 const schema=schemaFor({unit:'cm',cadence:'daily'});
 f.store.save('collections',{name:'Belly',field_schema:schema,tracker:{names:['Belly'],cadence:'daily',talk:'health',specialist:null}});
 f.store.save('collections',{name:'Steps',field_schema:schema,tracker:{names:['Steps'],cadence:'daily',talk:null,specialist:null}});
 const listed=(await f.op({type:'tracker-list'})).trackers;
 assert.deepEqual(listed.find(x=>x.name==='Belly').talks,['health']);assert.deepEqual(listed.find(x=>x.name==='Steps').talks,[]);
 assert.equal('talk' in listed.find(x=>x.name==='Belly'),false,'tracker-list gives talks only');
 assert.deepEqual(await read(f,'health'),['Belly']);
 const added=await f.op({type:'tracker-talk',tracker:'Belly',talk:'work'});
 assert.equal(added.reply,'The work talk may now look at your belly tracker, along with the health talk.');
 assert.deepEqual(card(f,'Belly').talks,['health','work']);assert.equal('talk' in card(f,'Belly'),false);
 assert.deepEqual(await read(f,'health'),['Belly']);assert.deepEqual(await read(f,'work'),['Belly']);
 // Any other write of an older card stores the list too: a new name for it.
 await f.op({type:'track',tracker:'Steps',value:9000,new_name:'Walking'});
 assert.deepEqual(card(f,'Steps').talks,[]);assert.equal('talk' in card(f,'Steps'),false);
 // An owner's own words: "The psychology talk may ALSO look at my headache tracker".
 talkArea(f.root,'psychology');
 createTracker(f.root,{fields:FIELDS.map(x=>({...x})),names:[...NAMES]});f.store.scan(true);
 const headaches=trackers(f.store).find(c=>c.tracker.specialist==='headache');
 assert.equal(headaches.tracker.talk,'health','the add-on still writes one talk');
 assert.deepEqual(await read(f,'health'),['Belly','Headaches']);
 const also=await f.op({type:'tracker-talk',tracker:'headache',talk:'psychology'});
 assert.equal(also.reply,'The psychology talk may now look at your headache tracker, along with the health talk.');
 assert.deepEqual(card(f,'Headaches').talks,['health','psychology']);assert.equal('talk' in card(f,'Headaches'),false);
 assert.deepEqual(await read(f,'psychology'),['Headaches']);
});

test('a habit belongs to its own area\'s talk, and the cycle tracker answers as its own',async t=>{
 process.env.GODSPEED_NOW='2026-10-12T08:00:00Z';t.after(()=>{delete process.env.GODSPEED_NOW;});
 const f=fixture(t,{talks:['health','work']});
 const {addHabit}=await import('../../third-party/addons/godspeed-coach/lib/habits.mjs');
 addHabit(f.root,{area:'health',slug:'stretching',title:'Stretching',days:'daily'},'2026-10-12');
 // A habit's talks are its area's, and tracker-list filters habits by the same list.
 assert.deepEqual((await f.op({type:'tracker-list'})).trackers.find(x=>x.specialist==='habit').talks,['health']);
 assert.deepEqual(await read(f,'health'),['Stretching']);assert.deepEqual(await read(f,'work'),[]);
 const held=await f.op({type:'cycle',action:'track',flow:'unspecified',language:'en'});
 await f.op({type:'tracker-create',proposal_id:held.proposal_id});
 const cyc=()=>trackers(f.store).find(c=>c.tracker.specialist==='cycle').tracker;
 const on=await f.op({type:'tracker-talk',tracker:'cycle',talk:'health'});
 assert.equal(on.reply,'Done: your health talk may now read your cycle tracker.');
 assert.deepEqual(cyc().talks,['health']);
 const second=await f.op({type:'tracker-talk',tracker:'cycle',talk:'work'});
 assert.equal(second.reply,'Done: your work talk may now read your cycle tracker, along with your health talk.');
 assert.deepEqual(cyc().talks,['health','work']);
 assert.equal((await f.op({type:'tracker-talk',tracker:'cycle',talk:'work'})).reply,'Your work talk already reads your cycle tracker.');
 const one=await f.op({type:'tracker-talk',tracker:'cycle',talk:'health',remove:true});
 assert.equal(one.reply,'Done: your health talk no longer reads your cycle tracker.');assert.deepEqual(cyc().talks,['work']);
 assert.equal((await f.op({type:'tracker-talk',tracker:'cycle',talk:'health',remove:true})).reply,'Your health talk was not reading your cycle tracker.');
 await f.op({type:'tracker-talk',tracker:'cycle',talk:'health'});
 const moved=await f.op({type:'tracker-talk',tracker:'cycle',talk:'health',instead:true});
 assert.equal(moved.reply,'Done: your health talk may now read your cycle tracker, instead of your work talk.');assert.deepEqual(cyc().talks,['health']);
 const off=await f.op({type:'tracker-talk',tracker:'cycle',talk:'health',remove:true});
 assert.equal(off.reply,'Done: no talk reads your cycle tracker.');
 assert.deepEqual(cyc().talks,[]);
});

// Over MCP (the Telegram bot's way in) a change to the tracker's card needs its current hash.
test('the bot changes a tracker\'s talk over MCP only with the tracker\'s hash',async t=>{
 const f=fixture(t),scopes=['actions','collections'];await sleep(f);
 const call=async args=>{const r=await mcp({id:1,method:'tools/call',params:{name:'personal_operation',arguments:args}},{store:f.store,query:f.query,domains:f.domains,scopes});return {error:!!r.result.isError,text:r.result.content[0].text};};
 const listed=JSON.parse((await call({type:'tracker-list'})).text).trackers.find(x=>x.name==='Sleep');
 const words='The health talk may also look at my sleep tracker.';
 const refused=await call({type:'tracker-talk',tracker:listed.id,talk:'health',words});
 assert.equal(refused.error,true);assert.match(refused.text,/hash/);assert.deepEqual(card(f,'Sleep').talks,[]);
 const done=await call({type:'tracker-talk',tracker:listed.id,talk:'health',words,expected:{['collections/'+listed.id]:listed.hash}});
 assert.equal(done.error,false,done.text);assert.equal(JSON.parse(done.text).reply,'The health talk may now look at your sleep tracker.');
 const now=JSON.parse((await call({type:'tracker-list'})).text).trackers.find(x=>x.name==='Sleep');
 assert.deepEqual(now.talks,['health']);assert.equal(JSON.parse(done.text).tracker_hash,now.hash,'the reply gives the hash the next change needs');
 const off=await call({type:'tracker-talk',tracker:now.id,talk:'health',remove:true,words:'The health talk no longer needs my sleep tracker.',expected:{['collections/'+now.id]:now.hash}});
 assert.equal(JSON.parse(off.text).reply,'The health talk no longer looks at your sleep tracker.');
});

// The notebook's own chat: the change must be what they said, a talk named, and the right way round.
test('the notebook\'s chat changes which talk looks at a tracker only as they said it',async t=>{
 const f=fixture(t);await sleep(f);
 const say=async(message,operations)=>{f.domains.provider=async()=>({reply:'ok',operations:operations.map(o=>({source_quote:message,...o}))});return f.domains.invoke('conversation-chat',{message,conversation_id:'c1'});};
 const r=await say('The health talk may also look at my sleep tracker.',[{type:'tracker-talk',tracker:'Sleep',talk:'health'}]);
 assert.equal(r.reply,'The health talk may now look at your sleep tracker.');assert.deepEqual(card(f,'Sleep').talks,['health']);
 // Taking it away when they asked to add it, or adding when they asked to take it away, is refused.
 await assert.rejects(say('The health talk may also look at my sleep tracker.',[{type:'tracker-talk',tracker:'Sleep',talk:'health',remove:true}]),/Say that the talk no longer needs that tracker/);
 assert.deepEqual(card(f,'Sleep').talks,['health']);
 await assert.rejects(say('The health talk no longer needs my sleep tracker.',[{type:'tracker-talk',tracker:'Sleep',talk:'health'}]),/Say that the talk may look at that tracker/);
 assert.deepEqual(card(f,'Sleep').talks,['health']);
 const off=await say('The health talk no longer needs my sleep tracker.',[{type:'tracker-talk',tracker:'Sleep',talk:'health',remove:true}]);
 assert.equal(off.reply,'The health talk no longer looks at your sleep tracker.');assert.deepEqual(card(f,'Sleep').talks,[]);
 // No talk named in their words: nothing changes.
 await assert.rejects(say('Use my sleep tracker for health.',[{type:'tracker-talk',tracker:'Sleep',talk:'health'}]),/explicit request/);
 assert.deepEqual(card(f,'Sleep').talks,[]);
});

// An owner's own sentence, through the notebook's chat and over MCP: a second talk is added without a
// question, and "instead" works only when their words say it.
test('the chat and the bot add a second talk without asking, and move it only when they say instead',async t=>{
 const f=fixture(t,{talks:['health','psychology','work']});await sleep(f);
 const say=async(message,operations)=>{f.domains.provider=async()=>({reply:'ok',operations:operations.map(o=>({source_quote:message,...o}))});return f.domains.invoke('conversation-chat',{message,conversation_id:'c1'});};
 await say('The health talk may also look at my sleep tracker.',[{type:'tracker-talk',tracker:'Sleep',talk:'health'}]);
 const also=await say('The psychology talk may ALSO look at my sleep tracker.',[{type:'tracker-talk',tracker:'Sleep',talk:'psychology'}]);
 assert.equal(also.reply,'The psychology talk may now look at your sleep tracker, along with the health talk.');
 assert.deepEqual(card(f,'Sleep').talks,['health','psychology']);
 // An instead their words do not say is refused, and nothing changes.
 await assert.rejects(say('The work talk may also look at my sleep tracker.',[{type:'tracker-talk',tracker:'Sleep',talk:'work',instead:true}]),/Pass instead only when their own words say/);
 assert.deepEqual(card(f,'Sleep').talks,['health','psychology']);
 const moved=await say('The work talk should look at my sleep tracker instead of the other talks.',[{type:'tracker-talk',tracker:'Sleep',talk:'work',instead:true}]);
 assert.equal(moved.reply,'The work talk may now look at your sleep tracker, instead of the health and psychology talks.');
 assert.deepEqual(card(f,'Sleep').talks,['work']);
 // Over MCP an instead needs their words, and their words must say it.
 const scopes=['actions','collections'];
 const call=async args=>{const r=await mcp({id:1,method:'tools/call',params:{name:'personal_operation',arguments:args}},{store:f.store,query:f.query,domains:f.domains,scopes});return {error:!!r.result.isError,text:r.result.content[0].text};};
 let listed=JSON.parse((await call({type:'tracker-list'})).text).trackers.find(x=>x.name==='Sleep');
 const added=await call({type:'tracker-talk',tracker:listed.id,talk:'health',words:'The health talk may also look at my sleep tracker.',expected:{['collections/'+listed.id]:listed.hash}});
 assert.equal(JSON.parse(added.text).reply,'The health talk may now look at your sleep tracker, along with the work talk.');
 listed=JSON.parse((await call({type:'tracker-list',talk:'work'})).text).trackers.find(x=>x.name==='Sleep');
 assert.deepEqual(listed.talks,['work','health']);
 const bare=await call({type:'tracker-talk',tracker:listed.id,talk:'psychology',instead:true,expected:{['collections/'+listed.id]:listed.hash}});
 assert.equal(bare.error,true);assert.match(bare.text,/Pass instead only when their own words say/);
 const said=await call({type:'tracker-talk',tracker:listed.id,talk:'psychology',instead:true,words:'Let the psychology talk look at my sleep tracker instead.',expected:{['collections/'+listed.id]:listed.hash}});
 assert.equal(said.error,false,said.text);
 assert.equal(JSON.parse(said.text).reply,'The psychology talk may now look at your sleep tracker, instead of the work and health talks.');
 assert.deepEqual(card(f,'Sleep').talks,['psychology']);
});

// A habit may be read by other talks too (coach 0.2.8, READ BY): "The work talk may also look at my
// stretching habit" goes through tracker-talk, the same as a tracker, and the notebook answers in the
// trackers' words. Its own area's talk always looks at it and cannot be taken away.
test('other talks may look at a habit through tracker-talk; its own talk always does',async t=>{
 process.env.GODSPEED_NOW='2026-10-12T08:00:00Z';t.after(()=>{delete process.env.GODSPEED_NOW;});
 const f=fixture(t,{talks:['health','work','psychology']});talkArea(f.root,'garden','none');
 const {addHabit}=await import('../../third-party/addons/godspeed-coach/lib/habits.mjs');
 addHabit(f.root,{area:'health',slug:'stretching',title:'Stretching',days:'daily'},'2026-10-12');
 const file=path.join(f.root,'coach','health','habits','stretching.md'),before=fs.readFileSync(file,'utf8');
 const habit=async()=>(await f.op({type:'tracker-list'})).trackers.find(x=>x.specialist==='habit'&&x.name==='Stretching');
 assert.deepEqual((await habit()).talks,['health']);assert.deepEqual(await read(f,'work'),[]);
 const added=await f.op({type:'tracker-talk',tracker:'stretching',talk:'work'});
 assert.equal(added.reply,'The work talk may now look at your stretching habit, along with the health talk.');
 assert.equal(added.changed,true);assert.deepEqual(added.talks,['health','work']);
 assert.equal(fs.readFileSync(file,'utf8'),before.replace('AREA: health\n','AREA: health\nREAD BY: work\n'),'only the READ BY line');
 assert.deepEqual((await habit()).talks,['health','work']);assert.equal(added.tracker_hash,(await habit()).hash,'the hash the next change needs');
 // tracker-list with the talk returns the habit for a talk that reads it, as for a tracker.
 assert.deepEqual(await read(f,'work'),['Stretching']);assert.deepEqual(await read(f,'health'),['Stretching']);
 assert.ok(fs.readdirSync(path.join(f.root,'coach','history')).length>0,'the earlier version is kept, as every notebook coach write does');
 assert.equal((await f.op({type:'tracker-talk',tracker:'Stretching',talk:'work'})).reply,'The work talk already looks at your stretching habit.');
 const second=await f.op({type:'tracker-talk',tracker:'stretching',talk:'psychology'});
 assert.equal(second.reply,'The psychology talk may now look at your stretching habit, along with the health and work talks.');
 const off=await f.op({type:'tracker-talk',tracker:'stretching',talk:'work',remove:true});
 assert.equal(off.reply,'The work talk no longer looks at your stretching habit.');assert.deepEqual(off.talks,['health','psychology']);
 assert.deepEqual(await read(f,'work'),[]);assert.deepEqual(await read(f,'psychology'),['Stretching']);
 const notThere=await f.op({type:'tracker-talk',tracker:'stretching',talk:'work',remove:true});
 assert.equal(notThere.reply,'The work talk was not looking at your stretching habit.');assert.equal(notThere.changed,false);
 // Its own area's talk cannot be taken away, and already looks at it.
 const own=await f.op({type:'tracker-talk',tracker:'stretching',talk:'health',remove:true});
 assert.equal(own.reply,'Stretching is a health habit, so the health talk always looks at it.');assert.equal(own.changed,false);
 assert.equal((await f.op({type:'tracker-talk',tracker:'stretching',talk:'health'})).reply,'The health talk already looks at your stretching habit.');
 // A talk that does not exist: the trackers' reply, and nothing written.
 const kept=fs.readFileSync(file,'utf8');
 assert.equal((await f.op({type:'tracker-talk',tracker:'stretching',talk:'travel'})).reply,'There is no travel talk yet. Say when it should happen, and from then on it can look at your stretching habit.');
 assert.match((await f.op({type:'tracker-talk',tracker:'stretching',talk:'garden'})).reply,/^There is no garden talk yet\./);
 assert.equal(fs.readFileSync(file,'utf8'),kept);
 // instead: the new talk replaces the other talks that look at it, and the reply says its own talk keeps it.
 await assert.rejects(f.op({type:'tracker-talk',tracker:'stretching',talk:'work',instead:true,words:'The work talk may also look at my stretching habit.'}),/Pass instead only when their own words say/);
 const moved=await f.op({type:'tracker-talk',tracker:'stretching',talk:'work',instead:true,words:'The work talk should look at my stretching habit instead.'});
 assert.equal(moved.reply,'The work talk may now look at your stretching habit, instead of the psychology talk. Stretching is a health habit, so the health talk keeps looking at it too.');
 assert.deepEqual(moved.talks,['health','work']);assert.deepEqual(await read(f,'psychology'),[]);
});

test('a habit whose own area has no talk is looked at by the talk it is given, and nothing else is named',async t=>{
 process.env.GODSPEED_NOW='2026-10-12T08:00:00Z';t.after(()=>{delete process.env.GODSPEED_NOW;});
 const f=fixture(t,{talks:['work']});
 const {addHabit}=await import('../../third-party/addons/godspeed-coach/lib/habits.mjs');
 // The coach makes an area with no talk for a habit started on its own (coach 0.2.5).
 talkArea(f.root,'health','none');addHabit(f.root,{area:'health',slug:'stretching',title:'Stretching',days:'daily'},'2026-10-12');
 const r=await f.op({type:'tracker-talk',tracker:'stretching',talk:'work'});
 assert.equal(r.reply,'The work talk may now look at your stretching habit.');
 assert.deepEqual(await read(f,'work'),['Stretching']);
 const moved=await f.op({type:'tracker-talk',tracker:'stretching',talk:'work',instead:true,words:'Only the work talk instead.'});
 assert.equal(moved.reply,'The work talk already looks at your stretching habit.');
});

// Over MCP the bot passes the habit's hash from tracker-list, as for a habit day.
test('the bot gives a habit to another talk over MCP with the habit\'s hash',async t=>{
 process.env.GODSPEED_NOW='2026-10-12T08:00:00Z';t.after(()=>{delete process.env.GODSPEED_NOW;});
 const f=fixture(t,{talks:['health','work']}),scopes=['actions','collections'];
 const {addHabit}=await import('../../third-party/addons/godspeed-coach/lib/habits.mjs');
 addHabit(f.root,{area:'health',slug:'stretching',title:'Stretching',days:'daily'},'2026-10-12');
 const call=async args=>{const r=await mcp({id:1,method:'tools/call',params:{name:'personal_operation',arguments:args}},{store:f.store,query:f.query,domains:f.domains,scopes});return {error:!!r.result.isError,text:r.result.content[0].text};};
 const listed=JSON.parse((await call({type:'tracker-list'})).text).trackers.find(x=>x.specialist==='habit');
 const words='The work talk may also look at my stretching habit.';
 const stale=await call({type:'tracker-talk',tracker:listed.id,talk:'work',words,expected:{['habits/'+listed.id]:'0'.repeat(64)}});
 assert.equal(stale.error,true);assert.match(stale.text,/This habit changed/);
 const done=await call({type:'tracker-talk',tracker:listed.id,talk:'work',words,expected:{['habits/'+listed.id]:listed.hash}});
 assert.equal(done.error,false,done.text);assert.equal(JSON.parse(done.text).reply,'The work talk may now look at your stretching habit, along with the health talk.');
 const now=JSON.parse((await call({type:'tracker-list',talk:'work'})).text).trackers.find(x=>x.specialist==='habit');
 assert.deepEqual(now.talks,['health','work']);assert.equal(JSON.parse(done.text).tracker_hash,now.hash);
});
