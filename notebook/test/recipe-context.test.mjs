import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {recipeContext} from '../core/recipe-context.mjs';import {briefing} from '../core/briefing.mjs';

test('the actual morning writer receives the complete selected user workflow and its references',async()=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-workflow-'))),query=new QueryService(store),folder=path.join(store.root,'skills','morning-note');fs.mkdirSync(path.join(folder,'references'),{recursive:true});
 fs.writeFileSync(path.join(folder,'SKILL.md'),'# User-selected morning method\nRead every source before writing.\nThe final rule must reach the writer too.');fs.writeFileSync(path.join(folder,'references','facts.md'),'A checked draft is not a measured outcome.');
 const provider=async input=>{if(input.kind==='brief-verification')return {passed:true,reason:'Fixture checked.'};assert.equal(input.context.workflow.source,'installed user workflow');assert.equal(input.context.workflow.complete_read,true);assert.ok(input.context.workflow.sources.some(s=>s.content.endsWith('The final rule must reach the writer too.')));assert.ok(input.context.workflow.sources.some(s=>s.path==='references/facts.md'&&s.content.includes('not a measured outcome')));return 'Fresh fictional health observations are missing. Review the fictional draft today.';};
 const result=await briefing({kind:'morning-brief',id:'workflow-brief'},{store,query,provider});assert.equal(store.get('notes',result.record_id).content,'Fresh fictional health observations are missing. Review the fictional draft today.');
});

test('workflow loading rejects traversal and a linked installation instead of silently using private instructions',()=>{
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-workflow-boundary-')),store=new Store(path.join(temporary,'chosen')),outside=path.join(temporary,'other');fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'SKILL.md'),'Private instructions from another installation.');fs.mkdirSync(path.join(store.root,'skills'));fs.symlinkSync(outside,path.join(store.root,'skills','morning-note'),process.platform==='win32'?'junction':'dir');
 assert.throws(()=>recipeContext(store,'../other'),/Invalid workflow/);assert.throws(()=>recipeContext(store,'morning-note'),/another installation|selected workspace/);
});
