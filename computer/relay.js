#!/usr/bin/env node
'use strict';
// The server half of "your computer lends its browser" (computer use layer 2, D-285).
//
// The user's computer opens ONE connection out to this door (TLS, the server's own key,
// which the helper checks; a pairing key, which this checks). The assistant's browser tools
// never see that: they attach to 127.0.0.1:9223 here as if a Chrome ran on the server, and
// every message is carried along the computer's connection to Godspeed Chrome over there.
//
//   door   0.0.0.0:7443   POST /v1/pair, GET /v1/helper (WebSocket), GET /v1/ping
//   local  127.0.0.1:9223 /json/* and WebSockets for the browser tools, /godspeed/status
//
// The door opens only once someone asked for a connection code (godspeed-computer pair).
// "Stop using my computer" (godspeed-computer off) turns every helper away until "on".
// Jobs that waited for the computer run when it connects; a day-old one is dropped with a line.
const https = require('https');
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('./vendor/ws');
const C = require('./lib/common');
const S = require('./lib/state');

const short = (s, n = 140) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));

function startRelay(opts = {}) {
  const dir = opts.dir || C.serverDir();
  const doorPort = opts.doorPort ?? Number(process.env.GODSPEED_COMPUTER_DOOR_PORT || C.DOOR_PORT);
  const doorHost = opts.doorHost || process.env.GODSPEED_COMPUTER_DOOR_HOST || '0.0.0.0';
  const cdpPort = opts.cdpPort ?? Number(process.env.GODSPEED_COMPUTER_CDP_PORT || C.CDP_PORT);
  const log = opts.log || C.log;
  const runWaiting = opts.runWaiting || (() => runWaitingJobs({ dir, log }));

  let helper = null;
  const chans = new Map();
  const httpWait = new Map();
  const failures = new Map();
  let next = 1;
  let door = null;
  let doorAddress = null;
  let cdpAddress = null;
  let closed = false;

  // --- The door the user's computer dials ----------------------------------------------------

  function openDoor() {
    if (door || closed) return;
    const { keyPem, certPem } = S.serverCert(dir);
    door = https.createServer({ key: keyPem, cert: certPem }, onDoorRequest);
    door.on('upgrade', onDoorUpgrade);
    door.on('tlsClientError', () => {});
    door.on('error', e => log('door: cannot listen on', doorPort, '-', e.message));
    door.listen(doorPort, doorHost, () => { doorAddress = door.address(); log('door: open on port', doorAddress.port); });
  }

  function tooManyTries(ip) {
    const recent = (failures.get(ip) || []).filter(t => Date.now() - t < 600000);
    failures.set(ip, recent);
    return recent.length >= 10;
  }

  function onDoorRequest(req, res) {
    const ip = req.socket.remoteAddress;
    const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.method === 'GET' && req.url === '/v1/ping') return send(200, { godspeed: 'computer', protocol: C.PROTOCOL });
    if (req.method !== 'POST' || req.url !== '/v1/pair') return send(404, { error: 'not here' });
    if (tooManyTries(ip)) return send(429, { error: 'Too many wrong codes. Wait ten minutes, then ask your assistant for a new one.' });
    let body = '';
    req.on('data', d => { body += d; if (body.length > 4096) req.destroy(); });
    req.on('end', () => {
      let o = {};
      try { o = JSON.parse(body); } catch { /* answered below */ }
      const dev = o.code ? S.redeemPairCode(dir, String(o.code), o.name) : null;
      if (!dev) {
        failures.get(ip).push(Date.now());
        log('door: a connection code was refused, from', ip);
        return send(403, { error: 'This connection code is not valid any more. Ask your assistant for a new one: "connect my computer".' });
      }
      log('door: paired a computer:', short(o.name || 'computer', 60));
      send(200, { device: dev.id, key: dev.key, protocol: C.PROTOCOL });
    });
  }

  function refuseUpgrade(sock, status, text, reason) {
    sock.end(`HTTP/1.1 ${status} ${text}\r\nX-Godspeed-Reason: ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  }

  const wss = new WebSocket.WebSocketServer({ noServer: true, maxPayload: 256 << 20 });

  function onDoorUpgrade(req, sock, head) {
    const url = new URL(req.url, 'https://door');
    if (url.pathname !== '/v1/helper') return refuseUpgrade(sock, 404, 'Not Found', 'path');
    const m = String(req.headers.authorization || '').match(/^Bearer ([A-Za-z0-9]+):([A-Za-z0-9_-]+)$/);
    const dev = m ? S.checkDevice(dir, m[1], m[2]) : null;
    if (!dev) { log('door: turned away a computer without a valid key, from', req.socket.remoteAddress); return refuseUpgrade(sock, 401, 'Unauthorized', 'unknown'); }
    if (S.isOff(dir)) return refuseUpgrade(sock, 403, 'Forbidden', 'off');
    wss.handleUpgrade(req, sock, head, ws => attach(ws, dev, req.socket.remoteAddress));
  }

  function attach(ws, dev, addr) {
    if (helper) {
      try { helper.ws.send(JSON.stringify({ t: 'replaced' })); } catch { /* gone anyway */ }
      const old = helper;
      drop(old, 'another connection took over');
      old.ws.terminate();
    }
    const h = { ws, dev, addr, since: Date.now(), lastSeen: Date.now(), hello: null };
    helper = h;
    log('door: computer connected:', dev.name, 'from', addr);
    ws.on('message', raw => {
      h.lastSeen = Date.now();
      let m;
      try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.t === 'hb') return;
      if (m.t === 'hello') { h.hello = m; return; }
      if (m.t === 'd') { const c = chans.get(m.ch); if (c && c.readyState === 1) c.send(m.data); return; }
      if (m.t === 'close') { const c = chans.get(m.ch); chans.delete(m.ch); if (c) c.close(); return; }
      if (m.t === 'refused') { log('computer refused:', short(m.url), '-', m.why || ''); return; }
      if (m.t === 'http-res') {
        const w = httpWait.get(m.id); httpWait.delete(m.id);
        if (!w) return;
        clearTimeout(w.timer);
        const body = String(m.body || '').replace(/ws:\/\/127\.0\.0\.1:\d+/g, `ws://127.0.0.1:${cdpLocalPort()}`)
          .replace(/ws=127\.0\.0\.1:\d+/g, `ws=127.0.0.1:${cdpLocalPort()}`);
        w.res.writeHead(m.status || 502, { 'content-type': 'application/json' });
        w.res.end(body);
      }
    });
    ws.on('close', () => drop(h, 'connection closed'));
    ws.on('error', () => {});
    setTimeout(() => { if (helper === h) Promise.resolve(runWaiting()).catch(e => log('waiting jobs:', e.message)); }, 1500);
  }

  function drop(h, why) {
    if (!h || helper !== h) return;
    helper = null;
    for (const c of chans.values()) { try { c.close(1011, 'home computer gone'); } catch { /* closing */ } }
    chans.clear();
    for (const w of httpWait.values()) {
      clearTimeout(w.timer);
      w.res.writeHead(503, { 'content-type': 'application/json' });
      w.res.end(JSON.stringify({ error: 'home computer not connected' }));
    }
    httpWait.clear();
    log('door: computer gone (' + why + ')');
  }

  // Watch the switches and the silence often; send the heartbeat every HEARTBEAT_MS.
  let lastBeatSent = 0;
  const beat = setInterval(() => {
    if (!door && S.isEnabled(dir)) openDoor();
    if (!helper) return;
    if (S.isOff(dir)) {
      const h = helper;
      try { h.ws.send(JSON.stringify({ t: 'off' })); } catch { /* gone */ }
      drop(h, 'switched off with "stop using my computer"');
      setTimeout(() => h.ws.terminate(), 200);
      return;
    }
    if (Date.now() - helper.lastSeen > C.SILENCE_MS) {
      const h = helper;
      drop(h, 'silent for ' + ((Date.now() - h.lastSeen) / 1000).toFixed(1) + ' s');
      h.ws.terminate();
      return;
    }
    if (Date.now() - lastBeatSent >= C.HEARTBEAT_MS) {
      lastBeatSent = Date.now();
      try { helper.ws.send('{"t":"hb"}'); } catch { /* the silence check handles it */ }
    }
  }, Math.max(50, Math.min(1000, Math.floor(C.HEARTBEAT_MS / 5))));

  const expiry = setInterval(() => {
    const dropped = S.expireWaiting(dir);
    for (const j of dropped) deliver(`I dropped a job that waited a whole day for your computer: "${short(j.task)}". Ask me again once your computer is on.`, log);
  }, 10 * 60000);

  // --- The local stand-in for a Chrome ------------------------------------------------------

  const cdpLocalPort = () => (cdpAddress ? cdpAddress.port : cdpPort);

  function status() {
    return {
      connected: !!helper,
      off: S.isOff(dir),
      enabled: S.isEnabled(dir),
      computer: helper ? helper.dev.name : null,
      since: helper ? new Date(helper.since).toISOString() : null,
      browser: helper && helper.hello ? helper.hello.browser || null : null,
      paired: S.devices(dir).length,
      waiting: S.listWaiting(dir).length,
    };
  }

  const cdp = http.createServer((req, res) => {
    if (req.url.startsWith('/godspeed/status')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(status()));
    }
    if (!helper) {
      res.writeHead(503, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: S.isOff(dir) ? 'computer switched off by its owner' : 'home computer not connected' }));
    }
    const id = next++;
    // Long enough for a first, cold start of Godspeed Chrome on a slow computer (the helper waits 40 s).
    const timer = setTimeout(() => {
      const w = httpWait.get(id); httpWait.delete(id);
      if (w) { w.res.writeHead(504); w.res.end('{"error":"the home computer did not answer"}'); }
    }, 45000);
    httpWait.set(id, { res, timer });
    try { helper.ws.send(JSON.stringify({ t: 'http', id, path: req.url })); } catch { /* the timer answers */ }
  });

  const local = new WebSocket.WebSocketServer({ noServer: true, maxPayload: 256 << 20 });
  cdp.on('upgrade', (req, sock, head) => {
    if (!helper) return refuseUpgrade(sock, 503, 'Service Unavailable', 'not-connected');
    local.handleUpgrade(req, sock, head, client => {
      const h = helper;
      if (!h) return client.close(1011, 'home computer gone');
      const ch = next++;
      chans.set(ch, client);
      h.ws.send(JSON.stringify({ t: 'open', ch, path: req.url }));
      client.on('message', data => {
        const text = data.toString();
        let msg = null;
        try { msg = JSON.parse(text); } catch { /* pass it on as it is */ }
        const url = C.navTarget(msg);
        if (url !== null && url !== undefined) {
          const why = C.refuseUrl(url);
          if (why) {
            log('refused to open', short(url), '-', why);
            return client.send(JSON.stringify({ id: msg.id, ...(msg.sessionId ? { sessionId: msg.sessionId } : {}), error: { code: -32000, message: 'Godspeed: ' + why } }));
          }
          if (url && url !== 'about:blank') S.appendPage(dir, url);
        }
        if (helper === h) { try { h.ws.send(JSON.stringify({ t: 'd', ch, data: text })); } catch { /* gone */ } }
      });
      client.on('close', () => { chans.delete(ch); if (helper === h) { try { h.ws.send(JSON.stringify({ t: 'close', ch })); } catch { /* gone */ } } });
      client.on('error', () => {});
    });
  });

  const cdpReady = new Promise((resolve, reject) => {
    cdp.once('error', reject);
    cdp.listen(cdpPort, opts.cdpHost || '127.0.0.1', () => { cdpAddress = cdp.address(); log('local browser endpoint on 127.0.0.1:' + cdpAddress.port); resolve(); });
  });
  if (S.isEnabled(dir)) openDoor();

  return {
    ready: cdpReady,
    status,
    doorPort: () => (doorAddress ? doorAddress.port : null),
    cdpPort: cdpLocalPort,
    async close() {
      closed = true;
      clearInterval(beat); clearInterval(expiry);
      if (helper) { const h = helper; drop(h, 'server stopping'); h.ws.terminate(); }
      await Promise.all([
        new Promise(r => cdp.close(() => r())),
        door ? new Promise(r => { door.close(() => r()); door.closeAllConnections?.(); }) : null,
      ]);
    },
  };
}

