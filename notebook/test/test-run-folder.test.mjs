import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {RUN_PREFIX, MARKER} from '../scripts/run-tests.mjs';

// The tests run with one temporary folder per run (scripts/run-tests.mjs), which
// goes when the run ends. Until 16 October 2026 they wrote straight into the
// computer's temp folder, and 81,347 leftover folders filled the developer's C: drive.
const runner = fileURLToPath(new URL('../scripts/run-tests.mjs', import.meta.url));

function sandbox(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'run-folder-'));
  t.after(() => fs.rmSync(base, {recursive: true, force: true}));
  const outer = path.join(base, 'temp'), files = path.join(base, 'files');
  fs.mkdirSync(outer); fs.mkdirSync(files);
  return {outer, files, report: path.join(files, 'report.json')};
}
// A test that leaves a folder behind, and asks a program it starts where its temp folder is.
const leaky = (extra = '') => `import test from 'node:test';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
test('leaves a folder',()=>{const made=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-leak-'));fs.writeFileSync(path.join(made,'file.txt'),'kept by nobody');
const child=spawnSync(process.execPath,['-e','process.stdout.write(require("os").tmpdir())'],{encoding:'utf8'}).stdout;
fs.writeFileSync(process.env.REPORT,JSON.stringify({tmp:os.tmpdir(),child,made,run:process.env.GODSPEED_TEST_RUN_DIR}));${extra}});\n`;
const envFor = (box, more = {}) => {
  const env = {...process.env, TMPDIR: box.outer, TEMP: box.outer, TMP: box.outer, REPORT: box.report, ...more};
  if (!('GODSPEED_KEEP_TEST_TMP' in more)) delete env.GODSPEED_KEEP_TEST_TMP;
  return env;
};
const run = (box, file, more) => spawnSync(process.execPath, [runner, file], {env: envFor(box, more), encoding: 'utf8', timeout: 120000});

test('the tests and the programs they start get the run folder as their temp folder, and nothing is left afterwards', t => {
  const box = sandbox(t), file = path.join(box.files, 'leaky.test.mjs');
  fs.writeFileSync(file, leaky());
  const result = run(box, file);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const seen = JSON.parse(fs.readFileSync(box.report, 'utf8'));
  assert.equal(path.dirname(seen.tmp), box.outer, 'the temp folder is one folder inside the computer\'s');
  assert.ok(path.basename(seen.tmp).startsWith(RUN_PREFIX));
  assert.equal(seen.child, seen.tmp, 'a program the test starts uses the same folder');
  assert.equal(seen.run, seen.tmp);
  assert.ok(seen.made.startsWith(seen.tmp + path.sep), 'what the test made is inside it');
  assert.deepEqual(fs.readdirSync(box.outer), [], 'the run leaves nothing in the computer\'s temp folder');
});

test('a failing run is cleaned up too, and still fails', t => {
  const box = sandbox(t), file = path.join(box.files, 'failing.test.mjs');
  fs.writeFileSync(file, leaky("throw new Error('this test fails on purpose');"));
  const result = run(box, file);
  assert.notEqual(result.status, 0);
  assert.deepEqual(fs.readdirSync(box.outer), []);
});

test('GODSPEED_KEEP_TEST_TMP keeps the folder and says where it is', t => {
  const box = sandbox(t), file = path.join(box.files, 'leaky.test.mjs');
  fs.writeFileSync(file, leaky());
  const result = run(box, file, {GODSPEED_KEEP_TEST_TMP: '1'});
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const kept = fs.readdirSync(box.outer);
  assert.equal(kept.length, 1);assert.ok(kept[0].startsWith(RUN_PREFIX));
  assert.match(result.stderr, new RegExp('Test files kept in .*' + kept[0]));
  const seen = JSON.parse(fs.readFileSync(box.report, 'utf8'));
  assert.ok(fs.existsSync(path.join(seen.made, 'file.txt')));
  // A kept folder is not swept away by the next run either.
  assert.equal(run(box, file).status, 0);
  assert.deepEqual(fs.readdirSync(box.outer), kept);
});

test('a run that was killed outright is cleaned up by the next one; a run still going and folders of others stay', t => {
  const box = sandbox(t), file = path.join(box.files, 'leaky.test.mjs');
  fs.writeFileSync(file, leaky());
  const gone = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], {encoding: 'utf8'}).stdout;
  const folder = (name, marker) => { const dir = path.join(box.outer, name); fs.mkdirSync(path.join(dir, 'godspeed-leftover-abc'), {recursive: true}); fs.writeFileSync(path.join(dir, 'godspeed-leftover-abc', 'x'), 'x'); if (marker) fs.writeFileSync(path.join(dir, MARKER), JSON.stringify(marker)); return name; };
  folder(RUN_PREFIX + 'killed', {pid: Number(gone), started: '2026-10-16T00:00:00Z', keep: false});
  const running = folder(RUN_PREFIX + 'running', {pid: process.pid, started: new Date().toISOString(), keep: false});
  const foreign = folder(RUN_PREFIX + 'foreign', null);
  const other = folder('somebody-else', null);
  assert.equal(run(box, file).status, 0);
  assert.deepEqual(fs.readdirSync(box.outer).sort(), [foreign, running, other].sort());
});

test('Ctrl+C stops the tests and the folder still goes', {skip: process.platform === 'win32' && 'a program cannot send Ctrl+C to another on Windows; a run stopped any other way is removed by the next run (test above)'}, async t => {
  const box = sandbox(t), file = path.join(box.files, 'waiting.test.mjs');
  fs.writeFileSync(file, leaky('await new Promise(()=>setInterval(()=>{},1000));').replace("test('leaves a folder',()=>", "test('leaves a folder',async()=>"));
  const child = spawn(process.execPath, [runner, file], {env: envFor(box), stdio: 'ignore'});
  for (let i = 0; i < 300 && !fs.existsSync(box.report); i++) await new Promise(resolve => setTimeout(resolve, 100));
  assert.ok(fs.existsSync(box.report), 'the test started');
  const ended = new Promise(resolve => child.on('exit', (code, signal) => resolve({code, signal})));
  child.kill('SIGINT');
  const {code} = await ended;
  assert.notEqual(code, 0);
  assert.deepEqual(fs.readdirSync(box.outer), []);
});
