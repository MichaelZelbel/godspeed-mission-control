export const briefingReviewPolicy=Object.freeze({draftAttempts:2});
export const factualFallbackEligible=(attempt,reviews)=>attempt===briefingReviewPolicy.draftAttempts-1&&reviews.some(review=>review.passed!==true);
export const briefingFactualFallbackAcceptance='after both permitted draft attempts remain rejected, a checked factual fallback may deliver';
export const briefingAcceptanceCriterion='Collect/check sources; '+briefingFactualFallbackAcceptance+'; failed final safety gate prevents delivery; useful fresh health line';
export const briefingAcceptanceTargetTest='Inspect an accepted installed briefing with exact fresh measurement, supported action and changed source; '+briefingFactualFallbackAcceptance+', while a failed final safety gate prevents delivery; unchanged advice stays quiet.';
export function assertBriefingAcceptanceEvidence(evidence){if(evidence?.target_test!==briefingAcceptanceTargetTest)throw Error('Briefing acceptance evidence must equal the briefing review policy');}
