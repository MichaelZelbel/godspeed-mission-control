import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createService} from '../server/main.mjs';
import {runRememberWhatYouSaid} from '../core/jobs/remember-job.mjs';

// #903: a notebook with no assistant program lists "Remember what you said" in Settings > Routines
// and can run it from there.
async function withService(t,fn){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-remember-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const service=await createService({root,device:'local',port:0});
 const url='http://127.0.0.1:'+service.address.port;
 const post=(route,body)=>fetch(url+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{await fn({service,post,url});}finally{await service.close();}
}
const setup=post=>post('/api/setup',{goal:'Run a 10k by spring',timezone:'Europe/Berlin'});

test('setup lists Remember what you said and Run now runs it, saying nothing without an AI',t=>withService(t,async({service,post,url})=>{
 assert.equal((await setup(post)).status,200);
 const {schedules}=await (await fetch(url+'/api/status')).json();
 const row=schedules.find(j=>j.id==='memory-daily');
 assert.equal(row.title,'Remember what you said');assert.equal(row.calendar.time,'03:40');
 const reply=await post('/api/jobs/run',{id:'memory-daily'});
 assert.equal(reply.status,202);assert.deepEqual(await reply.json(),{started:true,id:'memory-daily'});
 await service.scheduler.started;
 const job=service.store.get('jobs','memory-daily');
 assert.equal(job.last_outcome,'verified');assert.ok(job.last_run);assert.ok(Date.parse(job.next_run)>Date.now());
}));

test('Run now on another routine row runs that routine and answers its result',t=>withService(t,async({service,post})=>{
 await setup(post);
 const before=service.store.get('jobs','review');
 assert.ok(before&&!before.last_run);
 const reply=await post('/api/jobs/run',{id:'review'});
 assert.equal(reply.status,200);
 const {results}=await reply.json();
 assert.equal(results.length,1);assert.equal(results[0].id,'review');
 const job=service.store.get('jobs','review');
 assert.ok(job.last_run,'the review routine ran');assert.ok(Date.parse(job.next_run)>Date.now());
}));

test('an older notebook gains the routine when the server starts and keeps what the person set',t=>withService(t,async({service,post})=>{
 await setup(post);
 service.store.commit([],{removeKeys:['jobs/memory-daily']});
 assert.equal(service.store.get('jobs','memory-daily'),undefined);
 service.store.save('jobs',{id:'coaching',paused:true,next_run:'2031-01-01T00:00:00.000Z'});
 await service.scheduler.ensureStartingJobs();
 assert.ok(service.store.get('jobs','memory-daily'));
 const coaching=service.store.get('jobs','coaching');
 assert.equal(coaching.paused,true);assert.equal(coaching.next_run,'2031-01-01T00:00:00.000Z');
}));

test('Run now refuses an unknown or paused routine in plain words',t=>withService(t,async({service,post})=>{
 await setup(post);
 const unknown=await post('/api/jobs/run',{id:'nope'});
 assert.ok(unknown.status>=400);assert.match((await unknown.json()).error,/Choose an existing routine/);
 service.store.save('jobs',{id:'memory-daily',paused:true});
 const paused=await post('/api/jobs/run',{id:'memory-daily'});
 assert.ok(paused.status>=400);assert.match((await paused.json()).error,/This routine is paused\. Resume it, then run it\./);
}));

test('Run now refuses a routine owned elsewhere, awaiting review, or while another runs',t=>withService(t,async({service,post})=>{
 await setup(post);
 const refused=async(patch,re)=>{service.store.save('jobs',{id:'memory-daily',paused:false,state:'pending',owner:'local',...patch});const r=await post('/api/jobs/run',{id:'memory-daily'});assert.ok(r.status>=400);assert.match((await r.json()).error,re);};
 await refused({owner:'vps'},/does not run here/);
 await refused({state:'needs_review'},/needs its previous attempt reviewed/);
 await refused({state:'awaiting_approval'},/needs its previous attempt reviewed/);
 service.scheduler.running=true;
 await refused({},/already running/);
 service.scheduler.running=false;
}));

test('the program\'s failure never carries its output',async()=>{
 const store={root:'/tmp/ws'};
 await assert.rejects(runRememberWhatYouSaid({store,run:async()=>({code:1,stderr:'sk-secret',stdout:''})}),e=>e.message==='Remember what you said could not finish.');
 let env;
 assert.deepEqual(await runRememberWhatYouSaid({store,run:async(_e,_a,o)=>{env=o.env;return {code:0};}}),{verified:true,silent:true});
 assert.equal(env.GODSPEED_WORKSPACE,'/tmp/ws');
});
