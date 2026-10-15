import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {createHash} from 'node:crypto';import os from 'node:os';import path from 'node:path';
import {installSkillTree} from '../core/packaged-skills.mjs';

// One recipe owns "track" (D-321): the tracker recipe takes it, the journal
// gives it up, and the coach's talks read the trackers for their area.
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8').replaceAll('\r','');
const digest=text=>createHash('sha256').update(text).digest('hex');

test('shipped progress recipes remain eligible for later upgrades, while owner edits require review',t=>{
 for(const name of ['coach','tracker']){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-progress-recipe-upgrade-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store={root,state:path.join(root,'.godspeed')},source=path.join(root,'incoming',name),target=path.join(root,'skills',name);
  fs.mkdirSync(source,{recursive:true});fs.mkdirSync(target,{recursive:true});
  const shipped=read('../recipes/'+name+'/SKILL.md'),next=shipped+'\nA fictional next packaged version.\n';
  fs.writeFileSync(path.join(source,'SKILL.md'),next);
  fs.writeFileSync(path.join(target,'SKILL.md'),shipped.replaceAll('\n','\r\n'));
  const upgraded=installSkillTree(store,source,target);
  assert.deepEqual(upgraded,{updated:1,conflicts:0},'a known stock recipe upgrades without a pre-existing ledger');
  assert.equal(fs.readFileSync(path.join(target,'SKILL.md'),'utf8'),next);
  assert.equal(fs.readFileSync(path.join(store.state,'skill-history',name,digest(shipped),'SKILL.md'),'utf8').replaceAll('\r',''),shipped,'the prior shipped text is retained');
  const custom=next+'\nThe owner added a private preference.\n';fs.writeFileSync(path.join(target,'SKILL.md'),custom);
  fs.writeFileSync(path.join(source,'SKILL.md'),next+'\nAnother fictional package change.\n');
  const reviewed=installSkillTree(store,source,target);
  assert.equal(reviewed.conflicts,1);assert.equal(reviewed.updated,0);
  assert.equal(fs.readFileSync(path.join(target,'SKILL.md'),'utf8'),custom,'an owner edit is never overwritten');
 }
});

test('the tracker recipe owns "track" and the journal no longer takes it',()=>{
  const tracker=read('../recipes/tracker/SKILL.md'),journal=read('../recipes/interstitial-journal/SKILL.md'),coach=read('../recipes/coach/SKILL.md');
  assert.match(tracker,/^---\nname: tracker\ndescription: Track anything/);
  assert.match(tracker,/tracker-hold/);assert.match(tracker,/tracker-create/);assert.match(tracker,/"expected":\{"collection_items\/<id>":"<hash>"\}/);
  assert.doesNotMatch(tracker,/[–—]/,'no long dashes');
  const description=journal.match(/^description: (.*)$/m)[1];
  assert.doesNotMatch(description,/"track"/,'the journal description no longer lists track');
  assert.match(description,/"journal", "j:", "log:" or "Tagebuch"/);
  assert.match(journal,/"track" is never a journal entry/);
  assert.match(coach,/"type":"tracker-list","talk":"<area>","days":7/);
  // The vendored add-ons are the copies the recipes come from.
  assert.equal(journal,read('../../third-party/addons/godspeed-journal/skill/interstitial-journal/SKILL.md'));
  assert.equal(coach,read('../../third-party/addons/godspeed-coach/skill/coach/SKILL.md'));
});

test('the tracker recipe is listed, and an unedited earlier journal or coach recipe is replaced',()=>{
  const inventory=JSON.parse(read('../data/recipe-inventory.json'));
  assert.deepEqual(inventory.find(r=>r.name==='tracker'),{...inventory.find(r=>r.name==='headache-tracker'),name:'tracker'});
  const revisions=JSON.parse(read('../data/recipe-revisions.json'));
  // The texts shipped before 11 October 2026, which an installation may still hold.
  assert.ok(revisions['interstitial-journal/SKILL.md'].includes('b6c6d726f3099badc70ce2d50d5d5472c62367f45d49b537d69621d0d3eb532b'));
  assert.ok(revisions['coach/SKILL.md'].includes('70704119ef404a19a6d92b058f7adb7e42a8f64fd94ad28912933b55372c979b'));
  for(const name of ['tracker','interstitial-journal','coach'])assert.ok(revisions[name+'/SKILL.md'].includes(digest(read('../recipes/'+name+'/SKILL.md'))),name+' ships a known revision');
});

