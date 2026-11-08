import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {NativeScheduler} from '../core/native-scheduler.mjs';
import {Store} from '../core/records/store.mjs';
import {readNotebookRoutines} from '../core/notebook-routines.mjs';
import {WorkoutsAddon} from '../core/workouts.mjs';
import {createService} from '../server/main.mjs';
import {startFakeHevy,KEY,workout} from '../../third-party/addons/godspeed-workouts/test/fakes/hevy.mjs';
import {startFakeNotebook} from '../../third-party/addons/godspeed-workouts/test/fakes/notebook.mjs';
import {readKey} from '../../third-party/addons/godspeed-workouts/lib/keys.mjs';

const temporary=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-workouts-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;};
const REPLACEMENT_KEY='66666666-7777-4888-8999-aaaaaaaaaaaa';
function fakeHermes(home){
 let serial=0,onRun=async()=>{};const events=[],file=path.join(home,'cron','jobs.json'),read=()=>fs.existsSync(file)?JSON.parse(fs.readFileSync(file)).jobs:[],write=jobs=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify({jobs}));};
 const run=async(_exe,args)=>{const [,verb,...rest]=args,flag=name=>rest[rest.indexOf(name)+1];events.push(verb+(verb==='run'?':'+rest[0]:''));if(verb==='create'){const jobs=read();jobs.push({id:'job'+(++serial),name:flag('--name'),script:flag('--script'),workdir:flag('--workdir'),schedule:{expr:rest[0]},enabled:true});write(jobs);}if(verb==='run')await onRun(rest[0]);if(verb==='remove')write(read().filter(job=>job.id!==rest[0]));return {stdout:''};};
 return {run,jobs:read,events,setRun:handler=>{onRun=handler;}};
}
function handoverFixture(t,{mode='fresh'}={}){
 const root=temporary(t),home=path.join(root,'.hermes'),store=new Store(root,{device:'pc'}),hermes=fakeHermes(home),events=hermes.events;let now=Date.parse('2030-01-01T00:00:00Z'),last=null;
 let retirementError=mode==='uninstall-fails'?'legacy timer remains':null;
 const scheduler=new NativeScheduler(store,{home,executable:'hermes',device:'pc',run:hermes.run,now:()=>now}),addon={hasKey:()=>true,routineConfig:()=>({}),status:async()=>{events.push('status');return {minute:17,last_run:last};},uninstall:async()=>{events.push('uninstall');if(retirementError)throw Error(retirementError);}};
 fs.writeFileSync(path.join(root,'AGENTS.md'),'# test');scheduler.setWorkouts(addon);
 hermes.setRun(async()=>{if(mode==='run-fails')throw Object.assign(Error('first import failed'),{stderr:'first import failed\ntoken=sk-secret-token-value-123456789'});last=mode==='stale'?{ok:true,at:new Date(now-1).toISOString()}:mode==='failed'?{ok:false,at:new Date(now).toISOString()}:{ok:true,at:new Date(now).toISOString()};});
 return {store,hermes,scheduler,events,advance:ms=>{now+=ms;},setRetirementError:error=>{retirementError=error;}};
}

