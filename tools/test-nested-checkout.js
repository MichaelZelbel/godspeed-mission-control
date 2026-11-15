#!/usr/bin/env node
// test-nested-checkout.js - the product's CommonJS files work wherever the product is checked out.
//
// Node takes a .js file, and a script without an extension, for an ES module when the nearest
// package.json above it says "type": "module". Until 24 October 2026 the product had no package.json
// of its own above tools/ and computer/, so checked out inside an add-on's repository, whose
// package.json says "type": "module", tools/due.js was read as an ES module ("require is not
// defined"), and the notebook, which loads it, did not start (The Clerk's full test on GitHub).
//
// This copies the checkout into such a folder and runs, from there, what loads the CommonJS files:
// the deadline tool, the tools the notebook requires, the computer commands, and the notebook.
// Needs Node 22.19 for the notebook (its engines); the rest runs on any Node the tools support.
// Usage: node tools/test-nested-checkout.js
'use strict';
require('./test-guard.cjs');
const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net');
const {spawn, spawnSync} = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ESM_ERROR = /ES module|ERR_REQUIRE_ESM|Cannot use import statement|require is not defined/;
let outer, product;

// The files of this checkout as Git has them, also the ones not committed yet; installers/ (Windows
// programs the notebook never runs) is left out, as the installers leave it out.
function productFiles() {
  const listed = spawnSync('git', ['-C', ROOT, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
  assert.equal(listed.status, 0, 'git ls-files: ' + listed.stderr);
  return listed.stdout.split('\0').filter(f => f && !f.startsWith('installers/') && fs.existsSync(path.join(ROOT, f)) && fs.statSync(path.join(ROOT, f)).isFile());
}

before(() => {
  outer = fs.mkdtempSync(path.join(os.tmpdir(), 'godspeed-nested-'));
  fs.writeFileSync(path.join(outer, 'package.json'), JSON.stringify({name: 'an-add-on', private: true, type: 'module'}, null, 2) + '\n');
  product = path.join(outer, 'godspeed-mission-control');
  for (const file of productFiles()) {
    const to = path.join(product, file);
    fs.mkdirSync(path.dirname(to), {recursive: true});
    fs.copyFileSync(path.join(ROOT, file), to);
    fs.chmodSync(to, fs.statSync(path.join(ROOT, file)).mode & 0o777);
  }
});
after(() => { if (outer) fs.rmSync(outer, {recursive: true, force: true}); });

const node = (args, options = {}) => spawnSync(process.execPath, args, {encoding: 'utf8', timeout: 60000, ...options});
const said = r => (r.stdout || '') + (r.stderr || '');
function workspace() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'godspeed-nested-ws-'));
  fs.mkdirSync(path.join(ws, 'due'));
  fs.mkdirSync(path.join(ws, 'world', 'events'), {recursive: true});
  fs.mkdirSync(path.join(ws, 'rules'));
  fs.writeFileSync(path.join(ws, 'AGENTS.md'), '');
  return ws;
}

test('tools/due.js makes and reads a deadline from a checkout inside a "type": "module" folder', t => {
  const ws = workspace(); t.after(() => fs.rmSync(ws, {recursive: true, force: true}));
  const env = {...process.env, GODSPEED_ROOT: ws, GODSPEED_TODAY: '2041-06-01'};
  const due = path.join(product, 'tools', 'due.js');
  const added = node([due, 'add', 'water-bill', '--title', 'Pay the invented water bill', '--to', '2041-06-20', '--done-when', 'The bill is paid.', '--cost', 'A reminder fee.', '--godspeed', ws], {env});
  assert.equal(added.status, 0, said(added));
  assert.doesNotMatch(said(added), ESM_ERROR);
  const listed = node([due, '--godspeed', ws], {env});
  assert.equal(listed.status, 0, said(listed));
  assert.match(listed.stdout, /invented water bill/);
});

