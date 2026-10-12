import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';
import {mcp} from '../server/mcp.mjs';
import {trackers,entries,dayMentions,resolveOn,entryOn,talkExists} from '../core/trackers.mjs';

// The book's capture run of 12 October 2026 (Ownward Studio's chapter-verification file
// ch14-ch39-trackers-2026-10-12.md) ran the bot's own model against a brand-new mission control and
// found these faults. Each test is one finding, over MCP, the way the bot reaches the notebook, on
// the run's own clock: Monday 12 October 2026, 06:34 in Berlin.
const NOW='2026-10-12T04:34:09Z';
const fixture=(t,{talks=[]}={})=>{
 process.env.GODSPEED_NOW=NOW;
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-capture-'));t.after(()=>{delete process.env.GODSPEED_NOW;fs.rmSync(root,{recursive:true,force:true});});
 const store=new Store(root),query=new QueryService(store),domains=new Domains(query);store.save('settings',{id:'installation',timezone:'Europe/Berlin'});
 for(const area of talks){fs.mkdirSync(path.join(root,'coach',area),{recursive:true});fs.writeFileSync(path.join(root,'coach',area,'area.md'),'AREA: '+area+'\nTITLE: '+area+'\nRHYTHM: weekly sunday\nTIME: 19:00\nSTARTS: 2026-10-01\nSTATUS: on\n\n## Preparation\n\nx\n');}
 return {root,store,query,domains};
};
const scopes=['actions','collections'];
const call=async(env,args)=>{const r=await mcp({id:1,method:'tools/call',params:{name:'personal_operation',arguments:args}},{...env,scopes});return {error:!!r.result.isError,text:r.result.content[0].text};};
const ok=r=>{assert.equal(r.error,false,r.text);return JSON.parse(r.text);};
const list=async env=>ok(await call(env,{type:'tracker-list'}));

// Finding 1: "track belly 94 on Friday" was read as the coming Friday and refused.
test('a weekday is the most recent one, worked out in code, whatever date a model sends',()=>{
 const today='2026-10-12';// a Monday
 assert.deepEqual(dayMentions('track belly 94 on Friday',today),['2026-10-09']);
 assert.deepEqual(dayMentions('Bauch 94 am Freitag',today),['2026-10-09']);
 assert.deepEqual(dayMentions('track stretching yesterday',today),['2026-10-11']);
 assert.deepEqual(dayMentions('gestern',today),['2026-10-11']);
 assert.deepEqual(dayMentions('vorgestern',today),['2026-10-10']);
 assert.deepEqual(dayMentions('the day before yesterday',today),['2026-10-10']);
 // Today's own weekday name is a week ago, unless they say "today" too.
 assert.deepEqual(dayMentions('track belly 94 on Monday',today),['2026-10-05']);
 assert.deepEqual(dayMentions('track belly 94 today, Monday',today),['2026-10-12']);
 assert.deepEqual(dayMentions('Sonntag',today),['2026-10-11']);
 assert.deepEqual(dayMentions('track belly 94',today),[]);
 assert.equal(resolveOn('Friday',today),'2026-10-09');assert.equal(resolveOn('2026-10-02',today),'2026-10-02');
 assert.throws(()=>resolveOn('soon',today),/today, yesterday or a weekday/);
 // Their words win over a date worked out elsewhere; a date they said themselves stands.
 assert.equal(entryOn({on:'2026-10-16',words:'track belly 94 on Friday'},today),'2026-10-09');
 assert.equal(entryOn({on:'2026-10-02',words:'track belly 94 for Friday the 2nd'},today),'2026-10-02');
 assert.equal(entryOn({on:'2026-10-02',words:'track belly 94, two weeks ago on Friday'},today),'2026-10-02');
 // An assistant that sends a date of its own sends their words with it.
 assert.throws(()=>entryOn({on:'2026-10-09'},today,{assistant:true}),/words/);
 assert.equal(entryOn({on:'Friday'},today,{assistant:true}),'2026-10-09');
});

