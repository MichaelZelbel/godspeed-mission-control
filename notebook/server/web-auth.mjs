import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, createHash, timingSafeEqual, scrypt as derive } from 'node:crypto';
import { promisify } from 'node:util';
import net from 'node:net';

const scrypt = promisify(derive);
// scrypt runs on libuv's small worker pool, which also serves fs.promises and
// name lookups. Until 7 October 2026 nothing capped it, so many sign-in
// attempts at once (one 32 MiB hash each) starved file reads and the owner's
// own sign-in: a file open went from 20 ms to 16 s under 120 attempts. At most
// two hash at a time; the rest wait here, not on the pool.
let scryptBusy = 0; const scryptWaiting = [];
async function hashPassword(password, salt) {
  if (scryptBusy >= 2) await new Promise(resolve => scryptWaiting.push(resolve));
  scryptBusy++;
  try { return await scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }); }
  finally { scryptBusy--; scryptWaiting.shift()?.(); }
}
const digest = value => createHash('sha256').update(String(value || '')).digest('hex');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const fail = (message, status = 400, code = 'AUTH_ERROR') => Object.assign(new Error(message), { status, code });
const recoveryCode = () => randomBytes(24).toString('hex').toUpperCase().match(/.{8}/g).join('-');
const recoveryHash = value => digest(String(value || '').replace(/[-\s]/g, '').toUpperCase());
const username = value => String(value || '').trim().toLowerCase();
async function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  const key = await hashPassword(password, salt);
  return { salt, hash: key.toString('hex') };
}
function validate(input) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.@-]{2,63}$/.test(String(input.username || '').trim())) throw fail('Use 3 to 64 letters, numbers, dots, underscores or hyphens for your username.');
  if (typeof input.password !== 'string' || input.password.length < 12 || input.password.length > 256) throw fail('Choose a password with 12 to 256 characters.');
}

// The proxy whose X-Forwarded-For is believed: Caddy on this machine or on the
// Compose network (loopback and private addresses), or the addresses in
// GODSPEED_TRUSTED_PROXIES ("none" believes nobody). From anyone else the
// header is ignored, so a stranger cannot pose as another address.
export function trustedProxies(setting = process.env.GODSPEED_TRUSTED_PROXIES) {
  const list = new net.BlockList(), value = String(setting ?? '').trim();
  const entries = value ? (value === 'none' ? [] : value.split(',').map(s => s.trim()).filter(Boolean)) : ['127.0.0.0/8', '::1/128', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', 'fc00::/7'];
  for (const entry of entries) {
    const [address, bits] = entry.split('/'), type = net.isIPv6(address) ? 'ipv6' : 'ipv4';
    if (!net.isIP(address)) throw new Error('GODSPEED_TRUSTED_PROXIES lists an address that is not one: ' + entry);
    if (bits === undefined) list.addAddress(address, type); else list.addSubnet(address, Number(bits), type);
  }
  return list;
}
const plainAddress = value => { const text = String(value || '').trim().replace(/^\[|\]$/g, '').replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, ''); return net.isIP(text) ? text : null; };
const trusted = (list, address) => !!address && list.check(address, net.isIPv6(address) ? 'ipv6' : 'ipv4');
export function clientAddress(req, proxies = trustedProxies()) {
  const peer = plainAddress(req.socket?.remoteAddress);
  if (!peer) return 'unknown';
  if (!trusted(proxies, peer)) return peer;
  // The nearest hop the trusted proxies did not add is the client.
  const hops = String(req.headers?.['x-forwarded-for'] || '').split(',').map(plainAddress);
  for (let i = hops.length - 1; i >= 0; i--) { if (!hops[i]) break; if (!trusted(proxies, hops[i])) return hops[i]; }
  return peer;
}
// Failed sign-ins, counted per client address and per username. Until
// 6 October 2026 one counter of twelve a minute served everyone, so a
// stranger's wrong guesses locked the owner out. Now an address that keeps
// failing waits longer each time; a username under attack, or a flood of
// failures overall, slows only addresses that have failed themselves. An
// address with no failures always has its password or code checked.
const FREE = 5, USER_FREE = 10, CEILING = 1000, WINDOW = 10 * 60000, FORGET = 3600000, LONGEST = 15 * 60000, KEPT = 10000;
const delay = (count, free) => count < free ? 0 : Math.min(LONGEST, 1000 * 2 ** (count - free));
class Failures {
  constructor(now) { this.now = now; this.addresses = new Map(); this.users = new Map(); this.recent = []; this.inflight = new Map(); }
  entry(map, key) { const e = map.get(key); if (e && e.last + FORGET < this.now()) { map.delete(key); return null; } return e || null; }
  // An attempt whose check is still running counts against the gate, so that
  // many guesses fired at once (which all passed the wait check before any of
  // them recorded a failure) no longer all get checked. Until 7 October 2026
  // the count moved only after the slow scrypt, so 40 at once from one address
  // were all checked.
  begin(address) { this.inflight.set(address, (this.inflight.get(address) || 0) + 1); }
  end(address) { const n = (this.inflight.get(address) || 0) - 1; if (n > 0) this.inflight.set(address, n); else this.inflight.delete(address); }
  wait(address, user) {
    const now = this.now(), own = this.entry(this.addresses, address), flying = this.inflight.get(address) || 0;
    // An address with no failures and nothing in flight is always checked, so a
    // username under attack never locks the owner out from a clean address. An
    // in-flight attempt counts like a failure here, so a burst from one address
    // still gates after the free allowance.
    if (!own && !flying) return 0;
    let until = (own ? own.last : now) + delay((own ? own.count : 0) + flying, FREE);
    const named = user ? this.entry(this.users, user) : null;
    if (named) until = Math.max(until, named.last + delay(named.count, USER_FREE));
    this.recent = this.recent.filter(at => at > now - WINDOW);
    if (this.recent.length >= CEILING) until = Math.max(until, this.recent[this.recent.length - CEILING] + WINDOW);
    return Math.max(0, until - now);
  }
  failed(address, user) {
    const now = this.now(), bump = (map, key) => { const e = this.entry(map, key) || { count: 0 }; map.delete(key); map.set(key, { count: e.count + 1, last: now }); while (map.size > KEPT) map.delete(map.keys().next().value); };
    bump(this.addresses, address); if (user) bump(this.users, user);
    this.recent.push(now); if (this.recent.length > CEILING * 2) this.recent = this.recent.slice(-CEILING);
  }
  succeeded(address) { this.addresses.delete(address); }
}

