import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {jobExecutor} from '../core/runtime.mjs';

// A model draft that puts its step under another heading still saves a brief with a "Next:" line. All data is made up.
function fixture(goal=true){
 process.env.GODSPEED_NOW='2026-10-21T08:00:00Z';
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-brief-next-'))),query=new QueryService(store);
 store.save('settings',{id:'installation',timezone:'Europe/Berlin'});
 if(goal)store.save('goals',{title:'Prepare a fictional guide',status:'adopted'});
 return {store,query};
}
const saved=async(draft,goal)=>{
 const {store,query}=fixture(goal);
 const provider=async input=>input.kind==='brief-verification'?{passed:true,reason:'Fictional sources checked.'}:draft;
 const result=await jobExecutor(provider,query)({kind:'morning-brief',id:'brief-next'},{store,settings:{}});
 return store.get('notes',result.record_id).content;
};
const body='No fresh health observations are recorded. ';
test.after(()=>{delete process.env.GODSPEED_NOW;});

for(const [shape,tail] of [['a non-Next heading','What I need from you:\n1. Look at the fictional list.'],['a Steps heading','Steps:\n- Look at the fictional list.'],['a numbered list','1. Look at the fictional list.\n2. Reply when done.'],['a plain paragraph','Look at the fictional list when you can.']])
 test('a draft with '+shape+' gains a Next line naming the goal',async()=>{
  const content=await saved(body+'\n\n'+tail);
  assert.ok(content.split(/\r?\n/).some(l=>/^Next: Ask Godspeed to work on Prepare a fictional guide/.test(l)),content);
  assert.match(content,/Look at the fictional list/);
 });

test('a Next line with any verb is kept unchanged and nothing is added',async()=>{
 const draft=body+'\n\nNext: Maybe think about the fictional list.',content=await saved(draft);
 assert.equal(content.match(/^Next:/gm).length,1);assert.match(content,/Maybe think about/);
});

test('with no saved goal the draft is saved as written',async()=>{
 const content=await saved(body+'\n\nWhat I need from you:\n1. Look at the fictional list.',false);
 assert.doesNotMatch(content,/^Next:/m);assert.match(content,/What I need from you/);
});

test('the one rewrite gains a Next line too when it puts its step under another heading',async()=>{
 const {store,query}=fixture();let writes=0,verified=0;
 const provider=async input=>{
  if(input.kind==='brief-verification')return input.check==='source-facts'&&!verified++?{passed:false,reason:'Fictional unsupported claim.',rejection_scope:'non-source',rejected_source_ids:[]}:{passed:true,reason:'Fictional sources checked.'};
  writes++;return body+'\n\nWhat I need from you:\n1. Look at the fictional list.';
 };
 const result=await jobExecutor(provider,query)({kind:'morning-brief',id:'brief-next-rewrite'},{store,settings:{}});
 const content=store.get('notes',result.record_id).content;
 assert.equal(writes,2);
 assert.equal(content.split(/\r?\n/).filter(l=>/^Next: Ask Godspeed to work on/.test(l)).length,1,content);
});
