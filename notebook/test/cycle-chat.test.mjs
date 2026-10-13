import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {Domains} from '../core/domains.mjs';
import {chatContext} from '../core/chat-context.mjs';
import {trackers,entries} from '../core/trackers.mjs';
import {FIXED_LINE,declineReply} from '../core/cycle.mjs';
import {addDays} from '../../third-party/addons/godspeed-coach/lib/clock.mjs';

// The cycle tracker in the notebook's own chat (D-321 step 4), with a stand-in model: the checks
// and the writes are the notebook's own, the answer is the server's line, and a question about a
// fertile window, ovulation or conceiving is declined whatever the model wrote.
function fixture(now='2026-10-15T08:00:00Z'){
 process.env.GODSPEED_NOW=now;
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-cycle-chat-'))),query=new QueryService(store),domains=new Domains(query);
 store.save('settings',{id:'installation',timezone:'Europe/Berlin'});
 return {store,query,domains,op:input=>domains.invoke('personal-operation',input)};
}
test.after(()=>{delete process.env.GODSPEED_NOW;});
const at=day=>{process.env.GODSPEED_NOW=day+'T08:00:00Z';};
function say(domains,message,ops,{reply='Okay!',language='en'}={}){
 const calls=[];domains.provider=async input=>{calls.push(input.kind);if(input.kind==='reply-language')return {lines:input.input.lines};return {reply,language,operations:ops.map(o=>({source_quote:message,...o}))};};
 return domains.invoke('conversation-chat',{message,conversation_id:'c1'}).then(r=>({...r,calls}));
}
const cycle=store=>trackers(store).find(c=>c.tracker.specialist==='cycle');
const SIX=['2026-04-20','2026-05-18','2026-06-17','2026-07-16','2026-08-13','2026-09-12','2026-10-11'];
async function sixCycles(f){
 const held=await f.op({type:'cycle',action:'track',on:SIX[0],flow:'medium'});await f.op({type:'tracker-create',proposal_id:held.proposal_id});
 for(const [i,start] of SIX.entries())for(const [d,flow] of ['medium','heavy','medium','light'].entries())if(i||d)await f.op({type:'cycle',action:'track',on:addDays(start,d),flow});
}

