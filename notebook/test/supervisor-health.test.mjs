import test from 'node:test';
import assert from 'node:assert/strict';
import {HealthMonitor} from '../core/supervisor-health.mjs';

test('a delayed health reply does not interrupt work, and a later success clears the failure streak',()=>{
 const monitor=new HealthMonitor();
 assert.equal(monitor.failure('Health request timed out',1000).restart,false);
 assert.equal(monitor.failure('Health request timed out',31000).restart,false);
 monitor.success(61000);
 assert.equal(monitor.failure('A later timeout',91000).restart,false);
 assert.equal(monitor.failures,1);
 assert.equal(monitor.history.length,3);
 assert.equal(monitor.history[0].reason,'Health request timed out');
});
test('persistent failures trigger bounded recovery with their original evidence retained across launches',()=>{
 const monitor=new HealthMonitor();
 monitor.failure('Scheduler heartbeat stopped',1000);
 monitor.failure('Scheduler heartbeat stopped',31000);
 const decision=monitor.failure('Scheduler heartbeat stopped',61000);
 assert.equal(decision.restart,true);
 monitor.launched();
 assert.equal(monitor.failures,0);
 assert.equal(monitor.history.at(-1).reason,'Scheduler heartbeat stopped');
 monitor.success(91000);
 assert.equal(monitor.stablyHealthy(300000),false);
 assert.equal(monitor.stablyHealthy(391000),true);
 for(let i=0;i<50;i++)monitor.failure('Repeated unavailable service',i);
 assert.equal(monitor.history.length,20);
});

// 6 October 2026: a PC busy with seven test suites made /health slow; the notebook was killed three
// checks later, again after each restart, and after five the supervisor left it down.
test('a slow or still-starting notebook is given ten minutes; one that answered and stopped is not',async()=>{
 const {UNANSWERED_AFTER}=await import('../core/supervisor-health.mjs');
 const slow=new HealthMonitor();
 for(let at=0;at<UNANSWERED_AFTER;at+=30000)assert.equal(slow.failure('The operation was aborted due to timeout',at,'slow').restart,false);
 assert.equal(slow.failure('The operation was aborted due to timeout',UNANSWERED_AFTER,'slow').restart,true);
 const starting=new HealthMonitor();starting.launched();
 for(let at=0;at<5*30000;at+=30000)assert.equal(starting.failure('fetch failed',at,'refused').restart,false,'not listening yet is a notebook still starting');
 const stopped=new HealthMonitor();stopped.success(0);
 stopped.failure('fetch failed',30000,'refused');stopped.failure('fetch failed',60000,'refused');
 assert.equal(stopped.failure('fetch failed',90000,'refused').restart,true,'one that answered and stopped listening is restarted after three checks');
 const stuck=new HealthMonitor();stuck.success(0);stuck.failure('Scheduler heartbeat stopped',30000);stuck.failure('Scheduler heartbeat stopped',60000);
 assert.equal(stuck.failure('Scheduler heartbeat stopped',90000).restart,true);
});
test('the supervisor treats a timed-out check as slow, and keeps trying after five failed restarts',async t=>{
 const fs=await import('node:fs'),os=await import('node:os'),path=await import('node:path'),{EventEmitter}=await import('node:events');
 const {Supervisor,RETRY_AFTER_FAILURES}=await import('../core/supervisor.mjs');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-supervisor-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,'.godspeed'));
 const children=[],timers=[],exits=[];let killed=0;
 const supervisor=new Supervisor({root,server:'server.mjs',device:'desktop-1',spawnProcess:()=>{const child=new EventEmitter();children.push(child);return child;},setTimer:(fn,ms)=>timers.push({fn,ms}),terminate:async()=>{killed++;},missing:()=>[],
  fetchImpl:async()=>{throw Object.assign(new Error('The operation was aborted due to timeout'),{name:'TimeoutError'});},graceMs:0,exit:code=>exits.push(code)});
 supervisor.launch();
 for(let i=0;i<5;i++)await supervisor.check(Date.now()+i*30000);
 assert.equal(killed,0,'five slow checks in two and a half minutes stop nothing');
 for(let i=0;i<6;i++){children.at(-1).emit('exit',1,null);await new Promise(r=>setImmediate(r));timers.at(-1).fn();}
 children.at(-1).emit('exit',1,null);await new Promise(r=>setImmediate(r));
 assert.deepEqual(exits,[],'the supervisor does not give up');
 assert.equal(timers.at(-1).ms,RETRY_AFTER_FAILURES);
 assert.match(JSON.parse(fs.readFileSync(path.join(root,'.godspeed','supervisor.json'),'utf8')).reason,/trying again every ten minutes/);
});