// Device-private state: never part of the knowledge records, Git sync or AI context.
export class WebAuth {
  constructor(state, { token, remote, now = Date.now, proxies = trustedProxies() } = {}) {
    this.file = path.join(state, 'web-auth.json'); this.token = token; this.remote = remote; this.now = now;
    this.failures = new Failures(() => this.now()); this.proxies = proxies; this.busy = false;
    if (!fs.existsSync(this.file)) this.save({ version: 1, sessions: {}, invitations: {} });
  }
  read() { return JSON.parse(fs.readFileSync(this.file, 'utf8')); }
  save(data) {
    const temp = this.file + '.' + randomBytes(8).toString('hex') + '.tmp';
    const fd = fs.openSync(temp, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(data)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temp, this.file); fs.chmodSync(this.file, 0o600);
  }
  configured() { return !!this.read().owner; }
  // Runs one credential check under the limits: refused while this address
  // must wait, counted when the check fails, forgotten when it succeeds.
  async limited(req, user, check) {
    const address = clientAddress(req, this.proxies), wait = this.failures.wait(address, user);
    if (wait > 0) throw fail(wait <= 60000 ? 'Too many attempts. Wait a minute, then try again.' : 'Too many attempts. Wait ' + Math.ceil(wait / 60000) + ' minutes, then try again.', 429, 'RATE_LIMIT');
    // Counted before the check runs, so attempts fired at once see each other.
    this.failures.begin(address);
    try { const result = await check(); this.failures.succeeded(address); return result; }
    catch (error) { if (error.status === 401 || error.status === 403) this.failures.failed(address, user); throw error; }
    finally { this.failures.end(address); }
  }
  cookie(req) { return (req.headers.cookie || '').match(/(?:^|;\s*)godspeed_session=([^;]+)/)?.[1]; }
  authorized(req) {
    if (!this.remote) return true;
    const session = this.read().sessions[digest(this.cookie(req))];
    return !!session && session.expires > this.now();
  }
  session(req) { return this.read().sessions[digest(this.cookie(req))]; }
  sessionCookie(value, seconds) { return `godspeed_session=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${seconds}${this.remote ? '; Secure' : ''}`; }
  startSession(data, remember = false) {
    const key = randomBytes(32).toString('hex'), seconds = remember ? 30 * 86400 : 8 * 3600;
    const now = this.now();
    data.sessions = Object.fromEntries(Object.entries(data.sessions).filter(([, s]) => s.expires > now));
    // Bound private session state even for repeated successful sign-ins.
    for (const id of Object.keys(data.sessions).slice(0, Math.max(0, Object.keys(data.sessions).length - 99))) delete data.sessions[id];
    data.sessions[digest(key)] = { expires: now + seconds * 1000 };
    this.save(data);
    return this.sessionCookie(key, seconds);
  }
  invite() {
    const data = this.read();
    if (data.owner) throw fail('Your account is already set up. Sign in instead.', 409);
    const key = randomBytes(32).toString('hex');
    // Issuing a new invitation replaces the previous one.
    data.invitations = { [digest(key)]: this.now() + 24 * 3600000 }; this.save(data);
    return { path: '/setup#invite=' + key, expires_hours: 24 };
  }
  validInvite(input, data = this.read()) { return !data.owner && (data.invitations[digest(input.invite)] || 0) > this.now(); }
  async handle(route, req, input = {}) {
    if (route === '/api/auth/status' && req.method === 'GET') return { configured: this.configured(), local: !this.remote, signed_in: this.authorized(req), session_expired: !!this.cookie(req) && !this.authorized(req) };
    if (route === '/api/auth/bootstrap' && req.method === 'POST') {
      return this.limited(req, null, async () => {
        if (!this.token || !equal(digest(input.token), digest(this.token))) throw fail('The setup code was not accepted. Copy the code you saved during installation.', 401);
        return this.invite();
      });
    }
    if (route === '/api/auth/invite' && req.method === 'POST') {
      return this.limited(req, null, async () => {
        if (!this.validInvite(input)) throw fail('This setup link has expired or was already used. Use your installation setup code to open a new one.', 401);
        return { ok: true };
      });
    }
    if (route === '/api/auth/setup' && req.method === 'POST') return this.limited(req, null, async () => {
      if (this.busy) throw fail('Account setup is already in progress. Try signing in shortly.', 409);
      this.busy = true;
      try {
        const data = this.read();
        if (data.owner) throw fail('Your account is already set up. Sign in instead.', 409);
        if (!this.validInvite(input, data)) throw fail('Open your private setup link before creating your account.', 403);
        validate(input); const password = await passwordHash(input.password);
        const code = recoveryCode();
        data.owner = { username: username(input.username), password, recovery: recoveryHash(code) };
        data.invitations = {}; data.sessions = {};
        return { ok: true, recovery_code: code, cookie: this.startSession(data, input.remember === true) };
      } finally { this.busy = false; }
    });
    if (route === '/api/login' && req.method === 'POST') return this.limited(req, username(input.username) || null, async () => {
      const data = this.read();
      // Old installer helpers can create a private setup link until the owner is created.
      if (!data.owner) {
        if (!this.token || !equal(digest(input.token), digest(this.token))) throw fail('Open your private setup link to create your account.', 401);
        return { ok: true, cookie: this.startSession(data) };
      }
      const candidate = await passwordHash(typeof input.password === 'string' && input.password.length <= 256 ? input.password : '', data.owner.password.salt);
      const current = this.read();
      if (!current.owner || username(input.username) !== current.owner.username || !equal(candidate.hash, current.owner.password.hash)) throw fail('Username or password was not accepted. Check both and try again.', 401);
      return { ok: true, cookie: this.startSession(current, input.remember === true) };
    });
    // The recovery code belongs to the account, so its failures count against one name.
    if (route === '/api/auth/recover' && req.method === 'POST') return this.limited(req, 'account recovery', async () => {
      if (this.busy) throw fail('An account change is in progress. Try again shortly.', 409);
      this.busy = true;
      try {
        const data = this.read();
        if (!data.owner || !equal(recoveryHash(input.recovery_code), data.owner.recovery)) throw fail('Recovery code was not accepted. Use the code you saved when you set up your account.', 401);
        validate(input); const password = await passwordHash(input.password);
        const code = recoveryCode();
        data.owner = { username: username(input.username), password, recovery: recoveryHash(code) }; data.sessions = {};
        return { ok: true, recovery_code: code, cookie: this.startSession(data, input.remember === true) };
      } finally { this.busy = false; }
    });
    if (route === '/api/logout' && req.method === 'POST') {
      const data = this.read(); delete data.sessions[digest(this.cookie(req))]; this.save(data);
      return { ok: true, cookie: this.sessionCookie('', 0) };
    }
    throw fail('This sign-in operation is unavailable.', 405);
  }
}

export function safeReturn(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\r\n]/.test(value)) return '/dashboard';
  const url = new URL(value, 'https://godspeed.invalid');
  // Checked after the path is normalized: "/.//evil.example" becomes
  // "//evil.example", which a browser follows to another site (until
  // 6 October 2026 it was handed back as the destination).
  if (url.origin !== 'https://godspeed.invalid' || !/^\/(?![/\\])/.test(url.pathname) || /[\\\t]/.test(url.pathname) || /^\/(setup|login|api)(\/|$)/.test(url.pathname)) return '/dashboard';
  return url.pathname + url.search + url.hash;
}