test('the notebook owns one Workouts routine, replaces its key, and disconnects without touching the add-on state',async t=>{
 const root=temporary(t),state=path.join(root,'private-state'),app=path.join(root,'copied-addon'),home=path.join(root,'.hermes'),store=new Store(root,{device:'pc'}),hermes=fakeHermes(home),scheduler=new NativeScheduler(store,{home,executable:'hermes',device:'pc',run:hermes.run}),hevy=await startFakeHevy(),notebook=await startFakeNotebook();t.after(()=>Promise.all([hevy.close(),notebook.close()]));
 fs.writeFileSync(path.join(root,'AGENTS.md'),'# test');hevy.add(workout({start:'2026-01-01T10:00:00Z',exercises:[]}));
 const addon=new WorkoutsAddon({root,address:()=>notebook.url,env:{...process.env,GODSPEED_WORKOUTS_STATE:state,GODSPEED_WORKOUTS_APP:app,GODSPEED_WORKOUTS_TEST:'1',GODSPEED_WORKOUTS_HEVY_API:hevy.url}});
 scheduler.setWorkouts(addon);
 await scheduler.followWorkouts();assert.equal(hermes.jobs().length,0,'no key makes no routine');assert.equal(hevy.calls.length,0,'no key makes no Hevy call');
 await assert.rejects(addon.connect('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'),/Hevy refused that key/);assert.equal(fs.existsSync(path.join(state,'hevy.json')),false);
 await addon.connect(KEY);
 hermes.setRun(async()=>{const result=await addon.command(['run','--scheduled']);assert.equal(result.code,0,result.stderr);});
 await Promise.all([scheduler.followWorkouts(),scheduler.followWorkouts()]);
 assert.equal(hermes.jobs().filter(job=>job.name==='Workouts from Hevy').length,1);
 const minute=(await addon.status()).minute;assert.equal(hermes.jobs()[0].schedule.expr,minute+' * * * *');
 const config=JSON.parse(fs.readFileSync(path.join(home,'scripts','godspeed-routines.json'),'utf8'));assert.ok(config.workouts.endsWith('godspeed-workouts.mjs'));assert.equal(config.workouts_notebook,notebook.url);
 hevy.fh.key=REPLACEMENT_KEY;await addon.connect(REPLACEMENT_KEY);await scheduler.followWorkouts({reconnect:true});
 assert.equal(readKey(addon.paths),REPLACEMENT_KEY,'a second accepted key replaces the one private key');assert.equal(hermes.jobs().filter(job=>job.name==='Workouts from Hevy').length,1,'replacement does not add a second routine');
 const files=[];const walk=folder=>{for(const entry of fs.readdirSync(folder,{withFileTypes:true})){const file=path.join(folder,entry.name);entry.isDirectory()?walk(file):files.push(file);}};walk(root);
 for(const file of files)if(file!==path.join(state,'hevy.json'))for(const key of [KEY,REPLACEMENT_KEY])assert.equal(fs.readFileSync(file,'utf8').includes(key),false,file+' retained the key');
 assert.equal(JSON.stringify(await addon.status()).includes(REPLACEMENT_KEY),false,'status does not return the replacement key');
 const removed=hermes.jobs()[0];await hermes.run('hermes',['cron','remove',removed.id]);await scheduler.followWorkouts();assert.equal(hermes.jobs().length,0,'a routine a person removed stays removed');
 await scheduler.disconnectWorkouts();assert.equal(hermes.jobs().length,0);assert.equal(readNotebookRoutines(store).jobs.find(job=>job.key==='workouts')?.switched_off,true);assert.equal(readKey(addon.paths),REPLACEMENT_KEY,'Disconnect retains the add-on key');assert.equal(notebook.rows().length,1,'Disconnect retains imported rows');
});

test('a carried Workouts routine proves its first import before replacing the standalone timer',async t=>{
 const {store,hermes,scheduler,events}=handoverFixture(t);
 await scheduler.followWorkouts();
 assert.deepEqual(events,['status','create','run:job1','status','uninstall']);
 assert.deepEqual(readNotebookRoutines(store).jobs.map(job=>job.id),['job1']);assert.equal(hermes.jobs().length,1);
});

