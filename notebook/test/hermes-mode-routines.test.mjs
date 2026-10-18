import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';
import {Store} from '../core/records/store.mjs';import {NativeScheduler} from '../core/native-scheduler.mjs';import {Scheduler} from '../core/jobs/scheduler.mjs';import {QueryService} from '../core/query.mjs';import {watchCommand} from '../core/watch-commands.mjs';
// The watch below reads a page from a server on this machine (core/outbound-fetch.mjs).
process.env.GODSPEED_OUTBOUND_ALLOW_LOCAL='1';

const temporary=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-hermes-mode-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;};
const owned=(root,device,owner='vps')=>{
 const store=new Store(root,{device});store.save('settings',{id:'installation',owner,timezone:'Europe/Berlin',delivery:'notebook'});
 fs.mkdirSync(path.join(root,'skills','morning-brief'),{recursive:true});fs.writeFileSync(path.join(root,'skills','morning-brief','SKILL.md'),'# Morning brief');
 const calls=[],ran=[];
 const records=new Scheduler(store,{device,only:NativeScheduler.recordKinds,delivery:'notebook',executor:async job=>{ran.push(job.kind);return {verified:true,silent:true};}});
 const scheduler=new NativeScheduler(store,{executable:'hermes',home:path.join(root,'.hermes'),device,records,run:async(exe,args)=>{calls.push(args);return {stdout:''};}});
 return {store,scheduler,calls,ran};
};

test('a routine cannot be added or run on a machine that does not run the routines',async t=>{
 const laptop=owned(temporary(t),'laptop-1234abcd');
 await assert.rejects(laptop.scheduler.control({kind:'morning-brief',at:'05:16'},{enable:true}),/machine named vps/);
 await assert.rejects(laptop.scheduler.runNow(),/machine named vps/);
 assert.equal(laptop.calls.length,0,'nothing went into this machine\'s Hermes');
 const server=owned(temporary(t),'vps');await server.scheduler.control({kind:'morning-brief',at:'05:16'},{enable:true});assert.equal(server.calls[0][1],'create');
});

test('with the original assistant, the notebook\'s own record routines run on the machine that runs the routines',async t=>{
 const root=temporary(t),server=owned(root,'vps'),now=new Date(Date.now()-1000).toISOString();
 server.store.save('jobs',{id:'radar-prepare-x',kind:'radar-prepare',owner:'vps',paused:false,state:'pending',next_run:now,interval_ms:86400000});
 // Hermes owns the goal routines: the notebook does not run a second copy of them.
 server.store.save('jobs',{id:'goal-work',kind:'goal-work',owner:'vps',paused:false,state:'pending',next_run:now,interval_ms:86400000});
 await server.scheduler.tick();
 assert.deepEqual(server.ran,['radar-prepare']);assert.deepEqual(server.calls.map(a=>a.join(' ')),['cron tick']);
 const laptop=owned(temporary(t),'laptop-1234abcd');laptop.store.save('jobs',{id:'radar-prepare-x',kind:'radar-prepare',owner:'vps',paused:false,state:'pending',next_run:now,interval_ms:86400000});
 await laptop.scheduler.tick();assert.deepEqual(laptop.ran,[]);
});

test('a record routine is paused and resumed through its guarded control, also with the original assistant',async t=>{
 const server=owned(temporary(t),'vps');
 server.store.save('jobs',{id:'watch-sweeper',kind:'watch',owner:'vps',paused:false,state:'needs_review',next_run:new Date().toISOString(),interval_ms:60000});
 server.store.save('settings',{id:'installation',delivery:'telegram'});
 await assert.rejects(server.scheduler.control({id:'watch-sweeper',paused:false}),/reviewed/);
 const paused=await server.scheduler.control({id:'watch-sweeper',paused:true});assert.equal(paused.paused,true);
});

