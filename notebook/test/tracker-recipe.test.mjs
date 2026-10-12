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
