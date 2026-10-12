import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {createHash} from 'node:crypto';

// One recipe owns "track" (D-321): the tracker recipe takes it, the journal
// gives it up, and the coach's talks read the trackers for their area.
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8').replaceAll('\r','');
const digest=text=>createHash('sha256').update(text).digest('hex');

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
