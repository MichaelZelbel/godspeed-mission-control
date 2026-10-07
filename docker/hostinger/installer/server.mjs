import http from 'node:http';
import net from 'node:net';
import dns from 'node:dns';
import fs from 'node:fs';
import path from 'node:path';

import { fileURLToPath } from 'node:url';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { composeFor } from './compose.mjs';

const secret = () => randomBytes(32).toString('hex');
const digest = value => createHash('sha256').update(String(value || '')).digest('hex');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const BASE = '/godspeed-install';
const assets = fileURLToPath(new URL('./public/', import.meta.url));
const TTL = 24 * 3600000;
// Limits since 6 October 2026. Before, the Origin header (which any script can
// type) was the only gate, and 100 jobs kept for 24 hours were a global cap: a
// script blocked real buyers for a day. Now an installation nobody deploys (its
// Compose file never fetched) goes after an hour, one address holds at most
// five of those and starts at most twenty a day, and the overall rate is
// generous.
const UNDEPLOYED_TTL = 3600000, PER_ADDRESS = 5, PER_ADDRESS_DAY = 20, PER_MINUTE = 30, MOST = 10000;
// The client is the address Caddy, on this server or its Docker network,
// names in X-Forwarded-For; anyone else's header is ignored.
const proxies = new net.BlockList();
for (const [address, bits, type] of [['127.0.0.0', 8, 'ipv4'], ['10.0.0.0', 8, 'ipv4'], ['172.16.0.0', 12, 'ipv4'], ['192.168.0.0', 16, 'ipv4'], ['::1', 128, 'ipv6'], ['fc00::', 7, 'ipv6']]) proxies.addSubnet(address, bits, type);
const plainIP = value => { const text = String(value || '').trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, ''); return net.isIP(text) ? text : null; };
const isProxy = ip => !!ip && proxies.check(ip, net.isIPv6(ip) ? 'ipv6' : 'ipv4');
export function clientAddress(req) {
  const peer = plainIP(req.socket?.remoteAddress);
  if (!peer || !isProxy(peer)) return peer || 'unknown';
  const hops = String(req.headers['x-forwarded-for'] || '').split(',').map(plainIP);
  for (let i = hops.length - 1; i >= 0; i--) { if (!hops[i]) break; if (!isProxy(hops[i])) return hops[i]; }
  return peer;
}
// For the limits, an IPv6 client is its whole /64 network: a single customer is handed a
// /64, so one address and its neighbours must count as one (otherwise a script walks a /64
// for free). IPv4 stands alone. Added 7 October 2026.
export function clientGroup(ip) {
  if (!ip || !net.isIPv6(ip)) return ip || 'unknown';
  try {
    const [head, tail = ''] = ip.split('::');
    const h = head ? head.split(':') : [], t = tail ? tail.split(':') : [];
    const full = [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
    return full.slice(0, 4).map(x => (parseInt(x || '0', 16) & 0xffff).toString(16)).join(':') + '::/64';
  } catch { return ip; }
}
// A claimed server's callback reply is read with a hard cap. A 64 MB reply under the
// service's MemoryMax=96M crashed the Restart=on-failure coordinator, and the job persisted
// so each restart re-crashed (fixed 7 October 2026). The real reply is a one-line invitation.
const CALLBACK_REPLY_MAX = 8 * 1024;
async function readBounded(response, limit = CALLBACK_REPLY_MAX) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) throw new Error('Reply too large');
  if (!response.body) { const text = await response.text(); if (text.length > limit) throw new Error('Reply too large'); return text; }
  const reader = response.body.getReader(); let size = 0; const parts = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error('Reply too large');
      parts.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
    }
  } finally { try { await reader.cancel(); } catch { /* already closed */ } }
  return Buffer.concat(parts).toString('utf8');
}
// A hostname's A and AAAA records. Returns [] when the name definitively does not exist (so a
// bogus hostname is refused) and throws on a transient resolver failure (so a real deploy is
// not failed on a DNS blip). Added 7 October 2026 for the /api/ready source check.
async function defaultResolveHost(hostname) {
  const settled = await Promise.allSettled([dns.promises.resolve4(hostname), dns.promises.resolve6(hostname)]);
  const ips = settled.flatMap(r => r.status === 'fulfilled' ? r.value : []);
  if (ips.length) return ips;
  if (settled.every(r => r.status === 'rejected' && ['ENOTFOUND', 'ENODATA'].includes(r.reason?.code))) return [];
  throw new Error('Callback hostname could not be resolved');
}
// Compare two IP strings by value (IPv6 expanded to its full form), ignoring notation.
function canonIP(value) {
  const ip = plainIP(value);
  if (!ip) return null;
  if (!net.isIPv6(ip)) return ip;
  try {
    const [head, tail = ''] = ip.split('::');
    const h = head ? head.split(':') : [], t = tail ? tail.split(':') : [];
    const full = [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
    return full.map(x => (parseInt(x || '0', 16) & 0xffff).toString(16).padStart(4, '0')).join(':');
  } catch { return ip; }
}
const sameAddress = (a, b) => { const x = canonIP(a); return !!x && x === canonIP(b); };

export function createInstaller({ directory, origin, fetcher = fetch, now = Date.now, testing = false, hostnameFile, coordinatorProxy, allowedOrigins = [], verifyCallbackHost = !testing, resolveHost = defaultResolveHost }) {
  if (!testing && !origin.startsWith('https://')) throw new Error('HTTPS required');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 }); fs.chmodSync(directory, 0o700);
  const apiOrigin = new URL(origin).origin;
  const approved = new Set([apiOrigin, 'https://godspeedmissioncontrol.com', 'https://godspeedmissioncontrol.lovable.app', ...allowedOrigins]);
  const jobs = new Map(), busy = new Map(); let created = [], starts = [];
  const file = id => path.join(directory, id + '.json');
  // The per-address limits must survive a restart: an attacker used to reset them by
  // crashing the service (Restart=on-failure). They live in the private volume, keyed by a
  // salted hash of the client's /64 (IPv6) or address (IPv4), never the address itself. A
  // job's own "address" field is that same salted id, so a reloaded job still counts toward
  // its address's cap. Added 7 October 2026.
  const limitsFile = path.join(directory, 'limits.json');
  let salt = '';
  try { const saved = JSON.parse(fs.readFileSync(limitsFile, 'utf8')); if (typeof saved.salt === 'string') salt = saved.salt; if (Array.isArray(saved.starts)) starts = saved.starts.filter(s => s && typeof s.address === 'string' && s.at > now() - 86400000); } catch { /* first run or unreadable: start fresh */ }
  salt ||= randomBytes(16).toString('hex');
  const addressId = req => digest(salt + '\0' + clientGroup(clientAddress(req)));
  const saveLimits = () => { const temp = limitsFile + '.tmp'; fs.writeFileSync(temp, JSON.stringify({ salt, starts }), { mode: 0o600 }); fs.renameSync(temp, limitsFile); };
  const write = job => { const temp = file(job.id) + '.tmp'; fs.writeFileSync(temp, JSON.stringify(job), { mode: 0o600 }); fs.renameSync(temp, file(job.id)); };
  // "deployed" governs expiry: a Compose file Hostinger fetched is kept its full day.
  // "bound" governs the undeployed cap: only the authenticated hostname callback counts, so
  // fetching your own Compose link no longer buys an exemption from the per-address cap.
  const deployed = job => !!(job.fetched || job.hostname || job.state !== 'waiting');
  const bound = job => !!(job.hostname || job.state === 'starting' || job.state === 'ready');
  const expired = job => job.created + TTL < now() || (!deployed(job) && job.created + UNDEPLOYED_TTL < now());
  for (const name of fs.readdirSync(directory)) if (/^[a-f0-9]{64}\.json$/.test(name)) {
    const job = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')); jobs.set(job.id, job);
  }
  saveLimits();
  function clean() {
    for (const [id, job] of jobs) if (expired(job)) { jobs.delete(id); fs.unlinkSync(file(id)); }
  }
  const timer = setInterval(clean, 60000); timer.unref(); clean();
  function send(res, status, value, type = 'application/json') {
    res.writeHead(status, { 'content-type': type + '; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' });
    res.end(typeof value === 'string' ? value : JSON.stringify(value));
  }
  async function input(req) {
    let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 2048) throw new Error('Request too large'); }
    return body ? JSON.parse(body) : {};
  }
  async function finish(job) {
    if (job.url || !job.hostname || !job.bootstrap) return;
    const target = testing && job.hostname === 'localhost' ? 'https://localhost' : `https://${job.hostname}`;
    // Only a callback authenticated with the private configuration can set this host.
    try {
      const response = await fetcher(target + '/api/auth/bootstrap', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: job.bootstrap }), redirect: 'error', signal: AbortSignal.timeout(10000),
      });
      if (response.status === 409) { job.url = target + '/login'; job.state = 'ready'; write(job); return; }
      if (!response.ok) return;
      // Read at most a few KB: a claimed server that floods the reply cannot grow the
      // coordinator's memory. An oversized reply throws and is caught below, so the next
      // poll simply retries. (7 October 2026)
      const invitation = JSON.parse(await readBounded(response));
      if (!/^\/setup#invite=[a-f0-9]{64}$/.test(invitation.path)) return;
      job.url = target + invitation.path; job.state = 'ready'; write(job);
    } catch { /* HTTPS may still be starting. The next poll retries without redeploying. */ }
  }
  const server = http.createServer(async (req, res) => {
    try {
      const requestOrigin = req.headers.origin;
      if (requestOrigin) {
        const localPreview = testing && /^http:\/\/(127\.0\.0\.1|localhost):[0-9]+$/.test(requestOrigin);
        if (!approved.has(requestOrigin) && !localPreview) return send(res, 403, { error: 'Open the Godspeed installation page to continue.' });
        res.setHeader('access-control-allow-origin', requestOrigin); res.setHeader('vary', 'Origin');
        res.setHeader('access-control-allow-headers', 'content-type,authorization'); res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
      }
      if (req.method === 'OPTIONS') return send(res, 204, '');
      const url = new URL(req.url, origin), route = url.pathname;
      if (route === BASE + '/health' && req.method === 'GET') return send(res, 200, { ok: true });
      if ((route === BASE || route === BASE + '/') && req.method === 'GET') {
        return send(res, 200, fs.readFileSync(path.join(assets, 'index.html'), 'utf8'), 'text/html');
      }
      if (route.startsWith(BASE + '/assets/') && req.method === 'GET') {
        const name = route.slice((BASE + '/assets/').length);
        if (!/^[a-zA-Z0-9._-]+$/.test(name)) return send(res, 404, { error: 'Not found' });
        const assetFile = path.join(assets, name);
        if (!fs.existsSync(assetFile)) return send(res, 404, { error: 'Not found' });
        const type = name.endsWith('.css') ? 'text/css' : name.endsWith('.mjs') ? 'text/javascript' : name.endsWith('.woff2') ? 'font/woff2' : name.endsWith('.png') ? 'image/png' : 'image/webp';
        res.writeHead(200, { 'content-type': type, 'cache-control': 'public, max-age=3600', 'x-content-type-options': 'nosniff' }); return res.end(fs.readFileSync(assetFile));
      }
      if (route === BASE + '/api/start' && req.method === 'POST') {
        if (!requestOrigin || !approved.has(requestOrigin) && !(testing && /^http:\/\/(127\.0\.0\.1|localhost):[0-9]+$/.test(requestOrigin))) return send(res, 403, { error: 'Open the Godspeed installation page to continue.' });
        await input(req); clean(); const at = now(), address = addressId(req);
        created = created.filter(t => t > at - 60000); starts = starts.filter(s => s.at > at - 86400000);
        if ([...jobs.values()].filter(j => j.address === address && !bound(j)).length >= PER_ADDRESS || starts.filter(s => s.address === address).length >= PER_ADDRESS_DAY) return send(res, 429, { error: 'This connection has started several installations. Finish one of them, or try again later.' });
        if (jobs.size >= MOST || created.length >= PER_MINUTE) return send(res, 429, { error: 'Installations are busy. Please try again in one minute.' });
        created.push(at); starts.push({ address, at }); saveLimits();
        const composeKey = secret(), browserKey = secret(), callback = secret();
        // No setup code here: the server makes its own and sends it with the callback.
        const job = { id: secret(), created: at, state: 'waiting', address, composeHash: digest(composeKey), browserHash: digest(browserKey), callbackHash: digest(callback), callback };
        jobs.set(job.id, job); write(job);
        const config = `${origin}/compose/${job.id}/${composeKey}`;
        const checkout = new URL('https://www.hostinger.com/docker-hosting'); checkout.searchParams.set('compose_url', config); checkout.searchParams.set('REFERRALCODE', 'GHNMICHAEJC8'); checkout.hash = 'pricing';
        return send(res, 201, { id: job.id, key: browserKey, checkout: checkout.toString() });
      }
      const config = route.match(/^\/godspeed-install\/compose\/([a-f0-9]{64})\/([a-f0-9]{64})$/);
      if (config && req.method === 'GET') {
        const job = jobs.get(config[1]);
        // Spent once the server has called back: the link then opens nothing.
        if (!job || expired(job) || job.hostname || !equal(job.composeHash, digest(config[2]))) return send(res, 404, { error: 'Installation link has expired.' });
        job.fetched ||= now(); job.state = 'prepared'; write(job);
        return send(res, 200, composeFor(job, { origin, testing, hostnameFile, coordinatorProxy }), 'text/yaml');
      }
      const ready = route.match(/^\/godspeed-install\/api\/ready\/([a-f0-9]{64})$/);
      if (ready && req.method === 'POST') {
        const job = jobs.get(ready[1]), key = req.headers.authorization?.replace(/^Bearer /, '');
        if (!job || expired(job) || !equal(job.callbackHash, digest(key))) return send(res, 401, { error: 'Installation authorization was not accepted.' });
        const data = await input(req);
        if (!/^srv[0-9]+\.hstgr\.cloud$/.test(data.hostname || '') && !(testing && data.hostname === 'localhost')) return send(res, 400, { error: 'The server address could not be verified.' });
        // The callback secret travels inside the Compose link (the buyer's browser, and
        // Hostinger), so a stranger who scraped it must not bind the job to a server that is
        // not the one the claimed hostname points to. Require the callback's source address to
        // be one the hostname resolves to. A transient DNS failure is allowed (the real server
        // retries for ~15 minutes); a name that does not resolve at all is refused. Disable with
        // GODSPEED_INSTALL_VERIFY_HOST=0 if a deployment's DNS makes it impractical.
        if (verifyCallbackHost && !(testing && data.hostname === 'localhost')) {
          let okHost;
          try { const addrs = await resolveHost(data.hostname); okHost = addrs.length > 0 && addrs.some(ip => sameAddress(ip, clientAddress(req))); }
          catch { okHost = true; }
          if (!okHost) return send(res, 403, { error: 'This installation can only be claimed from its own server.' });
        }
        if (job.hostname && job.hostname !== data.hostname) return send(res, 409, { error: 'This installation is already assigned to a different server.' });
        // The first callback binds the server and its setup code; a later one cannot change either.
        if (!job.bootstrap && !/^[a-f0-9]{64}$/.test(data.setup || '')) return send(res, 400, { error: 'The server did not send its setup code.' });
        job.hostname = data.hostname; job.bootstrap ||= data.setup; job.state = job.url ? 'ready' : 'starting'; write(job);
        return send(res, 202, { ok: true });
      }
      const status = route.match(/^\/godspeed-install\/api\/status\/([a-f0-9]{64})$/);
      if (status && req.method === 'GET') {
        const job = jobs.get(status[1]), key = req.headers.authorization?.replace(/^Bearer /, '');
        if (!job || expired(job) || !equal(job.browserHash, digest(key))) return send(res, 401, { error: 'This installation page has expired. Start a new installation.' });
        if (!busy.has(job.id)) {
          const operation = finish(job).finally(() => busy.delete(job.id)); busy.set(job.id, operation); await operation;
        } else await busy.get(job.id);
        return send(res, 200, { state: job.state, ...(job.url ? { url: job.url } : {}) });
      }
      send(res, 404, { error: 'Not found' });
    } catch { send(res, 400, { error: 'The installation request could not be completed. Please try again.' }); }
  });
  server.on('close', () => clearInterval(timer));
  return { server, jobs };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const installer = createInstaller({ directory: process.env.GODSPEED_INSTALL_STATE || '/var/lib/godspeed-installer', origin: process.env.GODSPEED_INSTALL_ORIGIN || 'https://srv1069233.hstgr.cloud/godspeed-install', coordinatorProxy: process.env.GODSPEED_INSTALL_PROXY, verifyCallbackHost: process.env.GODSPEED_INSTALL_VERIFY_HOST !== '0' });
  const bind = process.env.GODSPEED_INSTALL_BIND || '127.0.0.1';
  if (!bind) throw new Error('Docker network address could not be detected');
  installer.server.listen(Number(process.env.GODSPEED_INSTALL_PORT || 8794), bind);
}
