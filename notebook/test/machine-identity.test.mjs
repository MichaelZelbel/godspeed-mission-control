import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn,execFile} from 'node:child_process';import {fileURLToPath} from 'node:url';import {EventEmitter} from 'node:events';import net from 'node:net';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {NativeScheduler} from '../core/native-scheduler.mjs';import {NoteProcessing} from '../core/processing.mjs';import {BackupSchedule} from '../core/backup-schedule.mjs';import {Scheduler} from '../core/jobs/scheduler.mjs';
import {createService} from '../server/main.mjs';

// Every PC was called 'local', so the "one machine runs the routines" rule
// could not tell two of them apart. These tests load the identity module when
// they run, so on code without it they fail one by one rather than all at once.
const identity=()=>import('../core/device-id.mjs');
const temporary=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-machine-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;};
const server=fileURLToPath(new URL('../server/main.mjs',import.meta.url));
const freePort=()=>new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const {port}=s.address();s.close(()=>resolve(port));});});

test('two computers started without a name are told apart, and neither is called local',async t=>{
 const ids=[];
 for(const name of ['desktop','laptop']){
  const root=temporary(t),port=await freePort(),env={...process.env,GODSPEED_WORKSPACE:root,GODSPEED_PORT:String(port)};delete env.GODSPEED_DEVICE;delete env.GODSPEED_ORIGINAL_RUNTIME;
  const child=spawn(process.execPath,[server],{env,stdio:['ignore','pipe','pipe'],windowsHide:true});
  try{
   let status=null;for(const until=Date.now()+30000;!status&&Date.now()<until;){try{const r=await fetch('http://127.0.0.1:'+port+'/api/status');if(r.ok)status=await r.json();}catch{}if(!status)await new Promise(r=>setTimeout(r,250));}
   assert.ok(status,name+' started');ids.push(status.device);
  }finally{child.kill();await new Promise(r=>child.once('exit',r));}
 }
 assert.notEqual(ids[0],'local');assert.notEqual(ids[1],'local');assert.notEqual(ids[0],ids[1]);
 for(const id of ids)assert.match(id,/^[a-z0-9][a-z0-9-]{0,39}$/,'a name Settings can choose as the machine that runs routines');
});

test('a machine keeps its name across restarts, and a named one keeps the name it was given',async t=>{
 const {deviceId,machineDevice}=await identity();const root=temporary(t),state=path.join(root,'.godspeed');
 const first=deviceId(state);assert.equal(deviceId(state),first);assert.equal(machineDevice(root,{}).id,first);assert.equal(machineDevice(root,{GODSPEED_DEVICE:'local'}).id,first,'the old shared name counts as no name');
 assert.deepEqual(machineDevice(root,{GODSPEED_DEVICE:'vps'}),{id:'vps',generated:false});
 assert.notEqual(deviceId(path.join(temporary(t),'.godspeed')),first);
});

test('the server and its supervisor starting at once agree on one name',async t=>{
 const root=temporary(t),module=new URL('../core/device-id.mjs',import.meta.url).href,state=path.join(root,'.godspeed');
 const runs=Array.from({length:6},()=>new Promise((resolve,reject)=>execFile(process.execPath,['--input-type=module','-e',`import {deviceId} from ${JSON.stringify(module)};process.stdout.write(deviceId(${JSON.stringify(state)}));`],{windowsHide:true},(error,stdout)=>error?reject(error):resolve(stdout.trim()))));
 const ids=await Promise.all(runs);assert.equal(new Set(ids).size,1);
});

// The same synced records on every machine; each machine has its own name.
const shared=(root,device,owner='local')=>{
 const store=new Store(root,{device});
 if(!store.get('settings','installation'))store.save('settings',{id:'installation',owner,timezone:'Europe/Berlin',delivery:'notebook'});
 if(!store.get('settings','processing'))store.save('settings',{id:'processing',enabled:true,daily_limit:40,quiet_minutes:0,min_chars:5,retry_minutes:30,max_attempts:3,since:'2000-01-01T00:00:00.000Z'});
 if(!store.get('notes','knee'))store.save('notes',{id:'knee',title:'Knee appointment',content:'Orthopaedist on Monday at 9, bring the MRI.'});
 const cron=[];const scheduler=new NativeScheduler(store,{executable:'hermes',home:root,device,run:async(e,a)=>{cron.push(a.join(' '));return {stdout:''};}});
 let calls=0;const processing=new NoteProcessing({store,query:new QueryService(store),domains:{provider:()=>{},invoke:async()=>{calls++;return {processed:1};}},device});
 return {store,scheduler,processing,cron,calls:()=>calls,backup:new BackupSchedule({store,runner:{run:async()=>({})},device})};
};

