import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { servePath } from '../reusable-recipes/web-design/scripts/serve-path.mjs';

test('web preview confines assets to the chosen directory and rejects malformed URLs', t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'web-preview-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, 'site with spaces');
  fs.mkdirSync(root);
  fs.mkdirSync(root + '-private');
  fs.writeFileSync(path.join(root, 'index.html'), '<p>Fictional page</p>');
  fs.writeFileSync(path.join(root + '-private', 'secret.txt'), 'Fictional private fixture');
  assert.equal(servePath(root, '/').status, 200);
  assert.equal(servePath(root, '/fictional-route').status, 200);
  assert.equal(servePath(root, '/%2e%2e%2fsite%20with%20spaces-private/secret.txt').status, 403);
  assert.equal(servePath(root, '/%zz').status, 400);
  assert.equal(servePath(root, '/missing.png').status, 404);
});
