import test from 'node:test';import assert from 'node:assert/strict';
import {addDays} from '../../third-party/addons/godspeed-coach/lib/clock.mjs';
import {FLOWS,cycleSchema,periods,cycleState,forecast,isOutlier,setupQuestion,createdReply,dayReply,overReply,forecastReply,headsUpLine,declineReply,FIXED_LINE,CYCLE_WORDS,asksForbidden} from '../core/cycle.mjs';

// The cycle tracker's rules (Mission Control's work/plans/2026-10-12-trackers-cycle-design.md, D-321
// step 4), worked out in code and tested without a model: when a period starts, how long it lasted,
// and the forecast. Never a fertile window, an ovulation day, safe days or a diagnosis.
let n=0;const row=(when,data)=>({id:'r'+(++n),created_at:'2026-01-01T00:00:00Z',data:{when,...data}});
// Five days of period from each start: medium, heavy, medium, light, then a day of spotting.
const periodFrom=start=>['medium','heavy','medium','light','spotting'].map((flow,i)=>row(addDays(start,i),{flow}));
const startsOf=(first,lengths)=>lengths.reduce((s,l)=>[...s,addDays(s.at(-1),l)],[first]);
const rowsOf=starts=>starts.flatMap(periodFrom);
const SIX=['2026-04-20','2026-05-18','2026-06-17','2026-07-16','2026-08-13','2026-09-12','2026-10-11'];
const card=(cycle={})=>({specialist:'cycle',language:'en',cycle:{heads_up:false,left_out:[],counted:[],...cycle}});

test('the columns are the design\'s, with unspecified for a period of no stated amount',()=>{
 const schema=cycleSchema();
 assert.deepEqual(schema.map(f=>f.key),['when','flow','pain','pain_where','symptoms','ended','note']);
 assert.deepEqual(schema.find(f=>f.key==='flow').options,FLOWS);
 assert.deepEqual(FLOWS,['spotting','light','medium','heavy','none','unspecified']);
 assert.deepEqual(schema.find(f=>f.key==='symptoms').options,['cramps','headache','bloating','breast tenderness','acne','low mood','irritable','low energy','poor sleep','cravings','digestion','discharge']);
 assert.deepEqual(schema.find(f=>f.key==='pain_where').options,['belly','back','head']);
});

test('spotting alone never starts a period, and a start needs at least 5 days without one',()=>{
 assert.deepEqual(periods([row('2026-10-01',{flow:'spotting'}),row('2026-10-02',{flow:'spotting'})]),[]);
 const p=periods([row('2026-10-01',{flow:'light'}),row('2026-10-02',{flow:'heavy'}),row('2026-10-03',{flow:'medium'}),row('2026-10-08',{flow:'light'}),row('2026-10-14',{flow:'unspecified'})]);
 // 4 days without (4 to 7 October) continue the period; 5 days without (9 to 13 October) start a new one.
 assert.deepEqual(p.map(x=>[x.start,x.end]),[['2026-10-01','2026-10-08'],['2026-10-14','2026-10-14']]);
 // A symptom day or spotting before the first flow is not a start.
 assert.equal(periods([row('2026-09-28',{symptoms:['cramps']}),row('2026-09-29',{flow:'spotting'}),row('2026-09-30',{flow:'medium'})])[0].start,'2026-09-30');
});

test('"period over" gives the length: the over day counts only when it has flow',()=>{
 const base=['2026-10-01','2026-10-02','2026-10-03','2026-10-04'].map(d=>row(d,{flow:'medium'}));
 assert.equal(periods([...base,row('2026-10-06',{flow:'none',ended:true})])[0].length,5,'over said on the 6th: the 5th was the last day');
 assert.equal(periods([...base,row('2026-10-05',{flow:'light',ended:true})])[0].length,5);
 assert.equal(periods([...base.slice(0,2),row('2026-10-03',{flow:'none',ended:true}),row('2026-10-04',{flow:'light'})])[0].length,4,'it came back: the last flow day ends it');
});

test('no forecast before two complete cycles, said as the rule counts',()=>{
 const today='2026-10-12';
 let f=forecast(cycleState([],card(),today),today);assert.equal(f.kind,'too-early');
 assert.equal(forecastReply('en',f,today),'Too early to say: I have not seen a period start yet. Once I have seen two whole cycles I can forecast your next period. '+FIXED_LINE.en);
 f=forecast(cycleState(rowsOf(['2026-10-11']),card(),today),today);
 assert.equal(forecastReply('en',f,today),'Too early to say: I have seen one start so far. After two more I can give a first forecast. '+FIXED_LINE.en);
 f=forecast(cycleState(rowsOf(['2026-09-12','2026-10-11']),card(),today),today);
 assert.equal(forecastReply('en',f,today),'Too early to say: I have seen one whole cycle so far (29 days). After your next period I can give a first forecast. '+FIXED_LINE.en);
});

