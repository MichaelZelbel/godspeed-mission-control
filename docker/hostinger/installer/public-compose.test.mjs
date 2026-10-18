import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { publicCompose, registrationCode } from './public-compose.mjs';

const endpoint = 'https://godspeedmissioncontrol.com/godspeed-install/api/servers/register';
const setup = '0123456789abcdef'.repeat(4);
const require = createRequire(import.meta.url);

async function registration({ hostname = 'srv123456', token = setup, statuses = [202], unhealthy = 0, configuredAfter = statuses.length } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'godspeed-public-register-'));
  const hostnameFile = path.join(directory, 'hostname'); fs.writeFileSync(hostnameFile, hostname + '\n');
  const calls = [], errors = [], pauses = []; let healthCalls = 0;
  try {
    await vm.runInNewContext(registrationCode({ endpoint, hostnameFile }), {
      require, process: { env: { GODSPEED_ACCESS_TOKEN: token } }, AbortSignal,
      setTimeout: (resolve, ms) => { pauses.push(ms); resolve(); }, console: { error: message => errors.push(message) },
      fetch: async (url, init) => {
        if (url === 'http://127.0.0.1:47831/health') return new Response('', { status: healthCalls++ < unhealthy ? 503 : 200 });
        if (url === 'http://127.0.0.1:47831/api/auth/status') return Response.json({ configured: calls.length >= configuredAfter });
        assert.equal(url, endpoint); calls.push(init);
        return new Response('This reply must never become a credential or be logged.', { status: statuses[Math.min(calls.length - 1, statuses.length - 1)] });
      },
    });
    return { calls, errors, healthCalls, pauses };
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

test('public manifest registers its own persistent secret only after health and retries nondurable responses', async () => {
  const result = await registration({ unhealthy: 2, statuses: [503, 200, 202] });
  assert.equal(result.calls.length, 3); assert.equal(result.healthCalls, 6);
  for (const call of result.calls) {
    assert.equal(call.method, 'POST'); assert.equal(call.redirect, 'error');
    assert.equal(call.headers['content-type'], 'application/json');
    assert.equal(call.headers.authorization, undefined);
    assert.deepEqual(JSON.parse(call.body), { hostname: 'srv123456.hstgr.cloud', setup });
  }
  assert.deepEqual(result.errors, []);
});

test('public registration refuses a non-Hostinger hostname or invalid runtime secret before sending anything', async () => {
  await assert.rejects(registration({ hostname: 'attacker.example' }), /Hostinger server address/);
  await assert.rejects(registration({ token: 'a public placeholder' }), /setup code/);
});

test('a lost or expired coordinator record is automatically renewed until an owner exists', async () => {
  const result = await registration({ statuses: [202, 202, 202] });
  assert.equal(result.calls.length, 3, 'a durable receipt must not end server enrollment');
  assert.deepEqual(result.pauses, [1200000, 1200000, 1200000]);
  assert.equal(new Set(result.calls.map(call => call.body)).size, 1, 'renewal must keep the existing server secret');
  const owned = await registration({ configuredAfter: 0 });
  assert.equal(owned.calls.length, 0, 'a configured owner needs no setup registration');
});

test('prolonged failure keeps retrying with a bounded pause and never logs or redirects credentials', async () => {
  const result = await registration({ statuses: [503], configuredAfter: 200 });
  assert.equal(result.calls.length, 200, 'registration must recover without a container restart after the old 180-attempt cutoff');
  assert.ok(result.pauses.every(ms => ms >= 5000 && ms <= 300000));
  assert.equal(result.pauses.at(-1), 300000); assert.deepEqual(result.errors, []);
  assert.throws(() => registrationCode({ endpoint: 'http://coordinator.example/register' }), /HTTPS/);
});

test('checked-in public GitHub manifest matches its generator and carries no per-buyer credential or setup fields', () => {
  const rendered = publicCompose();
  assert.equal(fs.readFileSync(new URL('../one-click.yaml', import.meta.url), 'utf8').replace(/\r\n/g, '\n'), rendered);
  assert.equal(/GODSPEED_INSTALL_CALLBACK|\/api\/ready\/|\$\{GODSPEED_(HOST|SETUP_CODE)/.test(rendered), false);
  assert.equal(/GODSPEED_ACCESS_TOKEN:\s*\S/.test(rendered), false);
});

test('Docker parses the public file with zero fields, zero host ports and read-only hostname discovery', {
  skip: process.env.GODSPEED_TEST_COMPOSE !== '1' ? 'set GODSPEED_TEST_COMPOSE=1 where Docker Compose is available; no containers are started' : false,
}, () => {
  const file = new URL('../one-click.yaml', import.meta.url);
  const config = args => execFileSync('docker', ['compose', '-f', fileURLToPath(file), 'config', ...args], { encoding: 'utf8', windowsHide: true });
  assert.deepEqual(JSON.parse(config(['--variables', '--format', 'json'])), {});
  const parsed = JSON.parse(config(['--format', 'json']));
  for (const service of Object.values(parsed.services)) {
    assert.equal(service.ports?.length || 0, 0);
    assert.match(service.image, /@sha256:[a-f0-9]{64}$/);
    assert.equal(service.volumes.some(volume => volume.source === '/etc/hostname' && volume.target === '/run/godspeed-vps-hostname' && volume.read_only === true), true);
    assert.equal(service.volumes.some(volume => volume.source?.includes('docker.sock')), false);
    // `compose config` serializes literal dollars as $$ so its output can be
    // used as Compose input again. The container shell receives single dollars.
    if (process.platform !== 'win32') for (const command of service.command || []) execFileSync('sh', ['-n', '-c', command.replace(/\$\$/g, '$')], { stdio: 'pipe' });
  }
  assert.equal(parsed.services.godspeed.environment.GODSPEED_ACCESS_TOKEN, undefined);
  assert.equal(parsed.services.godspeed.environment.GODSPEED_INSTALL_CALLBACK, undefined);
  assert.equal(parsed.services.https.labels['traefik.tcp.routers.godspeed-mission-control.tls.passthrough'], 'true');
  assert.equal(parsed.services.https.labels['traefik.tcp.services.godspeed-mission-control.loadbalancer.server.port'], '443');
  assert.equal(parsed.services.godspeed.volumes.some(volume => volume.type === 'volume' && volume.target === '/opt/data/full-candidate'), true);
});
