import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {EventEmitter} from 'node:events';import {PassThrough} from 'node:stream';
import {Store} from '../core/records/store.mjs';
import {HermesUpdate,eligibleRelease,readHermesUpdate} from '../core/hermes-update.mjs';
import {HermesLifecycle} from '../core/hermes-lifecycle.mjs';
import {NativeScheduler} from '../core/native-scheduler.mjs';
import {nativeAgent} from '../core/native-agent.mjs';
import {readNotices} from '../core/notices.mjs';

const at='2026-11-06T04:15:00Z',old=new Date(Date.parse(at)-8*24*60*60*1000).toISOString(),recent=new Date(Date.parse(at)-3*24*60*60*1000).toISOString();
const releases=versions=>versions.map((tag,index)=>({tag_name:'v'+tag,published_at:index?recent:old,prerelease:tag.includes('-')}));
function fixture(t,{breaks,rejects,isDocker=false,aiFails=false}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-hermes-update-')),source=path.join(root,'hermes-agent'),home=path.join(root,'.hermes'),executable=path.join(root,'bin','hermes');fs.mkdirSync(path.join(source,'hermes_cli'),{recursive:true});fs.mkdirSync(path.join(source,'venv','bin'),{recursive:true});fs.mkdirSync(path.dirname(executable),{recursive:true});fs.writeFileSync(path.join(source,'hermes_cli','__init__.py'),'');fs.writeFileSync(path.join(source,'venv','bin','python3'),'');fs.writeFileSync(executable,'');fs.mkdirSync(home,{recursive:true});fs.writeFileSync(path.join(home,'config.yaml'),'model:\n  provider: test\n  default: test\n');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 let version='1.0.0',updated=false,asked=0,clock=new Date(at);const calls=[];
 const run=async(exe,args)=>{calls.push([path.basename(exe),...args]);if(exe==='git'){
  if(args[0]==='rev-parse')return {code:0,stdout:args[1]==='--is-inside-work-tree'?'true\n':'old-commit\n',stderr:''};
  if(args[0]==='status')return {code:0,stdout:'',stderr:''};
  if(args[0]==='reset'){version='1.0.0';updated=false;return {code:0,stdout:'',stderr:''};}
 }
 if(path.basename(exe)==='hermes'){
  if(args[0]==='--version')return {code:0,stdout:'Hermes '+version+'\n',stderr:''};
  if(args[0]==='backup'){fs.mkdirSync(path.dirname(args[2]),{recursive:true});fs.writeFileSync(args[2],'backup');return {code:0,stdout:'saved\n',stderr:''};}
  if(args[0]==='update'&&args[1]==='--check')return {code:0,stdout:'v1.1.0 is ready\n',stderr:''};
  if(args[0]==='update'){version='1.1.0';updated=true;if(rejects==='update')throw Object.assign(Error('token=sk-secret-token-value-123456789'),{code:'TIMEOUT',stderr:'token=sk-secret-token-value-123456789'});return {code:0,stdout:'updated\n',stderr:''};}
  if(breaks==='gateway restart'&&args.join(' ')==='gateway restart'&&updated)return {code:1,stdout:'',stderr:'restart failed'};
  if(breaks===args.join(' ')&&updated)return {code:1,stdout:'token=sk-secret-token-value-123456789\n',stderr:'failed'};
  return {code:0,stdout:'ok\n',stderr:''};
 }
 return {code:0,stdout:'',stderr:''};
 };
 const fetcher=async()=>({ok:true,json:async()=>releases(['1.1.0','1.2.0-rc.1','2.0.0','1.0.1'])});
 const store=new Store(root),updater=new HermesUpdate({store,descriptor:{verified:true,executable,home,sourceRoot:source},run,now:()=>clock,ask:async()=>{asked++;if(aiFails)throw Error('provider unavailable');},fetcher,isDocker:()=>isDocker});
 return {store,updater,calls,asked:()=>asked,setClock:value=>{clock=new Date(value);}};
}

