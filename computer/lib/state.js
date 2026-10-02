'use strict';
// The server half's files, all in one folder of the container's volume:
//   server-key.pem, server-cert.pem   the door's own key, which every paired helper checks
//   enabled                           the door listens only once a connection code was asked for
//   pair-codes.json                   one-time codes (hashes only), ten minutes each
//   devices.json                      paired computers (hashes of their keys only)
//   off                               "stop using my computer": the door turns every helper away
//   pages.log                         every address the assistant opened on the computer
//   waiting.json                      jobs that wait for the computer to come back
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { PAIR_CODE_MINUTES, WAIT_HOURS, sha256, randomCode, fingerprintOfPem } = require('./common');

const now = () => (process.env.GODSPEED_COMPUTER_NOW ? Number(process.env.GODSPEED_COMPUTER_NOW) : Date.now());

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 1), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

// --- The door's own key ----------------------------------------------------------------------

function serverCert(dir) {
  ensureDir(dir);
  const keyFile = path.join(dir, 'server-key.pem'), certFile = path.join(dir, 'server-cert.pem');
  if (!fs.existsSync(keyFile) || !fs.existsSync(certFile)) {
    // The key is made here; openssl only signs the certificate, which every version can do.
    const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    fs.writeFileSync(keyFile + '.tmp', privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    const r = spawnSync(process.env.GODSPEED_COMPUTER_OPENSSL || 'openssl', [
      'req', '-x509', '-new', '-key', keyFile + '.tmp', '-days', '3650', '-subj', '/CN=godspeed-computer', '-out', certFile + '.tmp',
    ], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error('could not make the door key with openssl: ' + (r.stderr || r.error || '').toString().trim());
    fs.renameSync(keyFile + '.tmp', keyFile);
    fs.renameSync(certFile + '.tmp', certFile);
  }
  const certPem = fs.readFileSync(certFile, 'utf8');
  return { keyPem: fs.readFileSync(keyFile, 'utf8'), certPem, fingerprint: fingerprintOfPem(certPem) };
}

// --- Switches --------------------------------------------------------------------------------

const isEnabled = dir => fs.existsSync(path.join(dir, 'enabled'));
function enable(dir) { ensureDir(dir); fs.writeFileSync(path.join(dir, 'enabled'), new Date(now()).toISOString() + '\n'); }
const isOff = dir => fs.existsSync(path.join(dir, 'off'));
function setOff(dir, off) {
  ensureDir(dir);
  const f = path.join(dir, 'off');
  if (off) fs.writeFileSync(f, new Date(now()).toISOString() + '\n');
  else fs.rmSync(f, { force: true });
}

// --- One-time connection codes ---------------------------------------------------------------

function newPairCode(dir) {
  const file = path.join(dir, 'pair-codes.json');
  const codes = readJson(file, []).filter(c => c.expires > now());
  const code = randomCode(18);
  codes.push({ hash: sha256(code), expires: now() + PAIR_CODE_MINUTES * 60000 });
  writeJson(file, codes);
  enable(dir);
  return code;
}

// A code works once. Returns { id, key } for the new computer, or null.
function redeemPairCode(dir, code, name) {
  const file = path.join(dir, 'pair-codes.json');
  const codes = readJson(file, []);
  const h = sha256(code);
  const hit = codes.find(c => c.hash === h && c.expires > now());
  writeJson(file, codes.filter(c => c.hash !== h && c.expires > now()));
  if (!hit) return null;
  const id = 'c' + crypto.randomBytes(4).toString('hex');
  const key = randomCode(32);
  const devs = readJson(path.join(dir, 'devices.json'), []);
  devs.push({ id, name: String(name || 'computer').slice(0, 80), keyHash: sha256(key), paired: new Date(now()).toISOString() });
  writeJson(path.join(dir, 'devices.json'), devs);
  return { id, key };
}

function checkDevice(dir, id, key) {
  const dev = readJson(path.join(dir, 'devices.json'), []).find(d => d.id === id);
  if (!dev || !key) return null;
  const a = Buffer.from(dev.keyHash), b = Buffer.from(sha256(key));
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? dev : null;
}

const devices = dir => readJson(path.join(dir, 'devices.json'), []);

// --- What the assistant opened ---------------------------------------------------------------

function appendPage(dir, url) {
  ensureDir(dir);
  const file = path.join(dir, 'pages.log');
  fs.appendFileSync(file, new Date(now()).toISOString() + '\t' + url + '\n');
  try {
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    if (lines.length > 1000) fs.writeFileSync(file, lines.slice(-500).join('\n') + '\n');
  } catch { /* keep going */ }
}

function readPages(dir, n = 50) {
  try { return fs.readFileSync(path.join(dir, 'pages.log'), 'utf8').split('\n').filter(Boolean).slice(-n); } catch { return []; }
}

// --- Jobs that wait for the computer ---------------------------------------------------------

function addWaiting(dir, task) {
  const file = path.join(dir, 'waiting.json');
  const jobs = readJson(file, []);
  const job = { id: 'w' + crypto.randomBytes(3).toString('hex'), task: String(task).slice(0, 4000), created: now() };
  jobs.push(job);
  writeJson(file, jobs);
  return job;
}

const listWaiting = dir => readJson(path.join(dir, 'waiting.json'), []);

// Takes every waiting job out of the file: the ones to run now, and the ones a day old.
function takeWaiting(dir) {
  const file = path.join(dir, 'waiting.json');
  const jobs = readJson(file, []);
  if (!jobs.length) return { due: [], expired: [] };
  writeJson(file, []);
  const limit = now() - WAIT_HOURS * 3600000;
  return { due: jobs.filter(j => j.created >= limit), expired: jobs.filter(j => j.created < limit) };
}

// Drops jobs older than a day without the computer coming back.
function expireWaiting(dir) {
  const file = path.join(dir, 'waiting.json');
  const jobs = readJson(file, []);
  const limit = now() - WAIT_HOURS * 3600000;
  const expired = jobs.filter(j => j.created < limit);
  if (expired.length) writeJson(file, jobs.filter(j => j.created >= limit));
  return expired;
}

module.exports = {
  serverCert, isEnabled, enable, isOff, setOff, newPairCode, redeemPairCode, checkDevice, devices,
  appendPage, readPages, addWaiting, listWaiting, takeWaiting, expireWaiting, readJson, writeJson, ensureDir,
};
