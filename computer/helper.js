#!/usr/bin/env node
'use strict';
// The home half of "your computer lends its browser" (computer use layer 2, D-285).
//
//   node helper.js pair <connection code>   once, with the code the assistant sends in Telegram
//   node helper.js connect [code]           the same, asking for the code, then starts the helper
//   node helper.js run                      at login: keeps one connection out to the server
//   node helper.js pause | resume           the Pause and Resume entries
//   node helper.js off                      unpair this computer and stop
//   node helper.js status | pages           what it is doing, and every page the assistant opened
//   node helper.js uninstall [--keep-profile]
//
// Nothing listens on this computer except Godspeed Chrome's own control port on 127.0.0.1 and
// the home-network filter on 127.0.0.1. The helper opens the only connection, outwards.
const fs = require('fs');
const path = require('path');
const os = require('os');
const tls = require('tls');
const https = require('https');
const WebSocket = require('./vendor/ws');
const C = require('./lib/common');
const secret = require('./lib/secret');
const { ensureBrowser, getJson } = require('./lib/browser');
const { startProxy } = require('./lib/proxy');

const HOME = C.homeDir();
const F = name => path.join(HOME, name);
const PROFILE = process.env.GODSPEED_COMPUTER_PROFILE || F('profile');
const OFF_RETRY_MS = Number(process.env.GODSPEED_COMPUTER_OFF_RETRY_MS || 60000);

function say(s) { process.stdout.write(s + '\n'); }

function logLine(...a) {
  const line = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' ' + a.join(' ');
  if (process.env.GODSPEED_COMPUTER_QUIET !== '1') console.log(line);
  try {
    fs.mkdirSync(HOME, { recursive: true });
    const f = F('helper.log');
    try { if (fs.statSync(f).size > 1 << 20) fs.renameSync(f, f + '.old'); } catch { /* first line */ }
    fs.appendFileSync(f, line + '\n');
  } catch { /* logging must never stop the helper */ }
}

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
function writeJson(f, v) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + '.tmp', JSON.stringify(v, null, 1)); fs.renameSync(f + '.tmp', f); }

// Browser commands the server may never send through this computer: reading the logins out
// (cookies), putting the computer's files into a page, letting downloads in, granting a site the
// camera, microphone or location, or handing a page the browser's controls.
const DENIED = new Set([
  'Network.getAllCookies', 'Network.getCookies', 'Storage.getCookies', 'Network.setCookies', 'Storage.setCookies',
  'DOM.setFileInputFiles', 'Browser.setDownloadBehavior', 'Page.setDownloadBehavior',
  'Browser.grantPermissions', 'Browser.setPermission', 'Target.exposeDevToolsProtocol',
  'Browser.addPrivacySandboxEnrollmentOverride', 'SystemInfo.getProcessInfo',
  'Network.loadNetworkResource', 'IO.read',
]);

function pinCheck(fingerprint) {
  return (host, cert) => (C.normFingerprint(cert.fingerprint256) === fingerprint ? undefined
    : new Error('this server is not the one this computer was paired with'));
}

// --- pair ------------------------------------------------------------------------------------

function fetchCert(host, port) {
  return new Promise((resolve, reject) => {
    const s = tls.connect({ host, port, servername: require('net').isIP(host) ? undefined : host, rejectUnauthorized: false, timeout: 15000 }, () => {
      const c = s.getPeerCertificate(true);
      s.end();
      if (!c || !c.raw) return reject(new Error('no certificate'));
      const pem = '-----BEGIN CERTIFICATE-----\n' + c.raw.toString('base64').match(/.{1,64}/g).join('\n') + '\n-----END CERTIFICATE-----\n';
      resolve(pem);
    });
    s.on('timeout', () => { s.destroy(); reject(new Error('timed out')); });
    s.on('error', reject);
  });
}

function postJson(server, pathName, obj) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(obj);
    const req = https.request({
      host: server.host, port: server.port, path: pathName, method: 'POST', ca: server.certPem,
      checkServerIdentity: pinCheck(server.fingerprint), timeout: 15000,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    }, res => {
      let b = '';
      res.on('data', d => { b += d; });
      res.on('end', () => { let j = {}; try { j = JSON.parse(b); } catch { /* */ } resolve({ status: res.statusCode, body: j }); });
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', reject);
    req.end(body);
  });
}

