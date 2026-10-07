import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {NativeScheduler} from '../core/native-scheduler.mjs';
const root=()=>fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-idle-heartbeat-'));

// The supervisor kills the notebook when the scheduler heartbeat is older than
// three minutes, and killing it five times takes the Telegram gateway down with
// it, mid-conversation. The heartbeat only ever moved when the AI provider was
// called, so a server with nothing due was killed for being idle.
test('a tick reports a heartbeat even when there is nothing due',async()=>{
  const store=new Store(root());let ran=0;
  const scheduler=new NativeScheduler(store,{executable:'hermes-test',home:store.root,run:async()=>{ran++;return {stdout:''};}});
  let beats=0;scheduler.onProgress=()=>{beats++;};
  await scheduler.tick();
  assert.equal(ran,1,'the tick should have reached the scheduler');
  assert.ok(beats>0,'an idle tick must still report that the scheduler is alive');
});

test('the throttled tick in between still reports the scheduler is alive',async()=>{
  const store=new Store(root());
  const scheduler=new NativeScheduler(store,{executable:'hermes-test',home:store.root,run:async()=>({stdout:''})});
  await scheduler.tick();
  let beats=0;scheduler.onProgress=()=>{beats++;};
  // The server ticks every 30 seconds; the scheduler itself only works once a
  // minute, so every second call returns early and must not look like a stall.
  assert.deepEqual(await scheduler.tick(),[]);
  assert.ok(beats>0,'a deliberately skipped tick is a live scheduler, not a stopped one');
});

test('a tick that never returns is still reported as a stall',async()=>{
  const store=new Store(root());
  const scheduler=new NativeScheduler(store,{executable:'hermes-test',home:store.root,run:()=>new Promise(()=>{})});
  void scheduler.tick();
  await new Promise(resolve=>setImmediate(resolve));
  let beats=0;scheduler.onProgress=()=>{beats++;};
  await scheduler.tick();
  assert.equal(beats,0,'a wedged scheduler must not be covered up by a heartbeat');
});
