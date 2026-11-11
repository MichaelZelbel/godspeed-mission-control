// One update for the command (godspeed-update, `godspeed.mjs update`) and the Update now button in
// Settings, About: which release is the newest, whether it is newer than the one installed, and the
// download it runs from, checked against the SHA256SUMS its release publishes. The installers that
// already exist do the installing: Linux and a Mac run install-godspeed.sh taken out of the checked
// archive, Windows runs the checked GodspeedSetup.exe without questions. A Docker server is updated
// on the server itself (docker/server/update.sh); the notebook inside it only says how.
//
// The newest stable release is the one GitHub marks Latest, which is never a draft or a prerelease.
// The testing channel, only when asked for, is the highest published candidate/<version> release.
// What a release is made of is its stage file at the release's tag, as the installers read it.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {fileURLToPath} from 'node:url';
import {atomic} from './records/store.mjs';
import {installedRelease,productRoot as ownProduct} from './about.mjs';
import {VERSION} from './version.mjs';

const REPOSITORY='MichaelZelbel/godspeed-mission-control';
export const ARCHIVE='Godspeed-v2-integrated-source.tar.gz';
export const WINDOWS_SETUP='GodspeedSetup.exe';
export const SUMS='SHA256SUMS';
export const WINDOWS_FLAGS=['/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART'];
const INSTALLER='godspeed-mission-control/install-godspeed.sh';
const LIMIT=10*60*1000;

// A proving scenario stands a release in on this machine; any other address is not honoured, so a
// setting cannot send an update somewhere else (the same rule as hermes-update.mjs).
const scenarioReleases=/^http:\/\/127\.0\.0\.1:\d+$/;
export function releaseSources(env=process.env){
  const seam=String(env.GODSPEED_SCENARIO_RELEASES_URL||'').replace(/\/+$/,'');
  if(scenarioReleases.test(seam))return {api:seam,download:seam+'/download'};
  return {api:'https://api.github.com/repos/'+REPOSITORY,download:'https://github.com/'+REPOSITORY+'/releases/download'};
}
const stageRaw=env=>String(env.GODSPEED_STAGE_RAW||'https://raw.githubusercontent.com/'+REPOSITORY).replace(/\/+$/,'');
export const notesLink=tag=>'https://github.com/'+REPOSITORY+'/releases/tag/'+tag;

const parse=value=>{
  const found=/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/.exec(String(value??''));
  if(!found)throw Error(JSON.stringify(String(value??''))+' is not a version number Godspeed can compare.');
  return {core:[+found[1],+found[2],+found[3]],pre:found[4]?found[4].split('.'):[]};
};
const numeric=part=>/^\d+$/.test(part);
// Semantic versioning's order: the numbers first; a release above its own prereleases; within a
// prerelease, numbers by value and below words, and a longer one above the one it starts with.
export function compareVersions(a,b){
  const x=parse(a),y=parse(b);
  for(let i=0;i<3;i++)if(x.core[i]!==y.core[i])return Math.sign(x.core[i]-y.core[i]);
  if(!x.pre.length||!y.pre.length)return Math.sign(y.pre.length-x.pre.length);
  for(let i=0;i<Math.min(x.pre.length,y.pre.length);i++){
    const p=x.pre[i],q=y.pre[i];if(p===q)continue;
    if(numeric(p)&&numeric(q))return Math.sign(Number(p)-Number(q));
    if(numeric(p)!==numeric(q))return numeric(p)?-1:1;
    return p<q?-1:1;
  }
  return Math.sign(x.pre.length-y.pre.length);
}

async function answer(address,{fetchImpl=globalThis.fetch}={}){
  if(address.startsWith('file:'))return new Response(fs.readFileSync(fileURLToPath(address)));
  const response=await fetchImpl(address,{headers:{'user-agent':'godspeed-mission-control-update',accept:'application/vnd.github+json'},signal:AbortSignal.timeout(LIMIT)});
  if(!response.ok)throw Error(address+' answered '+response.status+'.');
  return response;
}
const readJson=async(address,options)=>JSON.parse(await (await answer(address,options)).text());

