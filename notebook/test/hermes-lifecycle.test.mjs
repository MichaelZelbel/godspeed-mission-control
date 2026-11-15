import test from 'node:test';import assert from 'node:assert/strict';
import {HermesLifecycle} from '../core/hermes-lifecycle.mjs';

test('only an assistant update runs alone; chats run beside anything else, and a tick and a run exclude each other',()=>{
 const lifecycle=new HermesLifecycle();
 const chat=lifecycle.acquire('chat reply'),secondChat=lifecycle.acquire('chat reply');
 assert.ok(chat&&secondChat);assert.equal(lifecycle.reason,'chat reply');
 assert.equal(lifecycle.acquire('assistant update'),null);
 const tick=lifecycle.acquire('routine tick');assert.ok(tick);assert.equal(lifecycle.reason,'routine tick');
 assert.equal(lifecycle.acquire('routine run'),null);assert.equal(lifecycle.acquire('routine tick'),null);
 assert.ok(lifecycle.acquire('chat reply'));
 assert.equal(lifecycle.acquire('assistant update'),null);
 chat();chat();assert.equal(lifecycle.busy,true);
 tick();assert.equal(lifecycle.reason,'chat reply');
 const run=lifecycle.acquire('routine run');assert.ok(run);assert.equal(lifecycle.acquire('routine tick'),null);assert.equal(lifecycle.reason,'routine run');run();
 const fresh=new HermesLifecycle(),update=fresh.acquire('assistant update');
 assert.ok(update);assert.equal(fresh.busy,true);
 for(const kind of ['chat reply','routine tick','routine run','assistant update'])assert.equal(fresh.acquire(kind),null,kind);
 assert.equal(fresh.reason,'assistant update');
 update();assert.equal(fresh.busy,false);assert.equal(fresh.reason,null);
});

test('an automatic Godspeed update waits for every chat and routine, and while it runs nothing else starts',()=>{
 const lifecycle=new HermesLifecycle();
 for(const kind of ['chat reply','routine tick','routine run','assistant update']){
  const held=lifecycle.acquire(kind);assert.equal(lifecycle.acquire('godspeed update'),null,kind);held();
 }
 const update=lifecycle.acquire('godspeed update');assert.ok(update);
 for(const kind of ['chat reply','routine tick','routine run','assistant update','godspeed update'])assert.equal(lifecycle.acquire(kind),null,kind);
 assert.equal(lifecycle.reason,'godspeed update');
 update();assert.equal(lifecycle.busy,false);
});
