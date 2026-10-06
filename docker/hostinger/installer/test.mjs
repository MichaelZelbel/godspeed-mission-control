import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInstaller } from './server.mjs';
import { WebAuth } from '../../../notebook/server/web-auth.mjs';

async function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'godspeed-installer-test-'));
  let now = Date.now(), auth, offline = false;
  const root = path.join(directory, 'jobs');
  let service;
  const fetcher = async (url, init) => {
    if (offline) throw Error('TLS not ready yet');
    assert.equal(url, 'https://srv123456.hstgr.cloud/api/auth/bootstrap');
    assert.equal(init.redirect, 'error');
    try { return new Response(JSON.stringify(await auth.handle('/api/auth/bootstrap', { method: 'POST', headers: {} }, JSON.parse(init.body))), { status: 200 }); }
    catch (error) { return new Response('{}', { status: error.status || 400 }); }
  };
  const options = { directory: root, origin: 'http://127.0.0.1/godspeed-install', testing: true, now: () => now, fetcher };
  async function start() { service = createInstaller(options); await new Promise(r => service.server.listen(0, '127.0.0.1', r)); }
  await start();
  let base = () => 'http://127.0.0.1:' + service.server.address().port;
  // from: the client address Caddy names in X-Forwarded-For.
  async function request(route, { key, body, origin = 'http://127.0.0.1', method, from } = {}) {
    const response = await fetch(base() + '/godspeed-install' + route, { method: method || (body === undefined ? 'GET' : 'POST'), headers: { Origin: origin, ...(key ? { Authorization: 'Bearer ' + key } : {}), ...(from ? { 'X-Forwarded-For': from } : {}), 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const type = response.headers.get('content-type');
    return { status: response.status, data: type?.includes('json') ? await response.json() : await response.text(), headers: response.headers };
  }
  return {
    request, service: () => service, directory,
    setAuth(job) { const state = path.join(directory, 'auth'); fs.mkdirSync(state, { recursive: true }); auth = new WebAuth(state, { token: job.bootstrap, remote: true, now: () => now }); return auth; },
    setOffline(value) { offline = value; }, advance(ms) { now += ms; },
    async restart() { await new Promise(r => service.server.close(r)); await start(); },
    async close() {
      await new Promise(r => service.server.close(r));
      // This is exclusively the mkdtemp test fixture, not any user's files.
      if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep + 'godspeed-installer-test-')) throw Error('Unsafe fixture cleanup');
      fs.rmSync(directory, { recursive: true });
    },
  };
}

