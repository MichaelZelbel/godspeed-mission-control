import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';
import {installSkillTree} from '../core/packaged-skills.mjs';

// THE PACKAGED RECIPE IS THE STARTER'S RECIPE (2026-10-13, final review C2). A recipe the starter
// ships and the notebook packages too is installed twice into a new mission control: the starter's
// copy first, then the notebook's over it. The notebook's next-action copy had stayed at an older
// version, and the starter's newer one was neither the notebook's copy nor a version it knew, so
// every new install filed "Review edited next-action skill", a review that stops the folder's sync
// until the person settles it, for a recipe they never touched. Accepting it installed the old
// recipe. tools/recipe-shipped-hashes.sh keeps the three in step; this test refuses any drift.
const kit=fileURLToPath(new URL('../../',import.meta.url));
const starterSkills=path.join(kit,'starter-godspeed','skills');
const packages=['notebook/recipes','notebook/reusable-recipes'];
const lf=file=>fs.readFileSync(file,'utf8').replaceAll('\r','');
const sha=text=>createHash('sha256').update(text).digest('hex');
const starterRecipes=fs.readdirSync(starterSkills).filter(name=>fs.existsSync(path.join(starterSkills,name,'SKILL.md')));
const shared=starterRecipes.filter(name=>packages.some(p=>fs.existsSync(path.join(kit,p,name,'SKILL.md'))));
const files=dir=>fs.readdirSync(dir,{recursive:true,withFileTypes:true}).filter(e=>e.isFile()).map(e=>path.relative(dir,path.join(e.parentPath??e.path,e.name)).replaceAll('\\','/')).sort();

test('the packaged recipe equals the starter recipe for every recipe both ship, and every shipped hash is a known revision',()=>{
 assert.ok(shared.includes('next-action'),'next-action is shipped by both');
 for(const name of shared)for(const p of packages){
  const copy=path.join(kit,p,name);if(!fs.existsSync(copy))continue;
  assert.deepEqual(files(copy),files(path.join(starterSkills,name)),`${p}/${name} holds the starter's files and no others`);
  for(const file of files(copy))assert.equal(lf(path.join(copy,file)),lf(path.join(starterSkills,name,file)),`${p}/${name}/${file} is the starter's, byte for byte`);
 }
 const known=JSON.parse(fs.readFileSync(path.join(kit,'notebook','data','recipe-revisions.json'),'utf8'));
 for(const name of starterRecipes){
  const listed=lf(path.join(starterSkills,name,'.shipped-sha256')).split('\n').filter(Boolean);
  assert.ok(listed.includes(sha(lf(path.join(starterSkills,name,'SKILL.md')))),`${name}: the starter's own text is listed as shipped`);
  for(const h of listed)assert.ok((known[name+'/SKILL.md']||[]).includes(h),`${name}: shipped version ${h.slice(0,12)} is a known revision`);
 }
});

test('installing the packaged recipes into a new mission control files no review and keeps the starter text',()=>{
 for(const name of shared.filter(n=>fs.existsSync(path.join(kit,'notebook','recipes',n)))){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-packaged-')),state=path.join(root,'.godspeed');
  try{
   fs.mkdirSync(state,{recursive:true});
   fs.cpSync(path.join(starterSkills,name),path.join(root,'skills',name),{recursive:true});
   const result=installSkillTree({root,state},path.join(kit,'notebook','recipes',name),path.join(root,'skills',name));
   assert.deepEqual(result,{updated:0,conflicts:0},name+': nothing to update and nothing to review');
   assert.ok(!fs.existsSync(path.join(root,'conflicts')),name+': no conflict file');
   assert.equal(lf(path.join(root,'skills',name,'SKILL.md')),lf(path.join(starterSkills,name,'SKILL.md')),name+': the starter text stays');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
 }
});
