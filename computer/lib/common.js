'use strict';
// Shared by the server half (relay.js, mcp.js, godspeed-computer) and the home half (helper.js)
// of "your computer lends its browser" (computer use layer 2, D-285). No dependencies.

const crypto = require('crypto');
const net = require('net');
const path = require('path');
const os = require('os');

const PROTOCOL = 1;
const VERSION = '1.0.0';
const DOOR_PORT = 7443;          // inside the container; the host publishes GODSPEED_COMPUTER_PORT
const CDP_PORT = 9223;           // the server's local stand-in for a Chrome, 127.0.0.1 only
const PAIR_CODE_MINUTES = 30;   // a fresh PC can spend a while installing Git and Node first
const WAIT_HOURS = 24;

// Timers can be shortened for tests; the defaults are the tested ones (5 s beat, 15 s silence).
const num = (v, d) => (v && /^\d+$/.test(v) ? Number(v) : d);
const HEARTBEAT_MS = num(process.env.GODSPEED_COMPUTER_HB_MS, 5000);
const SILENCE_MS = num(process.env.GODSPEED_COMPUTER_SILENCE_MS, 15000);

function log(...a) {
  console.log(new Date().toISOString().replace('T', ' ').slice(0, 19), ...a);
}

// --- Home network --------------------------------------------------------------------------
// The server must never reach the router, a printer or a file server through the user's
// computer. These are the addresses that are not the public internet.

function v4ToInt(ip) {
  return ip.split('.').reduce((a, b) => (a << 8) + Number(b), 0) >>> 0;
}
const V4_HOME = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
].map(([base, bits]) => [v4ToInt(base), bits]);

function isHomeNetworkIp(ip) {
  if (!ip) return true;
  ip = String(ip).replace(/^\[|\]$/g, '').toLowerCase();
  const kind = net.isIP(ip);
  if (kind === 4) {
    const n = v4ToInt(ip);
    return V4_HOME.some(([base, bits]) => (n >>> (32 - bits)) === (base >>> (32 - bits)));
  }
  if (kind === 6) {
    const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/) || ip.match(/^64:ff9b::(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isHomeNetworkIp(mapped[1]);
    if (ip === '::' || ip === '::1') return true;
    const first = parseInt(ip.split(':')[0] || '0', 16);
    if ((first & 0xfe00) === 0xfc00) return true;   // fc00::/7 unique local
    if ((first & 0xffc0) === 0xfe80) return true;   // fe80::/10 link local
    if ((first & 0xff00) === 0xff00) return true;   // multicast
    return false;
  }
  return true; // not an address at all: treat as unsafe
}

const HOME_SUFFIXES = ['localhost', 'local', 'lan', 'home', 'internal', 'intranet', 'corp', 'home.arpa', 'fritz.box', 'localdomain'];

function allowedForTests(host) {
  const list = (process.env.GODSPEED_COMPUTER_ALLOW_HOSTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return list.includes(String(host).toLowerCase());
}

// A name or an address that belongs to the home network (by its spelling; the proxy also
// checks what a name resolves to).
function isHomeNetworkHost(host) {
  if (!host) return true;
  host = String(host).replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (allowedForTests(host)) return false;
  if (net.isIP(host)) return isHomeNetworkIp(host);
  if (!host.includes('.')) return true; // "router", "nas", "printer"
  return HOME_SUFFIXES.some(s => host === s || host.endsWith('.' + s));
}

// Why a URL may not be opened through the user's computer, or null when it may.
function refuseUrl(url) {
  if (url === undefined || url === null || url === '' || url === 'about:blank') return null;
  let u;
  try { u = new URL(url); } catch { return 'not a web address'; }
  if (u.protocol === 'data:') return null;
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'only web pages may be opened, not ' + u.protocol.replace(':', '') + ' addresses';
  if (isHomeNetworkHost(u.hostname)) return 'home-network addresses are not allowed';
  return null;
}

// --- The connection code ---------------------------------------------------------------------
// One line the assistant sends in Telegram and the installer asks for. It carries where the
// server is, the server's own key (so the helper never talks to anyone else) and a one-time code.

const LINE_PREFIX = 'godspeed1.';

function encodePairLine({ host, port, fingerprint, code }) {
  const body = Buffer.from(JSON.stringify({ h: host, p: port, f: fingerprint, c: code })).toString('base64url');
  return LINE_PREFIX + body;
}

function decodePairLine(text) {
  const m = String(text || '').replace(/\s+/g, '').match(/godspeed1\.([A-Za-z0-9_-]+)/);
  if (!m) return null;
  try {
    const o = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'));
    if (!o.h || !o.p || !o.f || !o.c) return null;
    const port = Number(o.p);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    return { host: String(o.h), port, fingerprint: normFingerprint(o.f), code: String(o.c) };
  } catch {
    return null;
  }
}

function normFingerprint(f) {
  return String(f || '').replace(/[^0-9a-fA-F]/g, '').toUpperCase();
}

function fingerprintOfPem(pem) {
  return normFingerprint(new crypto.X509Certificate(pem).fingerprint256);
}

function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

function sameSecret(a, b) {
  const x = Buffer.from(sha256(a)), y = Buffer.from(sha256(b));
  return crypto.timingSafeEqual(x, y);
}

function randomCode(bytes) {
  return crypto.randomBytes(bytes).toString('base64url');
}

// Where the home half keeps its files, per system.
function homeDir() {
  if (process.env.GODSPEED_COMPUTER_HOME) return process.env.GODSPEED_COMPUTER_HOME;
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Godspeed', 'computer');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Godspeed', 'computer');
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'godspeed', 'computer');
}

// Where the server half keeps its files (the container's volume).
function serverDir() {
  return process.env.GODSPEED_COMPUTER_DIR || path.join(process.env.HOME || os.homedir(), '.godspeed', 'computer');
}

module.exports = {
  PROTOCOL, VERSION, DOOR_PORT, CDP_PORT, PAIR_CODE_MINUTES, WAIT_HOURS, HEARTBEAT_MS, SILENCE_MS,
  log, isHomeNetworkIp, isHomeNetworkHost, refuseUrl, encodePairLine, decodePairLine,
  normFingerprint, fingerprintOfPem, sha256, sameSecret, randomCode, homeDir, serverDir,
};
