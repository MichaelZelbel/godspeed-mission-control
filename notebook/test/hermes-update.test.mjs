import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {EventEmitter} from 'node:events';import {PassThrough} from 'node:stream';
import {execFileSync} from 'node:child_process';
import {Store} from '../core/records/store.mjs';
import {HermesUpdate,eligibleRelease,readHermesUpdate} from '../core/hermes-update.mjs';
import {scrubGitEnvironment} from '../core/assistant-files.mjs';
import {HermesLifecycle} from '../core/hermes-lifecycle.mjs';
import {NativeScheduler} from '../core/native-scheduler.mjs';
import {nativeAgent} from '../core/native-agent.mjs';
import {readNotices} from '../core/notices.mjs';
import {GODSPEED_PLUGINS} from '../core/godspeed-plugins.mjs';
import {createService} from '../server/main.mjs';

const at='2026-11-06T04:15:00Z',old=new Date(Date.parse(at)-8*24*60*60*1000).toISOString(),recent=new Date(Date.parse(at)-3*24*60*60*1000).toISOString();
const releases=versions=>versions.map((tag,index)=>({tag_name:'v'+tag,published_at:index?recent:old,prerelease:tag.includes('-')}));
const isUpdate=call=>call.join(' ')==='hermes update --no-backup --yes';
const applied=calls=>calls.some(isUpdate);
function fixture(t,{breaks,rejects,isDocker=false,aiFails=false,releaseLimit}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-hermes-update-')),source=path.join(root,'hermes-agent'),home=path.join(root,'.hermes'),executable=path.join(root,'bin','hermes');fs.mkdirSync(path.join(source,'hermes_cli'),{recursive:true});fs.mkdirSync(path.join(source,'venv','bin'),{recursive:true});fs.mkdirSync(path.dirname(executable),{recursive:true});fs.writeFileSync(path.join(source,'hermes_cli','__init__.py'),'');fs.writeFileSync(path.join(source,'venv','bin','python3'),'');fs.writeFileSync(executable,'');fs.mkdirSync(home,{recursive:true});fs.writeFileSync(path.join(home,'config.yaml'),'model:\n  provider: test\n  default: test\n');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 let version='1.0.0',offer='1.1.0',updated=false,asked=0,clock=new Date(at);const calls=[],callOptions=[];
 const run=async(exe,args,options)=>{calls.push([path.basename(exe),...args]);callOptions.push(options);if(exe==='git'){
  if(args[0]==='rev-parse')return {code:0,stdout:args[1]==='--is-inside-work-tree'?'true\n':'old-commit\n',stderr:''};
  if(args[0]==='status')return {code:0,stdout:'',stderr:''};
  if(args[0]==='remote')return {code:0,stdout:'https://github.com/NousResearch/hermes-agent.git\n',stderr:''};
  if(args[0]==='reset'){version='1.0.0';updated=false;return {code:0,stdout:'',stderr:''};}
 }
 if(path.basename(exe)==='hermes'){
  if(args[0]==='--version')return {code:0,stdout:'Hermes '+version+'\n',stderr:''};
  if(args[0]==='backup'){fs.mkdirSync(path.dirname(args[2]),{recursive:true});fs.writeFileSync(args[2],'backup');return {code:0,stdout:'saved\n',stderr:''};}
  if(args[0]==='update'&&args[1]==='--check')return {code:0,stdout:'v'+offer+' is ready\n',stderr:''};
  if(args[0]==='update'){if(rejects==='update')throw Object.assign(Error('token=sk-secret-token-value-123456789'),{code:'TIMEOUT',stderr:'token=sk-secret-token-value-123456789'});version=offer;updated=true;return {code:0,stdout:'updated\n',stderr:''};}
  if(breaks==='gateway restart'&&args.join(' ')==='gateway restart'&&updated)return {code:1,stdout:'',stderr:'restart failed'};
  if(breaks===args.join(' ')&&updated)return {code:1,stdout:'token=sk-secret-token-value-123456789\n',stderr:'failed'};
  return {code:0,stdout:'ok\n',stderr:''};
 }
 return {code:0,stdout:'',stderr:''};
 };
 const fetcher=async()=>({ok:true,json:async()=>releases(['1.1.0','1.2.0-rc.1','1.0.1'])});
 const store=new Store(root),updater=new HermesUpdate({store,descriptor:{verified:true,executable,home,sourceRoot:source},run,now:()=>clock,ask:async()=>{asked++;if(aiFails)throw Error('provider unavailable');},fetcher,isDocker:()=>isDocker,releaseLimit});
 return {store,updater,calls,callOptions,asked:()=>asked,setClock:value=>{clock=new Date(value);},setOffer:value=>{offer=value;}};
}

function taggedFixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-hermes-update-tagged-')),source=path.join(root,'hermes-agent'),home=path.join(root,'.hermes'),executable=path.join(root,'bin','hermes'),git=args=>execFileSync('git',['-C',source,...args],{encoding:'utf8',env:scrubGitEnvironment(process.env)}).trim();fs.mkdirSync(path.join(source,'hermes_cli'),{recursive:true});fs.mkdirSync(path.dirname(executable),{recursive:true});fs.mkdirSync(home,{recursive:true});fs.writeFileSync(path.join(source,'hermes_cli','__init__.py'),'');git(['init','-q']);git(['config','user.email','test@example.com']);git(['config','user.name','Test']);
 for(const version of ['1.0.0','1.1.0','1.2.0']){fs.writeFileSync(path.join(source,'VERSION'),version+'\n');git(['add','.']);git(['commit','-qm','release '+version]);git(['tag','v'+version]);}git(['reset','--hard','v1.0.0']);git(['remote','add','origin','https://github.com/NousResearch/hermes-agent.git']);
 fs.writeFileSync(executable,[
  '#!/usr/bin/env node',"import fs from 'node:fs';","import path from 'node:path';","import {execFileSync} from 'node:child_process';",`import {scrubGitEnvironment} from ${JSON.stringify(new URL('../core/assistant-files.mjs',import.meta.url).href)};`,
  "const args=process.argv.slice(2),root=path.dirname(path.dirname(process.argv[1])),source=path.join(root,'hermes-agent'),flag=name=>fs.existsSync(path.join(root,name)),run=args=>execFileSync('git',args,{encoding:'utf8',env:scrubGitEnvironment(process.env)}).trim(),version=()=>run(['-C',source,'describe','--tags','--exact-match']).replace(/^v/,''),available=()=>flag('available')?fs.readFileSync(path.join(root,'available'),'utf8').trim():run(['-C',source,'tag','--sort=-v:refname']).split(/\\r?\\n/)[0].replace(/^v/,'');",
  "if(args[0]==='--version'){console.log('Hermes '+version());process.exit(0);}",
  "if(args[0]==='update'&&args[1]==='--check'){console.log('v'+available()+' is ready');process.exit(0);}",
  "if(args[0]==='update'&&flag('fail-update')){console.error('token=sk-secret-token-value-123456789');process.exit(1);}",
  "if(args[0]==='update'){run(['-C',source,'reset','--hard','v'+available()]);fs.writeFileSync(path.join(root,'dependencies-installed'),version());process.exit(0);}",
  "if(args[0]==='backup'){fs.mkdirSync(path.dirname(args[2]),{recursive:true});fs.writeFileSync(args[2],'backup');process.exit(0);}",
  "if(args[0]==='pm'&&args[1]==='install'){fs.writeFileSync(path.join(root,'dependencies-installed'),version());process.exit(0);}",
  "if(args[0]==='cron'&&args[1]==='list'&&flag('fail-cron')&&version()!=='1.0.0'){console.error('cron failed');process.exit(1);}",
  "if(args[0]==='plugins'&&flag('fail-plugin')&&fs.readFileSync(path.join(root,'fail-plugin'),'utf8').trim()===path.basename(args[2])&&version()!=='1.0.0'){console.error('plugin import failed');process.exit(1);}",
  "if(args[0]==='gateway'&&args[1]==='restart'&&flag('fail-restored-restart')&&version()==='1.0.0'){console.error('restart failed');process.exit(1);}",
  'process.exit(0);'
 ].join('\n'),{mode:0o755});t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const store=new Store(root),updater=new HermesUpdate({store,descriptor:{verified:true,executable,home,sourceRoot:source},now:()=>new Date(at),ask:async()=>{}}),rows=versions=>versions.map(version=>({tag_name:'v'+version,published_at:old,prerelease:version.includes('-')}));
 return {root,source,store,updater,rows,head:()=>git(['describe','--tags','--exact-match']),setAvailable:version=>fs.writeFileSync(path.join(root,'available'),version)};
}

test('the tagged fixture ignores an inherited Git repository location',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-hermes-update-scratch-')),scratch=path.join(root,'scratch'),git=args=>execFileSync('git',['-C',scratch,...args],{encoding:'utf8',env:scrubGitEnvironment(process.env)}).trim();fs.mkdirSync(scratch,{recursive:true});git(['init','-q']);git(['config','user.email','test@example.com']);git(['config','user.name','Test']);fs.writeFileSync(path.join(scratch,'keep'),'unchanged\n');git(['add','keep']);git(['commit','-qm','scratch']);const before={head:git(['rev-parse','HEAD']),status:git(['status','--porcelain'])},previous=process.env.GIT_DIR;t.after(()=>fs.rmSync(root,{recursive:true,force:true}));process.env.GIT_DIR=path.join(scratch,'.git');try{assert.equal(taggedFixture(t).head(),'v1.0.0');}finally{if(previous===undefined)delete process.env.GIT_DIR;else process.env.GIT_DIR=previous;}
 assert.deepEqual({head:git(['rev-parse','HEAD']),status:git(['status','--porcelain'])},before);
});

test('Hermes children remove inherited Git variables',async t=>{
 const names=['GIT_DIR','GIT_WORK_TREE','GIT_INDEX_FILE','GIT_COMMON_DIR','GIT_OBJECT_DIRECTORY','GIT_CEILING_DIRECTORIES','GIT_SSH','git_SsH_Command'],previous=Object.fromEntries(names.map(name=>[name,process.env[name]]));for(const name of names)process.env[name]='inherited-'+name;
 try{const f=fixture(t);await f.updater.runNow();const updateOptions=f.calls.map((call,index)=>call[1]==='update'?f.callOptions[index]:null).filter(Boolean);assert.equal(updateOptions.length,2);for(const options of f.callOptions)assert.equal(Object.keys(options.env).some(name=>name.toUpperCase().startsWith('GIT_')),false);}
 finally{for(const name of names){if(previous[name]===undefined)delete process.env[name];else process.env[name]=previous[name];}}
});