test('"track belly 94 on Friday" holds the 94 for last Friday, and the next entry is compared with it',async t=>{
 const env=fixture(t);
 // What the bot sent on 12 October: the coming Friday as a date. Its words put it on the Friday just past.
 const held=ok(await call(env,{type:'tracker-hold',name:'Belly',unit:'cm',value:94,on:'2026-10-16',talk:'health',words:'track belly 94 on Friday'}));
 assert.equal(held.reply,"Start a new tracker called Belly, one number in cm, once a day? I've kept the 94 for 9 October.");
 // Or the person's own word for the day, worked out by the operation.
 const again=ok(await call(env,{type:'tracker-hold',name:'Belly',unit:'cm',value:94,on:'Friday',words:'track belly 94 on Friday'}));
 assert.equal(again.reply,held.reply);
 const made=ok(await call(env,{type:'tracker-create',proposal_id:again.proposal_id,words:'yes'}));
 assert.equal(made.reply,'Tracked: Belly 94 cm on Friday. From now on just say "track belly" and the number.','no health talk here, so none is named');
 const [belly]=trackers(env.store);assert.deepEqual(entries(env.store,belly).map(e=>[e.data.when,e.data.value]),[['2026-10-09',94]]);
 const today=ok(await call(env,{type:'track',tracker:belly.id,value:92,words:'track belly 92'}));
 assert.equal(today.reply,'Tracked: 92 cm, down 2 since Friday.');
 // A future day is refused, and the refusal says how to pass their words.
 const future=await call(env,{type:'track',tracker:belly.id,value:91,on:'2026-10-16',words:'track belly 91 on the 16th'});
 assert.equal(future.error,true);assert.match(future.text,/in the future\. A weekday they named is the most recent one: pass their own words as on/);
 const bare=await call(env,{type:'track',tracker:belly.id,value:91,on:'2026-10-09'});
 assert.equal(bare.error,true);assert.match(bare.text,/as words/);
 // German: "gestern" is yesterday.
 const de=ok(await call(env,{type:'track',tracker:belly.id,value:93,on:'gestern',words:'track Bauch 93 gestern'}));
 assert.equal(de.reply,'Tracked: 93 cm yesterday, down 1 since Friday.');
});

// "track waist 90" lands in Belly, which already has today's 92: the reply names Belly (the design's
// "Tracked under Belly"), so a wrong match shows at once.
test('another name for a tracker that has an entry today names the tracker it used',async t=>{
 const env=fixture(t);
 const held=ok(await call(env,{type:'tracker-hold',name:'Belly',unit:'cm',value:92,words:'track belly 92'}));
 ok(await call(env,{type:'tracker-create',proposal_id:held.proposal_id,words:'yes'}));
 const belly=(await list(env)).trackers[0];
 const r=ok(await call(env,{type:'track',tracker:belly.id,value:90,new_name:'Waist',words:'track waist 90',expected:{['collections/'+belly.id]:belly.hash,['collection_items/'+belly.today.id]:belly.today.hash}}));
 assert.equal(r.reply,"Tracked under Belly: today's 92 cm is now 90 cm.");
 assert.deepEqual((await list(env)).trackers[0].names,['Belly','Waist']);
});