test('six cycles: the median as most likely, the window from the shortest to the longest',()=>{
 const today='2026-10-12',state=cycleState(rowsOf(SIX),card(),today),f=forecast(state,today);
 assert.deepEqual(state.cycles.map(c=>c.length),[28,30,29,28,30,29]);
 assert.deepEqual({from:f.from,to:f.to,likely:f.likely,unreliable:f.unreliable},{from:'2026-11-08',to:'2026-11-10',likely:'2026-11-09',unreliable:false});
 assert.equal(forecastReply('en',f,today),'Likely between 8 and 10 November, most likely around 9 November. Your last cycles were 28, 30, 29, 28, 30 and 29 days. '+FIXED_LINE.en);
 assert.equal(forecastReply('de',f,today),'Wahrscheinlich zwischen dem 8. und 10. November, am ehesten um den 9. November. Deine letzten Zyklen waren 28, 30, 29, 28, 30 und 29 Tage lang. '+FIXED_LINE.de);
 // Only the last six count: a seventh, older cycle of 35 days changes nothing.
 const seven=cycleState(rowsOf(['2026-03-16',...SIX]),card(),today);assert.equal(seven.cycles[0].length,35);
 assert.deepEqual(forecast(seven,today).lengths,[28,30,29,28,30,29]);
 // Across a month: "between 30 October and 2 November".
 const across=forecast(cycleState(rowsOf(startsOf('2026-07-08',[28,30,29])),card(),today),today);
 assert.match(forecastReply('en',across,today),/^Likely between 31 October and 2 November, most likely around 1 November\./);
});

test('an outlier is asked about, left out until she answers, and counting it changes the forecast',()=>{
 const today='2026-10-12',starts=startsOf('2026-03-25',[29,52,28,30,29]),rows=rowsOf(starts);
 assert.ok(isOutlier(52)&&isOutlier(20)&&!isOutlier(21)&&!isOutlier(45));
 const state=cycleState(rows,card(),today);
 assert.deepEqual(state.cycles.map(c=>[c.length,c.status]),[[29,'counted'],[52,'pending'],[28,'counted'],[30,'counted'],[29,'counted']]);
 const f=forecast(state,today);assert.deepEqual(f.lengths,[29,28,30,29]);
 assert.match(forecastReply('en',f,today),/ A 52-day cycle is left out until you say to count it\. /);
 const counted=forecast(cycleState(rows,card({counted:[starts[1]]}),today),today);
 assert.deepEqual(counted.lengths,[29,52,28,30,29]);assert.equal(counted.unreliable,true);
 assert.notEqual(counted.to,f.to);
 const left=forecast(cycleState(rows,card({left_out:[{start:starts[1],why:'outlier'}]}),today),today);
 assert.deepEqual(left.lengths,[29,28,30,29]);assert.doesNotMatch(forecastReply('en',left,today),/left out/);
});

test('cycles that differ by more than 9 days make the forecast unreliable, said plainly',()=>{
 const today='2026-10-12',f=forecast(cycleState(rowsOf(startsOf('2026-05-20',[24,35,26,33])),card(),today),today);
 assert.equal(f.unreliable,true);
 assert.match(forecastReply('en',f,today),/Your recent cycles differ by more than 9 days, so this forecast is unreliable for you\./);
});

test('a cycle she marks is left out, and an open one marked pregnancy pauses the forecast',()=>{
 const today='2026-10-12',rows=rowsOf(SIX);
 const f=forecast(cycleState(rows,card({left_out:[{start:'2026-05-18',why:'contraception'}]}),today),today);
 assert.deepEqual(f.lengths,[28,29,28,30,29]);
 const paused=forecast(cycleState(rows,card({left_out:[{start:'2026-10-11',why:'pregnancy'}]}),today),today);
 assert.equal(paused.kind,'paused');
 assert.equal(forecastReply('en',paused,today),'No forecast for this cycle: you marked it as affected by pregnancy. '+FIXED_LINE.en);
});

