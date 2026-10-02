#!/usr/bin/env node
// Tests for computer/ (computer use layer 2, D-285): the server half, the home half, the
// assistant's tools, and, where a Chrome or Edge is installed, a whole run through a real one.
// No dependencies. Run: node computer/test/test-computer.js        (--no-browser skips the real browser)
'use strict';
const os = require('os');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const net = require('net');
const { spawn } = require('child_process');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-computer-'));
Object.assign(process.env, {
  GODSPEED_COMPUTER_HB_MS: '200',
  GODSPEED_COMPUTER_SILENCE_MS: '1000',
  GODSPEED_COMPUTER_OFF_RETRY_MS: '1500',
  GODSPEED_COMPUTER_QUIET: '1',
  GODSPEED_COMPUTER_HOME: path.join(TMP, 'home'),
  GODSPEED_COMPUTER_DIR: path.join(TMP, 'server'),
  GODSPEED_PUBLIC_HOST: '127.0.0.1',
  GODSPEED_COMPUTER_ALLOW_HOSTS: '127.0.0.1',
});
const ROOT = path.join(__dirname, '..');
const WebSocket = require('../vendor/ws');
const C = require('../lib/common');
const S = require('../lib/state');
const { startRelay, runWaitingJobs } = require('../relay');
const { startProxy } = require('../lib/proxy');
const secret = require('../lib/secret');
const { findBrowser } = require('../lib/browser');

