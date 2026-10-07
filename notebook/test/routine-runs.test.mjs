import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {Scheduler} from '../core/jobs/scheduler.mjs';import {jobExecutor} from '../core/runtime.mjs';
import {Telegram} from '../core/telegram.mjs';import {controlRoutine} from '../core/jobs/routine-control.mjs';import {personalOperation} from '../core/personal-operations.mjs';import {watchCommand} from '../core/watch-commands.mjs';
import {NativeScheduler} from '../core/native-scheduler.mjs';import * as health from '../core/supervisor-health.mjs';

const workspace=(t,device='vps')=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-routine-runs-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const store=new Store(root,{device});return {root,store,query:new QueryService(store)};};
const brief=(store,delivery='telegram')=>{store.save('settings',{id:'installation',owner:'vps',timezone:'Europe/Berlin',delivery});store.save('jobs',{id:'morning-brief',kind:'morning-brief',owner:'vps',paused:false,state:'pending',next_run:'2026-10-07T03:16:00.000Z',interval_ms:86400000});};
const t0=Date.parse('2026-10-07T03:16:00Z');

test('a delivery whose outcome is unknown is never sent again, whichever way the routine is resumed',async t=>{
 const {store,query}=workspace(t);brief(store);
 let executions=0;const sends=[];
 const scheduler=new Scheduler(store,{device:'vps',executor:async()=>{executions++;const n=store.save('notes',{title:'Your morning briefing',content:'Good morning! Dentist at 10.'});return {verified:true,record_id:n.id};}});
 // Telegram received the first message, but its answer was lost.
 const telegram=new Telegram({store,domains:null,token:'TEST',owner:'1',transport:async(url,init)=>{sends.push(JSON.parse(init.body).text);if(sends.length===1)throw Object.assign(new Error('The operation was aborted due to timeout'),{name:'TimeoutError'});return new Response(JSON.stringify({ok:true,result:{message_id:sends.length}}));}});
 scheduler.deliver=(id,r)=>telegram.deliver(id,r);
 await scheduler.tick(t0);
 assert.equal(store.get('jobs','morning-brief').state,'needs_review');
 await assert.rejects(controlRoutine(store,{id:'morning-brief',paused:false},{now:t0+60000}),/reviewed/);
 assert.throws(()=>personalOperation({store,query},{type:'routine-change',id:'morning-brief',paused:false}),/reviewed/,'the chat and MCP route takes the same guard');
 // Even a job someone unpaused by hand is not started while it awaits review.
 store.save('jobs',{id:'morning-brief',paused:false});
 await scheduler.tick(t0+10*60000);
 assert.equal(executions,1);assert.equal(sends.length,1);
});

test('one saved message is delivered once, whichever run hands it over',async t=>{
 const {store}=workspace(t);brief(store);const sends=[];
 const telegram=new Telegram({store,domains:null,token:'TEST',owner:'1',transport:async(url,init)=>{sends.push(JSON.parse(init.body).text);return new Response(JSON.stringify({ok:true,result:{message_id:sends.length}}));}});
 const note=store.save('notes',{title:'Review fictional stretch',content:'Did you try the fictional stretch?'});
 await telegram.deliver('habit-check-1-1000',{record_id:note.id});await telegram.deliver('habit-check-1-2000',{record_id:note.id});
 assert.equal(sends.length,1);
 store.save('notes',{id:note.id,content:'A changed question is a new message.'});await telegram.deliver('habit-check-1-3000',{record_id:note.id});
 assert.equal(sends.length,2);
});

test('a delivered run stays delivered when its bookkeeping meets a busy workspace',async t=>{
 const {store}=workspace(t);brief(store);let executions=0;const sends=[];
 const scheduler=new Scheduler(store,{device:'vps',executor:async()=>{executions++;const note=store.save('notes',{title:'Your morning briefing',content:'Good morning! Today: dentist at 10.'});return {verified:true,record_id:note.id,delivery:'notebook'};}});
 const lock=path.join(store.state,'workspace.lock');
 const telegram=new Telegram({store,domains:null,token:'TEST',owner:'1',transport:async(url,init)=>{sends.push(JSON.parse(init.body).text);return new Response(JSON.stringify({ok:true,result:{message_id:100+sends.length}}),{status:200});}});
 // Just after Telegram has the message, another program on the machine takes the workspace lock for a moment.
 const holdLock=async()=>{spawn(process.execPath,['-e',`const fs=require('fs');const fd=fs.openSync(process.argv[1],'wx');fs.writeFileSync(fd,JSON.stringify({pid:process.pid,at:new Date().toISOString()}));setTimeout(()=>{fs.closeSync(fd);fs.unlinkSync(process.argv[1]);},1500);`,lock],{stdio:'ignore'});
  while(!fs.existsSync(lock)||!fs.readFileSync(lock,'utf8'))await new Promise(r=>setTimeout(r,10));};
 scheduler.deliver=async(id,result)=>{const sent=await telegram.deliver(id,result);await holdLock();return sent;};
 const first=await scheduler.tick(t0);
 assert.equal(first[0].state,'verified');
 await new Promise(r=>setTimeout(r,1800));
 await scheduler.tick(t0+120000);
 assert.equal(executions,1);assert.equal(sends.length,1);
 assert.equal(store.get('job_receipts','morning-brief-'+t0).state,'verified');
});

