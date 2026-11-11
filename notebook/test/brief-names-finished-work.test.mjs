import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {briefing} from '../core/briefing.mjs';
import {plainTitle,finishedWork,finishedLine,nextLineError,NEXT_VERBS} from '../core/briefing-done.mjs';

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

test('a long work title is still named, and a question keeps its own mark',()=>{
 // The two works scenarios run 43076784276 verified: the draft's title is over 200 characters once
 // its path is left out, and it was dropped before this.
 const draft='Draft the household emergency-kit checklist file from the supported claims in goals/research/prepare-a-practical-household-emergency-kit-checklist-by-sun/claims.md, with every item marked HAVE or NEED for the person to fill in, and the water rule (3 days, 1 gallon per person per day; 2 weeks at home if possible) and the six-month review date on it';
 const question='How do people who finished a household emergency kit get there?';
 const rows=[question,draft].map(what=>({state:'verified',kind:'legacy-work',legacy_fields:{WHAT:what},legacy_log:[{date:'2026-11-11',event:'VERIFIED',rest:'check passed'}]}));
 const titles=finishedWork(rows,{today:'2026-11-12',dayOf:d=>d.toISOString().slice(0,10)});
 assert.equal(titles.length,2);assert.ok(titles[1].startsWith('Draft the household emergency-kit checklist file from the supported claims, with every item'));assert.doesNotMatch(titles[1],/goals\//);
 assert.equal(finishedLine([question]),'Finished and checked: '+question);
 assert.equal(finishedLine(['Plant the fictional bed']),'Finished and checked: Plant the fictional bed.');
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

// Scenarios run 43107490873: the brief named a research question and a draft's full brief in one
// 450-character line, and its action line opened "Next: open ...", which is not an action verb the
// first-day check (or this gate) accepts.
const RESEARCH='How do people who reached a practical household emergency-kit checklist get there, and what do they do first from where this person is now (no household details yet)?';
const DRAFT='Draft a general household emergency-kit checklist from the sources already read tonight (ready.gov kit, water and food; Red Cross 15-item list; British Red Cross 3-day kit; ReadyWisconsin six-month check), each item with its source and a blank where the household\'s own numbers go (people, ages, medicines, pets, home, car)';
const OPEN_DRAFT='The emergency-kit checklist is the one thing waiting on you. The general draft is saved, so your kit by Sunday can start from it.\n\nI have no fresh health readings this morning, so I can\'t say anything about your health today.\n\nNext: open the household blanks section of that checklist draft and fill in the first one, who lives with you and their ages.';

test('when work the person gets was finished, the line names it and leaves the research out',()=>{
 const rows=[{what:RESEARCH,kind:'learn'},{what:DRAFT,kind:'do'}].map(({what,kind})=>({state:'verified',kind:'legacy-work',legacy_fields:{WHAT:what,KIND:kind},legacy_log:[{date:'2026-11-11',event:'VERIFIED',rest:'check passed'}]}));
 const dayOf=d=>d.toISOString().slice(0,10);
 assert.deepEqual(finishedWork(rows,{today:'2026-11-12',dayOf}),[DRAFT]);
 assert.deepEqual(finishedWork(rows.slice(0,1),{today:'2026-11-12',dayOf}),[RESEARCH],'research alone is still named');
});

test('a "Next:" line must open with an action verb',()=>{
 assert.match(nextLineError(OPEN_DRAFT),/Start the "Next:" line with one of these verbs/);
 assert.equal(nextLineError('Next: write down who lives with you and their ages.'),null);
 assert.equal(nextLineError('**Next:** buy 12 litres of bottled water.'),null);
 assert.match(nextLineError('Next: review it.'),/Start the "Next:" line/,'a verb with nothing to act on');
 assert.equal(nextLineError('No action line here.'),null);
 for(const verb of ['open','fill','read'])assert.ok(!NEXT_VERBS.includes(verb));
});

test('a brief whose "Next:" line opens with another verb gets a rewrite, and the saved note opens with an action verb',async()=>{
 const env=setup('next');card(env.store);
 const drafts=[OPEN_DRAFT,OPEN_DRAFT.replace('Next: open the household blanks section of that checklist draft and fill in the first one,','Next: write down in the household blanks of that checklist draft')];
 const seen=[];const provider=async input=>{if(input.kind==='brief-verification')return {passed:true,reason:'Fixture checked the sources and the reader.'};seen.push(input);return drafts[Math.min(seen.length-1,1)];};
 const result=await briefing({id:'brief-next'},{store:env.store,query:env.query,provider,now:new Date('2026-11-12T07:00:00Z')});
 const content=env.store.get('notes',result.record_id).content;
 assert.match(content,/^Next: write down in the household blanks of that checklist draft who lives with you and their ages\.$/m);
 assert.doesNotMatch(content,/Next: open/);
 assert.ok(seen.some(input=>JSON.stringify(input.context.check_feedback||'').includes('Start the \\"Next:\\" line')),'the rewrite is told why');
});

test('a brief whose writer keeps another verb falls back to a "Next:" line that opens with review',async()=>{
 const env=setup('next-fallback');card(env.store);
 const provider=async input=>input.kind==='brief-verification'?{passed:true,reason:'Fixture checked the sources and the reader.'}:OPEN_DRAFT;
 const result=await briefing({id:'brief-next-fallback'},{store:env.store,query:env.query,provider,now:new Date('2026-11-12T07:00:00Z')});
 const content=env.store.get('notes',result.record_id).content;
 assert.doesNotMatch(content,/Next: open/);assert.equal(nextLineError(content),null);
 assert.match(content,/^Next: review /m);
 assert.match(content,/^Finished and checked: Write a practical household emergency-kit checklist\.$/m);
});
