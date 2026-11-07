import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {assertBriefingAcceptanceEvidence,briefingAcceptanceTargetTest,briefingReviewPolicy,factualFallbackEligible} from '../core/briefing-review-policy.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
test('briefing review policy owns the factual fallback lifecycle and acceptance declaration',()=>{
 const evidence=JSON.parse(fs.readFileSync(path.join(root,'docs/full-version/acceptance-evidence.json'),'utf8'))['behavior:briefing'];
 assert.equal(briefingReviewPolicy.draftAttempts,2);
 assert.equal(factualFallbackEligible(0,[{passed:false}]),false);
 assert.equal(factualFallbackEligible(1,[{passed:true},{passed:true}]),false);
 assert.equal(factualFallbackEligible(1,[{passed:true},{passed:false}]),true);
 assert.equal(evidence.target_test,briefingAcceptanceTargetTest);
 assert.doesNotThrow(()=>assertBriefingAcceptanceEvidence(evidence));
 assert.throws(()=>assertBriefingAcceptanceEvidence({...evidence,target_test:'Factual fallback may deliver after one rejected draft.'}),/must equal the briefing review policy/);
});
