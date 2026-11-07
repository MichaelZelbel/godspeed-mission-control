import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {NativeScheduler} from '../core/native-scheduler.mjs';
import {Store} from '../core/records/store.mjs';
import {readNotebookRoutines} from '../core/notebook-routines.mjs';
import {WorkoutsAddon} from '../core/workouts.mjs';
import {startFakeHevy,KEY,workout} from '../../third-party/addons/godspeed-workouts/test/fakes/hevy.mjs';
import {startFakeNotebook} from '../../third-party/addons/godspeed-workouts/test/fakes/notebook.mjs';

const temporary=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-workouts-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;};
function fakeHermes(home){
 let serial=0;const file=path.join(home,'cron','jobs.json'),read=()=>fs.existsSync(file)?JSON.parse(fs.readFileSync(file)).jobs:[],write=jobs=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify({jobs}));};
 const run=async(_exe,args)=>{const [,verb,...rest]=args,flag=name=>rest[rest.indexOf(name)+1];if(verb==='create'){const jobs=read();jobs.push({id:'job'+(++serial),name:flag('--name'),script:flag('--script'),workdir:flag('--workdir'),schedule:{expr:rest[0]},enabled:true});write(jobs);}if(verb==='remove')write(read().filter(job=>job.id!==rest[0]));return {stdout:''};};
 return {run,jobs:read};
}

test('the notebook owns one Workouts routine, preserves removal, and disconnects without touching the add-on state',async t=>{
 const root=temporary(t),home=path.join(root,'.hermes'),store=new Store(root,{device:'pc'}),hermes=fakeHermes(home),scheduler=new NativeScheduler(store,{home,executable:'hermes',device:'pc',run:hermes.run});
 let uninstalls=0;const addon={hasKey:()=>true,status:async()=>({minute:17}),uninstall:async()=>{uninstalls++;},routineConfig:()=>({workouts:'/carried/godspeed-workouts.mjs',workouts_notebook:'http://127.0.0.1:1234'})};
 scheduler.setWorkouts(addon);
 await Promise.all([scheduler.followWorkouts(),scheduler.followWorkouts()]);
 assert.equal(hermes.jobs().filter(job=>job.name==='Workouts from Hevy').length,1);
 assert.equal(hermes.jobs()[0].schedule.expr,'17 * * * *');assert.equal(uninstalls,1,'the carried uninstaller removes any standalone timer before Hermes owns the hour');
 const config=JSON.parse(fs.readFileSync(path.join(home,'scripts','godspeed-routines.json'),'utf8'));assert.equal(config.workouts,'/carried/godspeed-workouts.mjs');assert.equal(config.workouts_notebook,'http://127.0.0.1:1234');
 const removed=hermes.jobs()[0];await hermes.run('hermes',['cron','remove',removed.id]);await scheduler.followWorkouts();assert.equal(hermes.jobs().length,0,'a routine a person removed stays removed');
 await scheduler.disconnectWorkouts();assert.equal(uninstalls,2);assert.equal(readNotebookRoutines(store).jobs.find(job=>job.key==='workouts')?.switched_off,true);
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
