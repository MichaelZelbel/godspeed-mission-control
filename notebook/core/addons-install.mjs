import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runChild} from './child-process.mjs';
import {atomic} from './records/store.mjs';

// ADDING AN ADD-ON BY ONE PATH (28 November 2026, #1162).
//
// "Add the Wingman" in a chat, `godspeed addon add`, and the Add button in Settings > Add-ons all
// end here. The add-ons Godspeed knows are listed in third-party/addons/catalog.json (name,
// repository, setup and check commands, one line on what it does); a link to any other GitHub
// repository is added after the person's plain yes (`confirmed`). The repository is fetched into
// .godspeed/addons/<id>, its own setup runs from the mission control folder, its own check runs,
// and what happened is one plain sentence that names no command. Every setup is safe to run again,
// so adding an add-on that is already there fetches the newest copy and runs its setup again.
//
// A refused fetch (a private repository this computer cannot read yet) hands the same fetch to
// GitHubSignIn (core/sync/github-sign-in.mjs), which signs this computer in with GitHub's own
// device login and runs it again. A password or token is never asked for or shown.
//
// REMOVING ONE (#1163) is the same path from the same three places. A catalog entry that has a
// `remove` command can be removed: the person is asked first whether to keep what the add-on made
// or delete it too (nothing is deleted unless they say delete), the add-on's own `remove
// [--delete-data] --yes` runs from the fetched copy, its own check must then say it is not there
// (exit 3), and only then the fetched copy and its record go. Only that one add-on's folder and
// record are touched.
const catalogFile=fileURLToPath(new URL('../../third-party/addons/catalog.json',import.meta.url));
export const loadCatalog=(file=catalogFile)=>JSON.parse(fs.readFileSync(file,'utf8'));
export const folderOf=root=>path.join(root,'.godspeed','addons');
const recordFile=root=>path.join(folderOf(root),'added.json');
export const GITHUB='https://github.com/';
const repositoryPattern=/^([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100})$/;
const refused=/authentication failed|could not read username|terminal prompts disabled|repository not found|returned error: (401|403|404)|access denied|permission denied/i;
export const REFUSED='GitHub would not let this computer read that repository.';
export const CANNOT_REMOVE='This add-on cannot be removed by Godspeed yet.';
export const NOT_REACHED='That add-on could not be fetched from GitHub. Check the internet connection and ask again.';

export function readAdded(root){try{return JSON.parse(fs.readFileSync(recordFile(root),'utf8'));}catch(error){if(error.code==='ENOENT')return {};throw error;}}
function writeAdded(root,added){fs.mkdirSync(folderOf(root),{recursive:true});atomic(recordFile(root),JSON.stringify(added,null,1)+'\n');}

