#!/usr/bin/env node
// Smoke test for tools/check-built-on.js: a throwaway godspeed root, files written
// by hand, PASS/FAIL per check, non-zero exit on any FAIL. No dependencies.
// The same test runs against the mission control's own copy in scripts/; the two programs
// differ only in their front door.
//
// Run: node tools/test-check-built-on.js
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const script = path.join(__dirname, 'check-built-on.js');
let failures = 0;
const roots = [];

function freshGodspeed() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'built-on-test-'));
  fs.mkdirSync(path.join(root, 'world', 'claims'), { recursive: true });
  roots.push(root);
  return root;
}

function write(root, rel, text) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function claim(root, name, body) {
  write(root, path.join('world', 'claims', name + '.md'), '---\n' + body + '\n---\n');
}

function run(root, extra = []) {
  const args = [script, '--dir', root].concat(extra);
  try {
    return { out: execFileSync(process.execPath, args, { encoding: 'utf8' }), code: 0 };
  } catch (e) {
    return { out: (e.stdout || '') + (e.stderr || ''), code: e.status };
  }
}

function check(name, cond, detail) {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name);
  if (!cond) {
    failures++;
    if (detail) console.log('        ' + String(detail).replace(/\n/g, '\n        '));
  }
}

const CLOSED_TITLE = 'subject: teach-it-once\nattribute: title\nvalue: An AI of Your Own\nvalid_to: 2026-07-27';

// --- the case that was real: a closed value still live in profile/ --------
let root = freshGodspeed();
claim(root, 'teach-it-once--title--undated', CLOSED_TITLE);
write(root, 'profile/content-lanes.md', '# Lanes\n\nThe company produces the book **An AI of Your Own** and the shorts around it.\n');
let r = run(root);
check('a closed value still in profile/ is a finding', r.code === 1, r.out);
check('the report names the file and the line', r.out.includes('profile/content-lanes.md:3'), r.out);
check('the report names the fact', r.out.includes('teach-it-once / title'), r.out);

// --- an open claim is not a finding, however often its value appears ------
root = freshGodspeed();
claim(root, 'teach-it-once--title--2026-07-27', 'subject: teach-it-once\nattribute: title\nvalue: Teach It Once\nvalid_from: 2026-07-27');
write(root, 'profile/about.md', 'The book is Teach It Once. Teach It Once again.\n');
r = run(root);
check('an open claim is never reported', r.code === 0, r.out);

// --- history is allowed when the line carries the closing date ------------
root = freshGodspeed();
claim(root, 'teach-it-once--title--undated', CLOSED_TITLE);
write(root, 'profile/content-lanes.md', 'The book **Teach It Once** (called *An AI of Your Own* until 2026-07-27).\n');
r = run(root);
check('a line carrying the closing date is history, not a finding', r.code === 0, r.out);

// --- matching is whole-word and case-insensitive --------------------------
root = freshGodspeed();
claim(root, 'michael--manager--2026-08-20', 'subject: michael\nattribute: manager\nvalue: Phil Benton\nvalid_from: 2026-08-20\nvalid_to: 2026-08-31');
write(root, 'profile/work.md', 'Reports to PHIL BENTON on Mondays.\n');
write(root, 'rules/one.md', '---\nname: one\n---\nPhil Bentonville is a town.\n');
r = run(root, ['--json']);
let parsed = null;
try { parsed = JSON.parse(r.out); } catch { /* reported below */ }
check('--json emits parseable json', parsed !== null, r.out);
check('a case-different mention is found', parsed && parsed.findings.some((f) => f.file === 'profile/work.md'), r.out);
check('a longer word containing the value is not a match',
  parsed && !parsed.findings.some((f) => f.file === 'rules/one.md'), r.out);

// --- short values are not string-searched, and the report says so ---------
root = freshGodspeed();
claim(root, 'michael--location--2026-08-26', 'subject: michael\nattribute: location\nvalue: UK\nvalid_from: 2026-08-26\nvalid_to: 2026-08-31');
write(root, 'profile/about.md', 'Lives in the UK.\n');
r = run(root, ['--json']);
parsed = null;
try { parsed = JSON.parse(r.out); } catch { /* reported below */ }
check('a value under four characters is not string-searched', parsed && parsed.findings.length === 0, r.out);
check('the count of short values is reported', parsed && parsed.short_values_skipped === 1, r.out);

