import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {Domains} from '../core/domains.mjs';
import {trackers,entries} from '../core/trackers.mjs';
import {FIXED_LINE} from '../core/cycle.mjs';
import {addDays} from '../../third-party/addons/godspeed-coach/lib/clock.mjs';

// The cycle tracker's operations (D-321 step 4), on the shared tracker base: one path for the
// notebook's chat, MCP and the bot. A frozen clock (GODSPEED_NOW), no model.
function fixture(now='2026-10-12T08:00:00Z'){
 process.env.GODSPEED_NOW=now;
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-cycle-ops-')),store=new Store(root),query=new QueryService(store),domains=new Domains(query);
 store.save('settings',{id:'installation',timezone:'Europe/Berlin'});
 return {root,store,query,domains,op:input=>domains.invoke('personal-operation',input)};
}
test.after(()=>{delete process.env.GODSPEED_NOW;});
const at=day=>{process.env.GODSPEED_NOW=day+'T08:00:00Z';};
const cycle=store=>trackers(store).find(c=>c.tracker.specialist==='cycle');
const SIX=['2026-04-20','2026-05-18','2026-06-17','2026-07-16','2026-08-13','2026-09-12','2026-10-11'];
// Six synthetic cycles through the operations themselves, as a person would track them.
async function sixCycles(f,{over=true}={}){
 at('2026-10-15');
 const held=await f.op({type:'cycle',action:'track',on:SIX[0],flow:'medium'});
 await f.op({type:'tracker-create',proposal_id:held.proposal_id});
 for(const [i,start] of SIX.entries()){
  for(const [d,flow] of ['medium','heavy','medium','light'].entries())if(i||d)await f.op({type:'cycle',action:'track',on:addDays(start,d),flow});
  if(over&&start<'2026-10-08')await f.op({type:'cycle',action:'over',on:addDays(start,5)});
 }
}
const files=root=>{const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);return walk(root);};

test('"track period" with no tracker asks the design\'s question once and creates nothing; yes creates it with day 1',async()=>{
 const f=fixture();
 const held=await f.op({type:'cycle',action:'track'});
 assert.equal(held.reply,"Start a cycle tracker? It keeps the days of your period and a few symptoms if you like, and forecasts your next period once it has seen two cycles. It is not for contraception or for trying to conceive, and it is not a diagnosis. Your entries stay in your own notebook; what you type and what I answer pass through Telegram and your AI service, like every message. I've kept today as day 1.");
 assert.equal(cycle(f.store),undefined);
 const list=await f.op({type:'tracker-list'});assert.equal(list.pending[0].question,held.reply,'the open question is listed as the base lists them');
 const made=await f.op({type:'tracker-create',proposal_id:held.proposal_id});
 assert.equal(made.reply,'Tracked: period day 1. From now on just say "track period", "track period over", or a symptom, like "track cramps".');
 const c=cycle(f.store);
 assert.deepEqual({name:c.name,cadence:c.tracker.cadence,talks:c.tracker.talks,specialist:c.tracker.specialist,heads_up:c.tracker.cycle.heads_up},{name:'Cycle',cadence:'daily',talks:[],specialist:'cycle',heads_up:false});
 assert.deepEqual(entries(f.store,c).map(i=>i.data),[{when:'2026-10-12',flow:'unspecified'}]);
 // The base's own way in reaches the same: "track period" said to tracker-hold now tracks.
 at('2026-10-13');
 const next=await f.op({type:'tracker-hold',name:'Period',data:{flow:'heavy',pain:2,symptoms:['cramps']}});
 assert.equal(next.reply,'Tracked: period day 2, heavy, cramps 2 of 3.');
});

test('a symptom first keeps the symptom, and German asks in German',async()=>{
 const f=fixture();
 const held=await f.op({type:'cycle',action:'track',symptoms:['cramps']});
 assert.match(held.reply,/ I've kept today's cramps\.$/);
 const de=await f.op({type:'cycle',action:'track',language:'de'});
 assert.match(de.reply,/^Einen Zyklus-Tracker starten\?.* Ich habe mir heute als Tag 1 notiert\.$/);
 const made=await f.op({type:'tracker-create',proposal_id:de.proposal_id});
 assert.equal(made.reply,'Erfasst: Periode Tag 1. Ab jetzt sag einfach "track Periode", "track Periode vorbei" oder ein Symptom, etwa "track Krämpfe".');
 assert.equal(cycle(f.store).name,'Zyklus');
 assert.equal((await f.op({type:'tracker-list'})).pending.length,0,'the English question was replaced by the German one');
});