// Finding 2: "Your health talk will read it." on a mission control with no health talk.
test('a tracker is given to a talk, and the reply says so, only when that talk exists',async t=>{
 const none=fixture(t);
 const a=ok(await call(none,{type:'tracker-hold',name:'Belly',unit:'cm',value:92,talk:'health',words:'track belly 92'}));
 const ma=ok(await call(none,{type:'tracker-create',proposal_id:a.proposal_id,words:'yes'}));
 assert.doesNotMatch(ma.reply,/talk/);assert.equal(trackers(none.store)[0].tracker.talk,null);
 assert.equal(talkExists(none.root,'health'),false);
 const env=fixture(t,{talks:['health']});
 const b=ok(await call(env,{type:'tracker-hold',name:'Belly',unit:'cm',value:92,talk:'health',words:'track belly 92'}));
 const mb=ok(await call(env,{type:'tracker-create',proposal_id:b.proposal_id,words:'yes'}));
 assert.match(mb.reply,/ Your health talk will read it\.$/);assert.equal(trackers(env.store)[0].tracker.talk,'health');
 // An area a habit made with no talk is not a talk.
 fs.mkdirSync(path.join(env.root,'coach','work'),{recursive:true});fs.writeFileSync(path.join(env.root,'coach','work','area.md'),'AREA: work\nTITLE: Work\nRHYTHM: none\nSTATUS: on\n\n## Preparation\n\nx\n');
 assert.equal(talkExists(env.root,'work'),false);assert.equal(talkExists(env.root,'health'),true);
});

// Finding 4: a tracker set up on purpose with two columns became an hours-only tracker plus a
// second question, the yes got a question back, and an entry was made that nobody said yes to.
test('"I want to track my sleep: hours, and quality from 1 to 5" is one tracker with both columns, made only by the yes',async t=>{
 const env=fixture(t);
 const said='I want to track my sleep: hours, and quality from 1 to 5';
 const held=ok(await call(env,{type:'tracker-hold',name:'Sleep',fields:[{label:'Hours',type:'number',unit:'hours'},{label:'Quality',type:'number',min:1,max:5}],words:said}));
 assert.equal(held.reply,'Start a new tracker called Sleep, with hours and quality from 1 to 5, once a day?');
 assert.equal(env.store.get('tracker_proposals',held.proposal_id).entry,null,'nothing has happened yet, so nothing is held');
 // Asked and created in one turn: refused. Created with no words: refused.
 const same=await call(env,{type:'tracker-create',proposal_id:held.proposal_id,words:said});
 assert.equal(same.error,true);assert.match(same.text,/the message that asked for the tracker/);
 const silent=await call(env,{type:'tracker-create',proposal_id:held.proposal_id});
 assert.equal(silent.error,true);assert.match(silent.text,/answer as words/);
 assert.equal(trackers(env.store).length,0);
 const made=ok(await call(env,{type:'tracker-create',proposal_id:held.proposal_id,words:'yes'}));
 assert.equal(made.reply,'Sleep is ready. Say "track sleep" with its hours and quality.');assert.equal(made.entry_id,null);
 const [sleep]=trackers(env.store);
 assert.deepEqual(sleep.field_schema.map(f=>[f.key,f.type,f.unit??null,f.min??null,f.max??null]),[['when','date',null,null,null],['hours','number','hours',null,null],['quality','number',null,1,5],['note','text',null,null,null]]);
 assert.equal(entries(env.store,sleep).length,0);
 const tracked=ok(await call(env,{type:'track',tracker:sleep.id,data:{hours:7,quality:4},words:'track sleep, 7 hours, quality 4'}));
 assert.equal(tracked.reply,'Tracked: Sleep, 7 hours, quality 4 of 5.');
 const out=await call(env,{type:'track',tracker:sleep.id,data:{hours:7,quality:7},on:'yesterday',words:'track sleep yesterday, 7 hours, quality 7'});
 assert.equal(out.error,true);assert.match(out.text,/Quality is from 1 to 5/);
});

test('columns without keys get keys, and a held count does not fail a yes that asks for columns',async t=>{
 const env=fixture(t);
 // "track sleep" held a count; the yes asks for two number columns: the tracker starts empty.
 const held=ok(await call(env,{type:'tracker-hold',name:'Sleep',words:'track sleep'}));
 const made=ok(await call(env,{type:'tracker-create',proposal_id:held.proposal_id,fields:[{label:'Hours',type:'number'},{label:'Sleep quality',type:'number',min:1,max:5}],words:'yes, with hours and quality from 1 to 5'}));
 assert.equal(made.entry_id,null);
 assert.deepEqual(trackers(env.store)[0].field_schema.map(f=>f.key),['when','hours','sleep_quality','note']);
 // An assistant passes the words that asked, so the yes can be told from them.
 const bare=await call(env,{type:'tracker-hold',name:'Naps'});
 assert.equal(bare.error,true);assert.match(bare.text,/own message as words/);
});

