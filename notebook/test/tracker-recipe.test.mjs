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
