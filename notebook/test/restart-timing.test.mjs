import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyRestartTiming} from '../../docker/full-candidate/verify-restart-timing.mjs';

const browser=[
 {at:'2026-11-17T10:01:01.000Z',event:'browser-document-request',path:'/dashboard/settings/import'},
 {at:'2026-11-17T10:01:02.000Z',event:'browser-first-query-request'},
 {at:'2026-11-17T10:01:03.000Z',event:'browser-first-query-response',status:200},
].map(record=>JSON.stringify(record)).join('\n');
const traces=at=>['main-door-listening','index-published','first-authenticated-query'].map(event=>`${at} startup ${event}`).join('\n');

test('restart evidence rejects server traces retained from the prior lifecycle',()=>{
 const required=['main-door-listening','index-published','first-authenticated-query'];
 for(const stale of required){
  const server=required.map(event=>`${event===stale?'2026-11-17T09:59:00.000Z':'2026-11-17T10:00:01.000Z'} startup ${event}`).join('\n');
  assert.throws(()=>verifyRestartTiming(server,browser,'2026-11-17T10:00:00.000000000Z'),new RegExp(`missing post-restart ${stale}`));
 }
});

test('restart evidence accepts every required server trace from the restarted lifecycle',()=>{
 assert.doesNotThrow(()=>verifyRestartTiming(
  traces('2026-11-17T09:59:00.000Z')+'\n'+traces('2026-11-17T10:00:01.000Z'),
  browser,
  '2026-11-17T10:00:00.000Z',
 ));
});