test('only published stable, week-old releases in the installed major are eligible',()=>{
 assert.deepEqual(eligibleRelease(releases(['1.1.0','1.2.0-rc.1','1.0.1']),'1.0.0',Date.parse(at)),{tag:'v1.1.0',version:'1.1.0',at:Date.parse(old),prerelease:false});
 assert.equal(eligibleRelease([{tag_name:'v1.1.0',published_at:old},{tag_name:'v1.2.0',published_at:recent}],'1.0.0',Date.parse(at)),null,'the updater cannot use an old release while Hermes would select a newer, young stable release');
});

test('a passing published release is backed up, updated, restarted, checked, and visible in Settings',async t=>{
 const f=fixture(t),result=await f.updater.runNow(),state=readHermesUpdate(f.store),stop=f.calls.findIndex(call=>call.join(' ')==='hermes gateway stop'),backup=f.calls.findIndex(call=>call[1]==='backup'),update=f.calls.findIndex(isUpdate);assert.equal(result.result,'updated');assert.equal(result.version,'1.1.0');assert.equal(f.asked(),1);assert.ok(update>=0);assert.equal(f.callOptions[update].timeoutMs,40*60*1000);assert.ok(f.calls.some(call=>call.join(' ')==='hermes gateway restart'));assert.ok(stop>=0&&stop<backup,'the gateway is paused before the restorable snapshot');for(const name of GODSPEED_PLUGINS)assert.ok(f.calls.some(call=>call.join(' ').includes('plugins doctor')&&call.join(' ').includes(name)));assert.ok(fs.existsSync(state.backup));assert.deepEqual(f.store.list('notifications'),[]);
});

test('a plugin the installer keeps disabled is not required after an update',async t=>{
 const f=fixture(t),command=f.updater.command.bind(f.updater);let checked=false;fs.writeFileSync(path.join(f.updater.descriptor.home,'config.yaml'),'plugins:\n  disabled: ["godspeed-coach"]\n');f.updater.command=async(executable,args,options)=>args[0]==='plugins'&&args[2].endsWith('godspeed-coach')?(checked=true,{code:1,stdout:'',stderr:'disabled plugin'}):command(executable,args,options);assert.equal((await f.updater.runNow()).result,'updated');assert.equal(checked,false);
});

test('a newer major release and a mismatched Hermes preview never mutate the checkout',async t=>{
 const major=fixture(t);major.updater.fetcher=async()=>({ok:true,json:async()=>releases(['1.1.0','2.0.0'])});assert.equal((await major.updater.runNow()).result,'skipped');assert.equal(major.calls.some(call=>call[1]==='update'),false);
 const preview=fixture(t),command=preview.updater.command.bind(preview.updater);preview.updater.command=async(executable,args,options)=>args.join(' ')==='update --check'?{code:0,stdout:'v2.0.0 is ready\n',stderr:''}:command(executable,args,options);const result=await preview.updater.runNow();assert.equal(result.reason,'Hermes did not offer the eligible stable release.');assert.equal(preview.calls.some(call=>call.join(' ')==='hermes gateway stop'),false);assert.equal(applied(preview.calls),false);
});

test('a later Hermes offer is rolled back instead of replacing the selected release',async t=>{
 const f=fixture(t),command=f.updater.command.bind(f.updater);f.updater.command=async(executable,args,options)=>{const result=await command(executable,args,options);if(args.join(' ')==='update --check')f.setOffer('2.0.0');return result;};const result=await f.updater.runNow();assert.equal(result.result,'rolled-back');assert.equal(result.version,'1.0.0');assert.ok(applied(f.calls));assert.ok(f.calls.some(call=>call.join(' ')==='git reset --hard old-commit'));
});

test('an unofficial or multi-origin checkout is rejected before release discovery or mutation',async t=>{
 for(const origin of ['https://github.com/example/hermes-agent.git\n','https://github.com/NousResearch/hermes-agent.git\nhttps://github.com/example/hermes-agent.git\n'])for(const invoke of [updater=>updater.runNow(),updater=>updater.tick('UTC')]){const f=fixture(t),git=f.updater.git.bind(f.updater);let releasesCalled=false;f.updater.fetcher=async()=>{releasesCalled=true;return {ok:true,json:async()=>releases(['1.1.0'])};};f.updater.git=async(args,cwd)=>args.join(' ')==='remote get-url --all origin'?{code:0,stdout:origin,stderr:''}:git(args,cwd);const result=await invoke(f.updater);assert.equal(result.result,'skipped');assert.equal(result.reason,"This Hermes checkout's origin is not the official Hermes repository.");assert.equal(releasesCalled,false);assert.equal(f.calls.some(call=>call[1]==='backup'),false);assert.equal(applied(f.calls),false);}
});