test('bookkeeping that cannot be written now is finished later, and the routine is not run again meanwhile',async t=>{
 const {store}=workspace(t);brief(store,'notebook');let executions=0;
 const scheduler=new Scheduler(store,{device:'vps',executor:async()=>{executions++;const note=store.save('notes',{title:'Brief',content:'Fictional brief'});return {verified:true,record_id:note.id};}});
 const commit=store.commit.bind(store);let broken=true;
 store.commit=(records,options)=>{if(broken&&records.some(r=>r.type==='job_receipts'&&r.state==='verified'))throw Error('Fictional disk trouble');return commit(records,options);};
 const first=await scheduler.tick(t0);assert.equal(first[0].state,'verified');assert.equal(first[0].finished,false);
 await scheduler.tick(t0+60000);assert.equal(executions,1,'an unfinished run is not started again');
 broken=false;await scheduler.tick(t0+120000);
 assert.equal(executions,1);assert.equal(store.get('job_receipts','morning-brief-'+t0).state,'verified');assert.ok(Date.parse(store.get('jobs','morning-brief').next_run)>t0+86400000-1000);
});

test('one job whose schedule cannot be read does not stop the jobs after it',async t=>{
 const {store}=workspace(t);store.save('settings',{id:'installation',owner:'vps',timezone:'UTC',delivery:'notebook'});
 // A job with an invalid calendar whose slot already ran: its next run cannot be computed.
 store.save('jobs',{id:'a-broken',kind:'selftest',owner:'vps',paused:false,state:'pending',next_run:new Date(t0).toISOString(),calendar:{time:'99:99'}});
 store.save('job_receipts',{id:'a-broken-'+t0,job_id:'a-broken',kind:'selftest',state:'verified'});
 store.save('jobs',{id:'b-fine',kind:'selftest',owner:'vps',paused:false,state:'pending',next_run:new Date(t0).toISOString(),interval_ms:86400000});
 const ran=[];const scheduler=new Scheduler(store,{device:'vps',executor:async job=>{ran.push(job.id);return {verified:true,silent:false,record_id:store.save('notes',{title:'x',content:'y'}).id};}});
 const results=await scheduler.tick(t0);
 assert.deepEqual(ran,['b-fine']);assert.ok(results.some(r=>r.id==='a-broken'&&r.state==='not run'));
 assert.match(store.get('jobs','a-broken').last_outcome,/Not run/);
});

for(const variant of ['private','sensitive','removed'])test('goal work under a '+variant+' goal is not pulled forward every tick',async t=>{
 const {store,query}=workspace(t,'local');let providerCalls=0;
 const scheduler=new Scheduler(store,{device:'local',executor:jobExecutor(async()=>{providerCalls++;return '{}';},query)});
 scheduler.configure({owner:'local',timezone:'Europe/Berlin',goal:'Plan the garden'});
 for(const j of store.list('jobs'))if(j.id!=='goal-work')store.save('jobs',{id:j.id,paused:true});
 const start=Date.parse('2026-10-07T08:00:00Z');store.save('jobs',{id:'goal-work',next_run:new Date(start+86400000).toISOString(),state:'pending'});
 const goal=store.list('goals')[0],decision=store.save('decisions',{goal_id:goal.id,state:'selected',title:'Draft the plan'});
 store.save('work_items',{title:'Draft the plan',goal_id:goal.id,decision_id:decision.id,kind:'draft',allowed_action:'save-draft',state:'pending',check:'A draft exists',dependencies:[],attempts:0,max_attempts:3});
 if(variant==='removed')store.structural('goals',goal.id,'remove');else store.save('goals',{id:goal.id,...(variant==='sensitive'?{is_sensitive:true}:{visibility_scope:'private'})});
 let runs=0;for(let i=0;i<20;i++)runs+=(await scheduler.tick(start+i*30000)).filter(r=>r.id==='goal-work').length;
 assert.equal(runs,0);assert.equal(store.list('job_receipts').filter(r=>r.job_id==='goal-work').length,0);assert.equal(providerCalls,0);
});

