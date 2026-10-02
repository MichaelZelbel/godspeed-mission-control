'use strict';
// Godspeed Chrome: the user's own Chrome (or Edge, which every Windows PC has) started with a
// profile of its own, so the everyday Chrome stays open and untouched.
//
// Controlled through a local control port on 127.0.0.1 that the helper picks and passes as a
// number. NOT port 0 and NOT --remote-debugging-pipe: both make Chrome tell every website "this
// browser is automated" (navigator.webdriver), and Google's login refused such a browser (tested
// 2026-10-02 on Chrome 153). No automation flags either.
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

function exists(p) { try { return !!p && fs.statSync(p).isFile(); } catch { return false; } }

function onPath(name) {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() : null;
}

// { exe, kind: 'chrome' | 'edge' | 'chromium' } or null.
function findBrowser() {
  const forced = process.env.GODSPEED_COMPUTER_BROWSER;
  if (forced) return exists(forced) ? { exe: forced, kind: /edge/i.test(forced) ? 'edge' : 'chrome' } : null;
  const home = os.homedir();
  const c = [];
  if (process.platform === 'win32') {
    const pf = process.env.ProgramFiles || 'C:\\Program Files';
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const lad = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    c.push(['chrome', path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe')],
      ['chrome', path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe')],
      ['chrome', path.join(lad, 'Google', 'Chrome', 'Application', 'chrome.exe')],
      ['edge', path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe')],
      ['edge', path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe')]);
  } else if (process.platform === 'darwin') {
    for (const root of ['/Applications', path.join(home, 'Applications')]) {
      c.push(['chrome', path.join(root, 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome')]);
    }
    for (const root of ['/Applications', path.join(home, 'Applications')]) {
      c.push(['edge', path.join(root, 'Microsoft Edge.app', 'Contents', 'MacOS', 'Microsoft Edge')]);
    }
  } else {
    for (const [kind, name] of [['chrome', 'google-chrome'], ['chrome', 'google-chrome-stable'], ['chromium', 'chromium'],
      ['chromium', 'chromium-browser'], ['edge', 'microsoft-edge']]) {
      const p = onPath(name);
      if (p) c.push([kind, p]);
    }
  }
  const hit = c.find(([, p]) => exists(p));
  return hit ? { exe: hit[1], kind: hit[0] } : null;
}

function getJson(url, timeoutMs = 2000) {
  return new Promise(resolve => {
    const req = http.get(url, { timeout: timeoutMs }, res => {
      let b = '';
      res.on('data', d => { b += d; });
      res.on('end', () => { try { resolve(res.statusCode === 200 ? JSON.parse(b) : null); } catch { resolve(null); } });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

// The control port this profile's Godspeed Chrome was started with (kept beside the profile).
function activePort(profileDir) {
  try {
    const port = Number(fs.readFileSync(path.join(profileDir, 'godspeed-port'), 'utf8').trim());
    return Number.isInteger(port) && port > 0 ? port : null;
  } catch { return null; }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = require('net').createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

// Asks a running Godspeed Chrome to close (used when it was started with another filter port).
async function closeBrowser(port) {
  const v = await getJson(`http://127.0.0.1:${port}/json/version`);
  if (!v || !v.webSocketDebuggerUrl) return;
  const WebSocket = require('../vendor/ws');
  await new Promise(resolve => {
    const ws = new WebSocket(v.webSocketDebuggerUrl);
    const done = () => { try { ws.terminate(); } catch { /* */ } resolve(); };
    ws.on('open', () => ws.send(JSON.stringify({ id: 1, method: 'Browser.close' })));
    ws.on('message', done); ws.on('close', done); ws.on('error', done);
    setTimeout(done, 3000);
  });
  const end = Date.now() + 10000;
  while (Date.now() < end && await getJson(`http://127.0.0.1:${port}/json/version`, 500)) await new Promise(r => setTimeout(r, 200));
}

// A Godspeed Chrome that answers, started if needed. Returns { base, port, kind, pid }.
async function ensureBrowser({ profileDir, proxyPort, headless = !!process.env.GODSPEED_COMPUTER_HEADLESS, minimized = true }) {
  const marker = path.join(profileDir, 'godspeed-filter-port');
  const old = activePort(profileDir);
  if (old && await getJson(`http://127.0.0.1:${old}/json/version`)) {
    let was = null;
    try { was = Number(fs.readFileSync(marker, 'utf8')); } catch { /* */ }
    if (!proxyPort || was === proxyPort) return { base: `http://127.0.0.1:${old}`, port: old, reused: true };
    await closeBrowser(old);
  }
  const found = findBrowser();
  if (!found) throw new Error('Neither Chrome nor Edge was found on this computer');
  fs.mkdirSync(profileDir, { recursive: true });
  const port = await freePort();
  fs.writeFileSync(path.join(profileDir, 'godspeed-port'), String(port));
  const args = [
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    '--no-first-run',
    '--no-default-browser-check',
  ];
  if (proxyPort) args.push(`--proxy-server=http://127.0.0.1:${proxyPort}`, '--proxy-bypass-list=<-loopback>');
  if (headless) args.push('--headless=new');
  // Only for the Linux test stand-in inside a container, which has no user namespaces; never on a user's computer.
  if (process.env.GODSPEED_COMPUTER_NO_SANDBOX === '1') args.push('--no-sandbox');
  else if (minimized) args.push('--start-minimized');
  args.push('about:blank');
  fs.writeFileSync(marker, String(proxyPort || ''));
  const p = spawn(found.exe, args, { detached: true, stdio: 'ignore', windowsHide: false });
  p.unref();
  const end = Date.now() + 30000;
  while (Date.now() < end) {
    if (await getJson(`http://127.0.0.1:${port}/json/version`)) return { base: `http://127.0.0.1:${port}`, port, kind: found.kind, pid: p.pid };
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`${found.kind} did not start within 30 seconds`);
}

module.exports = { findBrowser, ensureBrowser, closeBrowser, getJson, activePort };
