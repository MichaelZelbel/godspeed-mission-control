import test from 'node:test';
import assert from 'node:assert/strict';
import {BRIEFING_SOURCE_SELECTORS,briefRehearsals} from '../core/briefing.mjs';

// #974: a connected OpenRouter key makes the install file a spend-guard receipt, which stays when a
// low balance makes it noisy. The brief must not read it before the first goal.
test('the brief reads no spend-guard receipt as a source',()=>{
 const spendGuard={id:'spend-guard-1',job_id:'spend-guard',kind:'spend-guard',state:'verified',result:{silent:false,notices:['low-balance']}};
 const rehearsal={id:'r1',kind:'brief-rehearsal'};
 assert.deepEqual(BRIEFING_SOURCE_SELECTORS.job_receipts({rehearsals:briefRehearsals([spendGuard])}),[]);
 assert.deepEqual(briefRehearsals([spendGuard,rehearsal]),[rehearsal]);
});
