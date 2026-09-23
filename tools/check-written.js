#!/usr/bin/env node
'use strict';
//
// check-written.js - is the thing your assistant says it wrote actually there, and is it the
// thing you asked for? Type it as `mc-check-written`.
//
// WHY THIS EXISTS. The work register (`mc-work`) closes an item only when a check that is NOT
// the runner says so. That is easy for a job whose result is a file that appears or a test that
// passes. It is hard for the other half of what an assistant does, which is find something out:
// "we looked into X and the answer is Y" arrives as a sentence in a report, and a sentence in a
// report is the runner's own word about its own work, the one source you cannot use. So a learn
// item is filed with a path, the answer has to be WRITTEN there, and this program is the check
// that is not the runner. It opens the file and asks the questions a reader would ask before
// believing it: is it there, is it long enough to hold an answer, does it have the sections that
// were asked for, is any template placeholder still sitting in it, and does it read like a
// person wrote it rather than a machine (no em dash, none of the words in
// `rules/machine-words.txt`, no long id, no server path). Exit 0 and the item can close; exit 1
// and it stays attempted, whatever the runner said.
//
// A trailing `## Sources` section is not counted and not checked for machine words, because a
// list of links and ids is exactly what belongs there, and a source that names a file or an id
// is provenance, not a sentence you were meant to read.
//
//   mc-check-written research/x.md --min-words 200 --sections "## Answer,## Evidence"
//
//   --min-words N     the answer has at least N words outside Sources (default 0)
//   --max-words N     and at most N, when you want it short
//   --sections "..."  comma-separated headings that must each start a line
//   --godspeed DIR         Mission Control whose rules/machine-words.txt applies (default: the one you are in)
//
// Prints one `PROBLEM: ...` line per fault and exits 1, or `ok: <path>, <N> words` and exits 0.
// It is meant as the CHECK of a work item: mc-work file --learn "..." --path research/x.md
// --check "mc-check-written research/x.md --min-words 200".

const fs = require('fs');
const path = require('path');
const L = require(path.join(__dirname, 'mc-cards.js'));

const { say } = L;
const USAGE = `mc-check-written: a written answer is verified by opening it, not by the runner's word

  mc-check-written <path> [--min-words N] [--max-words N] [--sections "## A,## B,..."] [--godspeed DIR]

  exit 0 and "ok: <path>, <N> words" when the file exists, is long enough, has every section named,
  carries no leftover (placeholder) line, no em or en dash, and none of the words in
  rules/machine-words.txt outside https links; else one "PROBLEM: ..." line per fault and exit 1.
  A trailing "## Sources" section is neither counted nor checked for machine words.`;

const a = L.parseArgs(process.argv.slice(2));
if (a.help === 'true' || a.h === 'true') { say(USAGE); process.exit(0); }
const target = a._[0];
if (!target) { say(USAGE); process.exit(1); }

const godspeed = a.godspeed || L.godspeedRoot(__filename);
const file = path.isAbsolute(target) ? target : path.join(godspeed, target);
const problems = [];
const problem = (m) => problems.push('PROBLEM: ' + m);
const num = (k) => (a[k] === undefined ? null : parseInt(a[k], 10));
const minWords = num('min-words') || 0;
const maxWords = num('max-words');
if (a['min-words'] !== undefined && Number.isNaN(minWords)) problem('--min-words needs a number');
if (a['max-words'] !== undefined && Number.isNaN(maxWords)) problem('--max-words needs a number');

let text = '';
try { text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'); } catch (e) { text = ''; }
if (!fs.existsSync(file)) problem(`${target} does not exist (looked at ${file})`);
else if (!text.trim()) problem(`${target} is empty`);

let words = 0;
if (text.trim()) {
  const lines = text.split('\n');
  // Everything from a `## Sources` heading to the end is provenance, not the answer.
  const srcAt = lines.findIndex(l => /^##\s+sources\s*$/i.test(l.trim()));
  const bodyLines = srcAt >= 0 ? lines.slice(0, srcAt) : lines;
  const body = bodyLines.join('\n');
  words = body.split(/\s+/).filter(Boolean).length;
  if (words < minWords) problem(`${words} words outside Sources, fewer than the ${minWords} asked for`);
  if (maxWords !== null && !Number.isNaN(maxWords) && words > maxWords) problem(`${words} words outside Sources, more than the ${maxWords} allowed`);

  for (const want of String(a.sections || '').split(',').map(s => s.trim()).filter(Boolean)) {
    if (!lines.some(l => l.trim().startsWith(want))) problem(`section "${want}" is missing`);
  }

  // A line under a `## ` heading that is still "(what goes here)" is a template nobody filled.
  let under = false;
  lines.forEach((l, i) => {
    if (/^##\s/.test(l)) { under = true; return; }
    const t = l.trim();
    if (under && t.startsWith('(') && t.endsWith(')')) problem(`line ${i + 1} is still a placeholder: ${t.slice(0, 60)}`);
  });

  lines.forEach((l, i) => {
    if (/—/.test(l)) problem(`line ${i + 1} has an em dash`);
    if (/–/.test(l)) problem(`line ${i + 1} has an en dash`);
  });

  // Machine words are checked in the body only, and never inside a link.
  const unlinked = (l) => l.replace(/https?:\/\/\S+/g, ' ');
  for (const [re, label] of L.machineWords(godspeed)) {
    for (let i = 0; i < bodyLines.length; i++) {
      const m = unlinked(bodyLines[i]).match(re);
      if (m) { problem(`line ${i + 1} has "${m[0]}" (${label})`); break; }
    }
  }
}

if (problems.length) { for (const p of problems) say(p); process.exit(1); }
say(`ok: ${target}, ${words} words`);