test('ready goal work is still pulled forward to the next tick',async t=>{
 const {store,query}=workspace(t,'local');
 const scheduler=new Scheduler(store,{device:'local',executor:async()=>({verified:true,silent:true})});
 scheduler.configure({owner:'local',timezone:'Europe/Berlin',goal:'Plan the garden'});
 for(const j of store.list('jobs'))if(j.id!=='goal-work')store.save('jobs',{id:j.id,paused:true});
 const start=Date.parse('2026-10-07T08:00:00Z');store.save('jobs',{id:'goal-work',next_run:new Date(start+86400000).toISOString(),state:'pending'});
 const goal=store.list('goals')[0],decision=store.save('decisions',{goal_id:goal.id,state:'selected',title:'Draft the plan'});
 store.save('work_items',{title:'Draft the plan',goal_id:goal.id,decision_id:decision.id,kind:'draft',allowed_action:'save-draft',state:'pending',check:'A draft exists',dependencies:[],attempts:0,max_attempts:3});
 const results=await scheduler.tick(start);assert.deepEqual(results.map(r=>r.id),['goal-work']);
});

test('an idle watch topic leaves no run receipts and the sweeper sleeps until it is due',async t=>{
 const {root,store,query}=workspace(t,'local');
 const scheduler=new Scheduler(store,{device:'local',executor:jobExecutor(null,query)});
 scheduler.configure({owner:'local',timezone:'Europe/Berlin',goal:'Stay informed'});
 for(const j of store.list('jobs'))store.save('jobs',{id:j.id,paused:true});
 watchCommand({store,query},['add','hermes-releases','--title','Hermes releases','--shape','source-watch','--cadence','weekly','--better','newer','--authority','maintainers','--tell-me-when','a release ships','--url','https://example.invalid/releases']);
 const topic=store.list('watch_topics')[0];store.save('watch_topics',{id:topic.id,next_run_at:'2026-10-14T00:00:00.000Z'});
 const start=Date.parse('2026-10-07T00:00:00Z');store.save('jobs',{id:'watch-sweeper',next_run:new Date(start).toISOString()});
 const revision=store.get('jobs','watch-sweeper').revision;
 for(let now=start;now<start+3*3600000;now+=30000)await scheduler.tick(now);
 assert.equal(store.list('job_receipts').filter(r=>r.job_id==='watch-sweeper').length,0);
 assert.ok(store.get('jobs','watch-sweeper').revision<=revision+1,'the sweeper is rescheduled once, not every minute');
 assert.equal(Date.parse(store.get('jobs','watch-sweeper').next_run),start+86400000,'it wakes within a day, or when its first topic is due');
 // A new topic wakes it at once.
 watchCommand({store,query},['add','second','--title','Second','--shape','source-watch','--cadence','daily','--better','x','--authority','x','--tell-me-when','x','--url','https://example.invalid/second']);
 assert.ok(Date.parse(store.get('jobs','watch-sweeper').next_run)<=Date.now());
});

test('a check that found nothing to say leaves no receipt; one that said something keeps it',async t=>{
 const {store}=workspace(t);store.save('settings',{id:'installation',owner:'vps',timezone:'UTC',delivery:'notebook'});
 store.save('jobs',{id:'journal-tick',kind:'journal-tick',owner:'vps',paused:false,state:'pending',next_run:new Date(t0).toISOString(),interval_ms:900000});
 let say=false;const scheduler=new Scheduler(store,{device:'vps',executor:async()=>say?{verified:true,silent:false,record_id:store.save('notes',{title:'Your journal check-in',content:'What are you working on?'}).id}:{verified:true,silent:true}});
 for(let i=0;i<8;i++)await scheduler.tick(t0+i*900000);
 assert.equal(store.list('job_receipts').length,0);assert.equal(Date.parse(store.get('jobs','journal-tick').next_run),t0+8*900000);
 say=true;await scheduler.tick(t0+8*900000);assert.equal(store.list('job_receipts').length,1);
});

