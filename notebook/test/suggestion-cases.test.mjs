import test from 'node:test';
import assert from 'node:assert/strict';
import {readCases, runCase} from './suggestion-cases/harness.mjs';

// The shipped cases (suggestion-cases/cases.json) with the model answers recorded for them: what
// processing puts in the Review queue for notes whose right answer is known. The answers to the
// request processing made until 23 October 2026 are noisy on purpose (a known phone number again,
// the same things after every edit); the screen must cope with them. For the cases about meaning,
// the answers to today's request are used. scripts/suggestion-cases.mjs runs them with a live model.
const file = readCases();
for (const c of file.cases) {
  test('suggestion case: ' + c.says, async () => {
    const result = await runCase(c, {owner: file.owner});
    assert.deepEqual(result.failures, [], c.id + ' queued: ' + (result.queued.join(' | ') || 'nothing'));
  });
}
