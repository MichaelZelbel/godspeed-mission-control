#!/usr/bin/env node
// Smoke test for tools/check-brief.js: clean briefs pass, paths and
// link-less read instructions are refused, Sources lines are exempt.
// No dependencies. Run: node tools/test-check-brief.js
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');

const script = path.join(__dirname, 'check-brief.js');
let failures = 0;

function run(input) {
  try {
    const out = execFileSync('node', [script, '-'], { input, encoding: 'utf8' });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: (e.stdout || '').toString() };
  }
}

function expect(name, input, wantCode, wantInOutput) {
  const r = run(input);
  const ok = r.code === wantCode &&
    (!wantInOutput || r.out.includes(wantInOutput));
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name);
  if (!ok) {
    failures++;
    console.log('  wanted exit ' + wantCode + (wantInOutput ? ' and "' + wantInOutput + '"' : '') +
      ', got exit ' + r.code + ' and:\n' + r.out.split('\n').map(l => '    ' + l).join('\n'));
  }
}

expect('a brief with full text and a link passes',
  'To act: pick one line below and post it.\n' +
  'Here in Europe, we are still proudly writing the AI rulebook. ;-)\n' +
  'https://www.linkedin.com/example\n', 0);

expect('a repo path in the steps is refused',
  'To act: open lead/drafts/2026-09-05-lines.md and paste the first line.\n', 1, 'lead/drafts');

expect('an absolute server path is refused',
  'The brief lives at /home/hermes/.hermes/profiles/godspeed/workspace/brief/today.md now.\n', 1, '/home/');

expect('a Windows path is refused',
  'Open C:/godspeed/lead/queue.md for the list.\n', 1, 'C:/godspeed');

expect('a Sources line may name its file',
  'The counts: 3 posts, 12 replies.\n' +
  'Sources: lead/queue.md (M016, filed 2026-09-06)\n', 0);

expect('a link is never mistaken for a path',
  'Read the thread: https://example.com/some/deep/page.html it is short.\n', 0);

expect('"read it" with nothing to read is refused',
  'This piece matters for your positioning. Read it before Friday.\n', 1, 'Read it');

expect('"open the draft" is fine when a link rides along',
  'Open the draft: https://example.com/draft and change the last line.\n', 0);

process.exit(failures ? 1 : 0);
