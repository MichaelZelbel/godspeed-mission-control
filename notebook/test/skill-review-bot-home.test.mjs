import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store,atomic,hash} from '../core/records/store.mjs';import {installSkillTree,skillHistory} from '../core/packaged-skills.mjs';
import {conflictView,resolveSavedConflict} from '../core/conflicts.mjs';

// The Telegram bot's Hermes home lies inside the workspace, under .godspeed/ (the server's
// .godspeed/integrated-runtime/hermes). When a new version changed a recipe the owner had edited
// there, the review was filed as a Git file review of a .godspeed/ path, and settling it was
// refused ("Conflict target is not durable state"). On 12 October 2026 the coach recipe, which
// carried Michael's section of 9 October, had to be merged by hand during the trackers install
// (ideas/an-edited-bot-recipe-becomes-a-review-the-notebook-cannot-settle.md). Now it is a review of
// the assistant's own recipe, settled like one in skills/: keep his text, take the new one or merge.
const recipe=body=>'---\nname: coach\ndescription: the fictional coach\n---\n'+body+'\n';
function fixture(){
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-bot-home-review-')),store=new Store(path.join(base,'workspace'));
 const home=path.join(store.state,'integrated-runtime','hermes'),source=path.join(base,'package','coach'),target=path.join(home,'skills','coach'),assistantPath=path.join(store.state,'assistant.json');
 fs.writeFileSync(assistantPath,JSON.stringify({verified:true,executable:'/opt/hermes',home}));
 atomic(path.join(source,'SKILL.md'),recipe('Version 1'));installSkillTree(store,source,target);
 // He adds his own section in the bot's copy; then a new version of the package ships.
 atomic(path.join(target,'SKILL.md'),recipe('Version 1\n\n## Changing an active habit\n\nHis own words.'));
 atomic(path.join(source,'SKILL.md'),recipe('Version 2'));
 const result=installSkillTree(store,source,target);
 const conflicts=fs.readdirSync(path.join(store.root,'conflicts')).map(n=>JSON.parse(fs.readFileSync(path.join(store.root,'conflicts',n),'utf8')));
 return {store,home,target,assistantPath,result,conflicts};
}

test('an edited recipe in the bot\'s home becomes a review of the assistant\'s recipe, never of a .godspeed/ file',()=>{
 const {target,result,conflicts}=fixture();
 assert.equal(result.conflicts,1);assert.equal(conflicts.length,1);
 assert.equal(conflicts[0].kind,'assistant-skill');assert.equal(conflicts[0].path,null);
 assert.equal(conflicts[0].target,path.join(target,'SKILL.md'));
 assert.match(fs.readFileSync(path.join(target,'SKILL.md'),'utf8'),/His own words/,'his copy is untouched until he decides');
});

test('the review settles: his text kept, or a merge of his section into the new version',()=>{
 for(const choice of ['current','merged']){
  const {store,target,assistantPath,conflicts}=fixture(),[c]=conflicts;
  const view=conflictView(store,c.id,{assistantPath});assert.match(view.current,/His own words/);assert.match(view.remote,/Version 2/);
  const merged=recipe('Version 2\n\n## Changing an active habit\n\nHis own words.');
  const resolved=resolveSavedConflict(store,{id:c.id,choice,text:merged,expected_hash:view.current_hash},{assistantPath});
  assert.ok(resolved.resolved_at);assert.equal(resolved.choice,choice);
  const now=fs.readFileSync(path.join(target,'SKILL.md'),'utf8');
  if(choice==='current')assert.equal(now,recipe('Version 1\n\n## Changing an active habit\n\nHis own words.'));
  else{assert.equal(now,merged);assert.ok(fs.readdirSync(path.join(skillHistory(store),hash(path.join(target,'SKILL.md')))).length,'his earlier text is kept');}
 }
});

test('no other .godspeed/ file can be named in a review',()=>{
 const {store,assistantPath}=fixture(),secret=path.join(store.state,'web-auth.json');fs.writeFileSync(secret,'{}');
 for(const conflict of [{kind:'assistant-skill',target:secret},{kind:'git',path:'.godspeed/web-auth.json'}]){
  const id='crafted-'+conflict.kind;atomic(path.join(store.root,'conflicts',id+'.json'),JSON.stringify({id,...conflict,local:'{}',remote:'{"owner":"someone else"}',at:new Date().toISOString()}));
  assert.throws(()=>resolveSavedConflict(store,{id,choice:'remote',expected_hash:hash(fs.readFileSync(secret))},{assistantPath}),/outside its workspace|not durable/);
  assert.equal(fs.readFileSync(secret,'utf8'),'{}');
 }
});