test('only published stable, week-old releases in the installed major are eligible',()=>{
 assert.deepEqual(eligibleRelease(releases(['1.1.0','1.2.0-rc.1','2.0.0','1.0.1']),'1.0.0',Date.parse(at)),{tag:'v1.1.0',version:'1.1.0',at:Date.parse(old),prerelease:false});
 assert.equal(eligibleRelease([{tag_name:'v1.1.0',published_at:old},{tag_name:'v1.2.0',published_at:recent}],'1.0.0',Date.parse(at)),null,'the updater cannot use an old release while Hermes would select a newer, young stable release');
});

test('a passing published release is backed up, updated, restarted, checked, and visible in Settings',async t=>{
 const f=fixture(t),result=await f.updater.runNow(),state=readHermesUpdate(f.store);assert.equal(result.result,'updated');assert.equal(result.version,'1.1.0');assert.equal(f.asked(),1);assert.ok(f.calls.some(call=>call.join(' ')==='hermes update --no-backup --yes'));assert.ok(f.calls.some(call=>call.join(' ')==='hermes gateway restart'));for(const name of ['godspeed-reply','godspeed-context','godspeed-chat-tidy'])assert.ok(f.calls.some(call=>call.join(' ').includes('plugins doctor')&&call.join(' ').includes(name)));assert.ok(fs.existsSync(state.backup));assert.deepEqual(f.store.list('notifications'),[]);
});

test('a Settings opt-out during an update survives its completion',async t=>{
 const f=fixture(t);let entered,release;const started=new Promise(resolve=>{entered=resolve;}),held=new Promise(resolve=>{release=resolve;});f.updater.fetcher=async()=>{entered();await held;return {ok:true,json:async()=>releases(['1.1.0','1.2.0-rc.1','2.0.0','1.0.1'])};};
 const updating=f.updater.runNow();await started;f.updater.setEnabled(false);release();assert.equal((await updating).result,'updated');assert.equal(readHermesUpdate(f.store).enabled,false);assert.deepEqual(await f.updater.runNow(),{result:'skipped',reason:'Keeping the assistant up to date is switched off.'});
});

test('a Settings opt-out during the nightly update survives its day marker',async t=>{
 const f=fixture(t);let entered,release;const started=new Promise(resolve=>{entered=resolve;}),held=new Promise(resolve=>{release=resolve;});f.updater.fetcher=async()=>{entered();await held;return {ok:true,json:async()=>releases(['1.1.0','1.2.0-rc.1','2.0.0','1.0.1'])};};
 const ticking=f.updater.tick('UTC');await started;f.updater.setEnabled(false);release();assert.equal((await ticking).result,'updated');assert.equal(readHermesUpdate(f.store).enabled,false);assert.deepEqual(await f.updater.runNow(),{result:'skipped',reason:'Keeping the assistant up to date is switched off.'});
});

test('every validation veto rolls back, restores the backup, restarts, and never asks AI twice',async t=>{
 for(const breaks of ['--version','cron list','plugins doctor '+path.join(os.tmpdir(),'unused'),'gateway status']){
  const f=fixture(t,{breaks:breaks==='plugins doctor '+path.join(os.tmpdir(),'unused')?'plugins doctor '+path.join(fixture.name,'unused'):breaks});
  if(breaks.startsWith('plugins')){const base=f.updater.command.bind(f.updater);f.updater.command=async(executable,args,options)=>args[0]==='plugins'&&args[1]==='doctor'&&args[2].endsWith('godspeed-context')&&f.calls.some(call=>call[1]==='update'&&call[2]==='--no-backup')&&!f.calls.some(call=>call.join(' ')==='git reset --hard old-commit')?{code:1,stdout:'',stderr:'plugin import failed'}:base(executable,args,options);}
  if(breaks==='--version'){const base=f.updater.command.bind(f.updater);f.updater.command=async(executable,args,options)=>args[0]==='--version'&&f.calls.some(call=>call[1]==='update'&&call[2]==='--no-backup')&&!f.calls.some(call=>call.join(' ')==='git reset --hard old-commit')?{code:1,stdout:'',stderr:'wrong version'}:base(executable,args,options);}
  const result=await f.updater.runNow();assert.equal(result.result,'rolled-back',breaks);assert.equal(f.asked(),1,breaks);assert.ok(f.calls.some(call=>call.join(' ')==='git reset --hard old-commit'),breaks);assert.ok(f.calls.some(call=>call[1]==='import'&&call.at(-1)==='--force'),breaks);assert.equal(readNotices(f.store).length,1,breaks);
 }
});

