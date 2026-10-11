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
