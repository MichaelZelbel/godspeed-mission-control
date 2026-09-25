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

// ---- 2026-09-24: repeats, the former name, and texts the judge could not find ----------------
const fs = require('fs');
const os = require('os');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brief-'));
const LINE = "My AI still asks twice before sending a text. Meta's new one already sold someone's car. ;-)";
fs.writeFileSync(path.join(dir, '2026-09-23.md'),
  'Anthropic put out Claude Opus 5.5.\nhttps://www.anthropic.com/claude-opus-5-5\n\n1. Post this:\n"' + LINE + '"\n');
fs.writeFileSync(path.join(dir, '2026-06-01.md'), 'Too old to count.\nhttps://example.com/june\n');

function expectFile(name, day, input, wantCode, wantInOutput) {
  const f = path.join(dir, day + '.md');
  fs.writeFileSync(f, input);
  let r;
  try { r = { code: 0, out: execFileSync('node', [script, f], { encoding: 'utf8' }) }; }
  catch (e) { r = { code: e.status, out: (e.stdout || '').toString() }; }
  fs.unlinkSync(f);
  const ok = r.code === wantCode && (!wantInOutput || r.out.includes(wantInOutput));
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name);
  if (!ok) { failures++; console.log('  got exit ' + r.code + ':\n' + r.out); }
}

expectFile('a link an earlier brief carried is refused', '2026-09-24',
  'Anthropic shipped Claude Opus 5.5 yesterday.\nhttps://www.anthropic.com/claude-opus-5-5\n', 1, 'brief of 2026-09-23');
expectFile('a line to post an earlier brief offered is refused, even reworded a little', '2026-09-24',
  '1. Pick one and post it:\n"My AI still asks twice before sending a text. Meta\'s new one already sold a car. ;-)"\n', 1,
  'already offered this line');
expectFile('a brief older than 45 days does not count', '2026-09-24',
  'Still worth it.\nhttps://example.com/june\n', 0);
expectFile('a brief is never compared with itself or a later one', '2026-09-22',
  'Anthropic news.\nhttps://www.anthropic.com/claude-opus-5-5\n', 0);
const H = 'h' + 'ub';  // the former name, in halves so no name check reads it here
expect('the former name for the product is refused',
  'Your ' + H + ' finished the backup overnight.\n', 1, 'former name');
expect('the word in its everyday sense passes',
  'The coworking ' + H + ' downtown opens a second floor. GitHub is down.\n', 0);
expect('a text to send without quotes is refused',
  '1. Send him the message below. Ready to send as is:\nHi Deshraj, I posted about memory today because you are right.\n', 1,
  'without quotes');
expect('a quoted text to send passes',
  '1. Send him this as is:\n"Hi Deshraj, I posted about memory today because you are right."\n', 0);
expect('a task with nothing to send passes',
  '1. Cancel the old mailboxes, then tell me it is done.\n', 0);
// 2026-09-25, the same rules as the author's server (scripts/briefing/note.py).
expect('a second story on the same subject in one brief is refused',
  'Friday.\n\nMeta\'s new assistant, Muse, copies OpenClaw\'s files.\nhttps://a.example/muse-copies\n\n' +
  'At its show, Meta said Muse will read your mail.\nhttps://b.example/muse-mail\n', 1, 'same subject');
expect('two different stories that share only a big company pass',
  'Friday.\n\nMeta cut its glasses price.\nhttps://a.example/glasses\n\nMeta\'s Muse got video calls.\nhttps://b.example/muse\n', 0);
fs.writeFileSync(path.join(dir, '2026-09-22.md'), 'Tuesday.\n\nMuse, Meta\'s assistant, launched.\nhttps://c.example/muse-launch\n');
fs.writeFileSync(path.join(dir, '2026-09-21.md'), 'Monday.\n\nMuse gets a Mac app.\nhttps://c.example/muse-mac\n');
expectFile('a subject in the news of two of the last four briefs rests', '2026-09-24',
  'Thursday.\n\nMuse now books tables for you.\nhttps://d.example/muse-tables\n', 1, 'Let it rest');
expect('an opening that previews the items is refused',
  'Tuesday, and a light one: a single small decision for you.\n\n1. Cancel the mailboxes, then tell me it is done.\n', 1, 'opening');
expect('a paragraph pointing at another by number is refused',
  'Friday.\n\nI built the sample. It is on the page in item 1.\n\n1. Reply "ship all".\nhttps://e.example/moves\n', 1, 'points at another');
fs.rmSync(dir, { recursive: true, force: true });

process.exit(failures ? 1 : 0);
