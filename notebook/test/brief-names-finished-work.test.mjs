import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {briefing} from '../core/briefing.mjs';
import {plainTitle,finishedWork} from '../core/briefing-done.mjs';

// A morning brief names the work finished and checked since the last one by its title (#377; owner's
// decision on PR #449). The first-day scenario's real brief (scenarios run 43070186384) said only that
// the goal "has a first draft"; a reader could not tell which work was done.
const TITLE='Write a practical household emergency-kit checklist at work/emergency-kit-checklist.md';
const REAL_DRAFT='Nothing new has come in on the news side, so there are no stories to pass on this morning.\n\nYour emergency-kit checklist goal, due Sunday, has a first draft. It is about 1,000 words in 15 sections, and it is written, not yet fitted to your home.\n\nI have no fresh health readings, so I can\'t say anything about your health today.\n\nWhat only you can do:\n\n1. Tell me the household basics: who lives with you and which prescriptions need a 7-day supply.';
const card=(store,{id='W-000-first-day-emergency-kit',state='verified',verified='2026-11-11',what=TITLE}={})=>store.save('work_items',{id,kind:'legacy-work',state,legacy_fields:{ID:id,STATUS:state,WHAT:what},legacy_log:[{date:'2026-11-11',event:'FILED',rest:'by first-day-scenario'},...(state==='verified'?[{date:verified,event:'VERIFIED',rest:'check passed (test -s work/emergency-kit-checklist.md)'}]:[])]});
const setup=name=>{const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-brief-finished-'+name+'-'))),query=new QueryService(store);store.save('settings',{id:'installation',timezone:'UTC'});store.save('goals',{title:'Household emergency kit ready by Sunday',status:'adopted'});return {store,query};};
const run=async({store,query},{now='2026-11-12T07:00:00Z',draft=REAL_DRAFT,id='brief-finished'}={})=>{
 const seen=[];const provider=async input=>{if(input.kind==='brief-verification')return {passed:true,reason:'Fixture checked the sources and the reader.'};seen.push(input);return draft;};
 const result=await briefing({id},{store,query,provider,now:new Date(now)});
 return {content:store.get('notes',result.record_id).content,seen};
};

test('a work title reads without its file path, inline code or card ID',()=>{
 assert.equal(plainTitle(TITLE),'Write a practical household emergency-kit checklist');
 assert.equal(plainTitle('Draft the letter in `notes/letter.md`'),'Draft the letter');
 assert.equal(plainTitle('W-20260101-01 Plant the fictional bed, see `make bed`'),'Plant the fictional bed, see');
 assert.equal(plainTitle('How do fictional gardeners plant their first bed?'),'How do fictional gardeners plant their first bed?');
 assert.equal(plainTitle('work/only-a-path.md'),null);
});

test('a brief after a day whose work passed its check names that work by its title, without its path',async()=>{
 const env=setup('done');card(env.store);
 const {content,seen}=await run(env);
 assert.match(content,/^Finished and checked: Write a practical household emergency-kit checklist\.$/m);
 assert.ok(content.includes('has a first draft'),'the model\'s own note is kept');
 assert.doesNotMatch(content,/work\/|\.md\b|W-000/,'no file path or internal name');
 assert.equal(seen[0].context.done_line,'Finished and checked: Write a practical household emergency-kit checklist.');
 assert.match(seen[0].contract,/done_line/);
 assert.match(seen[0].contract,/on a line of its own that starts with "Next:"/,'the next action is asked for on a line of its own');
});

test('a brief after a day with no verified work claims none',async()=>{
 const env=setup('none');card(env.store,{state:'pending'});
 const {content,seen}=await run(env);
 assert.doesNotMatch(content,/Finished and checked/);assert.equal(seen[0].context.done_line,null);
});

test('work the last brief already named, or verified before it, is not reported again',async()=>{
 const env=setup('again');card(env.store);
 env.store.save('notes',{title:'Your morning briefing',content:'Finished and checked: Write a practical household emergency-kit checklist.',source_app:'morning-brief',brief_day:'2026-11-11',created_at:'2026-11-11T20:00:00Z'});
 const {content}=await run(env);
 assert.doesNotMatch(content,/Finished and checked/);
 const rows=[{state:'verified',kind:'legacy-work',legacy_fields:{WHAT:'Fictional older work'},legacy_log:[{date:'2026-11-09',event:'VERIFIED',rest:'check passed'}]},{state:'verified',kind:'repair',title:'Fictional repair',verification:{at:'2026-11-12T06:00:00Z'}},{state:'verified',title:'Fictional new work',verification:{at:'2026-11-12T06:00:00Z'}}];
 assert.deepEqual(finishedWork(rows,{previous:{created_at:'2026-11-11T07:00:00Z',content:''},today:'2026-11-12',dayOf:d=>d.toISOString().slice(0,10)}),['Fictional new work']);
 assert.deepEqual(finishedWork(rows,{today:'2026-11-12',dayOf:d=>d.toISOString().slice(0,10)}),['Fictional new work'],'before the first brief: today and yesterday only');
});
