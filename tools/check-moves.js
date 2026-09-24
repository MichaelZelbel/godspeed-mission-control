#!/usr/bin/env node
'use strict';
//
// check-moves.js - did today's decision make moves, or only paper? Type it as `mc-check-moves`.
//
// WHY THIS EXISTS (2026-09-24). The daily decision was rewritten around moves: concrete changes
// in the world, each prepared to the last click, three per active goal. Two test runs of the new
// recipe read that instruction and made two moves across three goals, reused the mission
// control's own old idea as "who did this", and finished in eight of the forty minutes it had.
// A sentence in a recipe is advice; the decision run follows advice when it is convenient. So
// the count and the fields are checked by a program, the way the work register checks that an
// item is done, and the run is told to keep going until this passes.
//
// WHAT IT CHECKS, in routines/next-action/<date>/moves.md against attention.txt beside it:
//   - every ACTIVE goal has at least --per-goal move blocks (default 3), or a line
//       FEWER <goal>: <why, in a sentence>
//     that says what stopped the rest (and that obstacle is tomorrow's first move).
//   - every move block (a heading "### <n>. ...") carries GOAL, WHERE, NOW, AFTER, WHO DID THIS,
//     HOW IT LANDS, UNDO and PERMISSION, none of them empty.
//   - WHO DID THIS names somebody outside: not "his own", "my own", "this mission control", a
//     work id or an idea file.
//   - AFTER is the thing itself, or names a file that exists and is not empty.
//   - a ship-list move the mission control applies names its work item on an APPLY line.
//
//   mc-check-moves --date 2026-09-24 [--per-goal 3] [--godspeed DIR]
//
// Exit 0 and it prints OK with the count per goal. Exit 1 and it prints one line per gap.

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf('--' + name); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; };
function findRoot(start) {
  let d = start;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(d, 'rules')) || fs.existsSync(path.join(d, 'goals'))) return d;
    const p = path.dirname(d); if (p === d) break; d = p;
  }
  return start;
}
const ROOT = opt('godspeed', process.env.GODSPEED_ROOT || findRoot(process.cwd()));
const DATE = opt('date', process.env.GODSPEED_TODAY || new Date().toISOString().slice(0, 10));
const PER = parseInt(opt('per-goal', '3'), 10) || 3;
const RUN = path.join(ROOT, 'routines', 'next-action', DATE);

const problems = [];
const read = (p) => { try { return fs.readFileSync(p, 'utf8').replace(/\r/g, ''); } catch (e) { return null; } };

const att = read(path.join(RUN, 'attention.txt'));
const active = [];
if (att) {
  let inActive = false;
  for (const line of att.split('\n')) {
    if (/^active:/.test(line)) { inActive = true; continue; }
    if (/^\S/.test(line)) { inActive = false; continue; }
    const m = line.match(/^  ([a-z0-9][a-z0-9-]*)\s+outcome\b/);
    if (inActive && m) active.push(m[1]);
  }
}

const text = read(path.join(RUN, 'moves.md'));
if (text === null) {
  console.log(`no moves.md in the run folder for ${DATE}: today's decision made no moves`);
  process.exit(1);
}

const FIELDS = ['GOAL', 'WHERE', 'NOW', 'AFTER', 'WHO DID THIS', 'HOW IT LANDS', 'UNDO', 'PERMISSION'];
const blocks = text.split(/^(?=###? \d+\.)/m).filter(b => /^###? \d+\./.test(b));
const counts = {};
for (const b of blocks) {
  const title = b.split('\n')[0].replace(/^#+\s*/, '').trim();
  const f = {};
  let cur = null;
  for (const line of b.split('\n').slice(1)) {
    const m = line.match(/^([A-Z][A-Z ]+):\s?(.*)$/);
    if (m && FIELDS.includes(m[1].trim())) { cur = m[1].trim(); f[cur] = m[2]; continue; }
    if (cur && /^\s+\S/.test(line)) f[cur] += ' ' + line.trim();
  }
  for (const k of FIELDS) if (!f[k] || !f[k].trim()) problems.push(`move "${title}": ${k} is missing or empty`);
  const goal = (f.GOAL || '').trim();
  if (goal) counts[goal] = (counts[goal] || 0) + 1;
  const who = f['WHO DID THIS'] || '';
  if (/\b(his own|my own|her own|their own|this mission control|mission control's own)\b|W-\d{8}-\d+|ideas\//i.test(who)) {
    problems.push(`move "${title}": WHO DID THIS must name somebody outside who did this, not the person's or the mission control's own work`);
  }
  // A move on the ship list that the mission control applies needs its work item named, or a
  // "ship 2" answer reaches nothing (ship-list-apply reads this line).
  const onList = /ship list/i.test(f.PERMISSION || '');
  const his = /^\s*only the person/i.test(f['HOW IT LANDS'] || '');
  if (onList && !his && !/^APPLY:\s*\S+/m.test(b)) problems.push(`move "${title}": on the ship list but no "APPLY: <work id>" line, so an answer by number cannot reach it`);
  const after = (f.AFTER || '').trim();
  const file = after.match(/([A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+\.(?:md|txt|html|json|csv))/);
  if (file && after.length < 200) {
    const p = path.join(ROOT, file[1]);
    if (!fs.existsSync(p) || fs.statSync(p).size < 50) problems.push(`move "${title}": AFTER points to ${file[1]}, which is not there or empty`);
  }
}

const fewer = {};
// Two reasons are refused, because the recipe answers both (2026-09-24, test run 4 used them for
// every goal): a thin ideas register (the next move comes from what people who got there did,
// read today) and a platform nobody is signed in to (the move is prepared anyway and its
// ship-list line asks for the one sign-in).
// Running out of time is refused too: the run has forty minutes and the moves are where they go
// (test run 6 said "not in the time this run had" at minute 13). A reason may run over several
// lines, and all of it is read, up to the next blank line, move or FEWER line.
const REFUSED = /\b(register|ideas?\b|signed[- ]in|sign-in|session|log(?:ged)?[- ]?in|no route|route .*not hold|in the time|time (?:this|the) run|run had|to (?:that|the same) standard)/i;
for (const m of text.matchAll(/^FEWER ([a-z0-9-]+):[ \t]*(\S[^\n]*(?:\n(?![ \t]*\n)(?!#+ \d+\.)(?!FEWER )[^\n]*)*)/gm)) {
  if (REFUSED.test(m[2])) problems.push(`FEWER ${m[1]}: a thin ideas register, a missing sign-in or running out of time is not a reason for fewer moves; read what people who reached this goal did at this stage, prepare moves for unsigned platforms anyway (the ship list asks for the sign-in), and use the time the run has`);
  else fewer[m[1]] = m[2];
}
for (const g of active) {
  const n = counts[g] || 0;
  if (n < PER && !fewer[g]) problems.push(`${g}: ${n} move(s), fewer than ${PER}, and no "FEWER ${g}: <why>" line`);
}

if (problems.length) {
  for (const p of problems) console.log(p);
  process.exit(1);
}
console.log('OK ' + (active.length ? active.map(g => `${g} ${counts[g] || 0}${fewer[g] ? ' (fewer: said why)' : ''}`).join(', ') : `${blocks.length} move(s)`));