// Finding 5: list_records with a filter of the wrong shape crashed on the server.
test('a filter of the wrong shape is refused in words',async t=>{
 const env=fixture(t);
 const r=await mcp({id:1,method:'tools/call',params:{name:'list_records',arguments:{type:'collections',filters:[{field:'id',operator:'eq',value:'sleep-14a7be21'}]}}},{...env,scopes});
 assert.equal(r.result.isError,true);
 assert.match(r.result.content[0].text,/^Each filter is a list of three: an operator, a column and a value, for example \["eq","id","<id>"\]; got \{"field":"id","operator":"eq","value":"sleep-14a7be21"\}\.$/);
 assert.throws(()=>env.query.execute({table:'collections',filters:'id=1'}),/filters is a list/);
 assert.throws(()=>env.query.execute({table:'collections',filters:[['near','id',1]]}),/Unsupported filter near/);
 assert.deepEqual(env.query.execute({table:'collections',filters:[['eq','id','x']]}).data,[]);
});

// Finding 8: the empty Collections page called collections "structured trackers".
test('the empty Collections page does not call collections trackers',()=>{
 const page=fs.readFileSync(new URL('../ui/src/pages/Collections.tsx',import.meta.url),'utf8');
 assert.doesNotMatch(page,/structured trackers/);
 assert.match(page,/A collection is a table of things you want to keep in order/);
 assert.match(page,/Anything you track by saying "track" goes on its own Trackers shelf here\./);
});

// Finding 7: on a brand-new mission control a habit did not start, because the coach required an
// existing area with a talk. Now the coach makes the area, with no talk, and the habit is on the
// Trackers shelf at once: track it, yesterday, take the last one back, a no for today.
test('a new habit on day one reaches the shelf, and "track stretching yesterday" is worked out in code',async t=>{
 const env=fixture(t);
 fs.writeFileSync(path.join(env.root,'AGENTS.md'),'# test\n');
 const started=ok(await call(env,{type:'addon-command',addon:'coach',args:['habit','add','health','stretching','--title','Stretching','--done-means','ten minutes on the mat','--days','daily']}));
 assert.match(started.result,/"area_created":true/);
 assert.equal(talkExists(env.root,'health'),false,'the area has no talk');
 const habit=(await list(env)).trackers.find(x=>x.specialist==='habit');
 assert.deepEqual({id:habit.id,name:habit.name,status:habit.status},{id:'habit-health-stretching',name:'Stretching',status:'active'});
 assert.equal(ok(await call(env,{type:'track',tracker:habit.id,words:'track stretching'})).reply,'Tracked: stretching, done today.');
 assert.equal(ok(await call(env,{type:'track',tracker:habit.id,on:'yesterday',words:'track stretching yesterday'})).reply,'Tracked: stretching, done yesterday.');
 assert.equal(ok(await call(env,{type:'tracker-correct',tracker:habit.id,remove:true,words:'delete the last stretching'})).reply,'Removed: stretching, done yesterday.');
 assert.equal(ok(await call(env,{type:'tracker-correct',tracker:habit.id,answer:'no',words:'no stretching today'})).reply,'Changed: stretching is not done today.');
 const file=fs.readFileSync(path.join(env.root,'coach','health','habits','stretching.md'),'utf8');
 assert.match(file,/- 2026-10-12 done \(notebook\) "track stretching"\n- 2026-10-12 no \(notebook\) "no stretching today"\n$/);
});