test('a rejected update command follows rollback and keeps its diagnostics scrubbed',async t=>{
 const f=fixture(t,{rejects:'update'}),result=await f.updater.runNow();assert.equal(result.result,'rolled-back');assert.equal(f.store.get('notifications','hermes-update-1.1.0').status,'pending');assert.equal(readNotices(f.store).length,1);assert.doesNotMatch(JSON.stringify(readHermesUpdate(f.store)),/sk-secret-token/);
});

test('a non-sign-in AI failure rolls back and does not ask a second question',async t=>{
 const f=fixture(t,{aiFails:true}),result=await f.updater.runNow();assert.equal(result.result,'rolled-back');assert.equal(result.reason,'AI probe');assert.equal(f.asked(),1);assert.equal(readNotices(f.store).length,1);
});

test('a rollback failure leaves only the installer bell',async t=>{
 const f=fixture(t,{breaks:'cron list'}),base=f.updater.command.bind(f.updater);f.updater.command=async(executable,args,options)=>args.join(' ')==='gateway restart'&&f.calls.some(call=>call.join(' ')==='git reset --hard old-commit')?{code:1,stdout:'',stderr:'restart failed'}:base(executable,args,options);const result=await f.updater.runNow();assert.equal(result.result,'rollback-failed');assert.equal(f.store.get('notifications','hermes-update-1.1.0').status,'pending');assert.equal(readNotices(f.store).length,0);assert.match(f.store.get('notifications','hermes-update-1.1.0').body,/Run the Hermes installer again/);
});

test('the newest Godspeed backup replaces its recorded predecessor',async t=>{
 const f=fixture(t);await f.updater.runNow();const first=readHermesUpdate(f.store).backup;f.updater.fetcher=async()=>({ok:true,json:async()=>releases(['1.2.0'])});
 const original=f.updater.command.bind(f.updater);f.updater.command=async(executable,args,options)=>{const result=await original(executable,args,options);if(args[0]==='--version'&&f.calls.filter(call=>call[1]==='update'&&call[2]==='--no-backup').length>=2)return {code:0,stdout:'Hermes 1.2.0\n',stderr:''};return result;};
 await f.updater.runNow();const second=readHermesUpdate(f.store).backup;assert.notEqual(second,first);assert.equal(fs.existsSync(first),false);assert.equal(fs.existsSync(second),true);
});

test('an unrecovered later update still replaces its recorded predecessor backup',async t=>{
 const f=fixture(t);await f.updater.runNow();const first=readHermesUpdate(f.store).backup;f.updater.fetcher=async()=>({ok:true,json:async()=>releases(['1.2.0'])});
 const original=f.updater.command.bind(f.updater);f.updater.command=async(executable,args,options)=>args.join(' ')==='gateway stop'&&f.calls.filter(call=>call[1]==='update'&&call[2]==='--no-backup').length>=2?{code:1,stdout:'',stderr:'stop failed'}:original(executable,args,options);
 const result=await f.updater.runNow(),second=readHermesUpdate(f.store).backup;assert.equal(result.result,'rollback-failed');assert.notEqual(second,first);assert.equal(fs.existsSync(first),false);assert.equal(fs.existsSync(second),true);
});

test('a later nightly pass closes a rollback notice and release lookup failures say so',async t=>{
 const f=fixture(t,{breaks:'cron list'});await f.updater.runNow();const result=await f.updater.runNow();assert.equal(result.result,'checked');assert.equal(f.store.get('notifications','hermes-update-1.1.0').status,'resolved');assert.equal(f.asked(),2);assert.equal((await f.updater.runNow()).result,'skipped');assert.equal(f.calls.filter(call=>call[1]==='update'&&call[2]==='--no-backup').length,1,'a failed release waits thirty days');
 const failed=fixture(t);failed.updater.fetcher=async()=>{throw Object.assign(Error('token=sk-secret-token-value-123456789'),{stderr:'token=sk-secret-token-value-123456789'});};const discovery=await failed.updater.runNow();assert.equal(discovery.result,'failed');assert.equal(discovery.reason,'Hermes release discovery failed.');assert.doesNotMatch(JSON.stringify(readHermesUpdate(failed.store)),/sk-secret-token/);
});