test('a failed Workouts handover retains the standalone timer, reports a safe retry, and recovers',async t=>{
 const {store,hermes,scheduler,events,advance}=handoverFixture(t),command=scheduler.command.bind(scheduler);let createFails=true;
 scheduler.command=async(args,...rest)=>{if(createFails&&args[0]==='create')throw Object.assign(Error('Hermes could not create the routine'),{code:1,stderr:'Hermes could not create the routine\ntoken=sk-secret-token-value-123456789'});return command(args,...rest);};
 await assert.rejects(scheduler.followWorkouts(),/could not create/);
 assert.equal(events.includes('uninstall'),false);assert.equal(hermes.jobs().length,0);assert.equal(readNotebookRoutines(store).jobs.length,0);
 assert.deepEqual(scheduler.workoutsRoutineStatus(),{state:'pending',reason:'Hermes could not create the routine',retry_after:'2030-01-01T00:01:00.000Z'});assert.doesNotMatch(JSON.stringify(scheduler.workoutsRoutineStatus()),/sk-secret-token/);
 createFails=false;advance(60000);await scheduler.followWorkouts({retry:true});
 assert.equal(events.filter(event=>event==='uninstall').length,1);assert.equal(scheduler.workoutsRoutineStatus().state,'scheduled');assert.equal(scheduler.workoutsSetupFailure(),null);assert.equal(readNotebookRoutines(store).jobs.length,1);
 for(const mode of ['run-fails','stale','failed']){
  const next=handoverFixture(t,{mode});await assert.rejects(next.scheduler.followWorkouts(),/first import failed|did not complete/);
  assert.equal(next.events.includes('uninstall'),false,mode);assert.equal(next.hermes.jobs().length,0,mode);assert.equal(readNotebookRoutines(next.store).jobs.length,0,mode);assert.equal(next.scheduler.workoutsRoutineStatus().state,'pending',mode);
 }
 for(const kind of ['systemd-user','systemd-system']){
  const removal=handoverFixture(t,{mode:'uninstall-fails'}),reason=`systemd ${kind.slice('systemd-'.length)} manager refused reload`;removal.setRetirementError(reason);
  await assert.rejects(removal.scheduler.followWorkouts(),new RegExp(reason));
  assert.deepEqual(removal.events,['status','create','run:job1','status','uninstall'],kind);assert.equal(removal.hermes.jobs().length,1,kind);assert.deepEqual(readNotebookRoutines(removal.store).jobs.map(job=>job.id),['job1'],kind);
  assert.deepEqual(removal.scheduler.workoutsRoutineStatus(),{state:'scheduled',reason,retry_after:'2030-01-01T00:01:00.000Z'},kind);
  removal.setRetirementError(null);removal.advance(60000);await removal.scheduler.followWorkouts({retry:true});
  assert.deepEqual(removal.events,['status','create','run:job1','status','uninstall','status','uninstall'],kind);assert.equal(removal.hermes.jobs().length,1,kind);assert.deepEqual(removal.scheduler.workoutsRoutineStatus(),{state:'scheduled'},kind);
 }
});

test('a Workouts handover does not retire either importer when recording ownership fails',async t=>{
 const {store,hermes,scheduler,events}=handoverFixture(t),state=store.state;
 const open=fs.openSync;
 fs.openSync=(file,...args)=>{if(String(file).startsWith(path.join(state,'notebook-routines.json.'))&&String(file).endsWith('.tmp'))throw Object.assign(Error('No space left'),{code:'ENOSPC'});return open(file,...args);};
 try{await assert.rejects(scheduler.followWorkouts(),/No space left/);}finally{fs.openSync=open;}
 assert.equal(events.includes('uninstall'),false);assert.equal(hermes.jobs().length,0);assert.equal(readNotebookRoutines(store).jobs.length,0);
});

test('a failed carried-routine cleanup remains visible with an unproved handover failure',async t=>{
 const {store,hermes,scheduler,events}=handoverFixture(t,{mode:'run-fails'}),command=scheduler.command.bind(scheduler);
 const secret='sk-secret-token-value-123456789';
 scheduler.command=async(args,...rest)=>{if(args[0]==='remove')throw Object.assign(Error('Hermes refused carried cleanup'),{stderr:'Hermes refused carried cleanup: token='+secret});return command(args,...rest);};
 await assert.rejects(scheduler.followWorkouts(),/first import failed; carried routine cleanup failed: Hermes refused carried cleanup: credential: \*\*\*/);
 assert.deepEqual(events,['status','create','run:job1']);assert.equal(hermes.jobs().length,1);assert.equal(readNotebookRoutines(store).jobs.length,0);
 assert.deepEqual(scheduler.workoutsRoutineStatus(),{state:'pending',reason:'first import failed; carried routine cleanup failed: Hermes refused carried cleanup: credential: ***',retry_after:'2030-01-01T00:01:00.000Z'});
 assert.doesNotMatch(JSON.stringify(scheduler.workoutsRoutineStatus()),new RegExp(secret));
});

test('the Workouts add-on reports an unsuccessful standalone-timer removal',async t=>{
 const root=temporary(t),addon=new WorkoutsAddon({root,run:async()=>({code:1,stdout:'scheduler refused removal: token=sk-secret-token-value-123456789'})});
 await assert.rejects(addon.uninstall(),/Could not remove the standalone Workouts schedule: scheduler refused removal: credential: \*\*\*/);
 await assert.rejects(addon.uninstall(),error=>!String(error.message).includes('sk-secret-token'));
});