let failures = 0, passes = 0, skips = 0;
const quietLog = () => {};
async function check(name, fn) {
  let ok, detail = '';
  try { const r = await fn(); ok = r === true; if (!ok) detail = JSON.stringify(r); } catch (e) { ok = false; detail = e.stack || e.message; }
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name);
  if (ok) passes++; else { failures++; console.log('      ' + String(detail).split('\n').slice(0, 6).join('\n      ')); }
}
function skip(name, why) { skips++; console.log('SKIP  ' + name + ' (' + why + ')'); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 5000, step = 50) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(step); }
  return fn();
}
function freePort() {
  return new Promise(r => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
}
function getJson(url) {
  return new Promise(resolve => {
    http.get(url, res => { let b = ''; res.on('data', d => { b += d; }); res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch { /* */ } resolve({ status: res.statusCode, body: j, text: b }); }); })
      .on('error', e => resolve({ status: 0, error: e.message }));
  });
}
function post(port, certPem, pathName, obj) {
  return new Promise(resolve => {
    const body = JSON.stringify(obj);
    const req = https.request({ host: '127.0.0.1', port, path: pathName, method: 'POST', ca: certPem, checkServerIdentity: () => undefined,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, res => {
      let b = ''; res.on('data', d => { b += d; }); res.on('end', () => { let j = {}; try { j = JSON.parse(b); } catch { /* */ } resolve({ status: res.statusCode, body: j }); });
    });
    req.on('error', e => resolve({ status: 0, error: e.message }));
    req.end(body);
  });
}

// A stand-in for the home computer: speaks the helper's protocol, no browser.
function fakeHelper({ port, certPem, device, key, answerHb = true }) {
  const h = { messages: [], answerHb, refused: null, open: false };
  h.ws = new WebSocket(`wss://127.0.0.1:${port}/v1/helper`, {
    ca: certPem, checkServerIdentity: () => undefined, headers: { authorization: `Bearer ${device}:${key}` },
  });
  h.ws.on('unexpected-response', (req, res) => { h.refused = { status: res.statusCode, reason: res.headers['x-godspeed-reason'] }; h.ws.terminate(); });
  h.ws.on('open', () => { h.open = true; h.ws.send(JSON.stringify({ t: 'hello', protocol: 1, browser: 'chrome' })); });
  h.ws.on('close', () => { h.open = false; });
  h.ws.on('error', () => {});
  h.ws.on('message', raw => {
    const m = JSON.parse(raw.toString());
    h.messages.push(m);
    if (m.t === 'hb' && h.answerHb) h.ws.send('{"t":"hb"}');
    if (m.t === 'http') h.ws.send(JSON.stringify({ t: 'http-res', id: m.id, status: 200, body: JSON.stringify({ Browser: 'Fake/1', webSocketDebuggerUrl: 'ws://127.0.0.1:9999/devtools/browser/abc' }) }));
  });
  return h;
}

(async () => {
  // ---------------------------------------------------------------------------------------------
  console.log('== home network and the connection code');
  await check('the router, a printer name and the loopback are home network', () =>
    ['192.168.178.1', '10.0.0.5', '172.20.1.1', '127.0.0.1', '169.254.1.1', '100.100.1.1', '::1', 'fe80::1', 'fd00::1', '::ffff:192.168.1.1']
      .every(ip => C.isHomeNetworkIp(ip)) || 'an address slipped through');
  await check('public addresses are not home network', () =>
    ['8.8.8.8', '1.1.1.1', '140.82.121.4', '2606:4700::1111'].every(ip => !C.isHomeNetworkIp(ip)) || 'a public address was refused');
  await check('names: nas.local, a single word, fritz.box are home; github.com is not', () =>
    C.isHomeNetworkHost('nas.local') && C.isHomeNetworkHost('router') && C.isHomeNetworkHost('fritz.box') && C.isHomeNetworkHost('localhost')
      && !C.isHomeNetworkHost('github.com') || 'wrong');
  await check('files, browser settings and home addresses are refused; web pages and about:blank are not', () =>
    !!C.refuseUrl('file:///C:/Users') && !!C.refuseUrl('chrome://settings/passwords') && !!C.refuseUrl('http://192.168.1.1/')
      && C.refuseUrl('https://www.amazon.de/') === null && C.refuseUrl('about:blank') === null || 'wrong');
  const line = C.encodePairLine({ host: 'srv1.example.com', port: 7443, fingerprint: 'ab:cd:ef', code: 'xyz' });
  await check('a connection code pasted with quotes, spaces and line breaks around it still reads', () => {
    const d = C.decodePairLine('  "`' + line.slice(0, 20) + '\n' + line.slice(20) + '`"  ');
    return (d && d.host === 'srv1.example.com' && d.port === 7443 && d.fingerprint === 'ABCDEF' && d.code === 'xyz') || d;
  });
  await check('anything else is not a connection code', () => C.decodePairLine('hello') === null && C.decodePairLine('godspeed1.!!!') === null || 'read garbage');

  // ---------------------------------------------------------------------------------------------
  console.log('== the server\'s record');
  const sdir = path.join(TMP, 'state-test');
  await check('a connection code works once', () => {
    const code = S.newPairCode(sdir);
    const a = S.redeemPairCode(sdir, code, 'laptop'), b = S.redeemPairCode(sdir, code, 'laptop');
    return (a && a.key && !b && S.checkDevice(sdir, a.id, a.key) && !S.checkDevice(sdir, a.id, 'wrong')) || { a, b };
  });
  await check('a connection code is dead after half an hour', () => {
    const code = S.newPairCode(sdir);
    process.env.GODSPEED_COMPUTER_NOW = String(Date.now() + 31 * 60000);
    const r = S.redeemPairCode(sdir, code, 'late');
    delete process.env.GODSPEED_COMPUTER_NOW;
    return r === null || r;
  });
  await check('asking for a code opens the door; off and on switch', () => {
    const before = S.isOff(sdir); S.setOff(sdir, true); const off = S.isOff(sdir); S.setOff(sdir, false);
    return S.isEnabled(sdir) && !before && off && !S.isOff(sdir) || 'wrong';
  });
  await check('a waiting job older than a day is dropped, a fresh one runs', () => {
    S.addWaiting(sdir, 'old job');
    process.env.GODSPEED_COMPUTER_NOW = String(Date.now() + 25 * 3600000);
    S.addWaiting(sdir, 'new job');
    const t = S.takeWaiting(sdir);
    delete process.env.GODSPEED_COMPUTER_NOW;
    return (t.expired.length === 1 && t.expired[0].task === 'old job' && t.due.length === 1 && t.due[0].task === 'new job' && S.listWaiting(sdir).length === 0) || t;
  });

  // ---------------------------------------------------------------------------------------------
  console.log('== the relay, with a stand-in computer');
  const rdir = path.join(TMP, 'relay');
  const ran = [];
  S.newPairCode(rdir); // opens the door
  const relay = startRelay({ dir: rdir, doorPort: 0, cdpPort: 0, doorHost: '127.0.0.1', log: quietLog, runWaiting: () => ran.push(Date.now()) });
  await relay.ready;
  await until(() => relay.doorPort(), 3000);
  const door = relay.doorPort(), cdpP = relay.cdpPort();
  const { certPem } = S.serverCert(rdir);
  await check('the door answers once a code was asked for', async () => {
    const r = await new Promise(res => https.get({ host: '127.0.0.1', port: door, path: '/v1/ping', ca: certPem, checkServerIdentity: () => undefined }, x => res(x.statusCode)).on('error', e => res(e.message)));
    return r === 200 || r;
  });
  const code = S.newPairCode(rdir);
  const paired = await post(door, certPem, '/v1/pair', { code, name: 'test laptop' });
  await check('pairing with a fresh code gives this computer a key', () => (paired.status === 200 && !!paired.body.key) || paired);
  await check('the same code a second time is refused', async () => (await post(door, certPem, '/v1/pair', { code, name: 'x' })).status === 403 || 'not refused');
  await check('ten wrong codes in a row, then the door waits', async () => {
    for (let i = 0; i < 9; i++) await post(door, certPem, '/v1/pair', { code: 'wrong' + i });
    const r = await post(door, certPem, '/v1/pair', { code: 'wrong-again' });
    return r.status === 429 || r.status;
  });
  const dev = { port: door, certPem, device: paired.body.device, key: paired.body.key };
  await check('a computer without the right key is turned away', async () => {
    const h = fakeHelper({ ...dev, key: 'not-the-key' });
    await until(() => h.refused, 3000);
    return (h.refused && h.refused.status === 401) || h.refused;
  });
  await check('with nobody connected, the browser tools get "home computer not connected"', async () => {
    const r = await getJson(`http://127.0.0.1:${cdpP}/json/version`);
    return (r.status === 503 && /not connected/.test(r.text)) || r;
  });
  let h1 = fakeHelper(dev);
  await check('the paired computer connects, and status says so', async () => {
    const st = await until(async () => { const r = await getJson(`http://127.0.0.1:${cdpP}/godspeed/status`); return r.body && r.body.connected ? r.body : null; }, 3000);
    return (st && st.computer === 'test laptop' && st.browser === 'chrome') || st;
  });
  await check('waiting jobs are started when the computer connects', async () => !!(await until(() => ran.length, 4000)) || 'not started');
  await check('the browser tools reach the computer, with addresses rewritten to the server\'s own', async () => {
    const r = await getJson(`http://127.0.0.1:${cdpP}/json/version`);
    return (r.status === 200 && r.body.webSocketDebuggerUrl === `ws://127.0.0.1:${cdpP}/devtools/browser/abc`) || r;
  });
  await check('a home-network address is refused on the server, before it ever reaches the computer', async () => {
    const c = new WebSocket(`ws://127.0.0.1:${cdpP}/devtools/browser/abc`);
    await new Promise(r => c.on('open', r));
    const answer = new Promise(r => c.on('message', m => r(JSON.parse(m.toString()))));
    c.send(JSON.stringify({ id: 7, method: 'Page.navigate', params: { url: 'http://192.168.178.1/' }, sessionId: 'S1' }));
    const a = await answer;
    c.send(JSON.stringify({ id: 8, method: 'Page.navigate', params: { url: 'https://example.org/' } }));
    const forwarded = await until(() => h1.messages.find(m => m.t === 'd' && m.data.includes('example.org')), 2000);
    const leaked = h1.messages.some(m => m.t === 'd' && m.data.includes('192.168.178.1'));
    c.close();
    return (a.id === 7 && a.sessionId === 'S1' && /home-network/.test(a.error.message) && !!forwarded && !leaked && S.readPages(rdir).some(l => l.endsWith('https://example.org/'))) || { a, forwarded: !!forwarded, leaked };
  });
  await check('a computer that goes silent (asleep) is noticed, and the tools are told at once', async () => {
    h1.answerHb = false;
    const t0 = Date.now();
    const gone = await until(async () => { const r = await getJson(`http://127.0.0.1:${cdpP}/godspeed/status`); return r.body && !r.body.connected; }, 4000);
    const took = Date.now() - t0;
    const r = await getJson(`http://127.0.0.1:${cdpP}/json/version`);
    return (gone && took < 2500 && r.status === 503) || { gone, took, status: r.status };
  });
  h1 = fakeHelper(dev);
  await until(() => h1.open, 3000);
  await check('a newer connection takes over and the older one is told', async () => {
    const h2 = fakeHelper(dev);
    const told = await until(() => h1.messages.find(m => m.t === 'replaced'), 3000);
    await until(() => h2.open, 3000);
    h1 = h2;
    return !!told || 'not told';
  });
  await check('"stop using my computer" disconnects it and turns it away until "on"', async () => {
    S.setOff(rdir, true);
    const told = await until(() => h1.messages.find(m => m.t === 'off'), 3000);
    await until(() => !h1.open, 3000);
    const again = fakeHelper(dev);
    await until(() => again.refused, 3000);
    const tools = await getJson(`http://127.0.0.1:${cdpP}/json/version`);
    S.setOff(rdir, false);
    const back = fakeHelper(dev);
    const ok = await until(() => back.open, 3000);
    h1 = back;
    return (!!told && again.refused && again.refused.reason === 'off' && /switched off/.test(tools.text) && ok) || { told: !!told, refused: again.refused, tools: tools.text };
  });
  await relay.close();
  await check('after a server restart the computer reconnects with its key, no new pairing', async () => {
    const r2 = startRelay({ dir: rdir, doorPort: door, cdpPort: 0, doorHost: '127.0.0.1', log: quietLog, runWaiting: () => {} });
    await r2.ready;
    await until(() => r2.doorPort(), 3000);
    const h = fakeHelper(dev);
    const ok = await until(() => h.open, 3000);
    await r2.close();
    return ok || 'did not reconnect';
  });

  // ---------------------------------------------------------------------------------------------
  console.log('== jobs that wait for the computer');
  const fakeHermes = path.join(TMP, 'fake-hermes.js');
  const hermesLog = path.join(TMP, 'hermes-calls.txt');
  fs.writeFileSync(fakeHermes, `const fs=require('fs');const a=process.argv.slice(2);let input='';process.stdin.on('data',d=>input+=d).on('end',()=>{
fs.appendFileSync(${JSON.stringify(hermesLog)}, JSON.stringify({a,input})+'\\n');
if(a[0]==='-z')process.stdout.write('Your computer is back, so I checked: 2 parcels on the way.');});`);
  process.env.GODSPEED_COMPUTER_HERMES = `"${process.execPath}" "${fakeHermes}"`;
  const wdir = path.join(TMP, 'waiting');
  S.addWaiting(wdir, 'check my Amazon orders');
  await runWaitingJobs({ dir: wdir, log: quietLog });
  const calls = fs.readFileSync(hermesLog, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  await check('a waiting job runs through the assistant and its answer goes to Telegram', () =>
    (calls.length === 2 && calls[0].a[0] === '-z' && calls[0].a[1].includes('check my Amazon orders') && calls[1].a[0] === 'send'
      && calls[1].input.includes('2 parcels')) || calls);
  fs.writeFileSync(hermesLog, '');
  process.env.GODSPEED_COMPUTER_NOW = String(Date.now() - 25 * 3600000);
  S.addWaiting(wdir, 'an old job');
  delete process.env.GODSPEED_COMPUTER_NOW;
  await runWaitingJobs({ dir: wdir, log: quietLog });
  await check('a job that waited a whole day is dropped with one line', () => {
    const c = fs.readFileSync(hermesLog, 'utf8').trim().split('\n').map(l => JSON.parse(l));
    return (c.length === 1 && c[0].a[0] === 'send' && /dropped/.test(c[0].input) && /an old job/.test(c[0].input)) || c;
  });

  // ---------------------------------------------------------------------------------------------
  console.log('== the assistant\'s tools');
  const mdir = path.join(TMP, 'mcp');
  // A stand-in for the browser engine: one tab with an address, a loading state and text, kept in a
  // file between calls, plus a log of every call. FAKE_AB_SLOW makes the page never finish loading
  // (one slow script) while its text is already there.
  const fakeAb = path.join(TMP, 'fake-ab.js');
  const abState = path.join(TMP, 'fake-ab-state.json');
  fs.writeFileSync(fakeAb, `const fs = require('fs'); const a = process.argv.slice(2); const cmd = a.slice(4);
const f = ${JSON.stringify(abState)}; let st = { url: 'about:blank' }; try { st = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
fs.appendFileSync(f + '.log', a.join(' ') + '\\n');
if (cmd[0] === 'eval' && cmd[1].includes('location.href = ')) { const i = cmd[1].indexOf('location.href = ') + 16; st.url = JSON.parse(cmd[1].slice(i, cmd[1].indexOf(';', i))); st.at = Date.now(); fs.writeFileSync(f, JSON.stringify(st)); process.stdout.write('"going"'); }
else if (cmd[0] === 'eval') { const slow = !!process.env.FAKE_AB_SLOW; const ready = slow ? 'loading' : (Date.now() - (st.at || 0) > 300 ? 'complete' : 'loading');
  const shown = st.url.endsWith('/secure') ? st.url.replace('/secure', '/login') : st.url; process.stdout.write('"' + ready + ' 512 ' + shown + '"'); }
else if (cmd.join(' ') === 'get url') process.stdout.write(st.url);
else if (cmd.join(' ') === 'get title') process.stdout.write(st.url.includes('login') || st.url.endsWith('/secure') ? 'Log in' : 'Example Domain');
else process.stdout.write('AB ' + a.join(' '));`);
  const mrelay = startRelay({ dir: mdir, doorPort: 0, cdpPort: 0, doorHost: '127.0.0.1', log: quietLog, runWaiting: () => {} });
  await mrelay.ready;
  const mcp = spawn(process.execPath, [path.join(ROOT, 'mcp.js')], {
    env: { ...process.env, GODSPEED_COMPUTER_DIR: mdir, GODSPEED_COMPUTER_CDP_PORT: String(mrelay.cdpPort()), GODSPEED_COMPUTER_AGENT_BROWSER: `"${process.execPath}" "${fakeAb}"` },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  let mbuf = ''; const mwait = new Map(); let mid = 0;
  mcp.stdout.on('data', d => { mbuf += d; let i; while ((i = mbuf.indexOf('\n')) >= 0) { const m = JSON.parse(mbuf.slice(0, i)); mbuf = mbuf.slice(i + 1); const w = mwait.get(m.id); if (w) { mwait.delete(m.id); w(m); } } });
  const rpc = (method, params) => new Promise(r => { const n = ++mid; mwait.set(n, r); mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n'); });
  const tool = async (name, args = {}) => (await rpc('tools/call', { name, arguments: args })).result.content[0].text;
  await check('the tools introduce themselves to Hermes', async () => {
    const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    const list = await rpc('tools/list', {});
    const names = list.result.tools.map(t => t.name);
    return (init.result.serverInfo.name === 'godspeed-computer' && names.includes('computer_browser_open') && names.includes('computer_when_back')
      && !names.some(n => /cookie|eval|upload|download/.test(n))) || names;
  });
  await check('before any computer is paired, a tool explains how to set it up', async () => /NOT SET UP/.test(await tool('computer_browser_open', { url: 'https://example.org/' })) || 'no');
  await check('"connect my computer" gives a code that reads back to this server', async () => {
    const t = await tool('computer_connect_code');
    const d = C.decodePairLine(t);
    return (d && d.host === '127.0.0.1' && d.fingerprint === S.serverCert(mdir).fingerprint) || t;
  });
  S.redeemPairCode(mdir, S.newPairCode(mdir), 'mcp laptop');
  await check('with the computer off, a tool says so in plain words and offers to wait', async () => {
    const t = await tool('computer_browser_open', { url: 'https://example.org/' });
    return (/NOT CONNECTED/.test(t) && /computer_when_back/.test(t)) || t;
  });
  await check('a job can be left for when the computer is back', async () => {
    await tool('computer_when_back', { task: 'read my latest bank statement total' });
    return S.listWaiting(mdir).some(j => j.task === 'read my latest bank statement total') || S.listWaiting(mdir);
  });
  await check('the tools never open the home network or files', async () =>
    /Not opened/.test(await tool('computer_browser_open', { url: 'http://192.168.178.1/' })) && /Not opened/.test(await tool('computer_browser_open', { url: 'file:///etc/passwd' })) || 'opened');
  await until(() => mrelay.doorPort(), 3000);
  const mdev = S.redeemPairCode(mdir, S.newPairCode(mdir), 'mcp laptop 2');
  const mh = fakeHelper({ port: mrelay.doorPort(), certPem: S.serverCert(mdir).certPem, device: mdev.id, key: mdev.key });
  await until(() => mh.open, 3000);
  await check('with the computer on, "open" drives the browser through the server\'s local endpoint', async () => {
    const t = await tool('computer_browser_open', { url: 'https://example.org/' });
    const calls = fs.readFileSync(abState + '.log', 'utf8');
    return (t === '✓ Example Domain\n  https://example.org/' && calls.includes(`--session godspeed-computer --cdp ${mrelay.cdpPort()} eval setTimeout(function () { location.href = "https://example.org/"; }, 50)`)) || t;
  });
  await check('a page with one slow script is open once its text is there, redirect and all', async () => {
    const m2 = spawn(process.execPath, [path.join(ROOT, 'mcp.js')], {
      env: { ...process.env, FAKE_AB_SLOW: '1', GODSPEED_COMPUTER_DIR: mdir, GODSPEED_COMPUTER_CDP_PORT: String(mrelay.cdpPort()), GODSPEED_COMPUTER_AGENT_BROWSER: `"${process.execPath}" "${fakeAb}"` },
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    const answer = await new Promise(r => {
      let b = ''; m2.stdout.on('data', d => { b += d; const i = b.indexOf('\n'); if (i >= 0) r(JSON.parse(b.slice(0, i))); });
      m2.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'computer_browser_open', arguments: { url: 'https://example.org/secure' } } }) + '\n');
    });
    m2.stdin.end();
    const t = answer.result.content[0].text;
    return (/Log in/.test(t) && /example\.org\/login/.test(t) && /Still loading/.test(t) && !answer.result.isError) || t;
  });
  await check('"stop using my computer" and "use my computer again"', async () => {
    await tool('computer_switch', { on: false });
    const off = /SWITCHED OFF/.test(await tool('computer_browser_read')) && S.isOff(mdir);
    await tool('computer_switch', { on: true });
    return (off && !S.isOff(mdir)) || 'wrong';
  });
  mcp.stdin.end();
  await mrelay.close();

  // ---------------------------------------------------------------------------------------------
  console.log('== the home-network filter');
  const site = http.createServer((req, res) => {
    if (req.url === '/hello') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('hello from a public site'); }
    res.writeHead(302, { location: 'http://10.1.2.3/admin' }); res.end();
  });
  await new Promise(r => site.listen(0, '127.0.0.1', r));
  const filter = await startProxy({});
  const viaProxy = target => new Promise(resolve => {
    const u = new URL(target);
    http.get({ host: '127.0.0.1', port: filter.port, path: target, headers: { host: u.host } }, res => {
      let b = ''; res.on('data', d => { b += d; }); res.on('end', () => resolve({ status: res.statusCode, body: b, blocked: res.headers['x-godspeed'] }));
    }).on('error', e => resolve({ status: 0, body: e.message }));
  });
  const connectVia = hostPort => new Promise(resolve => {
    const s = net.connect(filter.port, '127.0.0.1', () => s.write(`CONNECT ${hostPort} HTTP/1.1\r\nHost: ${hostPort}\r\n\r\n`));
    s.once('data', d => { resolve(d.toString().split('\r\n')[0]); s.destroy(); });
    s.on('error', e => resolve(e.message));
  });
  await check('an allowed site passes through the filter', async () => (await viaProxy(`http://127.0.0.1:${site.address().port}/hello`)).body === 'hello from a public site' || 'blocked');
  await check('the router, by address or by name, gets the "Blocked by Godspeed" page', async () => {
    const a = await viaProxy('http://192.168.178.1/'), b = await viaProxy('http://fritz.box/');
    return (a.status === 403 && /Blocked by Godspeed/.test(a.body) && b.status === 403) || { a: a.status, b: b.status };
  });
  await check('a secure connection to a home address is refused too', async () => /403/.test(await connectVia('192.168.1.1:443')) || 'not refused');
  await check('a public name that leads to a home address is refused (192.168.1.1.nip.io)', async () => {
    const prev = process.env.GODSPEED_COMPUTER_ALLOW_HOSTS; process.env.GODSPEED_COMPUTER_ALLOW_HOSTS = '';
    const r = await connectVia('192.168.1.1.nip.io:443');
    process.env.GODSPEED_COMPUTER_ALLOW_HOSTS = prev;
    return /403/.test(r) || /name not found|502/.test(r) && 'DNS not available here: ' + r || r;
  });
  await filter.close();

  // ---------------------------------------------------------------------------------------------
  console.log('== the pairing key in this computer\'s own store (' + secret.mode() + ')');
  await check('the key is kept and read back', () => {
    const d = path.join(TMP, 'secret');
    secret.store(d, 'k-123_ABC');
    const back = secret.load(d);
    secret.remove(d);
    return (back === 'k-123_ABC' && secret.load(d) === null) || back;
  });

  // ---------------------------------------------------------------------------------------------
  const found = process.argv.includes('--no-browser') ? null : findBrowser();
  if (!found) skip('a whole run through a real browser', process.argv.includes('--no-browser') ? '--no-browser' : 'no Chrome or Edge here');
  else await realRun(found, site);
  site.close();

  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* a browser may still hold a file */ }
  console.log(`\n${passes} passed, ${failures} failed, ${skips} skipped`);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

// A paired helper, a real Chrome or Edge, the relay: what the assistant's browser tools see.
async function realRun(found, site) {
  console.log(`== a whole run through a real ${found.kind}`);
  const headless = process.platform === 'linux' && !process.env.DISPLAY;
  const dir = path.join(TMP, 'real-server');
  const home = path.join(TMP, 'real-home');
  const doorPort = await freePort();
  const rr = startRelay({ dir, doorPort, cdpPort: 0, doorHost: '127.0.0.1', log: quietLog, runWaiting: () => {} });
  await rr.ready;
  const env = { ...process.env, GODSPEED_COMPUTER_HOME: home, GODSPEED_COMPUTER_PORT: String(doorPort), GODSPEED_COMPUTER_DIR: dir };
  if (headless) env.GODSPEED_COMPUTER_HEADLESS = '1';
  process.env.GODSPEED_COMPUTER_PORT = String(doorPort);
  const lineReal = await require('../lib/control').pairLine(dir);
  const helperJs = path.join(ROOT, 'helper.js');
  const runNode = (args) => new Promise(resolve => {
    const p = spawn(process.execPath, [helperJs, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { out += d; });
    p.on('close', code => resolve({ code, out }));
  });
  const pr = await runNode(['pair', lineReal, '--name', 'real test']); // pairs even though the door opens a moment later
  await check('the helper pairs with the code the assistant would send', () => (pr.code === 0 && /Paired/.test(pr.out)) || pr);
  const bad = await runNode(['pair', C.encodePairLine({ host: '127.0.0.1', port: doorPort, fingerprint: 'AA'.repeat(32), code: 'x' })]);
  await check('the helper refuses a server whose key is not the one in the code', () => (bad.code === 4 && /not the one/.test(bad.out)) || bad);
  const helper = spawn(process.execPath, [helperJs, 'run'], { env, stdio: 'ignore' });
  const stopAll = async () => { try { helper.kill(); } catch { /* */ } await runNode(['off']); await rr.close(); };
  try {
    const connected = await until(() => rr.status().connected, 15000, 200);
    await check('the helper connects out to the server', () => connected || 'not connected');
    if (!connected) return;
    const cdpBase = `http://127.0.0.1:${rr.cdpPort()}`;
    const cdp = async () => {
      let v = null;
      for (let i = 0; i < 3 && !(v && v.webSocketDebuggerUrl); i++) v = (await getJson(cdpBase + '/json/version')).body; // a cold first start can be slow
      if (!v || !v.webSocketDebuggerUrl) throw new Error('no browser through the relay: ' + JSON.stringify(v));
      const ws = new WebSocket(v.webSocketDebuggerUrl);
      await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });
      let id = 0; const wait = new Map();
      ws.on('message', m => { const x = JSON.parse(m.toString()); const w = wait.get(x.id); if (w) { wait.delete(x.id); w(x); } });
      const send = (method, params = {}, sessionId) => new Promise(r => { const n = ++id; wait.set(n, r); ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) })); });
      return { ws, send };
    };
    const page = http.createServer((req, res) => {
      if (req.url === '/login') { res.writeHead(200, { 'set-cookie': 'gs_login=yes; Max-Age=3600; Path=/', 'content-type': 'text/html' }); return res.end('<title>login</title>logged in'); }
      if (req.url === '/account') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<title>account</title><p id=c>' + (req.headers.cookie || 'no cookie') + '</p><p id=w></p><script>document.getElementById("w").textContent="webdriver="+navigator.webdriver</script>'); }
      if (req.url === '/to-router') { res.writeHead(302, { location: 'http://10.1.2.3/' }); return res.end(); }
      if (req.url === '/file') { res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="godspeed-download-test.bin"' }); return res.end('x'); }
      res.writeHead(404); res.end();
    });
    await new Promise(r => page.listen(0, '127.0.0.1', r));
    const P = `http://127.0.0.1:${page.address().port}`;
    let c = await cdp();
    const tab = async url => {
      const t = await c.send('Target.createTarget', { url: 'about:blank' });
      const s = await c.send('Target.attachToTarget', { targetId: t.result.targetId, flatten: true });
      const sid = s.result.sessionId;
      await c.send('Page.enable', {}, sid);
      const nav = await c.send('Page.navigate', { url }, sid);
      await sleep(1500);
      return { sid, nav, targetId: t.result.targetId };
    };
    const evalIn = async (sid, expr) => ((await c.send('Runtime.evaluate', { expression: expr, returnByValue: true }, sid)).result || {}).result?.value;
    await tab(P + '/login');
    const acct = await tab(P + '/account');
    await check('a login made in Godspeed Chrome is carried to the page the assistant opens', async () => /gs_login=yes/.test(await evalIn(acct.sid, 'document.getElementById("c").textContent')) || 'no login');
    if (!headless) await check('websites see an ordinary browser, not an automated one', async () => (await evalIn(acct.sid, 'document.getElementById("w").textContent')) === 'webdriver=false' || 'robot flag set');
    const router = await tab('http://192.168.178.1/');
    await check('the server asking for the router is refused by the computer', () => (!!router.nav.error && /home-network/.test(router.nav.error.message)) || router.nav);
    const redirect = await tab(P + '/to-router');
    await check('a page that redirects to the home network gets "Blocked by Godspeed"', async () => /Blocked by Godspeed/.test(await evalIn(redirect.sid, 'document.body.innerText')) || await evalIn(redirect.sid, 'document.body.innerText'));
    const cookies = await c.send('Network.getAllCookies');
    await check('the server cannot read the logins out (cookies)', () => (!!cookies.error && /does not allow/.test(cookies.error.message)) || cookies);
    const dl = path.join(os.homedir(), 'Downloads', 'godspeed-download-test.bin');
    const hadDl = fs.existsSync(dl);
    await tab(P + '/file');
    await sleep(1500);
    await check('a download offered by a page never lands on the computer', () => (hadDl || !fs.existsSync(dl)) || 'downloaded');
    await check('every page the assistant opened is listed on the computer', async () => {
      const r = await runNode(['pages']);
      return (/\/account/.test(r.out) && /BLOCKED http:\/\/10\.1\.2\.3\//.test(r.out)) || r.out;
    });
    await c.send('Browser.close');
    c.ws.close();
    await sleep(1500);
    await check('when the user closes Godspeed Chrome, the next job starts it again', async () => {
      c = await cdp();
      const again = await tab(P + '/account');
      return /gs_login=yes/.test(await evalIn(again.sid, 'document.getElementById("c").textContent')) || 'not restarted with the login';
    });
    c.ws.close();
    await runNode(['pause']);
    await check('Pause disconnects it within seconds', async () => (await until(() => !rr.status().connected, 5000, 100)) || 'still connected');
    await runNode(['resume']);
    await check('Resume connects it again', async () => (await until(() => rr.status().connected, 10000, 100)) || 'not back');
    page.close();
    // leave Godspeed Chrome closed
    try { const k = await cdp(); await k.send('Browser.close'); k.ws.close(); } catch { /* */ }
  } finally {
    await stopAll();
  }
}