test('a pre-update backup failure resumes the paused chat gateway',async t=>{
 const f=fixture(t),command=f.updater.command.bind(f.updater);f.updater.command=async(executable,args,options)=>args[0]==='backup'?{code:1,stdout:'',stderr:'backup failed'}:command(executable,args,options);const result=await f.updater.runNow();assert.equal(result.reason,'Hermes could not make its pre-update backup.');assert.ok(f.calls.some(call=>call.join(' ')==='hermes gateway stop'));assert.ok(f.calls.some(call=>call.join(' ')==='hermes gateway restart'));assert.equal(f.calls.some(call=>call.join(' ')==='hermes update --no-backup --yes'),false);
});

test('a gateway-stop failure records the pause failure without backing up or changing Hermes',async t=>{
 for(const invoke of [updater=>updater.runNow(),updater=>updater.tick('UTC')]){const f=fixture(t),command=f.updater.command.bind(f.updater);f.updater.command=async(executable,args,options)=>args.join(' ')==='gateway stop'?{code:1,stdout:'',stderr:'stop failed'}:command(executable,args,options);const result=await invoke(f.updater);assert.equal(result.reason,'Hermes could not pause its chat gateway.');assert.equal(f.calls.some(call=>call[1]==='backup'),false);assert.equal(applied(f.calls),false);}
});

test('a tagged checkout and fake Hermes executable cover the update acceptance cases',async t=>{
 await t.test('keeps an eligible stable release after installing its dependencies',async t=>{const f=taggedFixture(t);f.setAvailable('1.1.0');f.updater.fetcher=async()=>({ok:true,json:async()=>f.rows(['1.1.0'])});assert.equal((await f.updater.runNow()).result,'updated');assert.equal(f.head(),'v1.1.0');assert.ok(fs.existsSync(path.join(f.root,'dependencies-installed')));assert.ok(fs.existsSync(readHermesUpdate(f.store).backup));assert.deepEqual(f.store.list('notifications'),[]);});
 await t.test('leaves young, prerelease, and major releases alone',async t=>{const cases=[['young',[{tag_name:'v1.1.0',published_at:recent,prerelease:false}]],['pre-release',[{tag_name:'v1.1.0-rc.1',published_at:old,prerelease:true}]],['major',[{tag_name:'v1.1.0',published_at:old,prerelease:false},{tag_name:'v2.0.0',published_at:old,prerelease:false}]]];for(const [name,releases] of cases){const f=taggedFixture(t);f.setAvailable('1.1.0');f.updater.fetcher=async()=>({ok:true,json:async()=>releases});assert.equal((await f.updater.runNow()).result,'skipped',name);assert.equal(f.head(),'v1.0.0',name);}});
 await t.test('rolls back each failed Godspeed plugin import and queues one notice',async t=>{for(const plugin of GODSPEED_PLUGINS){const f=taggedFixture(t);f.setAvailable('1.1.0');fs.writeFileSync(path.join(f.root,'fail-plugin'),plugin);f.updater.fetcher=async()=>({ok:true,json:async()=>f.rows(['1.1.0'])});assert.equal((await f.updater.runNow()).result,'rolled-back',plugin);assert.equal(f.head(),'v1.0.0',plugin);assert.equal(fs.readFileSync(path.join(f.root,'dependencies-installed'),'utf8'),'1.0.0',plugin);assert.equal(f.store.list('notifications').length,1,plugin);assert.equal(readNotices(f.store).length,1,plugin);}});
 await t.test('rolls back a cron failure, reports it once, and closes the bell after the next passing check',async t=>{const f=taggedFixture(t);f.setAvailable('1.1.0');fs.writeFileSync(path.join(f.root,'fail-cron'),'');f.updater.fetcher=async()=>({ok:true,json:async()=>f.rows(['1.1.0'])});assert.equal((await f.updater.runNow()).result,'rolled-back');assert.equal(f.head(),'v1.0.0');assert.equal(fs.readFileSync(path.join(f.root,'dependencies-installed'),'utf8'),'1.0.0');assert.equal(f.store.list('notifications').length,1);assert.equal(readNotices(f.store).length,1);assert.equal((await f.updater.runNow()).result,'checked');assert.equal(f.store.list('notifications')[0].status,'resolved');});
 await t.test('reports only the installer bell when rollback cannot restart',async t=>{const f=taggedFixture(t);f.setAvailable('1.1.0');fs.writeFileSync(path.join(f.root,'fail-plugin'),'godspeed-coach');fs.writeFileSync(path.join(f.root,'fail-restored-restart'),'');f.updater.fetcher=async()=>({ok:true,json:async()=>f.rows(['1.1.0'])});assert.equal((await f.updater.runNow()).result,'rollback-failed');assert.equal(f.head(),'v1.0.0');assert.equal(f.store.list('notifications').length,1);assert.equal(readNotices(f.store).length,0);});
 await t.test('refuses dirty, foreign, and Docker installations',async t=>{const dirty=taggedFixture(t);fs.writeFileSync(path.join(dirty.source,'local-change'),'x');dirty.updater.fetcher=async()=>({ok:true,json:async()=>dirty.rows(['1.1.0'])});assert.match((await dirty.updater.runNow()).reason,/uncommitted changes/);assert.equal(dirty.head(),'v1.0.0');const foreign=taggedFixture(t);foreign.updater.getuid=()=>-1;assert.match((await foreign.updater.runNow()).reason,/another user/);const docker=taggedFixture(t);docker.updater.isDocker=()=>true;assert.match((await docker.updater.runNow()).reason,/Docker/);});
 await t.test('retains one backup after two updates and scrubs a failed command',async t=>{const f=taggedFixture(t);f.setAvailable('1.1.0');f.updater.fetcher=async()=>({ok:true,json:async()=>f.rows(['1.1.0'])});await f.updater.runNow();const first=readHermesUpdate(f.store).backup;f.setAvailable('1.2.0');f.updater.fetcher=async()=>({ok:true,json:async()=>f.rows(['1.2.0'])});await f.updater.runNow();const second=readHermesUpdate(f.store).backup;assert.equal(f.head(),'v1.2.0');assert.notEqual(first,second);assert.equal(fs.existsSync(first),false);assert.equal(fs.existsSync(second),true);const failed=taggedFixture(t);failed.setAvailable('1.1.0');fs.writeFileSync(path.join(failed.root,'fail-update'),'');failed.updater.fetcher=async()=>({ok:true,json:async()=>failed.rows(['1.1.0'])});await failed.updater.runNow();assert.doesNotMatch(JSON.stringify(readHermesUpdate(failed.store)),/sk-secret-token/);});
});

