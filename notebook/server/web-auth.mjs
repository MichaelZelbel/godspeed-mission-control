import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, createHash, timingSafeEqual, scrypt as derive } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(derive);
const digest = value => createHash('sha256').update(String(value || '')).digest('hex');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const fail = (message, status = 400, code = 'AUTH_ERROR') => Object.assign(new Error(message), { status, code });
const recoveryCode = () => randomBytes(24).toString('hex').toUpperCase().match(/.{8}/g).join('-');
const recoveryHash = value => digest(String(value || '').replace(/[-\s]/g, '').toUpperCase());
const username = value => String(value || '').trim().toLowerCase();
async function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  const key = await scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return { salt, hash: key.toString('hex') };
}
function validate(input) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.@-]{2,63}$/.test(String(input.username || '').trim())) throw fail('Use 3 to 64 letters, numbers, dots, underscores or hyphens for your username.');
  if (typeof input.password !== 'string' || input.password.length < 12 || input.password.length > 256) throw fail('Choose a password with 12 to 256 characters.');
}

// Device-private state: never part of the knowledge records, Git sync or AI context.
export class WebAuth {
  constructor(state, { token, remote, now = Date.now } = {}) {
    this.file = path.join(state, 'web-auth.json'); this.token = token; this.remote = remote; this.now = now;
    this.attempts = []; this.busy = false;
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
  limit() {
    this.attempts = this.attempts.filter(at => at > this.now() - 60000);
    if (this.attempts.length >= 12) throw fail('Too many attempts. Wait one minute, then try again.', 429, 'RATE_LIMIT');
    this.attempts.push(this.now());
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
    const key = randomBytes(32).toString('hex'), seconds = remember ? 7 * 86400 : 8 * 3600;
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
      this.limit();
      if (!this.token || !equal(digest(input.token), digest(this.token))) throw fail('The setup code was not accepted. Copy the code you saved during installation.', 401);
      return this.invite();
    }
    if (route === '/api/auth/invite' && req.method === 'POST') {
      this.limit();
      if (!this.validInvite(input)) throw fail('This setup link has expired or was already used. Use your installation setup code to open a new one.', 401);
      return { ok: true };
    }
    if (route === '/api/auth/setup' && req.method === 'POST') {
      this.limit();
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
    }
    if (route === '/api/login' && req.method === 'POST') {
      this.limit(); const data = this.read();
      // Old installer helpers can create a private setup link until the owner is created.
      if (!data.owner) {
        if (!this.token || !equal(digest(input.token), digest(this.token))) throw fail('Open your private setup link to create your account.', 401);
        return { ok: true, cookie: this.startSession(data) };
      }
      const candidate = await passwordHash(typeof input.password === 'string' && input.password.length <= 256 ? input.password : '', data.owner.password.salt);
      const current = this.read();
      if (!current.owner || username(input.username) !== current.owner.username || !equal(candidate.hash, current.owner.password.hash)) throw fail('Username or password was not accepted. Check both and try again.', 401);
      return { ok: true, cookie: this.startSession(current, input.remember === true) };
    }
    if (route === '/api/auth/recover' && req.method === 'POST') {
      this.limit();
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
    }
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
  if (url.origin !== 'https://godspeed.invalid' || /^\/(setup|login|api)(\/|$)/.test(url.pathname)) return '/dashboard';
  return url.pathname + url.search + url.hash;
}