test('dirty, foreign, Docker, and Windows installations do not mutate',async t=>{
 const cases=[['dirty',f=>{const git=f.updater.git.bind(f.updater);f.updater.git=async(args,cwd)=>args[0]==='status'?{code:0,stdout:' M local.py\n',stderr:''}:git(args,cwd);},'The Hermes checkout has uncommitted changes.'],['foreign',f=>{f.updater.getuid=()=>-1;},'This Hermes checkout belongs to another user.'],['Docker',()=>{},'This Hermes installation is managed by Docker.',true],['Windows',f=>{f.updater.platform='win32';},'Windows updates are managed by its installer.']];
 for(const [name,change,reason,docker] of cases){const f=fixture(t,{isDocker:docker});change(f);const result=await f.updater.runNow();assert.equal(result.reason,reason,name);assert.equal(f.calls.some(call=>call[1]==='update'),false,name);}
});

test('the first scheduler pass at or after 04:15 runs once in the installation timezone',async t=>{
 const f=fixture(t);f.setClock('2026-11-06T03:14:00Z');assert.equal(await f.updater.tick('Europe/Berlin'),null);f.setClock('2026-11-06T04:16:01Z');assert.equal((await f.updater.tick('UTC')).result,'updated');assert.equal(await f.updater.tick('UTC'),null);
});

test('active chats, scheduler ticks, and manual routines defer updates for their whole lifetime',async t=>{
 const busy='Godspeed is still handling a chat or routine.';
 const cases=[
  ['chat reply',async(f,lifecycle)=>{let child;const agent=nativeAgent({executable:f.updater.descriptor.executable,home:f.updater.descriptor.home,cwd:f.store.root,lifecycle,spawnProcess:()=>{child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();return child;}}),pending=agent({message:'hold'});await new Promise(resolve=>setImmediate(resolve));return async()=>{child.emit('close',1);await assert.rejects(pending);};}],
  ['routine tick',async(f,lifecycle)=>{let entered,finish;const started=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{finish=resolve;}),scheduler=new NativeScheduler(f.store,{home:f.updater.descriptor.home,executable:f.updater.descriptor.executable,lifecycle,run:async()=>{entered();await gate;return {stdout:''};}}),pending=scheduler.tick();await started;return async()=>{finish();await pending;};}],
  ['manual routine',async(f,lifecycle)=>{const jobs=path.join(f.updater.descriptor.home,'cron');fs.mkdirSync(jobs,{recursive:true});fs.writeFileSync(path.join(jobs,'jobs.json'),JSON.stringify({jobs:[{id:'brief',name:'Brief'}]}));let entered,finish;const started=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{finish=resolve;}),scheduler=new NativeScheduler(f.store,{home:f.updater.descriptor.home,executable:f.updater.descriptor.executable,lifecycle,run:async()=>{entered();await gate;return {stdout:''};}});scheduler.startRun('brief');await started;return async()=>{finish();await scheduler.running;};}]
 ];
 for(const [name,enter] of cases){const f=fixture(t),lifecycle=new HermesLifecycle();f.updater.lifecycle=lifecycle;const leave=await enter(f,lifecycle);assert.equal(lifecycle.busy,true,name);assert.deepEqual(await f.updater.runNow(),{result:'skipped',reason:busy},name);assert.equal(f.calls.some(call=>call[1]==='update'&&call[2]==='--no-backup'),false,name);await leave();assert.equal(lifecycle.busy,false,name);}
});

test('a busy scheduled update records its visible deferral reason before marking the day',async t=>{
 const f=fixture(t);f.updater.isBusy=()=>true;const result=await f.updater.tick('UTC'),last=readHermesUpdate(f.store).last;assert.equal(result.result,'skipped');assert.equal(last.result,'skipped');assert.equal(last.reason,'Godspeed is still handling a chat or routine.');assert.equal(last.day,'2026-11-06');
});
