#!/usr/bin/env node
// The gate for the one reading of a research brief's limit (goals.js limitOf, 2026-10-13): every
// case in limit-cases.json is read the same by limitOf, by check-research (a current brief must
// name a limit) and by check-moves (once a limit is named, every move aims at it). Mission
// Control's trial check copies the rule and runs the same cases. Runs in a throwaway root.
// Run: node tools/test-limit.js
'use strict';
require('./test-guard.cjs'); // never a real mission control (test-guard.bash says why)
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const { limitOf } = require('./goals.js');
const { cases } = JSON.parse(fs.readFileSync(path.join(__dirname, 'limit-cases.json'), 'utf8'));

let pass = 0, fail = 0;
const check = (name, got, want) => {
  if (got === want) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log(`  FAIL ${name} (wanted [${want}], got [${got}])`); }
};
const run = (script, args) => {
  try { return { code: 0, out: execFileSync(process.execPath, [path.join(__dirname, script), ...args], { encoding: 'utf8' }) }; }
  catch (e) { return { code: e.status, out: String(e.stdout || '') + String(e.stderr || '') }; }
};

const D = '2026-10-13';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'godspeed-limit-'));
process.on('exit', () => { try { fs.rmSync(root, { recursive: true, force: true }); } catch {} });
const research = path.join(root, 'goals', 'research', 'g'), runDir = path.join(root, 'routines', 'next-action', D);
fs.mkdirSync(research, { recursive: true });
fs.mkdirSync(runDir, { recursive: true });
fs.writeFileSync(path.join(root, 'goals', 'g.md'), 'ID: g\nKIND: outcome\nSTATUS: adopted\nTITLE: G\n\n## Log\n');
fs.writeFileSync(path.join(runDir, 'attention.txt'), `Attention for ${D}\nactive:\n  g                                  outcome     nothing pressing\n`);
const move = (n, aims) => `### ${n}. Change the first line of the page\nGOAL: g\n${aims ? `AIMS AT: ${aims}: the first line says it\n` : ''}WHERE: https://example.org/p\n`
  + 'NOW: "old"\nAFTER: new\nWHO DID THIS: Simon Willison, his README, read today\nHOW IT LANDS: API, CHECK curl the page\nUNDO: put the old line back\nPERMISSION: ship list\nAPPLY: W-1\n\n';

console.log('limit gate');
for (const c of cases) {
  check(`limitOf: ${c.name}`, limitOf(c.brief), c.limit);
  // check-research: a brief that says STATUS: current must name a limit.
  fs.writeFileSync(path.join(research, 'brief.md'), c.brief.replace(/^STATUS: \w+/m, 'STATUS: current'));
  const r = run('check-research.js', ['--goal', 'g', '--date', D, '--godspeed', root]);
  check(`  check-research agrees`, /has no LIMIT: line/.test(r.out) ? null : 'named', c.limit === null ? null : 'named');
  // check-moves: a move with no AIMS AT passes only while no limit is named.
  fs.writeFileSync(path.join(research, 'brief.md'), c.brief);
  fs.writeFileSync(path.join(runDir, 'moves.md'), move(1) + move(2) + move(3));
  const m = run('check-moves.js', ['--godspeed', root, '--date', D]);
  check(`  check-moves agrees`, /AIMS AT must name this goal's limit/.test(m.out) ? 'named' : null, c.limit === null ? null : 'named');
  if (c.limit !== null) {
    fs.writeFileSync(path.join(runDir, 'moves.md'), move(1, c.limit) + move(2, c.limit) + move(3, c.limit));
    const a = run('check-moves.js', ['--godspeed', root, '--date', D]);
    check(`  check-moves passes moves that aim at "${c.limit}"`, a.code === 0 ? 'OK' : a.out.trim(), 'OK');
  }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