test('days, "period over" with its length, and a symptom on its own',async()=>{
 const f=fixture();
 const held=await f.op({type:'cycle',action:'track',flow:'medium'});await f.op({type:'tracker-create',proposal_id:held.proposal_id});
 for(const [day,flow] of [['2026-10-13','heavy'],['2026-10-14','medium'],['2026-10-15','light'],['2026-10-16','spotting']]){at(day);await f.op({type:'cycle',action:'track',flow});}
 at('2026-10-17');
 assert.equal((await f.op({type:'cycle',action:'over'})).reply,'Tracked: your period lasted 5 days.');
 assert.match((await f.op({type:'cycle',action:'over'})).reply,/already ended/,'a second over writes nothing more');
 at('2026-10-20');
 assert.equal((await f.op({type:'cycle',action:'track',symptoms:['bloating','low mood']})).reply,'Tracked: bloating, low mood.');
 // Two entries on one day are one row: the cramps join the bloating.
 assert.equal((await f.op({type:'cycle',action:'track',symptoms:['cramps'],pain:1})).reply,'Tracked: cramps 1 of 3, bloating, low mood.');
 assert.equal(entries(f.store,cycle(f.store)).filter(i=>i.data.when==='2026-10-20').length,1);
 await assert.rejects(f.op({type:'cycle',action:'track',flow:'gushing'}),/Flow is one of/);
 await assert.rejects(f.op({type:'cycle',action:'track',pain:7}),/0 to 3/);
});