// Step 2 (D-321): only the tracker recipe claims a message that starts with "track". The coach and
// the headache tracker keep their own words ("did head lifts", "headache since 6:30") and get
// "track ..." handed on by the tracker recipe.
test('the coach and headache recipes no longer claim "track", and their vendored copies are what ships',()=>{
  for(const name of ['coach','headache-tracker']){
    const text=read('../recipes/'+name+'/SKILL.md'),description=text.match(/^description: (.*)$/m)[1];
    assert.doesNotMatch(description,/"track /i,name+' no longer claims track');
    assert.match(text,/starts with "track"/,name+' says where track goes');
  }
  assert.match(read('../recipes/coach/SKILL.md').match(/^description: (.*)$/m)[1],/"did head lifts", "head lifts done", "Kopfheben erledigt"/);
  assert.match(read('../recipes/headache-tracker/SKILL.md').match(/^description: (.*)$/m)[1],/"headache over", "Kopfweh ist weg"/);
  assert.equal(read('../recipes/headache-tracker/SKILL.md'),read('../../third-party/addons/godspeed-headache/skill/headache-tracker/SKILL.md'));
  assert.equal(read('../recipes/coach/SKILL.md'),read('../../third-party/addons/godspeed-coach/skill/coach/SKILL.md'));
  const revisions=JSON.parse(read('../data/recipe-revisions.json'));
  // The texts shipped until 12 October 2026, which the bot's home and the workspace may still hold.
  assert.ok(revisions['coach/SKILL.md'].includes('00d0540e750f300be679461b625225655837069818a5ce17e9a5b0f6ca7810ee'));
  assert.ok(revisions['headache-tracker/SKILL.md'].includes('a817b4a2f7c3c00ac2792cff4b0d23450332dd8607ad9e4eccc15c577757363b'));
  for(const name of ['coach','headache-tracker'])assert.ok(revisions[name+'/SKILL.md'].includes(digest(read('../recipes/'+name+'/SKILL.md'))),name+' ships a known revision');
});

// The headache add-on writes the notebook's record files itself (its lib/notebook.mjs), with a
// copy of the notebook's YAML module: the two must never drift apart.
test('the headache add-on carries the notebook\'s own YAML module',()=>{
  assert.equal(read('../../third-party/addons/godspeed-headache/lib/yaml.mjs'),read('../core/records/yaml.mjs'));
});

// The tracker recipe claims every "track" and hands a habit and a headache on, in the order of the
// design: habit, headache, tracker, new tracker (D-321).
test('the tracker recipe takes every "track" and hands habits and headaches on',()=>{
  const tracker=read('../recipes/tracker/SKILL.md'),description=tracker.match(/^description: (.*)$/m)[1];
  assert.match(description,/every message that starts with "track"/);
  assert.doesNotMatch(description,/not a habit|not a headache/);
  const order=['**An active habit**','**A headache, a pill or a pain level**','**The period or the cycle**','**Food, a meal or something they ate or drank**','**One of the trackers\' names','**Anything else**'].map(x=>tracker.indexOf(x));
  assert.ok(order.every(i=>i>0)&&order.every((i,n)=>!n||i>order[n-1]),'the hand-off order');
  assert.match(tracker,/\{"type":"track","tracker":"<its id>","words":"<their message>"\}/);
  assert.match(tracker,/load the headache-tracker recipe/);
  assert.match(tracker,/Never `track` on the Headaches tracker/);
  assert.doesNotMatch(tracker,/[–—]/,'no long dashes');
  const revisions=JSON.parse(read('../data/recipe-revisions.json'));
  assert.ok(revisions['tracker/SKILL.md'].includes('3bc20a6ad70ca45c2d7740b7716d2f86bef907f17a00245347f7bcd38993b53e'),'the text shipped until today');
});

// Step 4 (D-321): the cycle tracker has its own recipe, and the tracker recipe hands the period and
// the cycle words to it, after a habit and a headache and before its own trackers.
test('the cycle-tracker recipe claims the period and declines what it never answers',()=>{
  const cycle=read('../recipes/cycle-tracker/SKILL.md'),description=cycle.match(/^description: (.*)$/m)[1];
  assert.match(cycle,/^---\nname: cycle-tracker\n/);
  for(const words of ['"track period"','"track Periode"','"track period over"','"when is my next period?"','"tell me two days before my period"','"delete my cycle tracker"','"track cramps"'])assert.ok(description.includes(words),words);
  assert.match(description,/fertile window, ovulation, safe days or getting pregnant, which you decline/);
  assert.match(cycle,/\{"type":"cycle","action":"decline"\}/);assert.match(cycle,/\{"type":"cycle","action":"forecast"\}/);
  assert.match(cycle,/"confirm":"<request_id>","expected":<that map>/);
  assert.match(cycle,/never a message/);assert.doesNotMatch(cycle,/[–—]/,'no long dashes');
  // The bot's rehearsal (12 October 2026) cut the setup question to its first and last sentence.
  assert.match(cycle,/word for word and whole, and nothing else\. Never shorten,\nsummarise or reword it/);
  const tracker=read('../recipes/tracker/SKILL.md');
  assert.match(tracker,/load the cycle-tracker recipe/);assert.match(tracker,/Never `track` on the cycle tracker/);
  const inventory=JSON.parse(read('../data/recipe-inventory.json'));
  assert.deepEqual(inventory.find(r=>r.name==='cycle-tracker'),{...inventory.find(r=>r.name==='tracker'),name:'cycle-tracker'});
  const revisions=JSON.parse(read('../data/recipe-revisions.json'));
  for(const name of ['tracker','cycle-tracker'])assert.ok(revisions[name+'/SKILL.md'].includes(digest(read('../recipes/'+name+'/SKILL.md'))),name+' ships a known revision');
  // The tracker text shipped until 12 October 2026 (e8eb43c) stays known, so an unedited copy is replaced.
  assert.ok(revisions['tracker/SKILL.md'].includes('670b19ada22060f4bf9f6e7e44bfee6ec6fe7507a636e5faa33f13c992583e85'));
});

// Step 5 (D-321): the food tracker has its own recipe, and the tracker recipe hands food to it, after the
// cycle and before its own trackers.
test('the food-tracker recipe claims food, keeps every number with the operation, and is listed',()=>{
  const food=read('../recipes/food-tracker/SKILL.md'),description=food.match(/^description: (.*)$/m)[1],tracker=read('../recipes/tracker/SKILL.md');
  assert.match(food,/^---\nname: food-tracker\n/);
  for(const words of ['"track food, ..."','"track usual lunch"','"what did I eat today?"','"set my food target"','"stop showing calories"','"remember this as my usual lunch"','"the eggs were three"'])assert.ok(description.includes(words),words);
  assert.match(food,/Work out calories, protein or a target yourself/);assert.match(food,/Guess the size of a pack, bowl, plate, glass or can/);
  assert.match(food,/under 19, pregnant, breastfeeding, or who has or had an eating\s+disorder/);
  assert.match(food,/"expected":\{"collection_items\/<id>":"<hash>"\}/);
  assert.doesNotMatch(food,/[–—]/,'no long dashes');
  assert.match(tracker,/load the food-tracker recipe/);assert.match(tracker,/Never `track` on the food tracker/);
  assert.match(tracker.match(/^description: (.*)$/m)[1],/the period and food included/);
  const inventory=JSON.parse(read('../data/recipe-inventory.json'));
  assert.deepEqual(inventory.find(r=>r.name==='food-tracker'),{...inventory.find(r=>r.name==='tracker'),name:'food-tracker'});
  const revisions=JSON.parse(read('../data/recipe-revisions.json'));
  assert.ok(revisions['tracker/SKILL.md'].includes('b876984f2d8ad2f25ffda69c45ac2978cea74a9a86e840d863704e2d79f5b1a1'),'the tracker text shipped until today');
  for(const name of ['tracker','food-tracker'])assert.ok(revisions[name+'/SKILL.md'].includes(digest(read('../recipes/'+name+'/SKILL.md'))),name+' ships a known revision');
});

// The book's capture run of 12 October 2026 (D-321): the bot retyped an operation's reply, set up a
// two-column tracker as two trackers, asked and created in one turn, worked out a weekday's date as
// the coming one, gave a pill the time of the message, and asked for a talk to start a habit. The
// recipes the product ships say what to do instead, and Michael's own copies are the same text.
test('the shipped recipes pass an operation\'s reply on as it came, set up columns in one tracker, and leave days to the operation',()=>{
  const tracker=read('../recipes/tracker/SKILL.md');
  assert.match(tracker.replace(/\s+/g,' '),/Your reply is the operation's `reply`, exactly as it came\*\*: the same words, the same quotes and the same punctuation, character for character, with nothing added and nothing left out\. Never retype it in your own style\. Only when they wrote in another language than the reply's, say it in theirs, and keep every number, name and day\./);
  assert.match(tracker,/"fields":\[\{"label":"Hours","type":"number","unit":"hours"\},\{"label":"Quality","type":"number","min":1,"max":5\}\]/);
  assert.match(tracker,/Never split their columns into\s+trackers of their own/);
  assert.match(tracker,/\{"type":"tracker-create","proposal_id":"<id>","words":"<their answer>"\}/);
  assert.match(tracker,/Never create a tracker in the turn that asked/);
  assert.match(tracker,/`"on":"Friday"`/);assert.match(tracker,/Never work out a weekday's date yourself/);
  assert.match(tracker,/"data":\{"hours":7,"quality":4\}/);
  for(const name of ['food-tracker','cycle-tracker'])assert.match(read('../recipes/'+name+'/SKILL.md'),/Reply with the operation's `reply`, word for word and whole, and nothing else[.:]/,name);
  assert.match(read('../recipes/food-tracker/SKILL.md'),/the same words, quotes and\npunctuation, character for character, never retyped in your own style/);
  assert.match(read('../recipes/cycle-tracker/SKILL.md'),/or retype its quotes and punctuation in your own style/);
  for(const name of ['food-tracker','cycle-tracker'])assert.match(read('../recipes/'+name+'/SKILL.md'),/`"on":"yesterday"` or `"on":"Friday"`/,name);
  const headache=read('../recipes/headache-tracker/SKILL.md');
  assert.match(headache,/\*\*When a pill was taken\*\*: only a time they said\./);assert.match(headache,/Never give it the time of their message\./);
  const coach=read('../recipes/coach/SKILL.md');
  assert.match(coach,/It does not have to exist: when it does not, the command makes it, with no talk\./);
  assert.match(coach,/never ask for a day or time, set up a talk, or offer one to start a habit/);
  for(const text of [tracker,headache,coach])assert.doesNotMatch(text,/[–—]/,'no long dashes');
  const revisions=JSON.parse(read('../data/recipe-revisions.json'));
  for(const name of ['tracker','coach','headache-tracker','food-tracker','cycle-tracker'])assert.ok(revisions[name+'/SKILL.md'].includes(digest(read('../recipes/'+name+'/SKILL.md'))),name+' ships a known revision');
  // The texts shipped until today stay known, so an unedited installed copy is replaced.
  for(const [name,old] of [['tracker','0284d7e3c89601983997724ee8d2bd2f88f510f9a4b290ca6338888561abf7d1'],['food-tracker','ceaa7e6c7934218eb618775fd815f03a08dfaa3b0654657074a67aa802b8c716']])assert.ok(revisions[name+'/SKILL.md'].includes(old),name);
});

// The recapture of 12 October 2026: the headache replies began "Saved:", as the recipe's example did,
// and a habit's no came back as "Tracked: stretching, no today.".
test('the headache recipe replies with "Tracked:", and the coach recipe says a no in words',()=>{
  const headache=read('../recipes/headache-tracker/SKILL.md'),coach=read('../recipes/coach/SKILL.md');
  assert.match(headache,/starting with\n"Tracked:", never "Saved:"/);
  assert.match(headache,/`Tracked: since 06:30, pain 3, right side, pounding, 2 Thomapyrin at 06:45\.`/);
  assert.doesNotMatch(headache,/`Saved: since/);
  assert.match(coach,/"Tracked:\n  stretching, not done today\."/);
  assert.equal(headache,read('../../third-party/addons/godspeed-headache/skill/headache-tracker/SKILL.md'));
  assert.equal(coach,read('../../third-party/addons/godspeed-coach/skill/coach/SKILL.md'));
  const revisions=JSON.parse(read('../data/recipe-revisions.json'));
  for(const name of ['coach','headache-tracker'])assert.ok(revisions[name+'/SKILL.md'].includes(digest(read('../recipes/'+name+'/SKILL.md'))),name);
});

// Mission Control's idea card of 12 October 2026: a talk that exists can be told in one sentence
// what it may look at and what it must never do, and the recipes say how, with the reader's words.
test('the coach and tracker recipes say how a talk that exists is told what it may look at and must never do',()=>{
  const coach=read('../recipes/coach/SKILL.md'),tracker=read('../recipes/tracker/SKILL.md');
  const description=coach.match(/^description: (.*)$/m)[1];
  for(const words of ['"The health talk may also look at my sleep tracker"','"The health talk must never suggest buying anything"','"The health talk no longer needs my sleep tracker"'])assert.ok(description.includes(words),words);
  const changing=coach.split('## Changing an area')[1].split('## Never')[0];
  assert.match(changing,/`godspeed-coach area read <area> "<what, in their words>"`/);
  assert.match(changing,/`godspeed-coach area read <area> "<what>" --remove`/);
  assert.match(changing,/`godspeed-coach area limit <area> "<the rule as they said it>"`/);
  assert.match(changing,/\{"type":"tracker-talk","tracker":"<its id>","talk":"<area>","words":"<their message>","expected":\{"collections\/<its id>":"<its hash>"\}\}/);
  assert.match(changing,/"The health talk may now look at your running app\.", "The health talk will never suggest buying\nanything\.", "The health talk no longer looks at your running app\."/);
  // Nothing tells the assistant to edit area.md by hand any more.
  assert.doesNotMatch(coach,/add them to\n`coach\/<area>\/area\.md` as `MAY READ:`/);
  assert.match(tracker,/^description: .*"The health talk may also look at my sleep tracker"/m);
  assert.match(tracker,/\{"type":"tracker-talk","tracker":"<id>","talk":"health","words":"<their message>","expected":\{"collections\/<id>":"<hash>"\}\}/);
  assert.doesNotMatch(coach+tracker,/[–—]/,'no long dashes');
  assert.equal(coach,read('../../third-party/addons/godspeed-coach/skill/coach/SKILL.md'));
  const revisions=JSON.parse(read('../data/recipe-revisions.json'));
  for(const name of ['coach','tracker'])assert.ok(revisions[name+'/SKILL.md'].includes(digest(read('../recipes/'+name+'/SKILL.md'))),name+' ships a known revision');
});

// "skip" is the answer for a day that shouldn't count (the evening check), "Does not count" on the
// habit page: coach 0.2.7 leaves a skipped day out of the planned days, and the recipe tells the
// talk the same, so a skipped day is never read out as a missed one.
test('the coach recipe says a skipped habit day counts neither way',()=>{
  const coach=read('../recipes/coach/SKILL.md');
  assert.match(coach.replace(/\s+/g,' '),/A day answered "skip" does not count either way: the brief's habit lines, graduating and "make it smaller" leave it out of the planned days, and so do you; never call it a missed day\./);
  assert.equal(coach,read('../../third-party/addons/godspeed-coach/skill/coach/SKILL.md'));
  assert.ok(JSON.parse(read('../data/recipe-revisions.json'))['coach/SKILL.md'].includes(digest(coach)),'coach ships a known revision');
  assert.doesNotMatch(coach,/[–—]/,'no long dashes');
});

// Michael's decision of 13 October 2026: any number of talks may read a tracker. The recipes no longer
// say a tracker has one talk or that adding one asks first; only their own "instead" moves it.
test('the tracker recipes say any number of talks may read a tracker, adding never asks, and only instead moves it',()=>{
  const tracker=read('../recipes/tracker/SKILL.md'),food=read('../recipes/food-tracker/SKILL.md'),cycle=read('../recipes/cycle-tracker/SKILL.md'),coach=read('../recipes/coach/SKILL.md');
  for(const text of [tracker,food,cycle,coach]){assert.doesNotMatch(text,/has one talk|one talk:/);assert.doesNotMatch(text,/[–—]/,'no long dashes');}
  const flat=tracker.replace(/\s+/g,' ');
  assert.match(flat,/any number of talks may read one tracker/);
  assert.match(flat,/adds that talk and never asks: the talks that read it already keep reading it\. Taking one away adds `"remove":true`, and the others keep it\. Only when their own words say instead/);
  assert.doesNotMatch(flat,/the reply asks first/);
  for(const text of [food,cycle])assert.match(text.replace(/\s+/g,' '),/adds that talk, and the talks that read it already keep reading it\. Taking one away adds `"remove":true`; `"instead":true` only when (?:they say|she says) instead/);
  const revisions=JSON.parse(read('../data/recipe-revisions.json'));
  for(const name of ['tracker','food-tracker','cycle-tracker'])assert.ok(revisions[name+'/SKILL.md'].includes(digest(read('../recipes/'+name+'/SKILL.md'))),name+' ships a known revision');
  // The texts shipped until today stay known, so an unedited installed copy is replaced.
  for(const [name,old] of [['tracker','faef7089df4754d29f994f247f88e33e8a05f97dc4bbb38eae11b2dd194ce6f1'],['food-tracker','0ef71e62224e4902619b87c047bada18f181f555a2298b105122c7315699565a'],['cycle-tracker','f78d68d429576a134f5738b9eaaa7f0931a2a25ef2402ff6b987c7afc21ed6be']])assert.ok(revisions[name+'/SKILL.md'].includes(old),name);
});

// Coach 0.2.8 (13 October 2026): several talks may look at one habit, and a talk never opens with what
// another talk raised this week. One path: where the notebook is connected a habit goes through
// tracker-talk, the same as a tracker; the coach's own command is for a mission control without it.
test('the coach and tracker recipes send a habit to another talk through tracker-talk, and the coach command only without the notebook',()=>{
  const coach=read('../recipes/coach/SKILL.md'),tracker=read('../recipes/tracker/SKILL.md');
  assert.equal(coach,read('../../third-party/addons/godspeed-coach/skill/coach/SKILL.md'),'the vendored fork is what ships');
  const changing=coach.split('## Changing an area')[1].split('## Never')[0],flat=changing.replace(/\s+/g,' ');
  assert.match(flat,/Where the notebook is connected, a habit is one of its trackers, so it goes the same way as a tracker/);
  assert.match(changing,/\{"type":"tracker-talk","tracker":"<the habit's id>","talk":"<area>","words":"<their message>","expected":\{"habits\/<the habit's id>":"<its hash>"\}\}/);
  assert.match(flat,/Without the notebook: `godspeed-coach habit read-by "<the habit>" <area>`/);
  assert.match(coach.replace(/\s+/g,' '),/The one thing is never something the brief lists under "Raised in other talks this week"/);
  assert.match(coach,/- An opening about something another talk raised in the last seven days\./);
  const flatTracker=tracker.replace(/\s+/g,' ');
  assert.match(flatTracker,/A habit is one of the trackers too \("The work talk may also look at my stretching habit"\): the same call with the habit's id from `tracker-list`, with `"expected":\{"habits\/<id>":"<hash>"\}`/);
  assert.match(tracker.match(/^description: (.*)$/m)[1],/"The work talk may also look at my stretching habit"/);
  for(const text of [coach,tracker])assert.doesNotMatch(text,/[–—]/,'no long dashes');
  const revisions=JSON.parse(read('../data/recipe-revisions.json'));
  for(const name of ['coach','tracker'])assert.ok(revisions[name+'/SKILL.md'].includes(digest(read('../recipes/'+name+'/SKILL.md'))),name+' ships a known revision');
  // The texts shipped until today stay known, so an unedited installed copy is replaced.
  for(const [name,old] of [['coach','3f5ee7b357f84c86a8cec168e7dd7934533875f300437189075e64250babf784'],['tracker','ccae4c80ee9c41de012c6ed236f0a15161037164860e8c875d00103d4b2a44b3']])assert.ok(revisions[name+'/SKILL.md'].includes(old),name);
});

// A talk they start themselves in the chat is seen already (14 October 2026): the open command its brief
// prints ends with --shown, and the recipe says to keep it, so the next conversation does not bring the
// same talk up again under another talk's opening.
test('the coach recipe keeps --shown on the open command of a talk they start themselves',()=>{
  const coach=read('../recipes/coach/SKILL.md');
  assert.equal(coach,read('../../third-party/addons/godspeed-coach/skill/coach/SKILL.md'));
  const started=coach.split('## A talk they start themselves')[1].split('## A new area')[0].replace(/\s+/g,' ');
  assert.match(started,/The open command that brief prints ends with `--shown`, because they read the opening right here: run it exactly as printed, so a later conversation does not bring the talk up again\./);
  assert.doesNotMatch(coach,/[–—]/,'no long dashes');
  const revisions=JSON.parse(read('../data/recipe-revisions.json'));
  assert.ok(revisions['coach/SKILL.md'].includes(digest(coach)),'coach ships a known revision');
  assert.ok(revisions['coach/SKILL.md'].includes('11de14f3425b1bb724910164a968f3f211524312a95689593e32d5f077c9e0ff'),'the text shipped until today stays known');
});

// The capture of 14 October 2026 (99e85dc): with the health talk open, "Can we do the psychology talk
// now?" was saved as an answer to it. The recipe says a request for another talk starts that talk.
test('the coach recipe: asking for another talk while one is open starts that talk and never answers the open one',()=>{
  const coach=read('../recipes/coach/SKILL.md');
  assert.equal(coach,read('../../third-party/addons/godspeed-coach/skill/coach/SKILL.md'));
  const flat=s=>s.replace(/\s+/g,' ');
  assert.match(flat(coach.split('## Continuing a talk')[1].split('## Closing a talk')[0]),/A message that asks for a talk of another area \("can we do the psychology talk now\?"\) is not about the open talk: follow "A talk they start themselves"\./);
  assert.match(flat(coach.split('## A talk they start themselves')[1].split('## A new area')[0]),/This holds while a talk of another area is open: that talk stays open as it is, and the request is never saved with `talk said` as an answer to it\./);
  assert.doesNotMatch(coach,/Their answer continues it|Their reply continues it/);
  assert.doesNotMatch(coach,/[–—]/,'no long dashes');
  const revisions=JSON.parse(read('../data/recipe-revisions.json'));
  assert.ok(revisions['coach/SKILL.md'].includes(digest(coach)),'coach ships a known revision');
  for(const old of ['e36b83a48a486083b883cf83c96844cf515c815bd207a0a708ecad9df614d3e5','11de14f3425b1bb724910164a968f3f211524312a95689593e32d5f077c9e0ff'])assert.ok(revisions['coach/SKILL.md'].includes(old),'the texts shipped until today stay known');
});

// The work talk of 14 October 2026 opened on a to-do title he no longer knew, while the goal research
// lay unread, and continued in Claude Code it ran four commands on his screen before a word to him.
// Coach 0.3.0: the research is the talk's material, a thing is said as what it is, and where commands
// show on screen nothing runs during the talk.
test('the coach recipe: the research is the talk\'s material, and a talk on a screen runs nothing',()=>{
  const coach=read('../recipes/coach/SKILL.md');
  assert.equal(coach,read('../../third-party/addons/godspeed-coach/skill/coach/SKILL.md'));
  const flat=s=>s.replace(/\s+/g,' ');
  const opening=flat(coach.split('## Opening a talk')[1].split('## Continuing a talk')[0]);
  assert.match(opening,/The brief's research sections \("What the research found for \.\.\."\) are the talk's main material\./);
  assert.match(opening,/never by a title from the obligations list, a work-item code or a goal id/);
  assert.match(opening,/--prepared "<two to four more things from the research, one line each, in plain words with their date and source link, ready for 'what else do you have\?'>"/);
  const continuing=flat(coach.split('## Continuing a talk')[1].split('## Closing a talk')[0]);
  assert.match(continuing,/run nothing while the talk goes on, and save all their messages at the close in one `talk said` with one `--words` per message/);
  assert.match(continuing,/The \[godspeed-coach\] block carries the opening and what was prepared: answer from it\./);
  assert.doesNotMatch(coach,/[–—]/,'no long dashes');
  const revisions=JSON.parse(read('../data/recipe-revisions.json'));
  assert.ok(revisions['coach/SKILL.md'].includes(digest(coach)),'coach ships a known revision');
  for(const old of ['a7ab480751bff1576ef2eb77382e795455db4c4d9d064248b6061e8c09f540d0','e36b83a48a486083b883cf83c96844cf515c815bd207a0a708ecad9df614d3e5'])assert.ok(revisions['coach/SKILL.md'].includes(old),'the texts shipped until today stay known');
});

// Hermes refuses a recipe whose description is longer than 1024 characters. The coach's was 1036, so
// on 15 October 2026 the assistant's own review could not patch it and wrote a short description
// that named none of its triggers. Coach 0.3.2: 978 characters, every trigger kept.
test('the coach recipe\'s description fits Hermes\'s 1024-character limit',()=>{
  const coach=read('../recipes/coach/SKILL.md');
  assert.equal(coach,read('../../third-party/addons/godspeed-coach/skill/coach/SKILL.md'));
  const description=coach.match(/^description: (.*)$/m)[1];
  assert.ok(description.length<1000,`the description is ${description.length} characters`);
  const revisions=JSON.parse(read('../data/recipe-revisions.json'));
  assert.ok(revisions['coach/SKILL.md'].includes(digest(coach)),'coach ships a known revision');
  assert.ok(revisions['coach/SKILL.md'].includes('fe19d3c02796f5cc024f42b397893e35ac760e1b7ca0f3a99def77ce03e176d7'),'the text shipped until today stays known');
});

// The talks of 14 and 15 October 2026 opened unprepared: the talk job's model wrote the opening in
// about a minute. Coach 0.4.0: a job of its own prepares each talk ahead (coach/<area>/prep/<date>.md),
// the talk opens with that opening as written, and the talk goes on like two people deciding
// something, reading the prepared file once when the talk card does not answer.
test('the coach recipe: a prepared talk opens as written, and the talk goes on like two people deciding something',()=>{
  const coach=read('../recipes/coach/SKILL.md');
  assert.equal(coach,read('../../third-party/addons/godspeed-coach/skill/coach/SKILL.md'));
  const flat=s=>s.replace(/\s+/g,' ');
  const opening=flat(coach.split('## Opening a talk')[1].split('## Continuing a talk')[0]);
  assert.match(opening,/1\. If the brief carries a prepared talk \(its section "The prepared talk"\), that is the preparation and the opening is written: skip steps 2 to 4, run the open command the brief prints \(with `--from-prep`\) as step 5 says, and your final answer is the opening it prints, exactly\./);
  assert.match(opening,/ 7\. Your final answer is the opening and nothing else\./);
  const continuing=flat(coach.split('## Continuing a talk')[1].split('## Closing a talk')[0]);
  assert.match(continuing,/3\. Talk like two people deciding something together, in the area's tone\./);
  assert.match(continuing,/The talk card in the block is the short version; the prepared talk file \(`coach\/<area>\/prep\/<date>\.md`\) holds the depth, so when the card does not answer them, read that file once rather than searching anywhere else\./);
  assert.doesNotMatch(continuing,/Answer like a person across the table/);
  assert.doesNotMatch(coach,/[\u2013\u2014]/,'no long dashes');
  assert.ok(coach.match(/^description: (.*)$/m)[1].length<1000);
  const revisions=JSON.parse(read('../data/recipe-revisions.json'));
  assert.ok(revisions['coach/SKILL.md'].includes(digest(coach)),'coach ships a known revision');
  assert.ok(revisions['coach/SKILL.md'].includes('3d17c43123ffe72d96f9c213bf67baf0ad15855bf4017caa1b394463c8473783'),'the text shipped until today stays known');
});

// With coach 0.4.1 Claude Code still answered a talk in three to four sentences: two that answer, a
// closing question, sometimes a third explaining. He wants a fast answer in one sentence, maybe two.
// Coach 0.4.2: an answer is two sentences at most, the closing question included.
test('the coach recipe: an answer in a talk is two sentences at most, the closing question included',()=>{
  const coach=read('../recipes/coach/SKILL.md');
  assert.equal(coach,read('../../third-party/addons/godspeed-coach/skill/coach/SKILL.md'));
  const continuing=coach.split('## Continuing a talk')[1].split('## Closing a talk')[0].replace(/\s+/g,' ');
  assert.match(continuing,/An answer is two sentences at most, the closing question included; a suggestion is one sentence\. When they ask what you think, say it and why in one sentence, then ask how they see it; disagree when the evidence does\./);
  assert.doesNotMatch(continuing,/one or two sentences|say it and why in two sentences/);
  assert.ok(coach.match(/^description: (.*)$/m)[1].length<1000);
  const revisions=JSON.parse(read('../data/recipe-revisions.json'));
  assert.ok(revisions['coach/SKILL.md'].includes(digest(coach)),'coach ships a known revision');
  assert.ok(revisions['coach/SKILL.md'].includes('50bbd27be5b5ac3d1cc753c08dbc07a708d2ac1393e0a1cbbc184fa606af10ab'),'the text shipped until today stays known');
});