test('private link prepares complete deployment without fields and opens real owner creation', async () => {
  const f = await fixture();
  try {
    const started = await f.request('/api/start', { body: {} }); assert.equal(started.status, 201);
    const ticket = started.data, job = f.service().jobs.get(ticket.id);
    const checkout = new URL(ticket.checkout); assert.equal(checkout.searchParams.get('REFERRALCODE'), 'GHNMICHAEJC8');
    const configPath = new URL(checkout.searchParams.get('compose_url')).pathname.replace('/godspeed-install', '');
    const config = await f.request(configPath); assert.equal(config.status, 200);
    // The server makes its own setup code and hands it over with the authenticated callback;
    // the Compose file, which Hostinger fetches and keeps, carries none (6 October 2026).
    assert.equal(job.bootstrap, undefined); assert.equal(/GODSPEED_ACCESS_TOKEN:/.test(config.data), false); assert.match(config.data, /randomBytes\(32\)/);
    assert.ok(config.data.includes('/etc/hostname:/run/godspeed-vps-hostname:ro'));
    assert.equal(/\$\{GODSPEED_(HOST|SETUP_CODE)/.test(config.data), false);
    // Telegram is connected from the page after the account is made, so nothing here switches it off or asks for a bot.
    assert.equal(/GODSPEED_TELEGRAM|BOT_TOKEN/.test(config.data), false);
    assert.equal((await f.request('/api/status/' + ticket.id, { key: 'wrong' })).status, 401);
    assert.equal((await f.request('/api/ready/' + ticket.id, { key: 'wrong', body: { hostname: 'srv123456.hstgr.cloud' } })).status, 401);
    assert.equal((await f.request('/api/ready/' + ticket.id, { key: job.callback, body: { hostname: 'attacker.example' } })).status, 400);
    assert.equal((await f.request('/api/ready/' + ticket.id, { key: job.callback, body: { hostname: 'srv123456.hstgr.cloud' } })).status, 400);
    const setup = 'a'.repeat(64);
    assert.equal((await f.request('/api/ready/' + ticket.id, { key: job.callback, body: { hostname: 'srv123456.hstgr.cloud', setup } })).status, 202);
    // The first callback binds the setup code; a later one cannot replace it, and the Compose link is spent.
    assert.equal((await f.request('/api/ready/' + ticket.id, { key: job.callback, body: { hostname: 'srv123456.hstgr.cloud', setup: 'b'.repeat(64) } })).status, 202);
    assert.equal(job.bootstrap, setup); assert.equal((await f.request(configPath)).status, 404);
    const auth = f.setAuth(job);
    f.setOffline(true);
    const waiting = await f.request('/api/status/' + ticket.id, { key: ticket.key }); assert.deepEqual(waiting.data, { state: 'starting' });
    f.setOffline(false);
    const ready = await f.request('/api/status/' + ticket.id, { key: ticket.key }); assert.equal(ready.data.state, 'ready');
    assert.match(ready.data.url, /^https:\/\/srv123456\.hstgr\.cloud\/setup#invite=[a-f0-9]{64}$/);
    const invite = new URL(ready.data.url).hash.slice('#invite='.length);
    const result = await auth.handle('/api/auth/setup', { method: 'POST', headers: {} }, { invite, username: 'synthetic-owner', password: 'synthetic-password-12', remember: true });
    assert.equal(result.ok, true); assert.match(result.cookie, /Max-Age=2592000/); assert.ok(result.recovery_code);
    await assert.rejects(auth.handle('/api/auth/setup', { method: 'POST', headers: {} }, { invite, username: 'other-owner', password: 'other-synthetic-password' }));
    await f.restart();
    const resumed = await f.request('/api/status/' + ticket.id, { key: ticket.key }); assert.equal(resumed.data.url, ready.data.url);
    const publicReply = JSON.stringify(resumed.data); for (const value of [job.bootstrap, job.callback, ticket.key]) assert.equal(publicReply.includes(value), false);
    assert.equal(fs.readFileSync(path.join(f.directory, 'jobs', job.id + '.json'), 'utf8').includes('127.0.0.1'), false);
  } finally { await f.close(); }
});

test('wrong origin, guessed configuration, changed server and expired installation cannot claim ownership', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.request('/api/start', { origin: 'https://attacker.example', body: {} })).status, 403);
    const ticket = (await f.request('/api/start', { body: {} })).data, job = f.service().jobs.get(ticket.id);
    assert.equal((await f.request(`/compose/${job.id}/${'0'.repeat(64)}`)).status, 404);
    await f.request('/api/ready/' + job.id, { key: job.callback, body: { hostname: 'srv123456.hstgr.cloud', setup: 'c'.repeat(64) } });
    assert.equal((await f.request('/api/ready/' + job.id, { key: job.callback, body: { hostname: 'srv222222.hstgr.cloud', setup: 'c'.repeat(64) } })).status, 409);
    f.advance(24 * 3600000 + 1);
    assert.equal((await f.request('/api/status/' + job.id, { key: ticket.key })).status, 401);
    assert.equal((await f.request('/api/ready/' + job.id, { key: job.callback, body: { hostname: 'srv123456.hstgr.cloud', setup: 'c'.repeat(64) } })).status, 401);
  } finally { await f.close(); }
});

test('deployment project, volumes and secrets are unique and bounded', async () => {
  const f = await fixture();
  try {
    const first = (await f.request('/api/start', { body: {} })).data, second = (await f.request('/api/start', { body: {} })).data;
    assert.notEqual(first.id, second.id); assert.notEqual(first.key, second.key);
    const a = f.service().jobs.get(first.id), b = f.service().jobs.get(second.id);
    assert.notEqual(a.callback, b.callback);
    // One address holds at most five installations nobody has deployed yet.
    for (let i = 0; i < 3; i++) assert.equal((await f.request('/api/start', { body: {} })).status, 201);
    assert.equal((await f.request('/api/start', { body: {} })).status, 429);
    // A script on many addresses meets the overall rate, which waits a minute.
    let created = 0; for (let i = 0; i < 40; i++) if ((await f.request('/api/start', { body: {}, from: '203.0.113.' + i })).status === 201) created++;
    assert.equal(created, 25);
    f.advance(60001); assert.equal((await f.request('/api/start', { body: {}, from: '198.51.100.1' })).status, 201);
  } finally { await f.close(); }
});

test('installations nobody deploys expire within the hour, so a script cannot keep real buyers out', async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 5; i++) assert.equal((await f.request('/api/start', { body: {}, from: '203.0.113.9' })).status, 201);
    assert.equal((await f.request('/api/start', { body: {}, from: '203.0.113.9' })).status, 429);
    assert.equal((await f.request('/api/start', { body: {}, from: '198.51.100.7' })).status, 201);
    const waiting = [...f.service().jobs.keys()];
    // One whose Compose file Hostinger fetched is kept for its day; the others go after an hour.
    const deployed = (await f.request('/api/start', { body: {}, from: '192.0.2.1' })).data;
    const composePath = new URL(new URL(deployed.checkout).searchParams.get('compose_url')).pathname.replace('/godspeed-install', '');
    assert.equal((await f.request(composePath)).status, 200);
    f.advance(61 * 60000);
    assert.equal((await f.request('/api/start', { body: {}, from: '203.0.113.9' })).status, 201);
    for (const id of waiting) assert.equal(f.service().jobs.has(id), false);
    assert.equal(f.service().jobs.has(deployed.id), true);
    assert.equal(fs.readdirSync(path.join(f.directory, 'jobs')).length, 2);
  } finally { await f.close(); }
});
