import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {hash,atomic} from './records/store.mjs';
import {normalized} from './packaged-skills.mjs';

// THE VIDEO RECIPES LEFT THE DEFAULT SET (31 October 2026, release 2.0.0-beta.13). Until then every
// new mission control got about twenty-five skills for making and finishing video whether the owner
// made videos or not, and the assistant had to choose among them on every request. They are the
// video add-on's now: `mc-video` carries four of them in its own skill/ folder and installs the
// other nineteen from the HyperFrames release it is pinned to, so only an owner who sets that
// add-on up gets them (third-party/addons/mc-video/bin/lib.mjs, RECIPES and installRecipes).
//
// gsap-core and gsap-timeline are NOT here. They are the official GSAP skills for a JavaScript
// animation library — animation in React/Vue/vanilla, scroll-driven animation, "powers Webflow
// Interactions" — which is web work as much as video, the same ground as scroll-craft and
// web-design, and HyperFrames v0.8.43 does not publish them, so nothing would put them back.
export const RETIRED_VIDEO_SKILLS=['embedded-captions','faceless-explainer','figma','general-video',
 'hyperframes','hyperframes-animation','hyperframes-audio','hyperframes-cli','hyperframes-core',
 'hyperframes-creative','hyperframes-keyframes','hyperframes-registry','media-use','motion-graphics',
 'music-to-video','pr-to-video','product-launch-video','remotion-to-hyperframes','slideshow',
 'talking-head-recut','video-captions','video-finishing','video-hooks'];

// The first line of the block mc-video's setup writes into the mission control's .gitignore for
// HyperFrames' recipe folders (its IGNORE_START). A copy, not an import: the add-on is carried, not
// depended on, and an installation that never set it up has no reason to load its code.
const VIDEO_IGNORE_LINE="# mc-video: HyperFrames' recipes.";
// The file mc-video's setup leaves in every skill folder it installs (its MARKER).
const VIDEO_MARKER='.installed-by-mc-video';

// Did the owner set the video add-on up? Then nothing of the list above is removed: those recipes
// are what they set it up for. Three signs, any one of which the setup leaves behind:
// the caption look it writes into the mission control and never overwrites, its block in the
// mission control's .gitignore, and its marker in a skill folder it installed itself.
export function videoAddonIsSetUp(root){
 if(fs.existsSync(path.join(root,'video','caption-style.json')))return 'the caption look in video/';
 try{if(fs.readFileSync(path.join(root,'.gitignore'),'utf8').includes(VIDEO_IGNORE_LINE))return "its block in the folder's .gitignore";}catch{}
 for(const name of RETIRED_VIDEO_SKILLS)
  if(fs.existsSync(path.join(root,'skills',name,VIDEO_MARKER)))return 'the recipes it installed in skills/'+name;
 return null;
}

const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{
 const file=path.join(dir,entry.name);
 return entry.isDirectory()?walk(file):[file];
});

// Is every file of this skill folder one Godspeed itself wrote there, unchanged? Two records say so,
// the same two packaged-skills.mjs installs by: the ledger of what this package last wrote to each
// path (.godspeed/packaged-skills.json), and every version of a recipe the notebook ever shipped
// (data/recipe-revisions.json). A file that matches neither is the owner's, and keeps the folder.
// A file whose name starts with a dot is the owner's or the add-on's by definition: installSkillTree
// skips those, so Godspeed never put one there.
function onlyGodspeedsOwn(folder,name,ledger,known){
 for(const file of walk(folder)){
  const relative=path.relative(folder,file).replaceAll('\\','/');
  if(relative.split('/').some(part=>part.startsWith('.')))return false;
  const digest=normalized(fs.readFileSync(file));
  if(ledger[hash(file)]===digest)continue;
  if((known[name+'/'+relative]||[]).includes(digest))continue;
  return false;
 }
 return true;
}

// Every version of a recipe the notebook ever shipped. Named here, rather than read inside the
// function below, only so a test can hand its own list in.
export function shippedRevisions(){
 const file=fileURLToPath(new URL('../data/recipe-revisions.json',import.meta.url));
 return fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{};
}

// On every install and every update (notebook/bin/godspeed.mjs init). Removes a retired video recipe
// from the owner's skills/ folder only when Godspeed put it there and the owner did not change it;
// one they changed stays, and an installation with the video add-on set up keeps them all. The
// removed folders' lines leave the ledger too, so a later run does not think this package still owns
// those paths.
export function removeRetiredSkills(store,root,{known=shippedRevisions()}={}){
 const setUp=videoAddonIsSetUp(root);
 if(setUp)return {removed:[],kept:[],videoAddon:setUp};
 const ledgerFile=path.join(store.state,'packaged-skills.json');
 const ledger=fs.existsSync(ledgerFile)?JSON.parse(fs.readFileSync(ledgerFile)):{};
 const removed=[],kept=[];let changed=false;
 for(const name of RETIRED_VIDEO_SKILLS){
  const folder=path.join(root,'skills',name);
  let stat=null;try{stat=fs.lstatSync(folder);}catch{}
  if(!stat?.isDirectory())continue;
  if(!onlyGodspeedsOwn(folder,name,ledger,known)){kept.push(name);continue;}
  for(const file of walk(folder)){const key=hash(file);if(key in ledger){delete ledger[key];changed=true;}}
  fs.rmSync(folder,{recursive:true,force:true});
  removed.push(name);
 }
 if(changed)atomic(ledgerFile,JSON.stringify(ledger));
 return {removed,kept,videoAddon:null};
}
