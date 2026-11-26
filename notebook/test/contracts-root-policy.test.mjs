import { test } from 'node:test';
import assert from 'node:assert/strict';
import { durableRoots, shared, inUpdateCopy } from '../core/file-policy.mjs';

// contracts/ holds the person's contract list (tools/contracts.js) as plain files. A root left out
// of durableRoots is neither synced nor in the copy made before an update.
const FILE = 'contracts/electricity.md';
const PREPARED = 'contracts/electricity/prepared/offer-service.md';

test('contracts is a durable root: synced and kept in the copy before an update', () => {
  assert.ok(durableRoots.includes('contracts'));
  for (const name of [FILE, PREPARED]) {
    assert.equal(shared(name), true, name);
    assert.equal(inUpdateCopy(name), true, name);
  }
});