test('a Settings opt-out during an update survives its completion',async t=>{
 const f=fixture(t);let entered,release;const started=new Promise(resolve=>{entered=resolve;}),held=new Promise(resolve=>{release=resolve;});f.updater.fetcher=async()=>{entered();await held;return {ok:true,json:async()=>releases(['1.1.0','1.2.0-rc.1','1.0.1'])};};
 const updating=f.updater.runNow();await started;f.updater.setEnabled(false);release();assert.equal((await updating).result,'updated');assert.equal(readHermesUpdate(f.store).enabled,false);assert.deepEqual(await f.updater.runNow(),{result:'skipped',reason:'Keeping the assistant up to date is switched off.'});
});

test('a Settings opt-out during the nightly update survives its day marker',async t=>{
 const f=fixture(t);let entered,release;const started=new Promise(resolve=>{entered=resolve;}),held=new Promise(resolve=>{release=resolve;});f.updater.fetcher=async()=>{entered();await held;return {ok:true,json:async()=>releases(['1.1.0','1.2.0-rc.1','1.0.1'])};};
 const ticking=f.updater.tick('UTC');await started;f.updater.setEnabled(false);release();assert.equal((await ticking).result,'updated');assert.equal(readHermesUpdate(f.store).enabled,false);assert.deepEqual(await f.updater.runNow(),{result:'skipped',reason:'Keeping the assistant up to date is switched off.'});
});

test('every validation veto rolls back, restores the backup, restarts, and never asks AI twice',async t=>{
 for(const breaks of ['--version','cron list','plugins doctor '+path.join(os.tmpdir(),'unused'),'gateway status']){
  const f=fixture(t,{breaks:breaks==='plugins doctor '+path.join(os.tmpdir(),'unused')?'plugins doctor '+path.join(fixture.name,'unused'):breaks});
  if(breaks.startsWith('plugins')){const base=f.updater.command.bind(f.updater);f.updater.command=async(executable,args,options)=>args[0]==='plugins'&&args[1]==='doctor'&&args[2].endsWith('godspeed-context')&&applied(f.calls)&&!f.calls.some(call=>call.join(' ')==='git reset --hard old-commit')?{code:1,stdout:'',stderr:'plugin import failed'}:base(executable,args,options);}
  if(breaks==='--version'){const base=f.updater.command.bind(f.updater);f.updater.command=async(executable,args,options)=>args[0]==='--version'&&applied(f.calls)&&!f.calls.some(call=>call.join(' ')==='git reset --hard old-commit')?{code:1,stdout:'',stderr:'wrong version'}:base(executable,args,options);}
  const result=await f.updater.runNow();assert.equal(result.result,'rolled-back',breaks);assert.equal(f.asked(),1,breaks);assert.ok(f.calls.some(call=>call.join(' ')==='git reset --hard old-commit'),breaks);assert.ok(f.calls.some(call=>call[1]==='import'&&call.at(-1)==='--force'),breaks);assert.equal(readNotices(f.store).length,1,breaks);
 }
});

test('rollback validates the restored checkout and treats a restored-check failure as unrecovered',async t=>{
 const f=fixture(t,{breaks:'gateway status'}),base=f.updater.command.bind(f.updater);let restoredCron=false;f.updater.command=async(executable,args,options)=>args.join(' ')==='cron list'&&f.calls.some(call=>call.join(' ')==='git reset --hard old-commit')?(restoredCron=true,{code:1,stdout:'',stderr:'restored cron failed'}):base(executable,args,options);
 const result=await f.updater.runNow(),reset=f.calls.findIndex(call=>call.join(' ')==='git reset --hard old-commit'),after=f.calls.slice(reset+1).map(call=>call.join(' '));assert.equal(result.result,'rollback-failed');assert.ok(after.some(call=>call==='hermes --version'));assert.equal(restoredCron,true);assert.equal(readNotices(f.store).length,0);assert.match(f.store.get('notifications','hermes-update-1.1.0').body,/Run the Hermes installer again/);
});

