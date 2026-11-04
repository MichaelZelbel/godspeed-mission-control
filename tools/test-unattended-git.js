#!/usr/bin/env node
'use strict';
// Every Git call nobody watches goes through tools/unattended-git.cjs (the issue: GitHub sign-in
// windows on a computer nobody sat at). This test is the rule that keeps a future spawn honest,
// plus the helper's own contract: the environment, the failure it recognises, the command form.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const ug = require('./unattended-git.cjs');

const ROOT = path.resolve(__dirname, '..');
const MARK = /A person is present:/;
const JS_SPAWN = /\b(?:spawn|spawnSync|execFile|execFileSync|execFileAsync|exec|execSync|run|runChild|probe|quiet)\(\s*['"`]git(?:\.exe)?(?:['"`]|\s)/;
const JS_ARGV = /\[\s*['"]git(?:\.exe)?['"]\s*,\s*\[/;
const PY_ARGV = /\[\s*['"]git['"]/;
const SH_GIT = /(^|[\s;&|({`$"])git\s+[-a-z]/;

function violations(file, text) {
  const lines = text.split('\n');
  const marked = (i) => MARK.test(lines[i]) || (i > 0 && MARK.test(lines[i - 1]));
  const first = lines[0] || '';
  // mc-prompt-archive is a shell and Python polyglot: its second line opens a Python string.
  const python = /\.py$/.test(file) || /^#!.*python/.test(first) || /^''''/.test(lines[1] || '');
  const shell = /\.sh$/.test(file) || /^#!.*\b(?:ba)?sh\b/.test(first);
  const js = /\.(?:js|cjs|mjs)$/.test(file);
  const out = [];
  if (shell && !python && !js) {
    if (MARK.test(text.split('\n').slice(0, 12).join('\n')) || (/\bgit\(\)\s*\{/.test(text) && /unattended-git\.cjs/.test(text))) return out;
    lines.forEach((line, i) => { if (SH_GIT.test(line.replace(/#.*$/, ''))) out.push(file + ':' + (i + 1)); });
    return out;
  }
  lines.forEach((line, i) => {
    if (marked(i)) return;
    if (python ? (PY_ARGV.test(line) && !/unattended-git\.cjs/.test(line + (lines[i - 1] || ''))) : js && (JS_SPAWN.test(line) || JS_ARGV.test(line))) out.push(file + ':' + (i + 1));
  });
  return out;
}

// 1. The scanner catches what it should (a scanner that finds nothing proves nothing).
assert.strictEqual(violations('a.js', "spawnSync('git', ['x'])").length, 1);
assert.strictEqual(violations('a.mjs', 'execFile("git", ["x"])').length, 1);
assert.strictEqual(violations('a.js', "const m = ['git', ['x']];").length, 1);
assert.strictEqual(violations('a.sh', '#!/bin/sh\ngit -C x push').length, 1);
assert.strictEqual(violations('a.py', 'subprocess.run(["git", "-C", d])').length, 1);
assert.strictEqual(violations('a.js', "// A person is present: Connect.\nspawnSync('git', ['x'])").length, 0);
assert.strictEqual(violations('a.sh', '#!/bin/sh\ngit() { node "$HERE/unattended-git.cjs" "$@"; }\ngit -C x push').length, 0);

// 2. Every spawn in tools/ and notebook/ goes through the helper or says why a person is present.
const SKIP_DIRS = new Set(['node_modules', 'ui', 'test', '.git']);
function walk(dir, found) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p, found); } else if (e.isFile()) found.push(p);
  }
  return found;
}
const found = [];
for (const top of ['tools', 'notebook']) walk(path.join(ROOT, top), found);
const bad = [];
for (const file of found) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  if (/^tools\/test[-_]/.test(rel) || rel === 'tools/unattended-git.cjs' || !/\.(?:js|cjs|mjs|py|sh)$|\/[^./]+$/.test(rel)) continue;
  let text; try { text = fs.readFileSync(file, 'utf8'); } catch (_) { continue; }
  if (text.length > 4e6 || text.includes('\0')) continue;
  bad.push(...violations(rel, text));
}
assert.deepStrictEqual(bad, [], 'a git call that bypasses tools/unattended-git.cjs:\n' + bad.join('\n'));

// 3. The helper.
const q = ug.quietGit(['push'], { env: { Gcm_Interactive: 'always', GIT_TERMINAL_PROMPT: '1', KEEP: 'me' } }, 'linux');
assert.strictEqual(q[0], 'git');
assert.deepStrictEqual(q[1], ['push']);
assert.strictEqual(q[2].env.GIT_TERMINAL_PROMPT, '0');
assert.strictEqual(q[2].env.GCM_INTERACTIVE, 'Never');
assert.strictEqual(q[2].env.Gcm_Interactive, undefined);
assert.strictEqual(q[2].env.KEEP, 'me');
assert.deepStrictEqual(ug.quietGit(['push'], {}, 'win32')[1], ['-c', 'core.longpaths=true', 'push']);
assert.ok(ug.signInMissing("fatal: could not read Username for 'https://github.com': terminal prompts disabled"));
assert.ok(ug.signInMissing(Buffer.from('Cannot prompt because user interactivity has been disabled.')));
assert.ok(!ug.signInMissing('remote: Repository not found.'));

// 4. The command form, against a fake git that fails like a push with no credential.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unattended-git-'));
try {
  const fake = path.join(dir, 'bin'); fs.mkdirSync(fake);
  fs.writeFileSync(path.join(fake, 'git'), "#!/bin/sh\necho \"fatal: could not read Username for 'https://github.com': terminal prompts disabled\" >&2\nexit 128\n", { mode: 0o755 });
  const mc = path.join(dir, 'mc'); fs.mkdirSync(path.join(mc, '.godspeed'), { recursive: true });
  const helper = path.join(__dirname, 'unattended-git.cjs');
  const failing = () => spawnSync(process.execPath, [helper, '--tell', mc, 'push'], { encoding: 'utf8', env: Object.assign({}, process.env, { PATH: fake + path.delimiter + process.env.PATH }) });
  const notices = () => JSON.parse(fs.readFileSync(path.join(mc, '.godspeed', 'notices.json'), 'utf8')).notices;
  const one = failing();
  assert.strictEqual(one.status, 128);
  assert.match(one.stderr, /terminal prompts disabled/);
  assert.strictEqual(notices().length, 1);
  assert.match(notices()[0].id, /^git-sign-in-\d{4}-\d{2}-\d{2}$/);
  failing();
  assert.strictEqual(notices().length, 1, 'a second failure the same day queues no second notice');
  const realGit = (args, input) => spawnSync(process.execPath, [helper, ...args], { encoding: 'utf8', input, cwd: dir });
  const hash = realGit(['hash-object', '--stdin'], 'x');
  assert.strictEqual(hash.stdout, spawnSync('git', ['hash-object', '--stdin'], { encoding: 'utf8', input: 'x' }).stdout);
  fs.writeFileSync(path.join(dir, 'a'), '1'); fs.writeFileSync(path.join(dir, 'b'), '2');
  assert.strictEqual(realGit(['diff', '--no-index', '--quiet', 'a', 'b']).status, 1);
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
console.log('ok test-unattended-git');