async function pair(line, name) {
  const p = C.decodePairLine(line);
  if (!p) { say('That is not a connection code from your assistant. Ask it in Telegram: "connect my computer", and copy the whole code it sends.'); return 2; }
  let certPem;
  try {
    // The door opens a moment after the code is made, and a home line can drop a packet: try a few times.
    for (let attempt = 1; ; attempt++) {
      try { certPem = await fetchCert(p.host, p.port); break; } catch (e) {
        if (attempt >= 4) throw e;
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  } catch (e) {
    say(`This computer cannot reach your Godspeed server at ${p.host} (port ${p.port}): ${e.message}. Check the internet connection and try again in a minute.`);
    return 3;
  }
  if (C.fingerprintOfPem(certPem) !== p.fingerprint) {
    say(`The server at ${p.host} is not the one your assistant named, so nothing was sent to it. Ask your assistant for a new code.`);
    return 4;
  }
  const server = { host: p.host, port: p.port, fingerprint: p.fingerprint, certPem };
  let r;
  try { r = await postJson(server, '/v1/pair', { code: p.code, name: name || os.hostname() }); } catch (e) {
    say(`Your Godspeed server did not answer: ${e.message}. Try again in a minute.`);
    return 3;
  }
  if (r.status !== 200 || !r.body.key) { say(r.body.error || `Your Godspeed server said no (${r.status}).`); return 2; }
  secret.store(HOME, r.body.key);
  writeJson(F('server.json'), { ...server, device: r.body.device, name: name || os.hostname(), paired: new Date().toISOString() });
  fs.rmSync(F('paused'), { force: true });
  logLine('paired with', p.host + ':' + p.port);
  say('Paired. Your assistant can now use Godspeed Chrome on this computer, for the sites you log into there.');
  return 0;
}

// --- run -------------------------------------------------------------------------------------

function alive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }

function takeLock() {
  const f = F('run.lock');
  const held = readJson(f, null);
  if (held && held.pid !== process.pid && alive(held.pid)) return false;
  writeJson(f, { pid: process.pid, started: new Date().toISOString() });
  return true;
}

async function run() {
  fs.mkdirSync(HOME, { recursive: true });
  if (!takeLock()) { say('The helper is already running.'); return 0; }
  // Not paired: nothing to do, and not an error (a login agent must not restart it for ever).
  if (!fs.existsSync(F('server.json'))) { say('This computer is not paired with a Godspeed server yet.'); return 0; }

  // The filter keeps the port it had, so a Godspeed Chrome that is already open (started by the
  // helper before an update or a restart) keeps working and keeps its logins; a new port would mean
  // restarting the browser, which drops the logins a site keeps only for the session.
  const onBlocked = (url, why) => { logLine('blocked', url, '-', why); recordPage('BLOCKED ' + url); };
  let previous = 0;
  try { previous = Number(fs.readFileSync(path.join(PROFILE, 'godspeed-filter-port'), 'utf8')) || 0; } catch { /* first start */ }
  let proxy;
  try { proxy = await startProxy({ port: previous, onBlocked }); } catch { proxy = await startProxy({ onBlocked }); }
  let browser = null;          // { base, port, kind }
  let ws = null;
  let lastSeen = 0;
  let wait = 2000;
  let holdUntil = 0;
  let state = 'starting';
  const chans = new Map();

  function recordPage(url) {
    try { fs.appendFileSync(F('pages.log'), new Date().toISOString() + '\t' + url + '\n'); } catch { /* */ }
  }
  const writeStatus = () => writeJson(F('status.json'), {
    state, pid: process.pid, browser: browser ? browser.kind || 'chrome' : null, at: new Date().toISOString(),
  });

  // A connection of the helper's own to Godspeed Chrome that keeps downloads switched off for as
  // long as the browser runs. Nothing a page offers lands on this computer.
  let guard = null;
  async function guardBrowser(b) {
    if (guard && guard.readyState === 1) return;
    const v = await getJson(b.base + '/json/version', 3000);
    if (!v || !v.webSocketDebuggerUrl) return;
    await new Promise(resolve => {
      const g = new WebSocket(v.webSocketDebuggerUrl);
      guard = g;
      // It also writes down every address a page in Godspeed Chrome arrives at, however it got there.
      const seen = new Map();
      g.on('open', () => {
        g.send(JSON.stringify({ id: 1, method: 'Browser.setDownloadBehavior', params: { behavior: 'deny' } }));
        g.send(JSON.stringify({ id: 2, method: 'Target.setDiscoverTargets', params: { discover: true } }));
      });
      g.on('message', raw => {
        resolve();
        let m; try { m = JSON.parse(raw.toString()); } catch { return; }
        const info = m.params && m.params.targetInfo;
        // A page showing a file of this computer is closed at once. Chrome itself keeps web pages and
        // the server's scripts away from files (tested 2026-10-02); this is the second lock.
        if (info && info.type === 'page' && /^file:/i.test(info.url || '')) {
          logLine('closed a page that showed a file of this computer:', info.url);
          recordPage('CLOSED ' + info.url);
          try { g.send(JSON.stringify({ id: 3, method: 'Target.closeTarget', params: { targetId: info.targetId } })); } catch { /* */ }
          return;
        }
        if (!info || info.type !== 'page' || !/^https?:\/\//.test(info.url || '')) return;
        if (seen.get(info.targetId) === info.url) return;
        seen.set(info.targetId, info.url);
        recordPage('shown ' + info.url);
      });
      g.on('close', () => { if (guard === g) guard = null; resolve(); });
      g.on('error', () => resolve());
      setTimeout(resolve, 3000);
    });
  }

  async function theBrowser() {
    if (browser && await getJson(browser.base + '/json/version', 1500)) { await guardBrowser(browser); return browser; }
    browser = await ensureBrowser({ profileDir: PROFILE, proxyPort: proxy.port });
    if (!browser.kind) browser.kind = (readJson(F('status.json'), {}).browser) || 'chrome';
    await guardBrowser(browser);
    logLine('Godspeed Chrome ready (' + (browser.reused ? 'already open' : 'started') + ')');
    return browser;
  }

  function closeAll() { for (const c of chans.values()) c.close(); chans.clear(); }

  function connect() {
    if (fs.existsSync(F('paused'))) { state = 'paused'; writeStatus(); return setTimeout(connect, 1000); }
    if (Date.now() < holdUntil) return setTimeout(connect, 1000);
    const server = readJson(F('server.json'), null);
    const key = server ? secret.load(HOME) : null;
    if (!server || !key) { state = 'unpaired'; writeStatus(); logLine('not paired any more; stopping'); return shutdown(0); }
    state = 'connecting'; writeStatus();
    const sock = new WebSocket(`wss://${server.host.includes(':') ? '[' + server.host + ']' : server.host}:${server.port}/v1/helper`, {
      ca: server.certPem, checkServerIdentity: pinCheck(server.fingerprint),
      headers: { authorization: `Bearer ${server.device}:${key}` }, handshakeTimeout: 15000, maxPayload: 256 << 20,
    });
    ws = sock;
    sock.on('unexpected-response', (req, res) => {
      const why = res.headers['x-godspeed-reason'];
      if (why === 'off') { state = 'off'; logLine('the server says: switched off in Telegram; asking again in a minute'); holdUntil = Date.now() + OFF_RETRY_MS; }
      else if (res.statusCode === 401) { state = 'refused'; logLine('the server does not know this computer any more; pair it again'); holdUntil = Date.now() + 10 * OFF_RETRY_MS; }
      else logLine('the server answered', res.statusCode);
      writeStatus();
      sock.terminate();
    });
    sock.on('open', async () => {
      lastSeen = Date.now(); wait = 2000; state = 'connected'; writeStatus();
      logLine('connected to', server.host);
      let kind = null;
      try { kind = require('./lib/browser').findBrowser()?.kind || null; } catch { /* */ }
      try { sock.send(JSON.stringify({ t: 'hello', protocol: C.PROTOCOL, version: C.VERSION, browser: kind, os: process.platform })); } catch { /* closing; the reconnect follows */ }
    });
    sock.on('error', e => { if (state !== 'off' && state !== 'refused') logLine('connection problem:', e.code || e.message); });
    sock.on('close', () => {
      if (ws !== sock) return;
      closeAll();
      if (state === 'connected') { state = 'reconnecting'; writeStatus(); }
      if (shuttingDown) return;
      const delay = Math.max(wait, holdUntil - Date.now());
      wait = Math.min(wait * 2, 30000);
      setTimeout(connect, delay);
    });
    sock.on('message', async raw => {
      lastSeen = Date.now();
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.t === 'hb') { try { sock.send('{"t":"hb"}'); } catch { /* */ } return; }
      if (m.t === 'replaced') { logLine('another connection to the server took over; waiting half an hour'); holdUntil = Date.now() + 1800000; return; }
      if (m.t === 'off') { logLine('switched off in Telegram'); state = 'off'; holdUntil = Date.now() + OFF_RETRY_MS; writeStatus(); return; }
      if (m.t === 'http') {
        let status = 502, body = '';
        try {
          const b = await theBrowser();
          const r = await fetch(b.base + m.path);
          status = r.status; body = await r.text();
        } catch (e) { body = JSON.stringify({ error: String(e.message || e) }); }
        try { sock.send(JSON.stringify({ t: 'http-res', id: m.id, status, body })); } catch { /* */ }
        return;
      }
      if (m.t === 'open') {
        const queue = [];
        let c = null, gone = false;
        chans.set(m.ch, { send: d => (c && c.readyState === 1 ? c.send(d) : queue.push(d)), close: () => { gone = true; if (c) c.close(); } });
        try {
          const b = await theBrowser();
          if (gone) return;
          c = new WebSocket(`ws://127.0.0.1:${b.port}${m.path}`, { maxPayload: 256 << 20 });
          c.on('open', () => { for (const d of queue.splice(0)) c.send(d); });
          c.on('message', d => { try { sock.send(JSON.stringify({ t: 'd', ch: m.ch, data: d.toString() })); } catch { /* */ } });
          c.on('close', () => { chans.delete(m.ch); try { sock.send(JSON.stringify({ t: 'close', ch: m.ch })); } catch { /* */ } });
          c.on('error', () => {});
        } catch (e) {
          logLine('Godspeed Chrome could not start:', e.message);
          chans.delete(m.ch);
          try { sock.send(JSON.stringify({ t: 'close', ch: m.ch })); } catch { /* */ }
        }
        return;
      }
      if (m.t === 'd') {
        let p = null; try { p = JSON.parse(m.data); } catch { /* pass on */ }
        if (p && DENIED.has(p.method)) {
          logLine('refused the browser command', p.method);
          try { sock.send(JSON.stringify({ t: 'd', ch: m.ch, data: JSON.stringify({ id: p.id, ...(p.sessionId ? { sessionId: p.sessionId } : {}), error: { code: -32000, message: 'Godspeed: this computer does not allow ' + p.method } }) })); } catch { /* */ }
          return;
        }
        const url = C.navTarget(p);
        if (url !== null && url !== undefined) {
          const why = C.refuseUrl(url);
          if (why) {
            logLine('refused', url, '-', why);
            recordPage('REFUSED ' + url);
            try {
              sock.send(JSON.stringify({ t: 'refused', url, why }));
              sock.send(JSON.stringify({ t: 'd', ch: m.ch, data: JSON.stringify({ id: p.id, ...(p.sessionId ? { sessionId: p.sessionId } : {}), error: { code: -32000, message: 'Godspeed: ' + why } }) }));
            } catch { /* */ }
            return;
          }
          if (url && url !== 'about:blank') { logLine('the assistant opened', url); recordPage(url); }
        }
        const ch = chans.get(m.ch);
        if (ch) ch.send(m.data);
        return;
      }
      if (m.t === 'close') { const ch = chans.get(m.ch); chans.delete(m.ch); if (ch) ch.close(); }
    });
  }

  // The helper's own watchdog: no word from the server for 15 s (a sleeping laptop wakes up to a
  // dead connection) means reconnect. Also notices Pause within a second.
  const watch = setInterval(() => {
    if (ws && ws.readyState === 1) {
      if (fs.existsSync(F('paused'))) { logLine('paused'); state = 'paused'; writeStatus(); ws.close(1000, 'paused'); return; }
      if (Date.now() - lastSeen > C.SILENCE_MS) { logLine('the server has been silent; reconnecting'); ws.terminate(); }
    }
  }, 1000);
  const statusTimer = setInterval(writeStatus, 5000);

  let shuttingDown = false;
  async function shutdown(code) {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(watch); clearInterval(statusTimer);
    state = 'stopped'; writeStatus();
    try { if (ws) ws.terminate(); } catch { /* */ }
    try { if (guard) guard.terminate(); } catch { /* */ }
    closeAll();
    await proxy.close();
    try { if (readJson(F('run.lock'), {}).pid === process.pid) fs.rmSync(F('run.lock'), { force: true }); } catch { /* */ }
    process.exit(code);
  }
  process.on('SIGTERM', () => shutdown(0));
  process.on('SIGINT', () => shutdown(0));
  // An unexpected error must not stop the helper: it starts again only at the next login.
  process.on('unhandledRejection', e => logLine('unexpected:', (e && e.message) || String(e)));
  process.on('uncaughtException', e => logLine('unexpected:', (e && e.message) || String(e)));
  connect();
  return new Promise(() => {});
}

// --- switches and reports --------------------------------------------------------------------

function stopRunning() {
  const held = readJson(F('run.lock'), null);
  if (held && held.pid !== process.pid && alive(held.pid)) {
    try { process.kill(held.pid); } catch { /* */ }
  }
  fs.rmSync(F('run.lock'), { force: true });
}

function off() {
  stopRunning();
  secret.remove(HOME);
  fs.rmSync(F('server.json'), { force: true });
  fs.rmSync(F('paused'), { force: true });
  say('This computer is no longer lent to your assistant. Its Godspeed Chrome and your logins there stay until you uninstall.');
  return 0;
}

function status() {
  const server = readJson(F('server.json'), null);
  const st = readJson(F('status.json'), null);
  const held = readJson(F('run.lock'), null);
  const running = !!(held && alive(held.pid));
  if (!server) { say('Not paired: this computer is not lent to an assistant.'); return 0; }
  const paused = fs.existsSync(F('paused'));
  const words = { connected: 'connected', connecting: 'trying to connect', reconnecting: 'reconnecting', paused: 'paused', off: 'switched off from Telegram', refused: 'not known to the server any more', unpaired: 'not paired' };
  say(`Paired with ${server.host}. ${paused ? 'Paused.' : running ? 'Running: ' + (words[st && st.state] || (st && st.state) || 'starting') + '.' : 'Not running.'}`);
  return 0;
}

function pages(n = 30) {
  let lines = [];
  try { lines = fs.readFileSync(F('pages.log'), 'utf8').split('\n').filter(Boolean).slice(-n); } catch { /* none yet */ }
  say(lines.length ? lines.join('\n') : 'Your assistant has not opened any page on this computer yet.');
  return 0;
}

function uninstall(keepProfile) {
  off();
  if (!keepProfile) fs.rmSync(PROFILE, { recursive: true, force: true });
  for (const f of ['status.json', 'pages.log', 'helper.log', 'helper.log.old']) fs.rmSync(F(f), { force: true });
  say(keepProfile ? 'Removed. Godspeed Chrome\'s profile with your logins was kept.' : 'Removed, together with Godspeed Chrome\'s profile and the logins in it.');
  return 0;
}

async function main(argv) {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case 'pair': {
      const i = rest.indexOf('--name');
      const name = i >= 0 ? rest[i + 1] : undefined;
      const code = rest.filter((_, k) => i < 0 || (k !== i && k !== i + 1)).join(' ') || (process.env.GODSPEED_COMPUTER_CODE || '');
      return pair(code, name);
    }
    case 'connect': {
      let code = rest.join(' ');
      if (!code) {
        process.stdout.write('Paste the connection code from your assistant (no code yet? write to it in Telegram: connect my computer): ');
        code = await new Promise(r => {
          let b = '';
          process.stdin.setEncoding('utf8');
          process.stdin.on('data', d => { b += d; if (b.includes('\n')) { process.stdin.pause(); r(b); } });
          process.stdin.on('end', () => r(b));
        });
      }
      const rc = await pair(code);
      if (rc === 0) {
        require('child_process').spawn(process.execPath, [__filename, 'run'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      }
      return rc;
    }
    case 'run': return run();
    case 'pause': fs.mkdirSync(HOME, { recursive: true }); fs.writeFileSync(F('paused'), new Date().toISOString()); say('Paused. Your assistant cannot use this computer until you press Resume.'); return 0;
    case 'resume': fs.rmSync(F('paused'), { force: true }); say('Resumed. Your assistant can use Godspeed Chrome on this computer again.'); return 0;
    case 'off': return off();
    case 'status': return status();
    case 'pages': return pages(Number(rest[0]) || 30);
    case 'uninstall': return uninstall(rest.includes('--keep-profile'));
    default:
      say('Usage: helper.js connect [code] | pair <code> | run | pause | resume | off | status | pages | uninstall [--keep-profile]');
      return cmd ? 1 : 0;
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then(code => { if (typeof code === 'number') process.exit(code); }, e => { say('Error: ' + e.message); process.exit(1); });
}

module.exports = { main, pair };
