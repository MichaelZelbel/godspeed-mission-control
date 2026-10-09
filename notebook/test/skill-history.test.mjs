import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store,atomic} from '../core/records/store.mjs';import {installSkillTree,moveSkillHistory} from '../core/packaged-skills.mjs';

// Hermes reads every SKILL.md under skills/. Until 9 October 2026 the earlier copies of a packaged
// skill were kept in skills/package-history/<skill>/<hash>/SKILL.md, and Hermes then refused
// next-action and keep-a-note: "Ambiguous skill name, 2 skills match".
const fixture=()=>{const base=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-skill-history-'));return {store:new Store(path.join(base,'workspace')),recipes:path.join(base,'recipes')};};
// What a skill scanner sees: every SKILL.md under the folder, by the name in its header.
function skillsNamed(folder,name){
 const found=[];const walk=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())walk(file);else if(entry.name==='SKILL.md'&&new RegExp('^name: '+name+'$','m').test(fs.readFileSync(file,'utf8')))found.push(file);}};
 if(fs.existsSync(folder))walk(folder);return found;
}
const skill=version=>'---\nname: next-action\ndescription: the fictional daily choice\n---\nVersion '+version+'\n';

test('an updated packaged skill keeps its earlier copy outside the folder skills are read from',()=>{
 const {store,recipes}=fixture(),source=path.join(recipes,'next-action'),target=path.join(store.root,'skills','next-action');
 atomic(path.join(source,'SKILL.md'),skill(1));installSkillTree(store,source,target);
 atomic(path.join(source,'SKILL.md'),skill(2));assert.equal(installSkillTree(store,source,target).updated,1);
 assert.match(fs.readFileSync(path.join(target,'SKILL.md'),'utf8'),/Version 2/);
 assert.equal(fs.existsSync(path.join(store.root,'skills','package-history')),false);
 assert.deepEqual(skillsNamed(path.join(store.root,'skills'),'next-action'),[path.join(target,'SKILL.md')],'one skill of that name');
 const kept=skillsNamed(path.join(store.state,'skill-history'),'next-action');
 assert.equal(kept.length,1);assert.match(fs.readFileSync(kept[0],'utf8'),/Version 1/,'the earlier copy is kept');
});

test('an installation with copies in skills/ has them moved once, and nothing is lost',()=>{
 const {store,recipes}=fixture(),history=path.join(store.root,'skills','package-history'),updates=path.join(store.root,'skills','package-updates');
 atomic(path.join(store.root,'skills','next-action','SKILL.md'),skill(3));
 atomic(path.join(history,'next-action','aaa','SKILL.md'),skill(1));atomic(path.join(history,'next-action','bbb','SKILL.md'),skill(2));
 atomic(path.join(updates,'keep-a-note','ccc','SKILL.md'),'---\nname: keep-a-note\n---\nWaiting for a review\n');
 // The same earlier copy already moved on this machine is not overwritten.
 atomic(path.join(store.state,'skill-history','next-action','bbb','SKILL.md'),'already here');
 assert.equal(skillsNamed(path.join(store.root,'skills'),'next-action').length,3,'the ambiguity as it was');
 const source=path.join(recipes,'other');atomic(path.join(source,'SKILL.md'),'---\nname: other\n---\nOther\n');
 installSkillTree(store,source,path.join(store.root,'skills','other'));
 assert.equal(fs.existsSync(history),false);assert.equal(fs.existsSync(updates),false);
 assert.equal(skillsNamed(path.join(store.root,'skills'),'next-action').length,1,'Hermes now finds one next-action');
 assert.match(fs.readFileSync(path.join(store.state,'skill-history','next-action','aaa','SKILL.md'),'utf8'),/Version 1/);
 assert.equal(fs.readFileSync(path.join(store.state,'skill-history','next-action','bbb','SKILL.md'),'utf8'),'already here');
 assert.match(fs.readFileSync(path.join(store.state,'skill-updates','keep-a-note','ccc','SKILL.md'),'utf8'),/Waiting for a review/);
 assert.equal(moveSkillHistory(store),0,'once only');
});