// The person's words are resolved by the assistant to a catalog id or a repository; code only
// accepts one of the two exactly.
export function resolveAddon(want,catalog=loadCatalog()){
  const text=String(want||'').trim().replace(/^https:\/\/github\.com\//i,'').replace(/\.git$/i,'').replace(/\/+$/,'');
  // "the Wingman" (the name Settings shows) and "Wingman" both reach the entry: case and a leading "the" do not matter.
  const plain=name=>String(name).toLowerCase().replace(/^the\s+/,'').trim();
  const known=catalog.find(e=>[e.id,e.name,e.repository,...(e.aliases||[])].some(name=>plain(name)===plain(text)));
  if(known)return {...known,known:true};
  const match=repositoryPattern.exec(text);
  if(!match)throw new Error('I do not know an add-on by that name. Give me its GitHub repository (owner/name) or choose one from Settings > Add-ons.');
  return {id:(match[1]+'--'+match[2]).toLowerCase(),name:'the add-on '+match[2],repository:text,known:false};
}

// What Settings shows: every known add-on, with whether it has been added and checked.
export function listAddons(root,{catalog=loadCatalog(),progress={}}={}){
  const added=readAdded(root);
  return catalog.map(e=>({id:e.id,name:e.name,description:e.description,added:Boolean(added[e.id]?.checked_at),installed:Boolean(added[e.id]),removable:Boolean(e.remove),busy:progress[e.id]==='working',message:added[e.id]?.message||''}));
}

const gitEnvironment=env=>({...env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'never',LC_ALL:'C'});
// A person is present: they asked for this add-on, and a refused fetch goes to the device sign-in, never a window.
async function git(args,{cwd,env,run}){const r=await run('git',args,{cwd,env:gitEnvironment(env),timeoutMs:300000});return {...r,failed:r.code!==0};}

async function fetchCopy(entry,{root,env,run,base}){
  const dir=path.join(folderOf(root),entry.id),url=base+entry.repository+'.git';
  fs.mkdirSync(folderOf(root),{recursive:true});
  const result=fs.existsSync(path.join(dir,'.git'))
    ?await git(['fetch','--depth','1',url,'HEAD'],{cwd:dir,env,run}).then(async r=>r.failed?r:git(['reset','--hard','FETCH_HEAD'],{cwd:dir,env,run}))
    :await git(['clone','--depth','1',url,dir],{env,run});
  if(result.failed){const text=result.stderr+result.stdout;throw Object.assign(new Error(refused.test(text)?REFUSED:NOT_REACHED),{refused:refused.test(text)});}
  const head=await git(['rev-parse','HEAD'],{cwd:dir,env,run});
  return {dir,commit:head.stdout.trim()};
}

// An add-on outside the list has no entry; its package.json names the program that has setup and check.
function commandsOf(entry,dir){
  if(entry.setup&&entry.check)return {setup:entry.setup,check:entry.check};
  let bin;try{bin=Object.values(JSON.parse(fs.readFileSync(path.join(dir,'package.json'),'utf8')).bin||{})[0];}catch{}
  if(!bin)throw new Error(entry.name+' does not say how to set it up, so nothing was installed.');
  return {setup:[bin,'setup'],check:[bin,'check']};
}

export async function runStep(args,{dir,root,env,run}){
  const program=path.resolve(dir,args[0]);
  if(!program.startsWith(dir+path.sep))throw new Error('That add-on points outside its own folder, so nothing was installed.');
  return run(process.execPath,[program,...args.slice(1)],{cwd:root,env:{...env,GODSPEED_WORKSPACE:root},timeoutMs:900000});
}

// Fetch, set up, check, record. Resolves to {message}; throws a plain sentence (error.refused: the fetch was refused).
export async function installAddon(entry,{root,env=process.env,run=runChild,base=GITHUB,now=()=>new Date()}){
  const {dir,commit}=await fetchCopy(entry,{root,env,run,base});
  const {setup,check}=commandsOf(entry,dir);
  const first=await runStep(setup,{dir,root,env,run});
  if(first.code!==0)throw new Error('Adding '+entry.name+' did not finish: its setup stopped.');
  const second=await runStep(check,{dir,root,env,run});
  const ok=second.code===0,added=readAdded(root);
  // The check may print `Start: <words or link>`; that line, when there, says where to start.
  const said=(second.stdout||'').match(/^\s*Start:\s*(.+?)\s*$/mi)?.[1];
  const start=said?(entry.start&&!entry.start.includes(said)?entry.start.replace(/\.?\s*$/,'')+': '+said:said):entry.start;
  const message=ok?'I added '+entry.name+'. '+(start||'It is ready.'):'I added '+entry.name+', but its own check found a problem, so it may not work yet.';
  added[entry.id]={repository:entry.repository,commit,added_at:added[entry.id]?.added_at||now().toISOString(),...(ok?{checked_at:now().toISOString()}:{}),message};
  writeAdded(root,added);
  return {id:entry.id,added:ok,message};
}

// Run the add-on's own remove, require its check to say it is gone (exit 3), then delete its fetched copy and record.
// Throws a plain sentence and leaves the copy and the record when either step fails, so removing can be tried again.
export async function removeAddon(entry,{root,env=process.env,run=runChild,data}){
  if(!entry.known||!entry.remove)throw new Error(CANNOT_REMOVE);
  const dir=path.join(folderOf(root),entry.id);
  if(!fs.existsSync(dir))throw new Error(entry.name+' is not added, so there is nothing to remove.');
  const first=await runStep([...entry.remove,...(data==='delete'?['--delete-data']:[]),'--yes'],{dir,root,env,run});
  if(first.code!==0)throw new Error('Removing '+entry.name+' did not finish: its own remove stopped. Nothing was deleted by Godspeed.');
  const second=await runStep(entry.check,{dir,root,env,run});
  if(second.code!==3)throw new Error(entry.name+' is still there after its own remove, so its files were left.');
  fs.rmSync(dir,{recursive:true,force:true});
  const added=readAdded(root);delete added[entry.id];writeAdded(root,added);
  return {id:entry.id,removed:true,message:'I removed '+entry.name+(data==='delete'?' and deleted what it made.':'. What it made is still there.')};
}

// One add-on at a time reaches the installer from Settings, the chat and the command line. A link
// outside the list is installed only when `confirmed` says the person said yes to it.
export class Addons{
  constructor({root,signIn,env=process.env,run=runChild,base=process.env.GODSPEED_ADDON_BASE||GITHUB,catalog=loadCatalog(process.env.GODSPEED_ADDON_CATALOG||undefined)}){Object.assign(this,{root,signIn,env,run,base,catalog});this.progress={};this.outcome={};}
  list(){return listAddons(this.root,{catalog:this.catalog,progress:this.progress});}
  status(id){return {working:this.progress[id]==='working',...(this.outcome[id]||{})};}
  async add(want,{confirmed=false}={}){
    const entry=resolveAddon(want,this.catalog);
    if(!entry.known&&!confirmed)return {state:'confirm',message:'This installs code from '+entry.repository+'. Add it?',repository:entry.repository};
    if(this.progress[entry.id]==='working')return {state:'working',id:entry.id,message:'Adding '+entry.name+' is already under way.'};
    const attempt=async()=>{
      this.progress[entry.id]='working';
      try{const r=await installAddon(entry,this);this.outcome[entry.id]={state:r.added?'added':'problem',message:r.message};return r;}
      catch(error){this.outcome[entry.id]={state:'failed',message:error.message};throw error;}
      finally{delete this.progress[entry.id];}
    };
    try{const r=await attempt();return {state:r.added?'added':'problem',id:entry.id,message:r.message};}
    catch(error){
      if(!error.refused||!this.signIn)throw new Error(this.outcome[entry.id].message);
      if(this.signIn.busy)throw new Error('Another GitHub sign-in is under way. Finish it, then ask again.');
      // The sign-in runs the same fetch again once GitHub has the person's yes, and says how that went.
      return {state:'signing_in',id:entry.id,signIn:this.signIn.start(this.base+entry.repository+'.git',()=>attempt()),message:'Adding '+entry.name+' needs GitHub access first. Sign in with the link and code below; nothing else is asked.'};
    }
  }
  // `data` is 'keep' or 'delete'; without it nothing runs and the person is asked, keep first.
  async remove(want,{data}={}){
    const entry=resolveAddon(want,this.catalog);
    if(!entry.known||!entry.remove)throw new Error(CANNOT_REMOVE);
    if(data!==undefined&&data!=='keep'&&data!=='delete')throw new Error('Say keep or delete.');
    if(data===undefined)return {state:'ask',id:entry.id,message:'Keep what '+entry.name+' made, or delete it too?',choices:['keep','delete']};
    if(this.progress[entry.id]==='working')return {state:'working',id:entry.id,message:'Working on '+entry.name+' is already under way.'};
    this.progress[entry.id]='working';
    try{const r=await removeAddon(entry,{...this,data});this.outcome[entry.id]={state:'removed',message:r.message};return {state:'removed',id:entry.id,message:r.message};}
    catch(error){this.outcome[entry.id]={state:'failed',message:error.message};throw error;}
    finally{delete this.progress[entry.id];}
  }
}
