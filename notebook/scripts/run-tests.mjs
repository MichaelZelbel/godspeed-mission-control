#!/usr/bin/env node
// Runs the notebook's tests (node --test) with a temporary folder of their own.
//
// The tests make their workspaces with fs.mkdtemp in os.tmpdir(), and many never
// remove them: by 16 October 2026, 81,347 godspeed-* folders (about 21 GB) had
// built up since 2 October on the developer's PC and filled its C: drive. Instead of
// cleaning up after each of the 250 test files, every run gets one fresh folder,
// handed to the tests and everything they start as TMPDIR, TEMP and TMP (what
// os.tmpdir() reads, in Node and in Python), and the folder is removed when the
// run ends, also after a failure or Ctrl+C. A run killed outright cannot clean
// up; the next run removes its folder.
//
//   node scripts/run-tests.mjs [node --test options] [files or patterns]
//   GODSPEED_KEEP_TEST_TMP=1 keeps the folder for a look afterwards.
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const RUN_PREFIX = 'godspeed-test-run-';
export const MARKER = '.godspeed-test-run.json';

const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };

// Everything but the marker first, so a folder that could not be emptied (a file
// a stray process still holds open on Windows) is still recognised next time.
export function removeRun(dir) {
  let left = 0;
  let names = [];
  try { names = fs.readdirSync(dir); } catch (error) { return error.code === 'ENOENT'; }
  for (const name of names) {
    if (name === MARKER) continue;
    try { fs.rmSync(path.join(dir, name), {recursive: true, force: true, maxRetries: 5, retryDelay: 200}); } catch { left++; }
  }
  if (left) return false;
  try { fs.rmSync(dir, {recursive: true, force: true, maxRetries: 5, retryDelay: 200}); return true; } catch { return false; }
}

// The folders of earlier runs whose runner is gone and that nobody asked to keep.
export function sweepRuns(outer) {
  let names = [];
  try { names = fs.readdirSync(outer).filter(name => name.startsWith(RUN_PREFIX)); } catch { return 0; }
  let removed = 0;
  for (const name of names) {
    const dir = path.join(outer, name);
    let run;
    try { run = JSON.parse(fs.readFileSync(path.join(dir, MARKER), 'utf8')); } catch { continue; }
    if (run.keep || alive(run.pid)) continue;
    if (removeRun(dir)) removed++;
  }
  return removed;
}

export function main(argv = process.argv.slice(2)) {
  const outer = os.tmpdir(), keep = /^(1|true|yes|on)$/i.test(process.env.GODSPEED_KEEP_TEST_TMP || '');
  sweepRuns(outer);
  const dir = fs.mkdtempSync(path.join(outer, RUN_PREFIX));
  fs.writeFileSync(path.join(dir, MARKER), JSON.stringify({pid: process.pid, started: new Date().toISOString(), keep}) + '\n');
  // No file named: the whole notebook suite, wherever this is started from.
  const suite = path.relative(process.cwd(), path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'test', '*.test.mjs')).split(path.sep).join('/');
  const args = argv.some(arg => !arg.startsWith('-')) ? argv : [...argv, suite];
  const env = {...process.env, TMPDIR: dir, TEMP: dir, TMP: dir, GODSPEED_TEST_RUN_DIR: dir};
  // Started from inside a test, node --test would otherwise report to that test's runner.
  delete env.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, ['--test', ...args], {stdio: 'inherit', env});

  let finished = false, stopping = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    if (keep) { process.stderr.write(`Test files kept in ${dir}\n`); return; }
    if (!removeRun(dir)) process.stderr.write(`Some test files in ${dir} were still in use and stay until the next test run removes them.\n`);
  };
  // Ctrl+C reaches the tests too (one console, one process group); the runner
  // waits for them to stop and then cleans up. A second Ctrl+C stops them hard.
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => {
      if (stopping) { child.kill('SIGKILL'); return; }
      stopping = true;
      child.kill(signal);
    });
  }
  child.on('error', error => { process.stderr.write(`The tests could not start: ${error.message}\n`); finish(); process.exitCode = 1; });
  child.on('exit', (code, signal) => {
    finish();
    process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1);
  });
  process.on('exit', finish);
  return child;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
