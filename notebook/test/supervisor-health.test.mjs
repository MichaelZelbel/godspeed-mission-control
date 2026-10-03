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
