export const procedureKinds=['coach-cycle','coach-tick','journal-tick','health-summary','portfolio','connection-check','selftest','job-check','disk-check','brief-review','brief-rehearsal','conversation-review','attention-review','lead','radar','radar-prepare','radar-work','memory-capture','domain-watch','spend-guard','board-export','browser-post','subscription-review'];
// The routines that cannot do anything without an AI. Where a routine is run (jobExecutor in
// core/runtime.mjs) these fail with the shared NO_AI_CONNECT sentence before any work, child process or
// AI request starts (#1093). A routine added to the catalogue is listed here, or in the no-AI list of
// test/no-ai-routines.test.mjs, or that test fails.
export const aiProcedureKinds=['review','memory-review','memory-capture','memory-daily'];