test('a restored checkout repeats every local check before recovery is reported',async t=>{
 const f=fixture(t,{breaks:'gateway status'});assert.equal((await f.updater.runNow()).result,'rolled-back');const reset=f.calls.findIndex(call=>call.join(' ')==='git reset --hard old-commit'),after=f.calls.slice(reset+1).map(call=>call.join(' '));assert.ok(after.includes('hermes --version'));assert.ok(after.includes('hermes cron list'));for(const plugin of GODSPEED_PLUGINS)assert.ok(after.some(call=>call.includes('plugins doctor')&&call.includes(plugin)));assert.ok(after.includes('hermes gateway status'));
});

test('a failed rollback dependency sync is not reported as recovered',async t=>{
 const f=fixture(t,{breaks:'gateway status'}),command=f.updater.command.bind(f.updater);f.updater.command=async(executable,args,options)=>args.join(' ')==='pm install'?{code:1,stdout:'',stderr:'dependency sync failed'}:command(executable,args,options);assert.equal((await f.updater.runNow()).result,'rollback-failed');assert.equal(readNotices(f.store).length,0);assert.match(f.store.get('notifications','hermes-update-1.1.0').body,/Run the Hermes installer again/);
});

test('rollback pauses the gateway again before importing the earlier Hermes home',async t=>{
 const f=fixture(t,{breaks:'cron list'});assert.equal((await f.updater.runNow()).result,'rolled-back');const imported=f.calls.findIndex(call=>call[1]==='import'),stops=f.calls.map((call,index)=>call.join(' ')==='hermes gateway stop'?index:-1).filter(index=>index>=0);assert.ok(stops.length>=2);assert.ok(stops.at(-1)<imported);
});

test('a held updater lock defers another process without an update command',async t=>{
 const f=fixture(t),lock=path.join(f.store.state,'hermes-update.lock');fs.writeFileSync(lock,'other process');assert.deepEqual(await f.updater.runNow(),{result:'skipped',reason:'A Hermes update is already running.'});assert.equal(f.calls.some(call=>call[1]==='update'),false);
});

test('an old updater lock still defers an update without changing Hermes',async t=>{
 for(const invoke of [updater=>updater.runNow(),updater=>updater.tick('UTC')]){const f=fixture(t),lock=path.join(f.store.state,'hermes-update.lock'),old=new Date(Date.now()-24*60*60*1000);fs.writeFileSync(lock,'interrupted process');fs.utimesSync(lock,old,old);const result=await invoke(f.updater);assert.equal(result.result,'skipped');assert.equal(result.reason,'A Hermes update is already running.');assert.equal(applied(f.calls),false);assert.equal(fs.existsSync(lock),true);}
});

test('a failed Hermes update restores the earlier checkout and scrubs its failure output',async t=>{
 const f=fixture(t,{rejects:'update'}),result=await f.updater.runNow();assert.equal(result.result,'rolled-back');assert.equal(result.reason,'Hermes update');assert.ok(f.calls.some(call=>call.join(' ')==='git reset --hard old-commit'));assert.equal(readNotices(f.store).length,1);assert.doesNotMatch(JSON.stringify(readHermesUpdate(f.store)),/sk-secret-token/);
});

test('a non-sign-in AI failure rolls back and does not ask a second question',async t=>{
 const f=fixture(t,{aiFails:true}),result=await f.updater.runNow();assert.equal(result.result,'rolled-back');assert.equal(result.reason,'AI probe');assert.equal(f.asked(),1);assert.equal(readNotices(f.store).length,1);
});

test('a rollback failure leaves only the installer bell',async t=>{
 const f=fixture(t,{breaks:'cron list'}),base=f.updater.command.bind(f.updater);f.updater.command=async(executable,args,options)=>args.join(' ')==='gateway restart'&&f.calls.some(call=>call.join(' ')==='git reset --hard old-commit')?{code:1,stdout:'',stderr:'restart failed'}:base(executable,args,options);const result=await f.updater.runNow();assert.equal(result.result,'rollback-failed');assert.equal(f.store.get('notifications','hermes-update-1.1.0').status,'pending');assert.equal(readNotices(f.store).length,0);assert.match(f.store.get('notifications','hermes-update-1.1.0').body,/Run the Hermes installer again/);
});

test('the newest Godspeed backup replaces its recorded predecessor',async t=>{
 const f=fixture(t);await f.updater.runNow();const first=readHermesUpdate(f.store).backup;f.setOffer('1.2.0');f.updater.fetcher=async()=>({ok:true,json:async()=>releases(['1.2.0'])});
 await f.updater.runNow();const second=readHermesUpdate(f.store).backup;assert.notEqual(second,first);assert.equal(fs.existsSync(first),false);assert.equal(fs.existsSync(second),true);
});