test('the integrated server sweeps a watch topic when the original assistant runs the routines',async t=>{
 const root=temporary(t),home=path.join(root,'.hermes-home'),bin=path.join(root,'.hermes-bin');fs.mkdirSync(home);fs.mkdirSync(bin);
 let executable;
 if(process.platform==='win32'){executable=path.join(bin,'hermes.exe');try{fs.linkSync(process.execPath,executable);}catch{fs.copyFileSync(process.execPath,executable);}}
 else{executable=path.join(bin,'hermes');fs.writeFileSync(executable,'#!/bin/sh\nscript="$1"; shift\nexec "'+process.execPath+'" "$PWD/$script" "$@"\n',{mode:0o755});}
 // `hermes cron tick` with nothing due.
 fs.writeFileSync(path.join(root,'cron'),'process.exit(0)');
 fs.mkdirSync(path.join(root,'.godspeed'),{recursive:true});fs.writeFileSync(path.join(root,'.godspeed','assistant.json'),JSON.stringify({verified:true,executable,home}));
 const source=http.createServer((req,res)=>res.end('Release 2.0 is out'));await new Promise(r=>source.listen(0,'127.0.0.1',r));t.after(()=>source.close());
 const saved=process.env.GODSPEED_ORIGINAL_RUNTIME;process.env.GODSPEED_ORIGINAL_RUNTIME='on';t.after(()=>{if(saved===undefined)delete process.env.GODSPEED_ORIGINAL_RUNTIME;else process.env.GODSPEED_ORIGINAL_RUNTIME=saved;});
 const {createService}=await import('../server/main.mjs');
 const service=await createService({root,port:0,device:'vps'});
 try{
  service.store.save('settings',{id:'installation',owner:'vps',timezone:'Europe/Berlin',delivery:'notebook'});
  watchCommand({store:service.store,query:new QueryService(service.store)},['add','releases','--title','Releases','--shape','source-watch','--cadence','daily','--better','x','--authority','x','--tell-me-when','x','--url','http://127.0.0.1:'+source.address().port+'/releases']);
  await service.scheduler.tick();
  assert.equal(service.store.list('watch_observations').length,1,'the topic was read');
  assert.ok(Date.parse(service.store.list('watch_topics')[0].next_run_at)>Date.now());
 }finally{await service.close();}
});

test('choosing another machine to run the routines moves the notebook\'s record routines with it',async t=>{
 const server=owned(temporary(t),'vps');server.store.save('jobs',{id:'watch-sweeper',kind:'watch',owner:'vps',paused:false,state:'pending',next_run:new Date().toISOString(),interval_ms:60000});
 await server.scheduler.transfer('desktop-3f9a1c2e');
 assert.equal(server.store.get('settings','installation').owner,'desktop-3f9a1c2e');assert.equal(server.store.get('jobs','watch-sweeper').owner,'desktop-3f9a1c2e');
});

test('with the original assistant, the routines list shows the record routines beside Hermes\' jobs',async t=>{
 const root=temporary(t),server=owned(root,'vps'),query=new QueryService(server.store);
 fs.mkdirSync(path.join(root,'.hermes','cron'),{recursive:true});fs.writeFileSync(path.join(root,'.hermes','cron','jobs.json'),JSON.stringify({jobs:[{id:'brief',name:'Morning brief',enabled:true}]}));
 server.store.save('jobs',{id:'watch-sweeper',kind:'watch',owner:'vps',paused:false,state:'pending',next_run:new Date().toISOString(),interval_ms:60000});
 server.store.save('jobs',{id:'goal-work',kind:'goal-work',owner:'vps',paused:false,state:'pending',next_run:new Date().toISOString(),interval_ms:86400000});
 query.nativeHermesHome=path.join(root,'.hermes');
 // Hermes runs the goal routines, so the notebook's own copy is not listed as one that runs.
 assert.deepEqual(query.rows('jobs').map(j=>j.id).sort(),['brief','watch-sweeper']);
});
