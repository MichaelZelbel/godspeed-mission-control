#!/usr/bin/env node
// Creates a local release history. It is deliberately a git fixture, never a Hermes installation.
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const at = process.argv.indexOf('--dir');
const dir = at === -1 ? '' : process.argv[at + 1];
if (!dir) throw new Error('usage: hermes-update-fixture.mjs --dir <folder>');
await mkdir(dir, { recursive: true });
const git = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });
git('init', '-q'); git('config', 'user.name', 'Scenario'); git('config', 'user.email', 'scenario@example.invalid');
for (const [version, healthy, published] of [
  ['1.0.0', true, '2026-10-20T00:00:00Z'],
  ['1.1.0', true, '2026-10-29T00:00:00Z'],
  ['1.2.0', false, '2026-10-30T00:00:00Z'],
  ['1.3.0', true, '2026-11-04T00:00:00Z'],
]) {
  await writeFile(join(dir, 'release.json'), JSON.stringify({ version, healthy, published }) + '\n');
  git('add', 'release.json');
  execFileSync('git', ['-C', dir, 'commit', '-q', '-m', version], { env: { ...process.env, GIT_AUTHOR_DATE: published, GIT_COMMITTER_DATE: published } });
  git('tag', `v${version}`);
}
process.stdout.write(`${dir}\n`);