test('setup, a day, "period over" and the forecast answer with the server\'s lines',async()=>{
 const f=fixture('2026-10-12T08:00:00Z');
 let r=await say(f.domains,'track period',[{type:'cycle',action:'track'}],{reply:'Sure, tracked!'});
 assert.match(r.reply,/^Start a cycle tracker\? .* I've kept today as day 1\.$/);
 assert.equal(cycle(f.store),undefined);
 const context=chatContext(f.query,{message:'yes',conversation_id:'c1'});
 assert.equal(context.personal.tracker_questions[0].question,r.reply,'the model is given the open question');
 r=await say(f.domains,'yes',[{type:'tracker-create',proposal_id:context.personal.tracker_questions[0].id}]);
 assert.match(r.reply,/^Tracked: period day 1\. From now on just say "track period"/);
 at('2026-10-13');
 r=await say(f.domains,'track period, heavy, cramps 2',[{type:'cycle',action:'track',flow:'heavy',pain:2,symptoms:['cramps']}]);
 assert.equal(r.reply,'Tracked: period day 2, heavy, cramps 2 of 3.');
 assert.equal(chatContext(f.query,{message:'x',conversation_id:'c1'}).personal.cycle.period.day,2,'the model sees the open period');
 at('2026-10-17');
 r=await say(f.domains,'track period over',[{type:'cycle',action:'over'}]);
 assert.equal(r.reply,'Tracked: your period lasted 5 days.');
 r=await say(f.domains,'when is my next period?',[{type:'cycle',action:'forecast'}],{reply:'Probably on 9 November!'});
 assert.equal(r.reply,'Too early to say: I have seen one start so far. After two more I can give a first forecast. '+FIXED_LINE.en);
});

test('German in, German out, without a second call',async()=>{
 const f=fixture();await sixCycles(f);
 let r=await say(f.domains,'track Periode, stark, Krämpfe 2',[{type:'cycle',action:'track',flow:'heavy',pain:2,symptoms:['cramps']}],{language:'de'});
 assert.equal(r.reply,'Erfasst: Periode Tag 5, stark, Krämpfe 2 von 3.');assert.deepEqual(r.calls,['conversation-chat']);
 r=await say(f.domains,'Wann kommt meine nächste Periode?',[{type:'cycle',action:'forecast'}],{language:'de'});
 assert.equal(r.reply,'Wahrscheinlich zwischen dem 8. und 10. November, am ehesten um den 9. November. Deine letzten Zyklen waren 28, 30, 29, 28, 30 und 29 Tage lang. '+FIXED_LINE.de);
});

test('a fertile-window, ovulation or pregnancy question is declined whatever the model answers',async()=>{
 const f=fixture();await sixCycles(f);
 let r=await say(f.domains,'when is my fertile window?',[],{reply:'Your fertile window is from 25 to 30 October.'});
 assert.equal(r.reply,declineReply('en'));
 r=await say(f.domains,'Kann ich heute schwanger werden?',[],{reply:'Eher nicht.',language:'de'});
 assert.equal(r.reply,declineReply('de'));
 r=await say(f.domains,'Wann ist mein Eisprung?',[{type:'cycle',action:'decline'}],{reply:'Am 26. Oktober.',language:null});
 assert.equal(r.reply,declineReply('de'),'German when the model names no German');
 // Marking a cycle is not such a question.
 r=await say(f.domains,'my last cycle was affected by stopping the pill',[{type:'cycle',action:'leave-out',why:'contraception',start:'2026-09-12'}]);
 assert.equal(r.reply,'Done: the cycle from 12 September (29 days) is left out of the forecast (starting or stopping hormonal contraception).');
 // A notebook with no cycle tracker leaves a general question to the model.
 const g=fixture();r=await say(g.domains,'what is a fertile window, in general?',[],{reply:'A general answer.'});
 assert.equal(r.reply,'A general answer.');
});

test('the checks refuse what she did not say, a quoted or refused track, and a late yes',async()=>{
 const f=fixture();await sixCycles(f);
 const refused=(message,op,pattern)=>assert.rejects(say(f.domains,message,[{type:'cycle',...op}]),pattern);
 await refused('track period',{action:'track',flow:'heavy'},/flow you said/);
 await refused('track period',{action:'track',pain:2},/pain level must be a number you said/);
 await refused('track period, cramps',{action:'track',symptoms:['cramps','acne']},/symptom you named/);
 await refused('track cramps',{action:'track',flow:'unspecified',symptoms:['cramps']},/period/);
 await refused('if I said track period, what would you do?',{action:'track'},/explicit request/);
 await refused("don't track my period",{action:'track'},/explicit request/);
 await refused('stop the heads-up',{action:'heads-up',enabled:true},/on or off/);
 await refused('delete my cycle tracker',{action:'delete',confirm:'tracker-deletions-missing'},/expired/);
 const rows=entries(f.store,cycle(f.store)).length;
 // The real thing: the question, then the yes.
 let r=await say(f.domains,'delete my cycle tracker',[{type:'cycle',action:'delete'}]);
 assert.equal(r.reply,'Delete your cycle tracker and its '+rows+' days? Say yes to delete it.');
 const request=chatContext(f.query,{message:'yes',conversation_id:'c1'}).personal.cycle.deletion.request_id;
 r=await say(f.domains,'yes',[{type:'cycle',action:'delete',confirm:request}]);
 assert.match(r.reply,/^Deleted: your cycle tracker and its \d+ days are gone from your notebook\. What remains: /);
 assert.equal(cycle(f.store),undefined);
});

// Any number of talks may read her cycle tracker (13 October 2026): in the chat, taking a talk away is
// what she said, and "instead" only when she said it.
test('her talks in the chat: one talk taken away only when she says so, instead only when she says it',async()=>{
 const f=fixture();await sixCycles(f);
 for(const area of ['health','psychology']){fs.mkdirSync(path.join(f.store.root,'coach',area),{recursive:true});fs.writeFileSync(path.join(f.store.root,'coach',area,'area.md'),'AREA: '+area+'\nTITLE: '+area+'\nRHYTHM: weekly sunday\nTIME: 19:00\nSTARTS: 2026-10-01\nSTATUS: on\n\n## Preparation\n\nx\n');}
 let r=await say(f.domains,'My health talk may read my cycle.',[{type:'cycle',action:'talk',talk:'health'}]);
 assert.equal(r.reply,'Done: your health talk may now read your cycle tracker.');
 r=await say(f.domains,'My psychology talk may read my cycle too.',[{type:'cycle',action:'talk',talk:'psychology'}]);
 assert.equal(r.reply,'Done: your psychology talk may now read your cycle tracker, along with your health talk.');
 await assert.rejects(say(f.domains,'My health talk may read my cycle.',[{type:'cycle',action:'talk',talk:'health',remove:true}]),/Say that the talk no longer needs your cycle tracker/);
 await assert.rejects(say(f.domains,'My health talk may read my cycle.',[{type:'cycle',action:'talk',talk:'health',instead:true}]),/Pass instead only when their own words say/);
 assert.deepEqual(cycle(f.store).tracker.talks,['health','psychology']);
 r=await say(f.domains,'My health talk no longer needs my cycle.',[{type:'cycle',action:'talk',talk:'health',remove:true}]);
 assert.equal(r.reply,'Done: your health talk no longer reads your cycle tracker.');
 assert.deepEqual(cycle(f.store).tracker.talks,['psychology']);
});