test('an unrecovered later update still replaces its recorded predecessor backup',async t=>{
 const f=fixture(t);await f.updater.runNow();const first=readHermesUpdate(f.store).backup;f.setOffer('1.2.0');f.updater.fetcher=async()=>({ok:true,json:async()=>releases(['1.2.0'])});
 const original=f.updater.command.bind(f.updater);f.updater.command=async(executable,args,options)=>args.join(' ')==='gateway restart'&&f.calls.filter(isUpdate).length>=2?{code:1,stdout:'',stderr:'restart failed'}:original(executable,args,options);
 const result=await f.updater.runNow(),second=readHermesUpdate(f.store).backup;assert.equal(result.result,'rollback-failed');assert.notEqual(second,first);assert.equal(fs.existsSync(first),false);assert.equal(fs.existsSync(second),true);
});

test('a later nightly pass closes only a restored rollback notice and release lookup failures say so',async t=>{
 const f=fixture(t,{breaks:'cron list'});await f.updater.runNow();const result=await f.updater.runNow();assert.equal(result.result,'checked');assert.equal(f.store.get('notifications','hermes-update-1.1.0').status,'resolved');assert.equal(f.asked(),2);assert.equal((await f.updater.runNow()).result,'skipped');assert.equal(f.calls.filter(isUpdate).length,1,'a failed release waits thirty days');
 const unrecovered=fixture(t,{breaks:'cron list'}),command=unrecovered.updater.command.bind(unrecovered.updater);unrecovered.updater.command=async(executable,args,options)=>args.join(' ')==='gateway restart'&&unrecovered.calls.some(call=>call.join(' ')==='git reset --hard old-commit')?{code:1,stdout:'',stderr:'restart failed'}:command(executable,args,options);assert.equal((await unrecovered.updater.runNow()).result,'rollback-failed');assert.equal((await unrecovered.updater.runNow()).result,'checked');assert.equal(unrecovered.store.get('notifications','hermes-update-1.1.0').status,'pending');assert.equal(unrecovered.store.get('notifications','hermes-update-1.1.0').kind,'hermes-update-reinstall');
 const failed=fixture(t);failed.updater.fetcher=async()=>{throw Object.assign(Error('token=sk-secret-token-value-123456789'),{stderr:'token=sk-secret-token-value-123456789'});};const discovery=await failed.updater.runNow();assert.equal(discovery.result,'failed');assert.equal(discovery.reason,'Hermes release discovery failed.');assert.doesNotMatch(JSON.stringify(readHermesUpdate(failed.store)),/sk-secret-token/);
});

test('the Settings status and control persist the assistant update choice',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-hermes-update-settings-')),home=path.join(root,'.hermes'),state=path.join(root,'.godspeed'),previous={runtime:process.env.GODSPEED_ORIGINAL_RUNTIME,config:process.env.GODSPEED_ASSISTANT_CONFIG};fs.mkdirSync(home,{recursive:true});fs.mkdirSync(state,{recursive:true});fs.writeFileSync(path.join(state,'assistant.json'),JSON.stringify({verified:true,executable:path.join(root,'bin','hermes'),home,sourceRoot:path.join(root,'source')}));process.env.GODSPEED_ORIGINAL_RUNTIME='on';delete process.env.GODSPEED_ASSISTANT_CONFIG;t.after(async()=>{if(previous.runtime===undefined)delete process.env.GODSPEED_ORIGINAL_RUNTIME;else process.env.GODSPEED_ORIGINAL_RUNTIME=previous.runtime;if(previous.config===undefined)delete process.env.GODSPEED_ASSISTANT_CONFIG;else process.env.GODSPEED_ASSISTANT_CONFIG=previous.config;fs.rmSync(root,{recursive:true,force:true});});
 const service=await createService({root,port:0}),base='http://127.0.0.1:'+service.address.port;t.after(()=>service.close());
 const status=async()=>await (await fetch(base+'/api/status')).json(),initial=await status();assert.equal(initial.assistantUpdate.enabled,true);const changed=await fetch(base+'/api/hermes-update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:false})});assert.equal(changed.status,200);assert.equal((await changed.json()).enabled,false);assert.equal((await status()).assistantUpdate.enabled,false);
});

test('a timed-out release lookup records failure and lets routines continue',{timeout:2000},async t=>{
 for(const [name,fetcher] of [
  ['request',async()=>await new Promise(()=>{})],
  ['successful response body',async()=>({ok:true,json:async()=>await new Promise(()=>{})})],
  ['failed response body',async()=>({ok:false,status:503,text:async()=>await new Promise(()=>{})})]
 ]){const f=fixture(t,{releaseLimit:10});let signal;f.updater.fetcher=async(url,options)=>{signal=options.signal;return fetcher(url,options);};const routineCalls=[],scheduler=new NativeScheduler(f.store,{home:f.updater.descriptor.home,executable:f.updater.descriptor.executable,updater:f.updater,updateLimit:1000,run:async(_executable,args)=>{routineCalls.push(args.join(' '));return {stdout:''};}});await scheduler.tick();assert.equal(readHermesUpdate(f.store).last.result,'failed',name);assert.equal(readHermesUpdate(f.store).last.reason,'Hermes release discovery failed.',name);assert.equal(signal.aborted,true,name);assert.ok(routineCalls.includes('cron tick'),name);}
});

