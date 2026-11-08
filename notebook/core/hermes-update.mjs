import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {atomic} from './records/store.mjs';
import {runChild} from './child-process.mjs';
import {assistantEnvironment,scrubGitEnvironment} from './assistant-files.mjs';
import {hermesPython,scrubCredentials} from './runtime.mjs';
import {aiProbe} from './connection-check.mjs';
import {queueNotice} from './notices.mjs';
import {GODSPEED_PLUGINS,enabledGodspeedPlugins} from './godspeed-plugins.mjs';
import {configList,readConfigValue} from './hermes-config.mjs';
import {now as clockNow} from '../../third-party/addons/godspeed-coach/lib/clock.mjs';

export const UPDATE_FILE='hermes-update.json';
const DAY=24*60*60*1000,WAIT=7*DAY,RETRY=30*DAY,UPDATE_LIMIT=40*60*1000,RELEASE_LIMIT=120000;
export const UPDATE_TRANSACTION_LIMIT=5*UPDATE_LIMIT+10*60*1000;
const versionOf=value=>{const found=/(?:^|[^0-9])(\d+)\.(\d+)\.(\d+)(?:$|[^0-9])/.exec(String(value||''));return found?[+found[1],+found[2],+found[3]].join('.'):null;};
const compare=(a,b)=>a.split('.').map(Number).reduce((result,n,index)=>result||n-b.split('.').map(Number)[index],0);
const errorText=result=>[result?.stderr,result?.stdout,result?.error?.message].filter(Boolean).join('\n');
const failure=({step,result})=>({step,output:scrubCredentials(errorText(result)).trim().slice(-2000)});
const backupName=file=>/^godspeed-pre-update-[0-9a-f-]+\.zip$/.test(file);
const HERMES_REPOSITORY={owner:'NousResearch',name:'hermes-agent'};
export const HERMES_HTTPS_ORIGIN=`https://github.com/${HERMES_REPOSITORY.owner}/${HERMES_REPOSITORY.name}.git`;
export const HERMES_RELEASES_URL=`https://api.github.com/repos/${HERMES_REPOSITORY.owner}/${HERMES_REPOSITORY.name}/releases?per_page=100`;
const hermesRepositoryPath=`${HERMES_REPOSITORY.owner}/${HERMES_REPOSITORY.name}`.toLowerCase();
export const officialHermesRemote=value=>['https://github.com/','git@github.com:','ssh://git@github.com/'].some(prefix=>String(value||'').trim().replace(/\/+$/,'').replace(/\.git$/i,'').toLowerCase()===prefix+hermesRepositoryPath);

export function readHermesUpdate(store){
 try{const value=JSON.parse(fs.readFileSync(path.join(store.state,UPDATE_FILE),'utf8'));return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}catch{return {};}
}

export function updateStatus(store){
 const state=readHermesUpdate(store),last=state.last;
 return {enabled:state.enabled!==false,reason:state.reason||last?.reason||null,last:last?{at:last.at,result:last.result,version:last.version,reason:last.reason}:null};
}

const settingsState=state=>typeof state.enabled==='boolean'?{enabled:state.enabled}:{};
const transactionState=state=>{const {enabled,...transaction}=state;return transaction;};

// GitHub's release record, rather than a local tag timestamp, is the authority
// for when a stable Hermes release became available to an installation.
export function releaseCandidates(releases){
 if(!Array.isArray(releases))throw Error('Hermes releases did not return a release list.');
 return releases.map(release=>({tag:release?.tag_name,version:/^v?(\d+\.\d+\.\d+)$/.exec(release?.tag_name||'')?.[1],at:Date.parse(release?.published_at),prerelease:release?.prerelease===true||release?.draft===true}))
  .filter(release=>release.version&&!release.prerelease&&Number.isFinite(release.at));
}

export function eligibleRelease(releases,installed,now=Date.now(),failed={}){
 const current=versionOf(installed);if(!current)return null;
 const newest=releaseCandidates(releases).filter(item=>!item.prerelease).sort((a,b)=>compare(b.version,a.version))[0];
 if(!newest||newest.version.split('.')[0]!==current.split('.')[0]||compare(newest.version,current)<=0||now-newest.at<WAIT||failed[newest.version]&&now-Date.parse(failed[newest.version])<RETRY)return null;
 return newest;
}