// --- Jobs that waited for the computer -------------------------------------------------------

function words(cmd) {
  return String(cmd).match(/"[^"]*"|\S+/g).map(s => s.replace(/^"|"$/g, ''));
}

function run(cmd, args, input, timeoutMs) {
  return new Promise(resolve => {
    const [bin, ...pre] = words(cmd);
    let out = '', err = '';
    let p;
    try { p = spawn(bin, [...pre, ...args], { stdio: ['pipe', 'pipe', 'pipe'] }); } catch (e) { return resolve({ code: -1, out: '', err: e.message }); }
    const timer = setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* */ } }, timeoutMs);
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; });
    p.on('error', e => { clearTimeout(timer); resolve({ code: -1, out, err: e.message }); });
    p.on('close', code => { clearTimeout(timer); resolve({ code, out, err }); });
    if (input !== null) p.stdin.end(input); else p.stdin.end();
  });
}

const hermesCmd = () => process.env.GODSPEED_COMPUTER_HERMES || 'hermes';

async function deliver(text, log = C.log) {
  const r = await run(hermesCmd(), ['send', '-t', 'telegram', '-s', 'Godspeed Mission Control', '-q'], text + '\n', 120000);
  if (r.code !== 0) log('could not send to Telegram (exit ' + r.code + '):', short(r.err, 200));
  return r.code === 0;
}