test('six synthetic cycles give the forecast, and a fertile-window question is declined',async()=>{
 const f=fixture();await sixCycles(f);
 const r=await f.op({type:'cycle',action:'forecast'});
 assert.equal(r.reply,'Likely between 8 and 10 November, most likely around 9 November. Your last cycles were 28, 30, 29, 28, 30 and 29 days. '+FIXED_LINE.en);
 assert.equal((await f.op({type:'cycle',action:'forecast',language:'de'})).reply.endsWith(FIXED_LINE.de),true);
 assert.match((await f.op({type:'cycle',action:'decline'})).reply,/^I can't help with that/);
 const status=await f.op({type:'cycle',action:'status'});
 assert.deepEqual(status.cycles.map(c=>c.length),[28,30,29,28,30,29]);
 assert.deepEqual(status.forecast,{kind:'window',from:'2026-11-08',to:'2026-11-10',likely:'2026-11-09'});
 assert.equal(status.tracker.hash,cycle(f.store)._hash);
});

test('an outlier is asked about once, in the reply that completes it, and her answer changes the forecast',async()=>{
 const f=fixture();await sixCycles(f);
 at('2026-12-01');
 const r=await f.op({type:'cycle',action:'track',flow:'heavy'});
 assert.equal(r.reply,'Tracked: period day 1, heavy. Your last cycle was 51 days, longer than 45. Leave this one out of the forecast?');
 at('2026-12-02');
 assert.equal((await f.op({type:'cycle',action:'track',flow:'heavy'})).reply,'Tracked: period day 2, heavy.','asked once');
 const before=(await f.op({type:'cycle',action:'forecast'})).reply;
 assert.match(before,/A 51-day cycle is left out until you say to count it\./);
 const left=await f.op({type:'cycle',action:'leave-out',why:'outlier'});
 assert.equal(left.reply,'Done: the cycle from 11 October (51 days) is left out of the forecast.');
 assert.doesNotMatch((await f.op({type:'cycle',action:'forecast'})).reply,/left out/);
 const counted=await f.op({type:'cycle',action:'count',start:'2026-10-11'});
 assert.equal(counted.reply,'Done: the cycle from 11 October (51 days) counts in the forecast again.');
 const after=(await f.op({type:'cycle',action:'forecast'})).reply;
 assert.notEqual(after,before);assert.match(after,/unreliable for you/);
 // Marking the open cycle as affected by pregnancy pauses the forecast.
 await f.op({type:'cycle',action:'leave-out',why:'pregnancy'});
 assert.match((await f.op({type:'cycle',action:'forecast'})).reply,/^No forecast for this cycle: you marked it as affected by pregnancy\./);
});

test('the heads-up only when she switches it on: one line for her brief, two days before the window',async()=>{
 const f=fixture();await sixCycles(f);
 assert.equal((await f.op({type:'cycle',action:'brief'})).line,null);
 const on=await f.op({type:'cycle',action:'heads-up',enabled:true});
 assert.match(on.reply,/^Done: two days before your next forecast window, your morning brief will carry one line about it\. Nobody else is told\./);
 assert.match(on.reply,/morning brief is not switched on yet/,'no brief runs in this notebook');
 at('2026-11-05');assert.equal((await f.op({type:'cycle',action:'brief'})).line,null);
 at('2026-11-06');assert.equal((await f.op({type:'cycle',action:'brief'})).line,'Heads-up: your period may start in two days, likely between 8 and 10 November.');
 await f.op({type:'cycle',action:'heads-up',enabled:false});
 assert.equal((await f.op({type:'cycle',action:'brief'})).line,null);
 // Her talk reads it only when she says so, and only a talk that exists (D-321: a new mission
 // control has no health talk, and nothing may say a talk will read it when there is none).
 assert.equal((await f.op({type:'tracker-list',talk:'health'})).trackers.length,0);
 const none=await f.op({type:'cycle',action:'talk',talk:'health'});
 assert.equal(none.reply,'There is no health talk yet. Say when it should happen, and from then on it can read your cycle tracker.');
 assert.deepEqual(cycle(f.store).tracker.talks,[]);
 fs.mkdirSync(path.join(f.root,'coach','health'),{recursive:true});
 fs.writeFileSync(path.join(f.root,'coach','health','area.md'),'AREA: health\nTITLE: Health\nRHYTHM: weekly sunday\nTIME: 19:00\nSTARTS: 2026-10-01\nSTATUS: on\n\n## Preparation\n\nx\n');
 await f.op({type:'cycle',action:'talk',talk:'health'});
 assert.equal((await f.op({type:'tracker-list',talk:'health'})).trackers[0].name,'Cycle');
});

test('delete asks once, the yes within an hour leaves nothing of it in her notebook, and says what remains',async()=>{
 const f=fixture();await sixCycles(f);
 await f.op({type:'cycle',action:'track',note:'secretnote',symptoms:['acne']});
 const c=cycle(f.store),rows=entries(f.store,c).length;
 const asked=await f.op({type:'cycle',action:'delete'});
 assert.equal(asked.reply,'Delete your cycle tracker and its '+rows+' days? Say yes to delete it.');
 assert.ok(asked.expected['collections/'+c.id]);
 assert.equal(cycle(f.store)._hash,c._hash,'the question deletes nothing');
 // A yes after an hour deletes nothing.
 process.env.GODSPEED_NOW='2026-10-15T09:30:00Z';
 await assert.rejects(f.op({type:'cycle',action:'delete',confirm:asked.request_id}),/expired/);
 process.env.GODSPEED_NOW='2026-10-15T08:00:00Z';
 const again=await f.op({type:'cycle',action:'delete'});
 const done=await f.op({type:'cycle',action:'delete',confirm:again.request_id});
 assert.equal(done.reply,'Deleted: your cycle tracker and its '+rows+' days are gone from your notebook. What remains: your messages and my replies in your chat history, and older copies in your private backup history.');
 assert.equal(cycle(f.store),undefined);
 const leftover=files(path.join(f.root,'notebook')).filter(file=>/secretnote|"?flow"?:|unspecified|Cycle/.test(fs.readFileSync(file,'utf8')));
 assert.deepEqual(leftover,[],'no file in the notebook holds a row, the tracker or a question');
});

test('the generic track and correct reach the cycle tracker and keep its columns honest',async()=>{
 const f=fixture();
 const held=await f.op({type:'tracker-hold',name:'Period'});
 assert.match(held.reply,/^Start a cycle tracker\?/);
 await f.op({type:'tracker-create',proposal_id:held.proposal_id});
 const c=cycle(f.store);at('2026-10-13');
 assert.equal((await f.op({type:'track',tracker:c.id,data:{flow:'light'}})).reply,'Tracked: period day 2, light.');
 assert.equal((await f.op({type:'track',tracker:'Periode',data:{ended:true}})).reply,'Tracked: your period lasted 2 days.');
 await assert.rejects(f.op({type:'tracker-correct',tracker:c.id,data:{flow:'gushing'}}),/one of/);
 const fixed=await f.op({type:'tracker-correct',tracker:c.id,entry_id:entries(f.store,c)[0].id,data:{flow:'heavy'}});
 assert.match(fixed.reply,/^Changed: Cycle on 12 October/);
 const listed=(await f.op({type:'tracker-list'})).trackers.find(t=>t.id===c.id);
 assert.deepEqual(listed.fields.find(x=>x.key==='flow').options,['spotting','light','medium','heavy','none','unspecified']);
});

// Any number of talks may read the cycle tracker, as any tracker (13 October 2026), and it still reaches a
// talk only when she says so; its own words, English or German.
test('the cycle tracker\'s talks: only when she says so, then add, remove one and instead, in English and German',async()=>{
 const f=fixture();
 for(const area of ['health','psychology']){fs.mkdirSync(path.join(f.root,'coach',area),{recursive:true});fs.writeFileSync(path.join(f.root,'coach',area,'area.md'),'AREA: '+area+'\nTITLE: '+area+'\nRHYTHM: weekly sunday\nTIME: 19:00\nSTARTS: 2026-10-01\nSTATUS: on\n\n## Preparation\n\nx\n');}
 const held=await f.op({type:'cycle',action:'track',language:'de'});await f.op({type:'tracker-create',proposal_id:held.proposal_id});
 assert.deepEqual(cycle(f.store).tracker.talks,[],'a health talk exists, and still no talk reads it until she says so');
 let r=await f.op({type:'cycle',action:'talk',talk:'health'});
 assert.equal(r.reply,'Erledigt: Dein Gespräch "health" darf jetzt deinen Zyklus-Tracker lesen.');
 r=await f.op({type:'cycle',action:'talk',talk:'psychology'});
 assert.equal(r.reply,'Erledigt: Dein Gespräch "psychology" darf jetzt deinen Zyklus-Tracker lesen, neben deinem Gespräch "health".');
 assert.deepEqual(cycle(f.store).tracker.talks,['health','psychology']);
 r=await f.op({type:'cycle',action:'talk',talk:'health',remove:true});
 assert.equal(r.reply,'Erledigt: Dein Gespräch "health" liest deinen Zyklus-Tracker nicht mehr.');assert.deepEqual(cycle(f.store).tracker.talks,['psychology']);
 r=await f.op({type:'cycle',action:'talk',talk:'health',language:'en'});
 assert.equal(r.reply,'Done: your health talk may now read your cycle tracker, along with your psychology talk.');
 r=await f.op({type:'cycle',action:'talk',talk:'psychology',instead:true,language:'en'});
 assert.equal(r.reply,'Done: your psychology talk may now read your cycle tracker, instead of your health talk.');assert.deepEqual(cycle(f.store).tracker.talks,['psychology']);
 // No talk named: none reads it any more, as before.
 r=await f.op({type:'cycle',action:'talk',talk:null,language:'en'});
 assert.equal(r.reply,'Done: no talk reads your cycle tracker.');assert.deepEqual(cycle(f.store).tracker.talks,[]);
 // An older card with one talk is read as a list, and the next write stores the list.
 const c=cycle(f.store),{talks:_,...old}=c.tracker;f.store.save('collections',{id:c.id,tracker:{...old,talk:'health'}},c._hash);
 assert.deepEqual((await f.op({type:'cycle',action:'status'})).tracker.talks,['health']);
 await f.op({type:'cycle',action:'heads-up',enabled:true});
 assert.deepEqual(cycle(f.store).tracker.talks,['health']);assert.equal('talk' in cycle(f.store).tracker,false);
});