// --- rests_on catches a paraphrase the string search cannot ---------------
root = freshGodspeed();
claim(root, 'michael--manager--2026-08-20', 'subject: michael\nattribute: manager\nvalue: Phil Benton\nvalid_from: 2026-08-20\nvalid_to: 2026-08-31');
write(root, 'rules/friday-mail.md', '---\nname: friday-mail\nrests_on: [michael/manager]\n---\nNever mail the boss on a Friday.\n');
r = run(root);
check('a rule that rests on the closed claim is a finding', r.code === 1 && r.out.includes('rules/friday-mail.md'), r.out);
check('the finding says it came through rests_on', r.out.includes('rests_on'), r.out);

// --- a decision block can rest on a claim too -----------------------------
root = freshGodspeed();
claim(root, 'teach-it-once--title--undated', CLOSED_TITLE);
write(root, 'decisions.md',
  '# Decisions\n\n## D-049, 2026-07-20 - Something else\n\n**Rests on:** michael/manager\n\n' +
  '## D-051, 2026-07-28 - Print run\n\n**Rests on:** teach-it-once/title, michael/location\n\nOrder 500 copies.\n');
r = run(root);
check('a decision resting on the closed claim is a finding', r.code === 1 && r.out.includes('decisions.md#D-051'), r.out);
check('a decision resting on another claim is not', !r.out.includes('D-049'), r.out);

// --- dependencies chain, and a cycle does not hang -------------------------
root = freshGodspeed();
claim(root, 'teach-it-once--title--undated', CLOSED_TITLE);
write(root, 'decisions.md', '## D-051, 2026-07-28 - Print run\n\n**Rests on:** teach-it-once/title\n');
write(root, 'rules/cover.md', '---\nname: cover\nrests_on: [decisions.md#D-051]\n---\nThe cover says the title.\n');
write(root, 'rules/a.md', '---\nname: a\nrests_on: [rules/b.md]\n---\n');
write(root, 'rules/b.md', '---\nname: b\nrests_on: [rules/a.md]\n---\n');
r = run(root, ['--json']);
parsed = null;
try { parsed = JSON.parse(r.out); } catch { /* reported below */ }
check('a record resting on a record that rests on the claim is found',
  parsed && parsed.findings.some((f) => f.file === 'rules/cover.md' && f.via === 'rests_on'), r.out);
check('the chained finding says what it came through',
  parsed && parsed.findings.some((f) => f.file === 'rules/cover.md' && f.through === 'decisions.md#D-051'), r.out);
check('a cycle between two records is harmless', parsed !== null, r.out);

// --- one claim only ---------------------------------------------------------
root = freshGodspeed();
claim(root, 'teach-it-once--title--undated', CLOSED_TITLE);
claim(root, 'michael--manager--2026-08-20', 'subject: michael\nattribute: manager\nvalue: Phil Benton\nvalid_from: 2026-08-20\nvalid_to: 2026-08-31');
write(root, 'profile/a.md', 'An AI of Your Own, by Phil Benton.\n');
r = run(root, ['--claim', 'michael/manager', '--json']);
parsed = null;
try { parsed = JSON.parse(r.out); } catch { /* reported below */ }
check('--claim limits the scan to one fact',
  parsed && parsed.findings.length === 1 && parsed.findings[0].attribute === 'manager', r.out);

// --- folders that are history are never scanned ----------------------------
root = freshGodspeed();
claim(root, 'teach-it-once--title--undated', CLOSED_TITLE);
write(root, 'observations/old.md', 'An AI of Your Own was the working title.\n');
write(root, 'archives/old.md', 'An AI of Your Own.\n');
write(root, 'lead/drafts/x.md', 'An AI of Your Own.\n');
write(root, 'lead/positions/y.md', 'An AI of Your Own.\n');
r = run(root, ['--json']);
parsed = null;
try { parsed = JSON.parse(r.out); } catch { /* reported below */ }
check('observations, archives and drafts are history and not scanned',
  parsed && parsed.findings.every((f) => f.file === 'lead/positions/y.md'), r.out);
check('lead positions are scanned', parsed && parsed.findings.length === 1, r.out);

// --- an empty godspeed is clean, and says why ------------------------------------
root = freshGodspeed();
r = run(root);
check('no closed claims exits clean', r.code === 0 && /no closed/i.test(r.out), r.out);

for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