test('every forecast reply carries the fixed line, and none names a fertile window or ovulation',()=>{
 const today='2026-10-12';
 for(const rows of [[],rowsOf(['2026-10-11']),rowsOf(SIX)])for(const lang of ['en','de']){
  const text=forecastReply(lang,forecast(cycleState(rows,card(),today),today),today);
  assert.ok(text.endsWith(FIXED_LINE[lang]),text);assert.doesNotMatch(text,/fertil|ovulat|eisprung|fruchtbar|safe day|sichere tage/i);
 }
 assert.equal(FIXED_LINE.en,'Not for contraception or for trying to conceive, and not a diagnosis.');
 assert.match(declineReply('en'),/^I can't help with that: .*doctor.*certified app/);
 assert.match(declineReply('de'),/Arzt.*zertifizierte App/);
});

test('the heads-up line is in the brief only two days before the window, and only when switched on',()=>{
 const rows=rowsOf(SIX),on=card({heads_up:true});
 const line=day=>headsUpLine(cycleState(rows,on,day),day);
 assert.equal(line('2026-11-06'),'Heads-up: your period may start in two days, likely between 8 and 10 November.');
 assert.equal(line('2026-11-05'),null);assert.equal(line('2026-11-07'),null);
 assert.equal(headsUpLine(cycleState(rows,card(),'2026-11-06'),'2026-11-06'),null,'switched off');
 const de={...on,language:'de'};
 assert.equal(headsUpLine(cycleState(rows,de,'2026-11-06'),'2026-11-06'),'Vorwarnung: Deine Periode kann in zwei Tagen beginnen, wahrscheinlich zwischen dem 8. und 10. November.');
});

test('the setup question is the design\'s words, and the day replies say what was kept',()=>{
 assert.equal(setupQuestion('en',{day:'2026-10-12',period:true},'2026-10-12'),"Start a cycle tracker? It keeps the days of your period and a few symptoms if you like, and forecasts your next period once it has seen two cycles. It is not for contraception or for trying to conceive, and it is not a diagnosis. Your entries stay in your own notebook; what you type and what I answer pass through Telegram and your AI service, like every message. I've kept today as day 1.");
 assert.match(setupQuestion('en',{day:'2026-10-12',symptoms:['cramps']},'2026-10-12'),/ I've kept today's cramps\.$/);
 assert.match(setupQuestion('en',{day:'2026-10-10',period:true},'2026-10-12'),/ I've kept 10 October as day 1\.$/);
 assert.match(setupQuestion('de',{day:'2026-10-12',period:true},'2026-10-12'),/^Einen Zyklus-Tracker starten\? .*nicht zur Verhütung und nicht für den Kinderwunsch gedacht.* Deine Einträge bleiben in deinem eigenen Notizbuch; was du schreibst und was ich antworte, läuft wie jede Nachricht über Telegram und deinen KI-Dienst\. Ich habe mir heute als Tag 1 notiert\.$/);
 assert.equal(createdReply('en','period day 1'),'Tracked: period day 1. From now on just say "track period", "track period over", or a symptom, like "track cramps".');
 assert.equal(dayReply('en',{day:'2026-10-13',today:'2026-10-13',periodDay:2,data:{flow:'heavy',pain:2,symptoms:['cramps']}}),'Tracked: period day 2, heavy, cramps 2 of 3.');
 assert.equal(dayReply('de',{day:'2026-10-13',today:'2026-10-13',periodDay:2,data:{flow:'heavy',pain:2,symptoms:['cramps']}}),'Erfasst: Periode Tag 2, stark, Krämpfe 2 von 3.');
 assert.equal(dayReply('en',{day:'2026-10-20',today:'2026-10-20',data:{symptoms:['bloating','low mood']}}),'Tracked: bloating, low mood.');
 assert.equal(dayReply('en',{day:'2026-10-20',today:'2026-10-20',data:{pain:1,pain_where:['back']}}),'Tracked: pain 1 of 3 (back).');
 assert.equal(dayReply('en',{day:'2026-11-08',today:'2026-11-08',periodDay:1,data:{flow:'unspecified'},lastCycle:28}),'Tracked: period day 1. Your last cycle was 28 days.');
 assert.equal(dayReply('en',{day:'2026-11-08',today:'2026-11-09',periodDay:1,data:{flow:'unspecified'},lastCycle:52}),'Tracked for 8 November: period day 1. Your last cycle was 52 days, longer than 45. Leave this one out of the forecast?');
 assert.equal(overReply('en',5),'Tracked: your period lasted 5 days.');assert.equal(overReply('de',1),'Erfasst: Deine Periode hat 1 Tag gedauert.');
});

test('the cycle words and the questions it never answers, in English and German',()=>{
 for(const said of ['track period','track Periode','track my period over','track cramps','meine Regel hat angefangen','Zyklus'])assert.match(said,CYCLE_WORDS,said);
 for(const said of ['track bicycle ride','Regeln für morgen','track sauna'])assert.doesNotMatch(said,CYCLE_WORDS,said);
 for(const said of ['when is my fertile window?','When do I ovulate?','which are my safe days','can I get pregnant today?','Wann ist mein Eisprung?','Kann ich heute schwanger werden?','an welchen Tagen bin ich fruchtbar','do I need contraception this week?','is this endometriosis, can you diagnose it?'])assert.ok(asksForbidden(said),said);
 for(const said of ['my last cycle was affected by stopping the pill','I started hormonal contraception this month','ich habe die Pille abgesetzt','ich bin schwanger','when is my next period?','track period'])assert.ok(!asksForbidden(said),said);
});
