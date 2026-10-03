import http from 'node:http';
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

export function createInstaller({ directory, origin, fetcher = fetch, now = Date.now, testing = false, hostnameFile, allowedOrigins = [] }) {
  if (!testing && !origin.startsWith('https://')) throw new Error('HTTPS required');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 }); fs.chmodSync(directory, 0o700);
  const apiOrigin = new URL(origin).origin;
  const approved = new Set([apiOrigin, 'https://godspeedmissioncontrol.com', 'https://godspeedmissioncontrol.lovable.app', ...allowedOrigins]);
  const jobs = new Map(), busy = new Map(); let created = [];
  const file = id => path.join(directory, id + '.json');
  const write = job => { const temp = file(job.id) + '.tmp'; fs.writeFileSync(temp, JSON.stringify(job), { mode: 0o600 }); fs.renameSync(temp, file(job.id)); };
  for (const name of fs.readdirSync(directory)) if (/^[a-f0-9]{64}\.json$/.test(name)) {
    const job = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')); jobs.set(job.id, job);
  }
  function clean() {
    for (const [id, job] of jobs) if (job.created + TTL < now()) { jobs.delete(id); fs.unlinkSync(file(id)); }
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
    if (job.url || !job.hostname) return;
    const target = testing && job.hostname === 'localhost' ? 'https://localhost' : `https://${job.hostname}`;
    // Only a callback authenticated with the private configuration can set this host.
    try {
      const response = await fetcher(target + '/api/auth/bootstrap', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: job.bootstrap }), redirect: 'error', signal: AbortSignal.timeout(10000),
      });
      if (response.status === 409) { job.url = target + '/login'; job.state = 'ready'; write(job); return; }
      if (!response.ok) return;
      const invitation = await response.json();
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
        await input(req); clean(); created = created.filter(t => t > now() - 60000);
        if (jobs.size >= 100 || created.length >= 10) return send(res, 429, { error: 'Installations are busy. Please try again in one minute.' });
        created.push(now());
        const composeKey = secret(), browserKey = secret(), callback = secret();
        const job = { id: secret(), created: now(), state: 'waiting', composeHash: digest(composeKey), browserHash: digest(browserKey), callbackHash: digest(callback), callback, bootstrap: secret() };
        jobs.set(job.id, job); write(job);
        const config = `${origin}/compose/${job.id}/${composeKey}`;
        const checkout = new URL('https://www.hostinger.com/docker-hosting'); checkout.searchParams.set('compose_url', config); checkout.searchParams.set('REFERRALCODE', 'GHNMICHAEJC8'); checkout.hash = 'pricing';
        return send(res, 201, { id: job.id, key: browserKey, checkout: checkout.toString() });
      }
      const config = route.match(/^\/godspeed-install\/compose\/([a-f0-9]{64})\/([a-f0-9]{64})$/);
      if (config && req.method === 'GET') {
        const job = jobs.get(config[1]);
        if (!job || job.created + TTL < now() || !equal(job.composeHash, digest(config[2]))) return send(res, 404, { error: 'Installation link has expired.' });
        job.state = job.hostname ? job.state : 'prepared'; write(job);
        return send(res, 200, composeFor(job, { origin, testing, hostnameFile }), 'text/yaml');
      }
      const ready = route.match(/^\/godspeed-install\/api\/ready\/([a-f0-9]{64})$/);
      if (ready && req.method === 'POST') {
        const job = jobs.get(ready[1]), key = req.headers.authorization?.replace(/^Bearer /, '');
        if (!job || job.created + TTL < now() || !equal(job.callbackHash, digest(key))) return send(res, 401, { error: 'Installation authorization was not accepted.' });
        const data = await input(req);
        if (!/^srv[0-9]+\.hstgr\.cloud$/.test(data.hostname || '') && !(testing && data.hostname === 'localhost')) return send(res, 400, { error: 'The server address could not be verified.' });
        if (job.hostname && job.hostname !== data.hostname) return send(res, 409, { error: 'This installation is already assigned to a different server.' });
        job.hostname = data.hostname; job.state = job.url ? 'ready' : 'starting'; write(job);
        return send(res, 202, { ok: true });
      }
      const status = route.match(/^\/godspeed-install\/api\/status\/([a-f0-9]{64})$/);
      if (status && req.method === 'GET') {
        const job = jobs.get(status[1]), key = req.headers.authorization?.replace(/^Bearer /, '');
        if (!job || job.created + TTL < now() || !equal(job.browserHash, digest(key))) return send(res, 401, { error: 'This installation page has expired. Start a new installation.' });
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
  const installer = createInstaller({ directory: process.env.GODSPEED_INSTALL_STATE || '/var/lib/godspeed-installer', origin: process.env.GODSPEED_INSTALL_ORIGIN || 'https://srv1328602.hstgr.cloud/godspeed-install' });
  installer.server.listen(Number(process.env.GODSPEED_INSTALL_PORT || 8794), '127.0.0.1');
}