test('old run receipts are removed after two weeks and the history of jobs after two days, keeping the last runs and every failure',async t=>{
 const {store}=workspace(t);store.save('settings',{id:'installation',owner:'vps',timezone:'UTC',delivery:'notebook'});
 store.save('jobs',{id:'portfolio',kind:'portfolio',owner:'vps',paused:true,state:'pending',next_run:new Date(t0).toISOString(),interval_ms:3600000});
 for(let i=0;i<10;i++){store.save('job_receipts',{id:'portfolio-'+(t0+i*3600000),job_id:'portfolio',kind:'portfolio',state:'verified',finished_at:new Date(t0+i*3600000).toISOString()});store.save('jobs',{id:'portfolio',last_run:new Date(t0+i*3600000).toISOString()});}
 store.save('job_receipts',{id:'portfolio-'+(t0-3600000),job_id:'portfolio',kind:'portfolio',state:'failed',error:'Fictional failure',finished_at:new Date(t0-3600000).toISOString()});
 store.save('job_receipts',{kind:'lead-verification',job_id:'portfolio',state:'verified',finished_at:new Date(t0).toISOString()});
 const note=store.save('notes',{title:'Kept',content:'first'});store.save('notes',{id:note.id,content:'second'});
 const scheduler=new Scheduler(store,{device:'vps',executor:async()=>({verified:true})});
 assert.ok(store.list('record_history').some(h=>h.source_type==='jobs'));
 // Three days on, only the history of jobs and receipts has gone.
 await scheduler.prune(Date.now()+3*86400000);assert.equal(store.list('record_history').filter(h=>h.source_type==='jobs').length,0);assert.equal(store.list('job_receipts').filter(r=>r.kind==='portfolio').length,11);
 scheduler.prunedAt=0;const later=Date.now()+15*86400000;
 for(let i=0;i<10&&(i===0||scheduler.pruneAgain);i++)await scheduler.prune(later+i);
 const runs=store.list('job_receipts').filter(r=>r.kind==='portfolio');
 assert.equal(runs.filter(r=>r.state==='verified').length,3,'the last three runs stay');assert.ok(runs.some(r=>r.state==='failed'),'a failure stays');
 assert.ok(store.list('job_receipts').some(r=>r.kind==='lead-verification'),'other receipts are not run receipts');
 assert.equal(store.list('record_history').filter(h=>['jobs','job_receipts'].includes(h.source_type)).length,0);
 assert.ok(store.list('record_history').some(h=>h.source_type==='notes'),'a note keeps its earlier versions');
 assert.equal(fs.readdirSync(path.join(store.recordsRoot,'_system','job_receipts')).length,store.list('job_receipts').length,'the files are gone too');
});

test('a long routine keeps the heartbeat alive while it is inside its time limit, and a wedged one does not',async t=>{
 const {store}=workspace(t);store.save('settings',{id:'installation',owner:'vps',timezone:'UTC'});
 // The original assistant's tick: Hermes runs every due job to the end before it returns.
 let options;const native=new NativeScheduler(store,{executable:'hermes',home:store.root,device:'vps',beatEvery:100,run:async(exe,args,o)=>{options=o;await new Promise(r=>setTimeout(r,1500));return {stdout:""};}});
 let beats=0;native.onProgress=()=>beats++;await native.tick();
 assert.ok(beats>=5,'beats while Hermes works: '+beats);assert.ok(options.timeout>=60*60000,'the tick has a time limit longer than any routine');
 // Work past its limit stops beating, so the supervisor still restarts a wedged server.
 let late=0;void health.beatWhile(new Promise(()=>{}),()=>late++,{limitMs:600,every:100});await new Promise(r=>setTimeout(r,1500));const atLimit=late;await new Promise(r=>setTimeout(r,800));
 assert.ok(atLimit>=3);assert.equal(late,atLimit,'no beat after the limit');
 assert.ok(health.STALL_AFTER>600000,'the stall threshold is above the longest single AI budget');
 // The notebook's own scheduler beats while a job works.
 store.save('jobs',{id:'slow',kind:'selftest',owner:'vps',paused:false,state:'pending',next_run:new Date(t0).toISOString(),interval_ms:86400000});
 const scheduler=new Scheduler(store,{device:'vps',beatEvery:100,executor:async()=>{await new Promise(r=>setTimeout(r,1500));return {verified:true,silent:true};}});
 let jobBeats=0;scheduler.onProgress=()=>jobBeats++;await scheduler.tick(t0);
 assert.ok(jobBeats>=7,'beats while a job works: '+jobBeats);
});