let runningJobs = false;
async function runWaitingJobs({ dir, log = C.log }) {
  if (runningJobs) return;
  runningJobs = true;
  try {
    const { due, expired } = S.takeWaiting(dir);
    for (const j of expired) await deliver(`I dropped a job that waited a whole day for your computer: "${short(j.task)}". Ask me again once your computer is on.`, log);
    for (const j of due) {
      log('running a job that waited for the computer:', j.id);
      const prompt = 'Earlier the user\'s own computer was off or asleep, so this job had to wait. The computer is back now. '
        + 'Do the job, using the computer_browser tools for anything that needs the user\'s logins. '
        + 'Then reply with the result for the user in one or two plain sentences, starting with "Your computer is back, so".\n\n'
        + 'The job: ' + j.task;
      const godspeed = process.env.GODSPEED || require('path').join(process.env.HOME || '', 'godspeed');
      const r = await run(hermesCmd(), ['-z', prompt, '--in', godspeed], null, 15 * 60000);
      const answer = r.code === 0 ? r.out.trim() : '';
      await deliver(answer || `Your computer is back, but the job that waited for it did not finish: "${short(j.task)}". Ask me again.`, log);
    }
  } finally {
    runningJobs = false;
  }
}

if (require.main === module) {
  // What the connection code must name, from the container's settings, for the tools Hermes starts
  // (they may not see the container's environment).
  S.writeJson(require('path').join(C.serverDir(), 'door.json'), {
    port: Number(process.env.GODSPEED_COMPUTER_PORT || C.DOOR_PORT), host: (process.env.GODSPEED_PUBLIC_HOST || '').trim(),
  });
  const relay = startRelay();
  relay.ready.catch(e => { C.log('cannot start:', e.message); process.exit(1); });
  const stop = () => relay.close().then(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

module.exports = { startRelay, runWaitingJobs, deliver };
