'use strict';
// What the server half does on request, shared by the command (godspeed-computer) and the
// assistant's tools (mcp.js): the connection code, the status, off and on, the page list.
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const C = require('./common');
const S = require('./state');

// The address the user's computer dials: GODSPEED_PUBLIC_HOST when set (a name or an address),
// else the server's public address as the internet sees it, asked once and kept.
function publicHost(dir) {
  const set = (process.env.GODSPEED_PUBLIC_HOST || '').trim();
  if (set) return Promise.resolve(set);
  const cache = path.join(dir, 'public-host');
  try { const h = fs.readFileSync(cache, 'utf8').trim(); if (h) return Promise.resolve(h); } catch { /* ask */ }
  return new Promise((resolve, reject) => {
    const req = https.get(process.env.GODSPEED_COMPUTER_IP_URL || 'https://cloudflare.com/cdn-cgi/trace', { timeout: 8000 }, res => {
      let b = '';
      res.on('data', d => { b += d; });
      res.on('end', () => {
        const m = b.match(/^ip=(.+)$/m);
        if (!m) return reject(new Error('could not learn the server\'s public address'));
        S.ensureDir(dir);
        fs.writeFileSync(cache, m[1].trim() + '\n');
        resolve(m[1].trim());
      });
    });
    req.on('timeout', () => req.destroy(new Error('timed out asking for the public address')));
    req.on('error', reject);
  });
}

async function pairLine(dir = C.serverDir()) {
  const host = await publicHost(dir);
  const { fingerprint } = S.serverCert(dir);
  const port = Number(process.env.GODSPEED_COMPUTER_PORT || C.DOOR_PORT);
  const code = S.newPairCode(dir);
  return C.encodePairLine({ host, port, fingerprint, code });
}

function localStatus(cdpPort = Number(process.env.GODSPEED_COMPUTER_CDP_PORT || C.CDP_PORT)) {
  return new Promise(resolve => {
    const req = http.get(`http://127.0.0.1:${cdpPort}/godspeed/status`, { timeout: 3000 }, res => {
      let b = '';
      res.on('data', d => { b += d; });
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve(null); } });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

async function statusText(dir = C.serverDir()) {
  const st = await localStatus();
  if (!st) return 'The computer link is not running on this server.';
  if (st.off) return 'Switched off: the user said "stop using my computer". Say "use my computer again" to switch it back on.';
  if (st.connected) return `Connected: ${st.computer} is lending Godspeed ${st.browser === 'edge' ? 'Edge' : 'Chrome'} since ${st.since}.`;
  if (!st.paired) return 'No computer is paired yet. The user installs Godspeed on Windows or Mac, ticks "Let your assistant use a browser on this computer", and pastes a connection code from "connect my computer".';
  return 'No computer connected right now: it is off, asleep, paused or offline.';
}

module.exports = { publicHost, pairLine, localStatus, statusText };