test('every library in tools/ loads with require() there', () => {
  const tools = path.join(product, 'tools');
  const libraries = fs.readdirSync(tools).filter(f => f.endsWith('.js') && !f.startsWith('test-') && /require\.main\s*===\s*module/.test(fs.readFileSync(path.join(tools, f), 'utf8')));
  assert.ok(libraries.includes('due.js'), 'due.js is among them: ' + libraries.join(', '));
  for (const f of libraries) {
    const loaded = node(['-e', 'require(process.argv[1])', path.join(tools, f)]);
    assert.equal(loaded.status, 0, f + ': ' + said(loaded));
  }
  for (const f of ['mc-cards.js', 'compile-rules.js', 'goals.js', 'due.js']) {
    const loaded = node(['-e', 'const m=require(process.argv[1]);if(!m||!Object.keys(m).length)process.exit(3)', path.join(tools, f)]);
    assert.equal(loaded.status, 0, f + ' (the notebook requires it): ' + said(loaded));
  }
});

test('the computer commands answer there: godspeed-computer (no extension) and helper.js', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'godspeed-nested-computer-')); t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const env = {...process.env, GODSPEED_COMPUTER_DIR: dir};
  for (const file of [path.join(product, 'computer', 'godspeed-computer'), path.join(product, 'computer', 'helper.js')]) {
    const r = node([file], {env});
    assert.equal(r.status, 0, path.basename(file) + ': ' + said(r));
    assert.match(r.stdout, /^Usage:/m, path.basename(file));
  }
});

const [major, minor] = process.versions.node.split('.').map(Number);
const notebookNode = major === 22 && minor >= 19;
test('the notebook starts from a checkout inside a "type": "module" folder', {skip: !notebookNode && 'the notebook needs Node 22.19 or a later 22'}, async t => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'godspeed-nested-notebook-')), home = fs.mkdtempSync(path.join(os.tmpdir(), 'godspeed-nested-home-'));
  const port = await new Promise((resolve, reject) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); s.on('error', reject); });
  const env = {...process.env, GODSPEED_WORKSPACE: ws, GODSPEED_PORT: String(port), GODSPEED_FOOD_TABLE: 'off', HOME: home, USERPROFILE: home};
  let log = '';
  const child = spawn(process.execPath, [path.join(product, 'notebook', 'server', 'main.mjs')], {env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true});
  child.stdout.on('data', d => { log += d; }); child.stderr.on('data', d => { log += d; });
  t.after(async () => {
    if (child.exitCode === null) { const gone = new Promise(r => child.once('exit', r)); child.kill(); await gone; }
    for (const dir of [ws, home]) fs.rmSync(dir, {recursive: true, force: true, maxRetries: 5});
  });
  let health = null;
  for (const until = Date.now() + 90000; Date.now() < until && child.exitCode === null;) {
    try { const r = await fetch(`http://127.0.0.1:${port}/health`); if (r.ok) { health = await r.json(); break; } } catch { /* not yet */ }
    await new Promise(r => setTimeout(r, 500));
  }
  assert.ok(health && health.ok === true, 'the notebook did not answer: ' + log.slice(-1200));
  assert.doesNotMatch(log, ESM_ERROR);
});

// What the checks above prove for a checkout, this says for every CommonJS script there, and for
// computer/, which the installers copy whole into the helper's own app folder on a person's computer
// ("your assistant's browser"), so it takes its own package.json along. tools/ has none of its own on
// purpose: the Mac and Linux installer copies every file in it into ~/.local/bin, a folder the person
// shares with other programs, and a package.json there would decide for their scripts too.
test('every CommonJS script of the product is CommonJS by a package.json of the product itself', () => {
  const files = productFiles();
  const typeAt = dir => { const f = path.join(ROOT, dir, 'package.json'); return fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, 'utf8')).type || 'commonjs') : null; };
  const scope = file => { for (let dir = path.posix.dirname(file); ; dir = path.posix.dirname(dir)) { const type = typeAt(dir === '.' ? '' : dir); if (type) return type; if (dir === '.' || dir === '/') return null; } };
  const script = file => file.endsWith('.js') || (!path.posix.basename(file).includes('.') && /^#!.*\bnode\b/.test(fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n')[0]));
  const unscoped = files.filter(script).filter(f => scope(f) === null);
  assert.deepEqual(unscoped, [], 'no package.json of the product says what these are');
  assert.equal(typeAt('computer'), 'commonjs', 'computer/package.json says "type": "commonjs"');
  assert.equal(typeAt('tools'), null, 'tools/ has no package.json: it would be copied into ~/.local/bin');
});