test('one PC upgrading takes over the routines the old shared name ran',async t=>{
 const {claimLegacyOwner}=await identity();const root=temporary(t),desktop=shared(root,'desktop-3f9a1c2e');
 desktop.store.save('jobs',{id:'goal-work',kind:'goal-work',owner:'local',paused:false,state:'pending',next_run:new Date().toISOString(),interval_ms:86400000});
 assert.equal(await claimLegacyOwner(desktop.store,{id:'desktop-3f9a1c2e',generated:true}),true);
 assert.equal(desktop.store.get('settings','installation').owner,'desktop-3f9a1c2e');assert.equal(desktop.store.get('jobs','goal-work').owner,'desktop-3f9a1c2e');
 await desktop.scheduler.tick();await desktop.processing.tick({now:Date.now()+1000});
 assert.equal(desktop.cron.length,1);assert.equal(desktop.calls(),1);
 const at3=Date.parse(new Date().toISOString().slice(0,10)+'T12:00:00Z');assert.equal(desktop.backup.due(at3),true);
});

test('with two PCs, the first to start runs the routines and the other does not',async t=>{
 const {claimLegacyOwner}=await identity();const root=temporary(t),desktop=shared(root,'desktop-3f9a1c2e'),laptop=shared(root,'laptop-77aa01bc');
 assert.equal(await claimLegacyOwner(desktop.store,{id:'desktop-3f9a1c2e',generated:true}),true);
 assert.equal(await claimLegacyOwner(laptop.store,{id:'laptop-77aa01bc',generated:true}),false,'the second machine sees an owner that is not its own');
 for(const m of [desktop,laptop]){await m.scheduler.tick();await m.processing.tick({now:Date.now()+1000});}
 assert.equal(desktop.cron.length,1);assert.equal(laptop.cron.length,0);
 assert.equal(desktop.calls(),1);assert.equal(laptop.calls(),0,'the note is processed once');
 const noon=Date.parse(new Date().toISOString().slice(0,10)+'T12:00:00Z');assert.equal(laptop.backup.due(noon),false);
});

test('an owner with a real name is never touched, and a server named by its launcher never claims',async t=>{
 const {claimLegacyOwner}=await identity();const root=temporary(t),pc=shared(root,'desktop-3f9a1c2e','production');
 assert.equal(await claimLegacyOwner(pc.store,{id:'desktop-3f9a1c2e',generated:true}),false);assert.equal(pc.store.get('settings','installation').owner,'production');
 const other=temporary(t),vps=shared(other,'vps');
 assert.equal(await claimLegacyOwner(vps.store,{id:'vps',generated:false}),false);assert.equal(vps.store.get('settings','installation').owner,'local');
});

test('"this machine" in Settings means this machine\'s own name',async t=>{
 const root=temporary(t),service=await createService({root,port:0,device:'desktop-3f9a1c2e'}),base='http://127.0.0.1:'+service.address.port;
 try{
  service.scheduler.configure({goal:'Fictional owner choice',timezone:'Europe/Berlin'});
  const response=await fetch(base+'/api/owner',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({owner:'this'})});
  assert.equal(response.status,200);assert.equal((await response.json()).owner,'desktop-3f9a1c2e');assert.equal(service.store.get('settings','installation').owner,'desktop-3f9a1c2e');
 }finally{await service.close();}
});

test('the supervisor starts a notebook again after it failed to start, and reads missing runs for this machine',async t=>{
 const {Supervisor}=await import('../core/supervisor.mjs');const root=temporary(t);fs.mkdirSync(path.join(root,'.godspeed'),{recursive:true});
 const children=[],timers=[];let device;
 const supervisor=new Supervisor({root,server:'server.mjs',device:'desktop-3f9a1c2e',spawnProcess:()=>{const child=new EventEmitter();child.pid=undefined;children.push(child);return child;},setTimer:(fn,ms)=>timers.push({fn,ms}),terminate:async()=>{},missing:(r,now,d)=>{device=d;return [];},fetchImpl:async()=>({ok:true,json:async()=>({instance:supervisor.instance,scheduler_heartbeat:new Date(Date.now()-4*60000).toISOString()})}),graceMs:0,exit:()=>{}});
 supervisor.launch();children[0].emit('error',Object.assign(new Error('spawn EAGAIN'),{code:'EAGAIN'}));children[0].emit('exit',null,null);
 await new Promise(r=>setImmediate(r));
 assert.equal(timers.length,1,'one new start is planned, even when both error and exit arrive');timers[0].fn();assert.equal(children.length,2);
 // A heartbeat four minutes old is a server inside a long routine, not a stall.
 await supervisor.check();assert.equal(device,'desktop-3f9a1c2e');assert.equal(supervisor.monitor.failures,0);
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,'.godspeed','supervisor.json'),'utf8')).state,'healthy');
});
