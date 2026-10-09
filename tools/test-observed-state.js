#!/usr/bin/env node
// Tests for tools/observed-state.js (mc-observed-state). A local web server stands in for the
// hourly copy on GitHub. No dependencies. Run: node tools/test-observed-state.js
'use strict';
require('./test-guard.cjs'); // never a real mission control (test-guard.bash says why)
const { execFile } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const script = path.join(__dirname, 'observed-state.js');
const LINK = 'https://observedstate.com/en/';
const NOW = '2026-10-02T06:00:00Z';
let failures = 0;
let serve = { code: 200, body: '' };

function record(over) {
  return Object.assign({
    status: 'ok', link: LINK, checked_utc: '2026-10-02T05:17:30Z',
    sources: {
      adsb: { calculado_utc: '2026-10-01T19:36:51+00:00' },
      ioda: { calculado_utc: '2026-10-01T17:16:21+00:00' },
      usgs: { calculado_utc: '2026-10-02T04:33:58+00:00' },
    },
    line: 'The observed state of the world: nothing to flag today.',
    text: 'The observed state of the world: nothing to flag today. ' + LINK,
  }, over || {});
}

function run(args, url) {
  return new Promise((resolve) => {
    const env = Object.assign({}, process.env, { OBSERVED_STATE_URL: url, OBSERVED_STATE_NOW: NOW });
    execFile('node', [script].concat(args), { env, encoding: 'utf8' }, (err, out, errOut) => {
      resolve({ code: err ? err.code : 0, out: out.trim(), err: errOut });
    });
  });
}

function check(name, ok, detail) {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name);
  if (!ok) { failures++; console.log('  ' + detail); }
}

const UNAVAILABLE = 'The observed state of the world: not available right now. ' + LINK;

(async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(serve.code, { 'Content-Type': 'application/json' });
    res.end(serve.body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + server.address().port + '/latest.json';
  const cases = [
    ['a normal day prints the line with the link, exit 0', record(), 200,
      'The observed state of the world: nothing to flag today. ' + LINK],
    ['a day with flags prints them exactly as built', record({
      text: 'The observed state of the world: 2 things to flag today. Internet, in Mexico; a magnitude 6.4 earthquake. ' + LINK }), 200,
      'The observed state of the world: 2 things to flag today. Internet, in Mexico; a magnitude 6.4 earthquake. ' + LINK],
    ['the hourly job reporting a failure says not available', record({ status: 'unavailable', error: 'x' }), 200, UNAVAILABLE],
    ['a copy older than six hours says not available, never yesterday\'s quiet', record({ checked_utc: '2026-10-01T22:00:00Z' }), 200, UNAVAILABLE],
    ['data older than thirty hours says not available', record({ sources: {
      adsb: { calculado_utc: '2026-09-30T19:36:51+00:00' }, ioda: { calculado_utc: '2026-10-01T17:16:21+00:00' },
      usgs: { calculado_utc: '2026-10-02T04:33:58+00:00' } } }), 200, UNAVAILABLE],
    ['a line not in the agreed shape is never printed', record({ text: 'World risk score: 7/10 ' + LINK }), 200, UNAVAILABLE],
    ['a line without the link is never printed', record({ text: 'The observed state of the world: nothing to flag today.' }), 200, UNAVAILABLE],
    ['a server error says not available', null, 503, UNAVAILABLE],
  ];
  for (const [name, rec, code, want] of cases) {
    serve = { code, body: rec ? JSON.stringify(rec) : 'down' };
    const r = await run([], url);
    check(name, r.code === 0 && r.out === want, 'got exit ' + r.code + ': ' + r.out);
  }

  serve = { code: 200, body: '{not json' };
  let r = await run([], url);
  check('broken JSON says not available', r.code === 0 && r.out === UNAVAILABLE, r.out);

  r = await run([], 'http://127.0.0.1:9/none');
  check('nothing listening says not available', r.code === 0 && r.out === UNAVAILABLE, r.out);

  // --append: at the end of the brief, once, however often it runs.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-'));
  const brief = path.join(dir, '2026-10-02.md');
  fs.writeFileSync(brief, '# Thursday\n\nYour day: two calls.\n\n');
  serve = { code: 200, body: JSON.stringify(record()) };
  await run(['--append', brief], url);
  await run(['--append', brief], url);
  const got = fs.readFileSync(brief, 'utf8');
  check('--append puts the line last, once, after a blank line',
    got === '# Thursday\n\nYour day: two calls.\n\nThe observed state of the world: nothing to flag today. ' + LINK + '\n', JSON.stringify(got));

  serve = { code: 200, body: JSON.stringify(record({
    text: 'The observed state of the world: 1 thing to flag today. Air traffic, at Frankfurt. ' + LINK })) };
  await run(['--append', brief], url);
  const after = fs.readFileSync(brief, 'utf8');
  check('--append replaces an earlier line instead of adding a second',
    after.split('The observed state of the world:').length === 2 && after.includes('Air traffic, at Frankfurt.'), JSON.stringify(after));

  r = await run(['--append'], url);
  check('--append without a file is a usage error', r.code === 2, 'exit ' + r.code);

  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(failures ? failures + ' FAILED' : 'all passed');
  process.exit(failures ? 1 : 0);
})();
