import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {HermesUpdate,eligibleRelease,readHermesUpdate} from '../core/hermes-update.mjs';
import {readNotices} from '../core/notices.mjs';

const old=new Date(Date.now()-8*24*60*60*1000).toISOString(),recent=new Date(Date.now()-3*24*60*60*1000).toISOString();
function fixture(t,{breaks}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-hermes-update-')),source=path.join(root,'hermes-agent'),home=path.join(root,'.hermes'),executable=path.join(root,'bin','hermes');fs.mkdirSync(path.join(source,'hermes_cli'),{recursive:true});fs.mkdirSync(path.join(source,'venv','bin'),{recursive:true});fs.mkdirSync(path.dirname(executable),{recursive:true});fs.writeFileSync(path.join(source,'hermes_cli','__init__.py'),'');fs.writeFileSync(path.join(source,'venv','bin','python3'),'');fs.writeFileSync(executable,'');fs.mkdirSync(home,{recursive:true});fs.writeFileSync(path.join(home,'config.yaml'),'model:\n  provider: test\n  default: test\n');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 let version='1.0.0',updated=false,asked=0;const calls=[];
 const run=async(exe,args)=>{calls.push([path.basename(exe),...args]);if(exe==='git'){
  if(args[0]==='rev-parse')return {code:0,stdout:args[1]==='--is-inside-work-tree'?'true\n':'old-commit\n',stderr:''};
  if(args[0]==='status')return {code:0,stdout:'',stderr:''};
  if(args[0]==='for-each-ref')return {code:0,stdout:['v1.1.0\t'+old,'v1.2.0-rc.1\t'+old,'v2.0.0\t'+old,'v1.0.1\t'+recent].join('\n'),stderr:''};
  if(args[0]==='reset'){version='1.0.0';updated=false;return {code:0,stdout:'',stderr:''};}
 }
 if(path.basename(exe)==='hermes'){
  if(args[0]==='--version')return {code:0,stdout:'Hermes '+version+'\n',stderr:''};
  if(args[0]==='update'&&args[1]==='--check')return {code:0,stdout:'v1.1.0 is ready\n',stderr:''};
  if(args[0]==='update'){version='1.1.0';updated=true;return {code:0,stdout:'updated\n',stderr:''};}
  if(breaks===args.join(' ')&&updated)return {code:1,stdout:'token=sk-secret-token-value-123456789\n',stderr:'failed'};
  return {code:0,stdout:'ok\n',stderr:''};
 }
 return {code:0,stdout:'',stderr:''};
 };
 const store=new Store(root),updater=new HermesUpdate({store,descriptor:{verified:true,executable,home,sourceRoot:source},run,now:()=>new Date('2026-11-06T04:15:00Z'),ask:async()=>{asked++;}});
 return {store,updater,calls,asked:()=>asked};
}

test('only stable, week-old releases in the installed major are eligible',()=>{
 assert.deepEqual(eligibleRelease(['v1.1.0\t'+old,'v1.2.0-rc.1\t'+old,'v2.0.0\t'+old,'v1.0.1\t'+recent],'1.0.0'),{tag:'v1.1.0',version:'1.1.0',at:Date.parse(old)});
});

test('a passing release is updated once, validated, and leaves no notice',async t=>{
 const f=fixture(t),result=await f.updater.runNow();assert.equal(result.result,'updated');assert.equal(result.version,'1.1.0');assert.equal(f.asked(),1);assert.ok(f.calls.some(call=>call.join(' ')==='hermes update --backup --yes'));assert.deepEqual(f.store.list('notifications'),[]);
});

test('a failed cron check restores the previous checkout, dependencies and gateway without a second AI probe',async t=>{
 const f=fixture(t,{breaks:'cron list'}),result=await f.updater.runNow();assert.equal(result.result,'rolled-back');assert.equal(result.version,'1.0.0');assert.equal(f.asked(),1,'the rollback validation never asks AI twice');assert.equal(f.store.get('notifications','hermes-update-1.1.0').status,'pending');assert.equal(readNotices(f.store).length,1);assert.match(readNotices(f.store)[0].text,/Hermes 1\.1\.0 did not pass its Hermes cron check/);assert.ok(f.calls.some(call=>call.join(' ')==='git reset --hard old-commit'));assert.ok(f.calls.some(call=>call.join(' ')==='hermes gateway restart'));
});

test('a failed release waits thirty days and never retains its credential-shaped output',async t=>{
 const f=fixture(t,{breaks:'plugins list'});await f.updater.runNow();const state=readHermesUpdate(f.store);assert.ok(state.failed['1.1.0']);assert.equal((await f.updater.runNow()).result,'checked');assert.equal((await f.updater.runNow()).result,'skipped');assert.equal(f.calls.filter(call=>call.join(' ')==='hermes update --backup --yes').length,1);assert.doesNotMatch(JSON.stringify(state),/sk-secret-token/);
});

test('a later passing nightly check closes the rollback notices without a second update',async t=>{
 const f=fixture(t,{breaks:'cron list'});await f.updater.runNow();const result=await f.updater.runNow();assert.equal(result.result,'checked');assert.equal(f.store.get('notifications','hermes-update-1.1.0').status,'resolved');assert.equal(f.calls.filter(call=>call.join(' ')==='hermes update --backup --yes').length,1);assert.equal(f.asked(),2,'one probe per nightly run');
});

test('a dirty checkout is left untouched with a plain reason',async t=>{
 const f=fixture(t);const original=f.updater.git.bind(f.updater);f.updater.git=async(args,cwd)=>args[0]==='status'?{code:0,stdout:' M local.py\n',stderr:''}:original(args,cwd);const result=await f.updater.runNow();assert.equal(result.result,'skipped');assert.equal(result.reason,'The Hermes checkout has uncommitted changes.');assert.equal(f.calls.some(call=>call[0]==='hermes'&&call[1]==='update'),false);
});

test('another Godspeed writer prevents a second updater from starting',async t=>{
 const f=fixture(t);fs.writeFileSync(path.join(f.store.state,'workspace.lock'),'another Godspeed process');const result=await f.updater.runNow();assert.deepEqual(result,{result:'skipped',reason:'Another Godspeed process is using this workspace.'});assert.equal(f.calls.length,0);
});
