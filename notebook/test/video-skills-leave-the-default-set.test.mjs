import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';
import {Store,atomic} from '../core/records/store.mjs';
import {installSkillTree} from '../core/packaged-skills.mjs';
import {RETIRED_VIDEO_SKILLS,removeRetiredSkills,videoAddonIsSetUp} from '../core/retired-skills.mjs';

// THE VIDEO RECIPES LEFT THE DEFAULT SET (31 October 2026). Until then a new mission control got
// about twenty-five skills for making and finishing video whether its owner made videos or not. They
// are the video add-on's now. An update takes them out of an existing installation again, but only
// the copies Godspeed itself put there unchanged: one the owner edited stays, and an installation
// with the video add-on set up keeps them all.
const kit=fileURLToPath(new URL('../../',import.meta.url));
const shipped=['notebook/recipes','notebook/reusable-recipes'];
// What the ticket keeps: the two official GSAP skills (a JavaScript animation library, which is web
// work as much as video), the two web ones, the two picture ones and the Excalidraw pair.
const stays=['gsap-core','gsap-timeline','scroll-craft','web-design','social-visuals','nano-banana-images','excalidraw-diagram','excalidraw-visuals'];

const fixture=name=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-video-skills-'));
 return {base,store:new Store(path.join(base,name||'workspace')),recipes:path.join(base,'recipes')};
};
const recipe=(name,body)=>'---\nname: '+name+'\ndescription: a fictional '+name+'\n---\n'+body+'\n';
const named=(store,name)=>path.join(store.root,'skills',name);
// An installation made by the version before this one: the recipe folder installed into skills/ the
// way `godspeed init` installed it, so the ledger that says what Godspeed wrote is the real one.
function installedByGodspeed(store,recipes,name,body){
 const source=path.join(recipes,name);
 atomic(path.join(source,'SKILL.md'),recipe(name,body||'How to make the video'));
 atomic(path.join(source,'references','how.md'),'More about '+name+'\n');
 installSkillTree(store,source,named(store,name));
 return source;
}

test('this version ships none of the video recipes, and still ships the ones that stay',()=>{
 for(const folder of shipped)for(const name of RETIRED_VIDEO_SKILLS)
  assert.equal(fs.existsSync(path.join(kit,folder,name)),false,folder+'/'+name+' is no longer shipped');
 for(const name of stays)
  assert.ok(fs.existsSync(path.join(kit,'notebook','recipes',name,'SKILL.md')),name+' stays in the default set');
 const manifest=JSON.parse(fs.readFileSync(path.join(kit,'notebook','reusable-recipes','manifest.json'),'utf8'));
 for(const name of RETIRED_VIDEO_SKILLS)
  assert.equal(manifest.some(e=>e.name===name),false,name+' has no line in the reusable recipes manifest');
 // The hashes stay: they are how an update tells an untouched copy from one the owner changed.
 const known=JSON.parse(fs.readFileSync(path.join(kit,'notebook','data','recipe-revisions.json'),'utf8'));
 for(const name of RETIRED_VIDEO_SKILLS)
  assert.ok((known[name+'/SKILL.md']||[]).length,name+': the versions Godspeed shipped are still known');
});

test('a fresh install puts no video recipe in the skills folder',()=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-video-fresh-'));
 const root=path.join(base,'mission-control');fs.mkdirSync(root);
 const run=spawnSync(process.execPath,[path.join(kit,'notebook','bin','godspeed.mjs'),'init'],
  {encoding:'utf8',windowsHide:true,env:{...process.env,GODSPEED_WORKSPACE:root,GODSPEED_FOOD_TABLE:'off'}});
 assert.equal(run.status,0,'init: '+run.stderr);
 const installed=fs.readdirSync(path.join(root,'skills'));
 for(const name of RETIRED_VIDEO_SKILLS)assert.equal(installed.includes(name),false,name+' was installed anyway');
 for(const name of stays)assert.ok(installed.includes(name),name+' is missing from a fresh install');
 assert.ok(installed.includes('phone-errands'),'the phone recipe is still seeded from its add-on');
 assert.equal(videoAddonIsSetUp(root),null,'a fresh install has no video add-on set up');
});

