import {test} from 'node:test';
import assert from 'node:assert/strict';
import {jobExecutor} from '../core/runtime.mjs';
import {kinds} from '../core/jobs/scheduler.mjs';
import {aiProcedureKinds} from '../core/jobs/kinds.mjs';
import {NO_AI_CONNECT} from '../core/no-ai.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// #1093: every routine that needs an AI fails with the one shared sentence, where routines are run,
// when no AI is connected, and starts no AI request. A routine added to `kinds` must be listed in
// aiProcedureKinds (core/jobs/kinds.mjs) or here, so a new one cannot skip the check unnoticed.
const noAI=['habit-check','coaching','deadline-reminder','profiling','morning-brief','audit','watch','coach-cycle','coach-tick','journal-tick','health-summary','portfolio','connection-check','selftest','job-check','disk-check','brief-review','brief-rehearsal','conversation-review','attention-review','lead','radar','radar-prepare','radar-work','domain-watch','spend-guard','board-export','browser-post','subscription-review'];
test('every routine kind is classified',()=>{
 for(const kind of kinds)assert.ok(aiProcedureKinds.includes(kind)!==noAI.includes(kind),kind+' must be in exactly one list');
});
test('every routine that needs an AI refuses with the shared sentence on a notebook with no assistant',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-noai-'));
 try{
  const store={root};
  const execute=jobExecutor(null,{rows:()=>{throw new Error('no work may start');}});
  for(const kind of aiProcedureKinds)
   await assert.rejects(execute({id:kind,kind},{store,settings:{}}),{message:NO_AI_CONNECT},kind);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
