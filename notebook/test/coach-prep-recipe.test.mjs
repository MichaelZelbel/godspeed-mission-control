import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';
import {installSkillTree} from '../core/packaged-skills.mjs';
import {readPrep,prepProblem} from '../../third-party/addons/godspeed-coach/lib/prep.mjs';
import {readArea} from '../../third-party/addons/godspeed-coach/lib/areas.mjs';

// Coaching talks prepared the day before (18 October 2026). The README promised since 16 October
// that talks are "prepared ahead from your goal's research", but the recipe that prepares them was
// the author's own and never shipped, so every talk on a new install opened from a brief its
// assistant read in about a minute. The product now ships its own coach-prep recipe, and the
// routine "Coaching talk preparation" runs it every night for the talks of the next day.
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8').replaceAll('\r','');
const digest=text=>createHash('sha256').update(text).digest('hex');
const recipe=read('../recipes/coach-prep/SKILL.md');

test('the coach-prep recipe ships, for any reader, and its description sends it only the preparation',()=>{
  assert.match(recipe,/^---\nname: coach-prep\ndescription: /);
  const description=recipe.match(/^description: (.*)$/m)[1];
  assert.ok(description.length<1024,'fits Hermes\' limit for a description');
  assert.match(description,/Use when the coaching talk preparation routine names a talk/);
  assert.match(description,/It only prepares: it never opens or continues a talk, and never messages the person or anyone else\./);
  // The author's own data, names, places and private commands stay out.
  assert.doesNotMatch(recipe,/owner-specific-name|employer|srv\d|C:\/|godspeed (?:memory|prompts|due|goals|work)\b|godspeed-headache|mc-attention/);
  assert.doesNotMatch(recipe,/[\u2013\u2014]/,'no long dashes');
  // Only public commands, and never the one that opens the talk.
  for(const command of ['godspeed-coach brief <area> --date <talk date>','godspeed-coach areas','mc-goals list','mc-prompt-archive search','godspeed-journal words --days 14'])assert.ok(recipe.includes(command),command);
  assert.match(recipe,/Never run `godspeed-coach talk open`/);
  assert.match(recipe,/Write only this file\./);
  const inventory=JSON.parse(read('../data/recipe-inventory.json'));
  assert.deepEqual(inventory.find(r=>r.name==='coach-prep'),{...inventory.find(r=>r.name==='tracker'),name:'coach-prep'});
  assert.ok(JSON.parse(read('../data/recipe-revisions.json'))['coach-prep/SKILL.md'].includes(digest(recipe)),'coach-prep ships a known revision');
});

test('a preparation written in the recipe\'s shape is one the coach opens a talk from',t=>{
  const shape=recipe.split('`coach/<area>/prep/<talk date>.md`, in exactly this shape:')[1].match(/```\n([\s\S]*?)```/)[1];
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-coach-prep-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'coach','weekly-check-in','prep'),{recursive:true});
  fs.writeFileSync(path.join(root,'coach','weekly-check-in','area.md'),'AREA: weekly-check-in\nTITLE: Weekly check-in\nRHYTHM: weekly sunday\nTIME: 18:00\nSTARTS: 2026-10-04\n');
  // Every section filled, as the recipe asks.
  const filled=shape.replace('<area>','weekly-check-in').replace('<talk date> <time>','2026-10-25 18:00').replace(/<the time you write it[^>]*>/,'2026-10-24T03:20:00Z')
    .replace(/^(## .+)$/gm,'$1\nA fictional line.');
  const file=path.join(root,'coach','weekly-check-in','prep','2026-10-25.md');fs.writeFileSync(file,filled);
  assert.equal(prepProblem(readPrep(file),readArea(path.join(root,'coach','weekly-check-in'))),null,filled);
  for(const section of ['## The opening','## Talk card'])assert.ok(shape.includes(section),section);
  assert.match(shape,/^STATE: ready$/m);assert.match(shape,/^PREPARED: /m);
});

test('a new mission control gets the recipe with the notebook\'s others, and nothing to review',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-coach-prep-install-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const state=path.join(root,'.godspeed');fs.mkdirSync(state,{recursive:true});
  const result=installSkillTree({root,state},fileURLToPath(new URL('../recipes/coach-prep/',import.meta.url)),path.join(root,'skills','coach-prep'));
  assert.deepEqual(result,{updated:1,conflicts:0});
  assert.equal(fs.readFileSync(path.join(root,'skills','coach-prep','SKILL.md'),'utf8').replaceAll('\r',''),recipe);
});