const unreachable=()=>Error('GitHub could not be reached to see whether a newer version exists.');
// The newest release of a channel: {tag, version, notes}.
export async function findNewest({channel='stable',fetchImpl,env=process.env}={}){
  if(!['stable','testing'].includes(channel))throw Error('Choose the channel stable or testing.');
  const {api}=releaseSources(env);
  let tag;
  try{
    if(channel==='stable'){
      const latest=await readJson(api+'/releases/latest',{fetchImpl});
      if(latest?.draft||latest?.prerelease)throw Error('The newest stable release is a draft or a prerelease.');
      tag=latest?.tag_name;
    }else{
      const candidates=(await readJson(api+'/releases?per_page=30',{fetchImpl}))
        .filter(release=>!release?.draft&&/^candidate\//.test(release?.tag_name||''))
        .map(release=>({tag:release.tag_name,version:release.tag_name.slice('candidate/'.length)}))
        .filter(release=>{try{parse(release.version);return true;}catch{return false;}})
        .sort((a,b)=>compareVersions(b.version,a.version));
      tag=candidates[0]?.tag;
    }
  }catch(error){if(/draft or a prerelease/.test(error.message))throw error;throw unreachable();}
  if(typeof tag!=='string'||!tag)throw Error('GitHub names no '+channel+' release of Godspeed Mission Control.');
  const raw=stageRaw(env);
  let stage,publicStage;
  try{
    stage=await readJson(raw+'/'+tag+'/stage.json',{fetchImpl});
    publicStage=tag==='beta'?stage:await readJson(raw+'/beta/stage.json',{fetchImpl});
  }catch{throw Error('The version list of the release '+tag+' could not be read, so nothing was installed.');}
  const version=stage?.version;parse(version);
  if(tag.startsWith('candidate/')&&tag.slice('candidate/'.length)!==version)throw Error('The release '+tag+' says it is '+version+', so it is not installed.');
  if([stage,publicStage].some(file=>Array.isArray(file?.withdrawn)&&file.withdrawn.includes(version)))throw Error('Godspeed Mission Control '+version+' was taken back, so it is not installed.');
  return {tag,version,notes:notesLink(tag)};
}

const runtime=root=>path.join(root,'.godspeed','integrated-runtime');
const nativeCommit=root=>{try{return fs.readFileSync(path.join(runtime(root),'version'),'utf8').trim()||null;}catch{return null;}};
// The version this mission control runs. On Linux and a Mac that is the one the installer switched
// in, which a command run from another copy (a newer one in a test) must not take for its own.
export function installedVersion({root}){
  const commit=nativeCommit(root);
  if(commit){try{return JSON.parse(fs.readFileSync(path.join(runtime(root),'versions',commit,'notebook','package.json'),'utf8')).version;}catch{}}
  return VERSION;
}

// How this installation is updated:
//   windows   the setup, without questions
//   server    on the Docker server itself (sudo godspeed-update); nothing from inside the notebook
//   handover  Linux or a Mac, from inside the notebook's own service, whose start.mjs takes the
//             new version over (native-start-script.mjs)
//   terminal  Linux or a Mac, from a terminal: the installer as the public line runs it
//   none      a copy no installer made
export function updateWay({root,env=process.env,product=ownProduct}){
  const by=installedRelease({root:product,env})?.installed_by;
  if(by==='windows'||by==='server')return by;
  if(by==='computer'||nativeCommit(root))return env.GODSPEED_HANDOVER==='1'?'handover':'terminal';
  return 'none';
}
export const COMMANDS={terminal:'godspeed-update',server:'sudo godspeed-update'};

export const updateFolder=root=>path.join(root,'.godspeed','update');
const file=(root,name)=>path.join(updateFolder(root),name);
export function readStatus(root){try{return JSON.parse(fs.readFileSync(file(root,'status.json'),'utf8'));}catch{return null;}}
export function writeStatus(root,status,now=()=>new Date()){
  const next={...status,at:now().toISOString()};atomic(file(root,'status.json'),JSON.stringify(next,null,2)+'\n');return next;
}
const readSmall=name=>{try{return fs.readFileSync(name,'utf8').trim();}catch{return '';}};
const alive=pid=>{try{process.kill(pid,0);return true;}catch(error){return error.code==='EPERM';}};
// An update that is running, or one handed over to start.mjs that has not finished.
export function updateBusy(root){
  if(['switch.json','trial.json'].some(name=>fs.existsSync(file(root,name))))return true;
  const pid=Number(readSmall(file(root,'lock')));
  return Number.isInteger(pid)&&pid>0&&alive(pid);
}
function takeLock(root){
  fs.mkdirSync(updateFolder(root),{recursive:true});
  if(updateBusy(root))throw Error('An update is already running. It says how it went in Settings, About.');
  fs.writeFileSync(file(root,'lock'),String(process.pid));
  return ()=>fs.rmSync(file(root,'lock'),{force:true});
}

// Downloads one file of the release and keeps it only when its SHA256 is the one the release's
// SHA256SUMS lists for exactly that name. Prints the path of the kept file.
export async function downloadVerified({tag,version=tag,name,folder,fetchImpl,env=process.env}){
  const {download}=releaseSources(env),base=download+'/'+tag+'/';
  const refuse=()=>Error('The download of '+version+' does not match the checksum its release publishes, so nothing was installed. The version you have keeps running.');
  let sums;
  try{sums=await (await answer(base+SUMS,{fetchImpl})).text();}catch{throw refuse();}
  const want=sums.split(/\r?\n/).map(line=>/^([0-9a-fA-F]{64}) [ *](.+)$/.exec(line.trim())).find(found=>found&&found[2]===name)?.[1].toLowerCase();
  if(!want)throw refuse();
  fs.mkdirSync(folder,{recursive:true});
  const target=path.join(folder,name),digest=crypto.createHash('sha256');
  try{
    const response=await answer(base+name,{fetchImpl});
    await pipeline(Readable.fromWeb(response.body),async function*(chunks){for await(const chunk of chunks){digest.update(chunk);yield chunk;}},fs.createWriteStream(target));
  }catch{fs.rmSync(target,{force:true});throw Error('The download of '+version+' did not finish, so nothing was installed. The version you have keeps running.');}
  if(digest.digest('hex')!==want){fs.rmSync(target,{force:true});throw refuse();}
  return target;
}

const runChild=(command,args,{env,cwd,detached=false}={})=>new Promise(resolve=>{
  const child=spawn(command,args,{env,cwd,detached,stdio:detached?'ignore':['ignore','inherit','inherit'],windowsHide:true});
  if(detached){child.on('error',()=>{});child.unref();return resolve(0);}
  child.on('error',()=>resolve(127));child.on('exit',(code,signal)=>resolve(signal?128:code??1));
});
// The settings start.mjs gives the notebook are the installation's, which the installer reads from
// start.mjs itself; inherited from the service they would only stand in for them.
const SERVICE_NAMES=['GODSPEED_WORKSPACE','GODSPEED_ORIGINAL_RUNTIME','GODSPEED_PORT','GODSPEED_BIND','HERMES_HOME','GODSPEED_DEVICE','GODSPEED_MEDIA_ROOT','GODSPEED_WEB_PORT','GODSPEED_HOST','GODSPEED_WEB_ADDRESS','GODSPEED_HANDOVER'];
const besideHermes=root=>{try{return fs.readFileSync(path.join(runtime(root),'start.mjs'),'utf8').includes('"HERMES_HOME":'+JSON.stringify(path.join(runtime(root),'hermes')));}catch{return false;}};

// The update: the command's whole work, and what the Update now button starts.
//   check        say what is installed and what is newest, and change nothing
//   fromSettings the Update now button: on Windows the setup runs on after the notebook it stops
export async function runUpdate({root,channel='stable',check=false,fromSettings=false,log=console.log,fetchImpl,env=process.env,run=runChild,platform=process.platform,product=ownProduct,now=()=>new Date()}){
  root=path.resolve(root);
  const installed=installedVersion({root}),newest=await findNewest({channel,fetchImpl,env});
  const newer=compareVersions(newest.version,installed)>0;
  if(check){
    log('Installed: '+installed);
    log('Newest '+channel+': '+newest.version);
    log('What changed: '+newest.notes);
    log(newer?'A newer version is ready. To install it, run: godspeed-update'+(channel==='stable'?'':' --channel '+channel):'You have the newest version.');
    return {state:'checked',installed,newest,newer};
  }
  if(!newer){log('You have the newest version, '+installed+'. Nothing was changed.');return {state:'current',installed,newest,newer};}
  const way=updateWay({root,env,product});
  if(way==='server')throw Error('This notebook runs in Docker on a server, which is updated on the server itself: run sudo godspeed-update there. A hosting company\'s one-click install is updated in its own panel.');
  if(way==='none')throw Error('No installer put this copy of Godspeed here, so it cannot update itself. Install it with the line from the user guide.');
  const release=takeLock(root),status=(state,message)=>writeStatus(root,{state,from:installed,to:newest.version,notes:newest.notes,message},now);
  const folder=file(root,'download');let keepDownload=false;
  try{
    status('downloading','Downloading '+newest.version+'.');
    fs.rmSync(folder,{recursive:true,force:true});
    const windows=way==='windows'||platform==='win32';
    const download=await downloadVerified({tag:newest.tag,version:newest.version,name:windows?WINDOWS_SETUP:ARCHIVE,folder,fetchImpl,env});
    log('The download of '+newest.version+' matched the checksum its release publishes.');
    if(windows){
      if(fromSettings){
        status('switching','The Windows setup is installing '+newest.version+'. The notebook starts again when it has finished.');
        keepDownload=true;
        await run(download,WINDOWS_FLAGS,{env,detached:true});
        return {state:'started',installed,newest,newer};
      }
      status('switching','The Windows setup is installing '+newest.version+'.');
      const code=await run(download,WINDOWS_FLAGS,{env});
      if(code!==0)throw Error('The Windows setup stopped (code '+code+'), and it puts the version that ran before back. Why it stopped is in setup-result.txt in %LOCALAPPDATA%\\Godspeed.');
    }else{
      if(await run('tar',['-xzf',download,'-C',folder,INSTALLER],{env})!==0)throw Error('The installer could not be taken out of the download of '+newest.version+', so nothing was installed. The version you have keeps running.');
      const handover=way==='handover';
      const installerEnv=Object.fromEntries(Object.entries(env).filter(([name])=>!SERVICE_NAMES.includes(name)));
      Object.assign(installerEnv,{GODSPEED_STAGE_REF:newest.tag},handover?{GODSPEED_UPDATE_MODE:'prepare'}:{});
      status('preparing','Installing '+newest.version+' beside the version that runs.');
      const code=await run('bash',[path.join(folder,INSTALLER),'--godspeed',root,...(besideHermes(root)?['--beside']:[])],{env:installerEnv,cwd:folder});
      if(code!==0)throw Error('The update to '+newest.version+' stopped before it was finished. The version you have keeps running.'+(handover?' What the installer said is in '+file(root,'update.log')+'.':''));
      if(handover){
        const pid=Number(readSmall(file(root,'start.pid')));
        if(!fs.existsSync(file(root,'switch.json'))||!(pid>0))throw Error('The update to '+newest.version+' could not be handed to the notebook\'s service. The version you have keeps running.');
        status('switching','Restarting with '+newest.version+'.');
        release();
        process.kill(pid,'SIGUSR2');
        return {state:'started',installed,newest,newer};
      }
    }
    status('updated','Updated to '+newest.version+'.');
    log('Godspeed Mission Control is now '+newest.version+'. Everything of yours was kept.');
    return {state:'updated',installed,newest,newer};
  }catch(error){
    status('failed',error.message);
    throw error;
  }finally{
    if(!keepDownload)fs.rmSync(folder,{recursive:true,force:true});
    release();
  }
}