export class HermesUpdate{
 constructor({store,descriptor,ask,run=runChild,now=clockNow,platform=process.platform,getuid=()=>process.getuid?.(),isDocker=()=>false,fetcher=globalThis.fetch,lifecycle=null,releaseLimit=RELEASE_LIMIT,releaseUrl=HERMES_RELEASES_URL}={}){Object.assign(this,{store,descriptor,ask,run,now,platform,getuid,isDocker,fetcher,lifecycle,releaseLimit,releaseUrl});this.running=null;}
 state(){return readHermesUpdate(this.store);}
 save(next){atomic(path.join(this.store.state,UPDATE_FILE),JSON.stringify(next,null,2)+'\n');return next;}
 setEnabled(enabled){return this.save({...transactionState(this.state()),enabled});}
 commit(change){const state=this.state();return this.save({...change(transactionState(state)),...settingsState(state)});}
 environment(){return scrubGitEnvironment(assistantEnvironment({home:this.descriptor?.home,workspace:this.store.root}));}
 async command(executable,args,{cwd,timeoutMs=120000,env=this.environment()}={}){
  try{return await this.run(executable,args,{cwd:cwd||this.store.root,timeoutMs,maxBytes:1024*1024,windowsHide:true,shell:false,env})||{code:0,stdout:'',stderr:''};}
  catch(error){return {code:typeof error?.code==='number'?error.code:1,stdout:error?.stdout||'',stderr:error?.stderr||'',error};}
 }
 async git(args,cwd){return this.command('git',args,{cwd});}
 async eligibility(){
  if(this.platform==='win32')return {reason:'Windows updates are managed by its installer.'};
  const executable=this.descriptor?.executable,sourceRaw=this.descriptor?.sourceRoot||hermesPython({executable,home:this.descriptor?.home}).source,source=sourceRaw&&path.resolve(sourceRaw);
  if(this.isDocker()||path.resolve(executable||'.').startsWith('/opt/hermes/'))return {reason:'This Hermes installation is managed by Docker.'};
  if(!this.descriptor?.verified||!path.isAbsolute(executable||'')||!source||!fs.existsSync(source))return {reason:'This assistant installation is not a recorded native Hermes checkout.'};
  let stat;try{stat=fs.statSync(source);}catch{return {reason:'The recorded Hermes source cannot be read.'};}
  if(this.getuid?.()!==undefined&&stat.uid!==this.getuid())return {reason:'This Hermes checkout belongs to another user.'};
  const inside=await this.git(['rev-parse','--is-inside-work-tree'],source);if(inside.code!==0||inside.stdout.trim()!=='true')return {reason:'The recorded Hermes source is not a Git checkout.'};
  const dirty=await this.git(['status','--porcelain'],source);if(dirty.code!==0)return {reason:'The Hermes checkout could not be checked.'};
  if(dirty.stdout.trim())return {reason:'The Hermes checkout has uncommitted changes.'};
  const head=await this.git(['rev-parse','HEAD'],source);if(head.code!==0)return {reason:'The Hermes checkout has no recoverable commit.'};
  const origin=await this.git(['remote','get-url','--all','origin'],source),urls=origin.stdout.trim().split(/\r?\n/).filter(Boolean);if(origin.code!==0||urls.length!==1||!officialHermesRemote(urls[0]))return {reason:"This Hermes checkout's origin is not the official Hermes repository."};
  return {source,head:head.stdout.trim(),executable};
 }
 async releaseValue(value,abort){
  let timeout;try{return await Promise.race([value,new Promise((resolve,reject)=>{timeout=setTimeout(()=>{abort.abort();reject(Error('Hermes release discovery timed out.'));},this.releaseLimit);})]);}finally{clearTimeout(timeout);}
 }
 async releases(){
  const abort=new AbortController();
  try{
   const response=await this.releaseValue(this.fetcher(this.releaseUrl,{headers:{Accept:'application/vnd.github+json','User-Agent':'godspeed-mission-control'},signal:abort.signal}),abort);
   if(!response?.ok)throw Object.assign(Error('Hermes releases request failed ('+(response?.status||'unknown')+').'),{stderr:await this.releaseValue(response?.text?.()||'',abort),code:response?.status||1});
   return {releases:await this.releaseValue(response.json(),abort)};
  }catch(error){return {error};}finally{abort.abort();}
 }
 plugins(){try{return enabledGodspeedPlugins(configList(readConfigValue(fs.readFileSync(path.join(this.descriptor.home,'config.yaml'),'utf8'),['plugins','disabled'])));}catch{return GODSPEED_PLUGINS;}}
 async validate({expect,ai=true}={}){
  const version=await this.command(this.descriptor.executable,['--version']);if(version.code!==0||!versionOf(version.stdout)||expect&&versionOf(version.stdout)!==expect)return {ok:false,...failure({step:'program version',result:version})};
  const cron=await this.command(this.descriptor.executable,['cron','list']);if(cron.code!==0)return {ok:false,...failure({step:'Hermes cron',result:cron})};
  for(const plugin of this.plugins()){const result=await this.command(this.descriptor.executable,['plugins','doctor',path.join(this.descriptor.home,'plugins',plugin),'--ci']);if(result.code!==0)return {ok:false,...failure({step:'Godspeed plugin '+plugin,result})};}
  const gateway=await this.command(this.descriptor.executable,['gateway','status']);if(gateway.code!==0)return {ok:false,...failure({step:'chat gateway',result:gateway})};
  if(ai&&this.ask){const result=await aiProbe({store:this.store,home:this.descriptor.home,hermes:this.descriptor.executable,hermesSource:this.descriptor.sourceRoot,ask:this.ask})();if(result.set_up&&!result.ok&&result.kind!=='sign-in')return {ok:false,step:'AI probe',output:''};}
  return {ok:true,version:versionOf(version.stdout)};
 }
 notice({version,step,rollback}){
  const id='hermes-update-'+version;
  if(rollback){this.store.save('notifications',{id,status:'pending',kind:'hermes-update-rolled-back',title:'A Hermes update was undone',body:`Hermes ${version} did not pass its ${step} check. The earlier version is running again.`,link:'/dashboard/settings#assistant-update'});queueNotice(this.store,{id,text:`Hermes ${version} did not pass its ${step} check, so Godspeed put the earlier version back. It is running again.`});}
  else this.store.save('notifications',{id,status:'pending',kind:'hermes-update-reinstall',title:'A Hermes update may not have recovered',body:`Hermes ${version} did not pass its ${step} check and could not be put back. Run the Hermes installer again.`,link:'/dashboard/settings#assistant-update'});
 }
 settleRestoredUpdates(){for(const bell of this.store.list('notifications').filter(entry=>entry.kind==='hermes-update-rolled-back'&&entry.status==='pending'))this.store.save('notifications',{id:bell.id,status:'resolved',resolved_at:this.now().toISOString()});}
 backupFile(){return path.join(this.descriptor.home,'backups','godspeed-pre-update-'+randomUUID()+'.zip');}
 async backup(){
  const file=this.backupFile();fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  const result=await this.command(this.descriptor.executable,['backup','--output',file,'--keep','0'],{timeoutMs:UPDATE_LIMIT});
  return result.code===0&&fs.existsSync(file)?{file}:{error:failure({step:'pre-update backup',result})};
 }
 removeOlderBackup(old,file){
  if(!old||old===file||path.dirname(old)!==path.join(this.descriptor.home,'backups')||!backupName(path.basename(old)))return;
  try{fs.unlinkSync(old);}catch{}
 }
 async rollback(eligible,head,backup){
  const stop=await this.command(eligible.executable,['gateway','stop'],{cwd:eligible.source});if(stop.code!==0)return false;
  const reset=await this.git(['reset','--hard',head],eligible.source);if(reset.code!==0)return false;
  const restored=await this.command(eligible.executable,['import',backup,'--force'],{cwd:eligible.source,timeoutMs:UPDATE_LIMIT});if(restored.code!==0)return false;
  const dependencies=await this.command(eligible.executable,['pm','install'],{cwd:eligible.source,timeoutMs:UPDATE_LIMIT});if(dependencies.code!==0)return false;
  const restart=await this.command(eligible.executable,['gateway','restart'],{cwd:eligible.source,timeoutMs:120000});return restart.code===0;
 }
 async applyRelease(eligible){
  const result=await this.command(eligible.executable,['update','--no-backup','--yes'],{cwd:eligible.source,timeoutMs:UPDATE_LIMIT});return result.code===0?{ok:true}:{ok:false,...failure({step:'Hermes update',result})};
 }
 async runNow(){
  if(this.running)return {result:'skipped',reason:'A Hermes update is already running.'};
  const state=this.state();if(state.enabled===false)return {result:'skipped',reason:'Keeping the assistant up to date is switched off.'};
  if(fs.existsSync(path.join(this.store.state,'workspace.lock')))return {result:'skipped',reason:'Another Godspeed process is using this workspace.'};
  const release=this.lifecycle?.acquire('assistant update');if(this.lifecycle&&!release)return {result:'skipped',reason:'Godspeed is still handling a chat or routine.'};
  const lock=path.join(this.store.state,'hermes-update.lock');let fd;
  try{fd=fs.openSync(lock,'wx');fs.writeFileSync(fd,String(process.pid));}catch{
   release?.();return {result:'skipped',reason:'A Hermes update is already running.'};
  }
  this.running=this.runTransaction().catch(error=>this.record({result:'failed',reason:'Hermes update could not finish.',detail:scrubCredentials(errorText({error})).trim().slice(-2000)}));
  try{return await this.running;}finally{this.running=null;try{fs.closeSync(fd);}catch{}try{fs.unlinkSync(lock);}catch{}release?.();}
 }
 async tick(timezone){
  const now=this.now(),parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:timezone||'UTC',hour:'2-digit',minute:'2-digit',year:'numeric',month:'2-digit',day:'2-digit',hourCycle:'h23'}).formatToParts(now).filter(part=>part.type!=='literal').map(part=>[part.type,part.value])),day=`${parts.year}-${parts.month}-${parts.day}`;
  if(parts.hour<'04'||parts.hour==='04'&&parts.minute<'15'||this.state().last?.day===day)return null;
  const result=await this.runNow();this.commit(state=>{const last=state.last||{at:now.toISOString(),result:result?.result||'skipped',reason:result?.reason||null,output:null};return {...state,last:{...last,day}};});return result;
 }
 async runTransaction(){
  const eligible=await this.eligibility();if(eligible.reason)return this.record({result:'skipped',reason:eligible.reason});
  const before=await this.command(eligible.executable,['--version']);const installed=versionOf(before.stdout);if(before.code!==0||!installed)return this.record({result:'skipped',reason:'Hermes did not report its installed version.'});
  if(this.store.list('notifications').some(entry=>entry.id.startsWith('hermes-update-')&&entry.status==='pending')){
   const checked=await this.validate({expect:installed});if(checked.ok){this.settleRestoredUpdates();return this.record({result:'checked',version:installed});}
   return this.record({result:'check-failed',version:installed,reason:checked.step,detail:checked.output});
  }
  const listed=await this.releases();if(listed.error)return this.record({result:'failed',version:installed,reason:'Hermes release discovery failed.',detail:failure({step:'release discovery',result:{error:listed.error}}).output});
  let target;try{target=eligibleRelease(listed.releases,installed,this.now().getTime(),this.state().failed);}catch(error){return this.record({result:'failed',version:installed,reason:'Hermes release discovery failed.',detail:failure({step:'release discovery',result:{error}}).output});}
  if(!target)return this.record({result:'skipped',version:installed,reason:'No eligible stable Hermes release is ready.'});
  const preview=await this.command(eligible.executable,['update','--check'],{cwd:eligible.source});if(preview.code!==0)return this.record({result:'failed',version:installed,reason:'Hermes could not check its stable release.',detail:failure({step:'update check',result:preview}).output});
  if(versionOf(preview.stdout)!==target.version)return this.record({result:'skipped',version:installed,reason:'Hermes did not offer the eligible stable release.'});
  const stopped=await this.command(eligible.executable,['gateway','stop'],{cwd:eligible.source});if(stopped.code!==0)return this.record({result:'failed',version:installed,reason:'Hermes could not pause its chat gateway.',detail:failure({step:'chat gateway stop',result:stopped}).output});
  const backup=await this.backup();if(backup.error){
   const restart=await this.command(eligible.executable,['gateway','restart'],{cwd:eligible.source});
   return this.record(restart.code===0?{result:'failed',version:installed,reason:'Hermes could not make its pre-update backup.',detail:backup.error.output}:{result:'failed',version:installed,reason:'Hermes could not restart its chat gateway.',detail:failure({step:'chat gateway restart',result:restart}).output});
  }
  const updated=await this.applyRelease(eligible);
  let checked=updated.ok?null:updated;
  if(!checked){const restart=await this.command(eligible.executable,['gateway','restart'],{cwd:eligible.source});checked=restart.code===0?await this.validate({expect:target.version}):{ok:false,...failure({step:'chat gateway restart',result:restart})};}
  if(checked.ok){this.removeOlderBackup(this.state().backup,backup.file);this.settleRestoredUpdates();return this.record({result:'updated',version:target.version,backup:backup.file});}
  const rolledBack=await this.rollback(eligible,eligible.head,backup.file);
  if(rolledBack){const restored=await this.validate({expect:installed,ai:checked.step!=='AI probe'});if(restored.ok){this.removeOlderBackup(this.state().backup,backup.file);this.notice({version:target.version,step:checked.step,rollback:true});return this.record({result:'rolled-back',version:installed,failed:target.version,reason:checked.step,detail:checked.output,backup:backup.file});}}
  this.removeOlderBackup(this.state().backup,backup.file);this.notice({version:target.version,step:checked.step,rollback:false});return this.record({result:'rollback-failed',version:target.version,failed:target.version,reason:checked.step,detail:checked.output,backup:backup.file});
 }
 record({result,version,failed,reason,detail,backup}){const at=this.now().toISOString(),next=this.commit(state=>({...state,...(backup?{backup}:{}),last:{at,result,version,reason:reason||null,output:detail||null},...(failed?{failed:{...(state.failed||{}),[failed]:at}}:{})}));return next.last;}
}