test('an update removes an unchanged copy and keeps the one the owner edited',()=>{
 const {store,recipes}=fixture();
 for(const name of ['hyperframes','media-use','slideshow'])installedByGodspeed(store,recipes,name);
 installedByGodspeed(store,recipes,'next-action','What to do next');
 fs.appendFileSync(path.join(named(store,'slideshow'),'SKILL.md'),'\nMy own notes on decks\n');
 const outcome=removeRetiredSkills(store,store.root);
 assert.deepEqual(outcome.removed,['hyperframes','media-use'],'the untouched copies are gone');
 assert.deepEqual(outcome.kept,['slideshow'],'the edited one is kept');
 assert.equal(fs.existsSync(named(store,'hyperframes')),false);
 assert.equal(fs.existsSync(named(store,'media-use')),false);
 assert.match(fs.readFileSync(path.join(named(store,'slideshow'),'SKILL.md'),'utf8'),/My own notes on decks/,'with the owner\'s own text');
 assert.ok(fs.existsSync(path.join(named(store,'next-action'),'SKILL.md')),'a recipe that is not about video is never touched');
 // The removed folders leave the ledger, so a later run does not think this package still owns them.
 const ledger=JSON.parse(fs.readFileSync(path.join(store.state,'packaged-skills.json'),'utf8'));
 const hashOf=file=>createHash('sha256').update(file).digest('hex');
 assert.equal(ledger[hashOf(path.join(named(store,'hyperframes'),'SKILL.md'))],undefined);
 assert.ok(ledger[hashOf(path.join(named(store,'next-action'),'SKILL.md'))],'the rest of the ledger stays');
 assert.deepEqual(removeRetiredSkills(store,store.root).removed,[],'a second update has nothing left to remove');
});

test('a copy whose text is a version the notebook shipped goes even when the ledger is lost',()=>{
 // An adopted folder, or one restored from a backup, can be without the ledger. Then the versions
 // the notebook ever shipped (data/recipe-revisions.json) are what say the copy is Godspeed's.
 const {store,recipes}=fixture();
 const source=installedByGodspeed(store,recipes,'figma');
 fs.rmSync(path.join(store.state,'packaged-skills.json'));
 assert.deepEqual(removeRetiredSkills(store,store.root,{known:{}}).kept,['figma'],'with nothing to go on, the copy is the owner\'s and stays');
 const sha=file=>createHash('sha256').update(fs.readFileSync(file,'utf8').replaceAll('\r','')).digest('hex');
 const known={'figma/SKILL.md':['0'.repeat(64),sha(path.join(source,'SKILL.md'))],
              'figma/references/how.md':[sha(path.join(source,'references','how.md'))]};
 assert.deepEqual(removeRetiredSkills(store,store.root,{known}).removed,['figma'],'a version the notebook shipped is Godspeed\'s, and it goes');
 assert.equal(fs.existsSync(named(store,'figma')),false);
});

test('an installation with the video add-on set up keeps every video recipe',()=>{
 for(const [how,prepare] of [
  ['the caption look it wrote',root=>atomic(path.join(root,'video','caption-style.json'),'{}\n')],
  ['its block in the .gitignore',root=>atomic(path.join(root,'.gitignore'),"# mc-video: HyperFrames' recipes. `mc-video setup` downloads them on each computer.\nskills/hyperframes/\n# end mc-video\n")],
  ['the marker in a folder it installed',root=>atomic(path.join(root,'skills','hyperframes','.installed-by-mc-video'),'mc-video 1.1.0, HyperFrames v0.8.43\n')],
 ]){
  const {store,recipes}=fixture();
  for(const name of ['hyperframes','media-use','video-finishing'])installedByGodspeed(store,recipes,name);
  prepare(store.root);
  assert.ok(videoAddonIsSetUp(store.root),how+': the add-on counts as set up');
  const outcome=removeRetiredSkills(store,store.root);
  assert.deepEqual(outcome.removed,[],how+': nothing is removed');
  for(const name of ['hyperframes','media-use','video-finishing'])
   assert.ok(fs.existsSync(path.join(named(store,name),'SKILL.md')),how+': '+name+' is still there');
 }
});

test('a video skill the owner wrote themselves is never removed',()=>{
 const {store}=fixture();
 atomic(path.join(named(store,'slideshow'),'SKILL.md'),recipe('slideshow','My own way of making decks'));
 assert.deepEqual(removeRetiredSkills(store,store.root).kept,['slideshow']);
 assert.ok(fs.existsSync(path.join(named(store,'slideshow'),'SKILL.md')));
});