test('the Workouts API projects pending and retained-routine handover failures',async t=>{
 const root=temporary(t),home=path.join(root,'.hermes'),assistant=path.join(root,'assistant.json'),saved={runtime:process.env.GODSPEED_ORIGINAL_RUNTIME,config:process.env.GODSPEED_ASSISTANT_CONFIG};
 fs.mkdirSync(home,{recursive:true});fs.writeFileSync(assistant,JSON.stringify({verified:true,executable:'hermes',home}));process.env.GODSPEED_ORIGINAL_RUNTIME='on';process.env.GODSPEED_ASSISTANT_CONFIG=assistant;
 t.after(()=>{for(const [name,value] of Object.entries(saved))if(value===undefined)delete process.env[name==='runtime'?'GODSPEED_ORIGINAL_RUNTIME':'GODSPEED_ASSISTANT_CONFIG'];else process.env[name==='runtime'?'GODSPEED_ORIGINAL_RUNTIME':'GODSPEED_ASSISTANT_CONFIG']=value;});
 const service=await createService({root,device:'pc',port:0});t.after(()=>service.close());
 fs.writeFileSync(path.join(service.store.state,'routine-setup-failures.json'),JSON.stringify({steps:{workouts:{stderr:'Hermes could not create the routine',retry_after:'2030-01-01T00:01:00.000Z'}}}));
 const response=await fetch('http://127.0.0.1:'+service.address.port+'/api/workouts'),status=await response.json();
 assert.equal(response.status,200);assert.deepEqual(status.routine,{state:'pending',reason:'Hermes could not create the routine',retry_after:'2030-01-01T00:01:00.000Z'});
 fs.mkdirSync(path.join(home,'cron'),{recursive:true});fs.writeFileSync(path.join(home,'cron','jobs.json'),JSON.stringify({jobs:[{id:'job1'}]}));fs.writeFileSync(path.join(service.store.state,'notebook-routines.json'),JSON.stringify({jobs:[{id:'job1',key:'workouts'}]}));
 const retained=await fetch('http://127.0.0.1:'+service.address.port+'/api/workouts'),retainedStatus=await retained.json();
 assert.equal(retained.status,200);assert.deepEqual(retainedStatus.routine,{state:'scheduled',reason:'Hermes could not create the routine',retry_after:'2030-01-01T00:01:00.000Z'});
});

test('the carried command accepts its key only on stdin and its projected status never exposes it',async t=>{
 const root=temporary(t),state=path.join(root,'private-state'),app=path.join(root,'copied-addon'),hevy=await startFakeHevy(),notebook=await startFakeNotebook();t.after(()=>Promise.all([hevy.close(),notebook.close()]));
 fs.writeFileSync(path.join(root,'AGENTS.md'),'# test');hevy.add(workout({start:'2026-01-01T10:00:00Z',exercises:[]}));
 const addon=new WorkoutsAddon({root,address:()=>notebook.url,env:{...process.env,GODSPEED_WORKOUTS_STATE:state,GODSPEED_WORKOUTS_APP:app,GODSPEED_WORKOUTS_TEST:'1',GODSPEED_WORKOUTS_HEVY_API:hevy.url}});
 await assert.rejects(addon.connect('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'),/Hevy refused that key/);assert.equal(fs.existsSync(path.join(state,'hevy.json')),false);
 await addon.connect(KEY);const status=await addon.status({routine:{state:'scheduled'}});
 assert.equal(status.connected,true);assert.equal(status.rows,1);assert.ok(status.minute>0&&status.minute<59);
 const files=[];const walk=folder=>{for(const entry of fs.readdirSync(folder,{withFileTypes:true})){const file=path.join(folder,entry.name);entry.isDirectory()?walk(file):files.push(file);}};walk(root);
 for(const file of files)if(file!==path.join(state,'hevy.json'))assert.equal(fs.readFileSync(file,'utf8').includes(KEY),false,file+' retained the key');
 assert.equal(JSON.stringify(status).includes(KEY),false);
});