test('dirty, foreign, Docker, and Windows installations do not mutate',async t=>{
 const cases=[['dirty',f=>{const git=f.updater.git.bind(f.updater);f.updater.git=async(args,cwd)=>args[0]==='status'?{code:0,stdout:' M local.py\n',stderr:''}:git(args,cwd);},'The Hermes checkout has uncommitted changes.'],['foreign',f=>{f.updater.getuid=()=>-1;},'This Hermes checkout belongs to another user.'],['Docker',()=>{},'This Hermes installation is managed by Docker.',true],['Windows',f=>{f.updater.platform='win32';},'Windows updates are managed by its installer.']];
 for(const [name,change,reason,docker] of cases){const f=fixture(t,{isDocker:docker});change(f);const result=await f.updater.runNow();assert.equal(result.reason,reason,name);assert.equal(f.calls.some(call=>call[1]==='update'),false,name);}
});

test('the first scheduler pass at or after 04:15 runs once in the installation timezone',async t=>{
 const f=fixture(t);f.setClock('2026-11-06T03:14:00Z');assert.equal(await f.updater.tick('Europe/Berlin'),null);f.setClock('2026-11-06T04:16:01Z');assert.equal((await f.updater.tick('UTC')).result,'updated');assert.equal(await f.updater.tick('UTC'),null);
});

test('the default update clock honors the service rehearsal clock',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-hermes-update-clock-')),previous=process.env.GODSPEED_NOW;process.env.GODSPEED_NOW='2026-11-06T04:15:30Z';t.after(()=>{if(previous===undefined)delete process.env.GODSPEED_NOW;else process.env.GODSPEED_NOW=previous;fs.rmSync(root,{recursive:true,force:true});});
 const store=new Store(root),updater=new HermesUpdate({store,descriptor:{verified:false},ask:async()=>{}});assert.equal((await updater.tick('UTC')).result,'skipped');assert.equal(readHermesUpdate(store).last.day,'2026-11-06');
});

test('active chats, scheduler ticks, and manual routines defer updates for their whole lifetime',async t=>{
 const busy='Godspeed is still handling a chat or routine.';
 const cases=[
  ['chat reply',async(f,lifecycle)=>{let child;const agent=nativeAgent({executable:f.updater.descriptor.executable,home:f.updater.descriptor.home,cwd:f.store.root,lifecycle,spawnProcess:()=>{child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();return child;}}),pending=agent({message:'hold'});await new Promise(resolve=>setImmediate(resolve));return async()=>{child.emit('close',1);await assert.rejects(pending);};}],
  ['routine tick',async(f,lifecycle)=>{let entered,finish;const started=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{finish=resolve;}),scheduler=new NativeScheduler(f.store,{home:f.updater.descriptor.home,executable:f.updater.descriptor.executable,lifecycle,run:async()=>{entered();await gate;return {stdout:''};}}),pending=scheduler.tick();await started;return async()=>{finish();await pending;};}],
  ['manual routine',async(f,lifecycle)=>{const jobs=path.join(f.updater.descriptor.home,'cron');fs.mkdirSync(jobs,{recursive:true});fs.writeFileSync(path.join(jobs,'jobs.json'),JSON.stringify({jobs:[{id:'brief',name:'Brief'}]}));let entered,finish;const started=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{finish=resolve;}),scheduler=new NativeScheduler(f.store,{home:f.updater.descriptor.home,executable:f.updater.descriptor.executable,lifecycle,run:async()=>{entered();await gate;return {stdout:''};}});scheduler.startRun('brief');await started;return async()=>{finish();await scheduler.running;};}]
 ];
 for(const [name,enter] of cases){const f=fixture(t),lifecycle=new HermesLifecycle();f.updater.lifecycle=lifecycle;const leave=await enter(f,lifecycle);assert.equal(lifecycle.busy,true,name);assert.deepEqual(await f.updater.runNow(),{result:'skipped',reason:busy},name);assert.equal(applied(f.calls),false,name);await leave();assert.equal(lifecycle.busy,false,name);}
});

test('a busy scheduled update records its visible deferral reason before marking the day',async t=>{
 const f=fixture(t),lifecycle=new HermesLifecycle(),release=lifecycle.acquire('routine tick');f.updater.lifecycle=lifecycle;const result=await f.updater.tick('UTC'),last=readHermesUpdate(f.store).last;assert.equal(result.result,'skipped');assert.equal(last.result,'skipped');assert.equal(last.reason,'Godspeed is still handling a chat or routine.');assert.equal(last.day,'2026-11-06');release();
});

test('the scheduler heartbeats while a bounded Hermes update is running',async t=>{
 const f=fixture(t);let entered,release,beats=0;const started=new Promise(resolve=>{entered=resolve;}),held=new Promise(resolve=>{release=resolve;});const updater={tick:async()=>{entered();await held;}};const scheduler=new NativeScheduler(f.store,{home:f.updater.descriptor.home,executable:f.updater.descriptor.executable,updater,beatEvery:10,updateLimit:1000,run:async()=>({stdout:''})});scheduler.onProgress=()=>beats++;const ticking=scheduler.tick();await started;await new Promise(resolve=>setTimeout(resolve,35));assert.ok(beats>=2);release();await ticking;
});
