import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectVerdicts } from './scenario-verdict.mjs';

const catalog = [
  '# id\timplementation\tclass\tsystem\tcandidate-only\tdisplay name',
  'native\tnative.sh\tshared\tnative\tno\tNative',
  'docker\tdocker.sh\tshared\tdocker\tno\tDocker',
  'mac\tinline\tpooled\tmac\tyes\tMac',
  'windows-old-names-move\twindows.ps1\tisolated\twindows\tyes\tWindows',
].join('\n');

function records(files) {
  const dir = mkdtempSync(join(tmpdir(), 'scenario-verdict-'));
  for (const [name, line] of Object.entries(files)) writeFileSync(join(dir, name), line);
  return dir;
}

test('merges every selected PASS line in catalog order', () => {
  const out = collectVerdicts({ catalog, candidateOnly: 'mac windows-old-names-move', directories: [records({ 'docker.txt': 'PASS docker: healthy\n', 'native.txt': 'PASS native: healthy\n' })] });
  assert.deepEqual(out, { lines: ['PASS native: healthy', 'PASS docker: healthy'], failures: [] });
});

test('retains a scenario failure without hiding the other scenario result', () => {
  const out = collectVerdicts({ catalog, candidateOnly: 'mac windows-old-names-move', directories: [records({ 'native.txt': 'FAIL native: no health\n', 'docker.txt': 'PASS docker: healthy\n' })] });
  assert.deepEqual(out.lines, ['FAIL native: no health', 'PASS docker: healthy']);
  assert.deepEqual(out.failures, []);
});

test('the command fails when a complete scenario result is FAIL', () => {
  const dir = records({ 'native.txt': 'FAIL native: no health\n', 'docker.txt': 'PASS docker: healthy\n' });
  writeFileSync(join(dir, 'catalog.tsv'), catalog);
  const run = spawnSync(process.execPath, ['scenarios/scenario-verdict.mjs', '--catalog', join(dir, 'catalog.tsv'), '--results', dir, '--picked', ',native,'], { encoding: 'utf8' });
  assert.equal(run.status, 1);
  assert.match(run.stdout, /^FAIL native: no health$/m);
});

test('status reports a complete failure without preventing nightly reporting', () => {
  const dir = records({ 'native.txt': 'FAIL native: no health\n', 'docker.txt': 'PASS docker: healthy\n' });
  writeFileSync(join(dir, 'catalog.tsv'), catalog);
  const run = spawnSync(process.execPath, ['scenarios/scenario-verdict.mjs', '--catalog', join(dir, 'catalog.tsv'), '--results', dir, '--picked', ',native,', '--status'], { encoding: 'utf8' });
  assert.equal(run.status, 0);
  assert.equal(run.stdout.trim(), 'native=failure');
});

test('fails closed for missing, duplicate, and malformed records', () => {
  const first = records({ 'native.txt': 'PASS native: healthy\n', 'docker.txt': 'not a verdict\n' });
  const second = records({ 'native.txt': 'PASS native: copied\n' });
  const out = collectVerdicts({ catalog, candidateOnly: 'mac windows-old-names-move', directories: [first, second] });
  assert.match(out.lines[0], /^FAIL native: expected 1 result record/);
  assert.match(out.lines[1], /^FAIL docker: malformed result record/);
  assert.equal(out.failures.length, 2);
});

test('uses picked names and candidate-only exclusions', () => {
  const out = collectVerdicts({ catalog, picked: ',docker,mac,', candidateOnly: 'mac', directories: [records({ 'docker.txt': 'PASS docker: healthy\n' })] });
  assert.deepEqual(out, { lines: ['PASS docker: healthy'], failures: [] });
});

test('accepts a standalone scenario result retained beside its evidence', () => {
  const out = collectVerdicts({ catalog, picked: ',native,', directories: [records({ 'result.txt': 'PASS native: healthy\n' })] });
  assert.deepEqual(out, { lines: ['PASS native: healthy'], failures: [] });
});

test('requires both Windows move modes and produces one scenario verdict', () => {
  const out = collectVerdicts({ catalog, picked: ',windows-old-names-move,', directories: [records({
    'windows-old-names-move-moves.txt': 'PASS windows-old-names-move: open handles moved\n',
    'windows-old-names-move-held.txt': 'PASS windows-old-names-move: held handles moved\n',
  })] });
  assert.deepEqual(out, { lines: ['PASS windows-old-names-move: held handles moved'], failures: [] });
});
