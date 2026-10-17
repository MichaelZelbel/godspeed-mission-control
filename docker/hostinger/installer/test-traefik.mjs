// Explicit Docker integration test. Uses only its own temporary projects/volumes.
// No public ACME requests and no Hostinger account or server is touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { spawnSync } from 'node:child_process';
import { createInstaller } from './server.mjs';

const TRAEFIK = 'traefik@sha256:0f6150202bc1fed72a7bd2107460eaa510e5b8a905f3fdb5b84f2c8619c33368';
const PEBBLE = 'ghcr.io/letsencrypt/pebble@sha256:ddf230642b1a584f519f32e347de1b05a6e4c1f6c35c1863b33effeab5f78199';
const fixtureHost = 'srv123456.hstgr.cloud';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function run(command, args, { allowFailure = false, env } = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 300000, env: { ...process.env, ...env }, windowsHide: true });
  if (result.status !== 0 && !allowFailure) throw Error(`${command} ${args.slice(0, 3).join(' ')} failed:\n${result.stderr || result.stdout || result.error}`);
  return result;
}
const docker = (...args) => run('docker', args).stdout.trim();
const request = (url, { body, ca, lookup, headers = {}, method = body === undefined ? 'GET' : 'POST' } = {}) => new Promise((resolve, reject) => {
  const req = (url.startsWith('https:') ? https : http).request(url, { method, ca, lookup, headers, timeout: 10000 }, res => {
    let data = ''; res.on('data', chunk => data += chunk); res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers, peer: res.socket?.getPeerCertificate?.() }));
  });
  req.on('error', reject); req.on('timeout', () => req.destroy(Error('Fixture request timed out'))); req.end(body);
});
const lookup = (_host, options, callback) => callback(null, ...(options.all ? [[{ address: '127.0.0.1', family: 4 }]] : ['127.0.0.1', 4]));

test('Hostinger default Traefik keeps ports 80/443 while Godspeed completes real TLS-ALPN issuance and private owner setup', {
  skip: process.env.GODSPEED_TEST_DOCKER !== '1' ? 'set GODSPEED_TEST_DOCKER=1 on a disposable Linux Docker host' : false,
  timeout: 360000,
}, async () => {
  assert.equal(process.platform, 'linux');
  // Fail before creating anything if another local service is using these ports.
  for (const port of [80, 443, 14000, 15000, 18794]) {
    const server = net.createServer(); await new Promise((resolve, reject) => server.once('error', reject).listen(port, '0.0.0.0', resolve));
    await new Promise(resolve => server.close(resolve));
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'godspeed-hostinger-traefik-'));
  const project = 'godspeed-traefik-' + path.basename(directory).split('-').at(-1).toLowerCase();
  const providerFile = path.join(directory, 'provider.yaml'), appFile = path.join(directory, 'application.json');
  const provider = ['compose', '-p', project, '-f', providerFile], application = ['compose', '-f', appFile];
  let service, root;
  fs.writeFileSync(path.join(directory, 'hostname'), fixtureHost + '\n');
  // Exact commands and host networking copied from Hostinger template 1210,
  // observed in hPanel on 17 October 2026. Only image version/email are pinned here.
  fs.writeFileSync(providerFile, `services:
  traefik:
    image: ${TRAEFIK}
    network_mode: host
    command:
      - --api.dashboard=false
      - --api.insecure=false
      - --log.level=WARN
      - --providers.docker=true
      - --providers.docker.exposedbydefault=false
      - --entrypoints.web.address=:80
      - --entrypoints.websecure.address=:443
      - --certificatesresolvers.letsencrypt.acme.httpchallenge=true
      - --certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web
      - --certificatesresolvers.letsencrypt.acme.email=fixture@example.invalid
      - --certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json
      - --entrypoints.web.http.redirections.entrypoint.to=websecure
      - --entrypoints.web.http.redirections.entrypoint.scheme=https
    volumes:
      - provider-certificates:/letsencrypt
      - /var/run/docker.sock:/var/run/docker.sock:ro
  pebble:
    image: ${PEBBLE}
    network_mode: host
    command: ["-config", "/fixture/pebble.json", "-strict=false"]
    extra_hosts: ["${fixtureHost}:127.0.0.1"]
    environment: {PEBBLE_VA_NOSLEEP: "1", PEBBLE_WFE_NONCEREJECT: "0"}
    volumes: ["${directory}:/fixture:ro"]
volumes:
  provider-certificates: {}
`);
  run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=host.docker.internal', '-addext', 'subjectAltName=DNS:host.docker.internal,DNS:localhost,IP:127.0.0.1', '-keyout', directory + '/ca-key.pem', '-out', directory + '/ca.pem']);
  fs.chmodSync(directory, 0o755); fs.chmodSync(directory + '/ca-key.pem', 0o644);
  fs.writeFileSync(directory + '/pebble.json', JSON.stringify({ pebble: { listenAddress: '0.0.0.0:14000', managementListenAddress: '0.0.0.0:15000', certificate: '/fixture/ca.pem', privateKey: '/fixture/ca-key.pem', httpPort: 80, tlsPort: 443 } }));
  const localCA = fs.readFileSync(directory + '/ca.pem');
  try {
    docker(...provider, 'up', '-d');
    for (let i = 0; i < 60; i++) {
      try { const response = await request('https://localhost:15000/roots/0', { ca: localCA }); if (response.status === 200) { root = response.body; break; } } catch {}
      await wait(250);
    }
    assert.ok(root, 'Pebble must start, with real challenge validation enabled');
    const fetcher = async (url, init) => {
      assert.equal(url, `https://${fixtureHost}/api/auth/bootstrap`);
      const result = await request(url, { body: init.body, headers: init.headers, ca: root, lookup });
      return new Response(result.body, { status: result.status });
    };
    service = createInstaller({ directory: directory + '/jobs', origin: 'http://host.docker.internal:18794/godspeed-install', testing: true, hostnameFile: directory + '/hostname', fetcher, allowedOrigins: ['http://localhost:18794'] });
    await new Promise(resolve => service.server.listen(18794, '0.0.0.0', resolve));
    const base = 'http://localhost:18794/godspeed-install';
    const started = await fetch(base + '/api/start', { method: 'POST', headers: { origin: 'http://localhost:18794', 'content-type': 'application/json' }, body: '{}' });
    assert.equal(started.status, 201); const ticket = await started.json();
    const configURL = new URL(new URL(ticket.checkout).searchParams.get('compose_url')); configURL.hostname = 'localhost';
    const config = await fetch(configURL); assert.equal(config.status, 200);
    const yamlFile = path.join(directory, 'generated.yaml'); fs.writeFileSync(yamlFile, await config.text(), { mode: 0o600 });
    const parsed = JSON.parse(docker('compose', '-f', yamlFile, 'config', '--no-interpolate', '--format', 'json'));
    // An existing listener must be sufficient; the application claims no host ports.
    assert.equal(parsed.services.https.ports?.length || 0, 0, 'Hostinger already owns ports 80 and 443');
    assert.equal(parsed.services.godspeed.ports?.length || 0, 0);
    const variables = JSON.parse(docker('compose', '-f', yamlFile, 'config', '--variables', '--format', 'json'));
    assert.deepEqual(variables, {}, 'the buyer must not fill any Compose fields');
    // Only replace the CA in this disposable fixture. Routing, hostname discovery,
    // setup-code generation and callbacks all execute the generated installer.
    const command = parsed.services.https.command[0];
    parsed.services.https.command[0] = command.replace('issuer acme {', 'issuer acme https://host.docker.internal:14000/dir {');
    assert.notEqual(parsed.services.https.command[0], command, 'the test must use its own ACME server');
    parsed.services.https.environment = { SSL_CERT_FILE: '/fixture/ca.pem' };
    parsed.services.https.extra_hosts = { 'host.docker.internal': 'host-gateway' };
    parsed.services.https.volumes.push({ type: 'bind', source: directory, target: '/fixture', read_only: true });
    fs.writeFileSync(appFile, JSON.stringify(parsed), { mode: 0o600 });
    docker(...application, 'up', '-d', '--wait', '--wait-timeout', '180');
    let status;
    for (let i = 0; i < 180; i++) {
      try { status = await (await fetch(base + '/api/status/' + ticket.id, { headers: { authorization: 'Bearer ' + ticket.key } })).json(); } catch { /* a cached HTTP connection may close while Docker starts */ }
      if (status?.state === 'ready') break; await wait(500);
    }
    assert.equal(status?.state, 'ready', 'real ACME validation through the default Traefik must finish the private handoff');
    const tlsResponse = await request(`https://${fixtureHost}/health`, { ca: root, lookup });
    assert.equal(tlsResponse.status, 200); assert.ok(JSON.parse(tlsResponse.body).ok);
    const redirect = await request('http://127.0.0.1/dashboard', { headers: { host: fixtureHost } });
    assert.equal(redirect.status, 301); assert.equal(redirect.headers.location, `https://${fixtureHost}/dashboard`);
    const invite = new URL(status.url).hash.slice('#invite='.length);
    const account = await request(`https://${fixtureHost}/api/auth/setup`, { ca: root, lookup, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ invite, username: 'fixture-owner', password: 'a synthetic owner password', remember: true }) });
    assert.equal(account.status, 200); assert.ok(JSON.parse(account.body).recovery_code);
    const cookie = account.headers['set-cookie'][0].split(';')[0];
    docker(...application, 'restart', 'godspeed');
    for (let i = 0; i < 60; i++) {
      try { if ((await request(`https://${fixtureHost}/api/session`, { ca: root, lookup, headers: { cookie } })).status === 200) break; } catch {} await wait(500);
    }
    assert.equal((await request(`https://${fixtureHost}/api/session`, { ca: root, lookup, headers: { cookie } })).status, 200);
    const logs = docker(...provider, 'logs', 'pebble');
    assert.match(logs, /set VALID by completed challenge/, 'Pebble must actually validate the challenge');
    const caddyLogs = docker(...application, 'logs', 'https');
    assert.match(caddyLogs, /"challenge_type":"tls-alpn-01"/, 'issuance must use TLS-ALPN through Traefik');
    assert.match(caddyLogs, /certificate obtained successfully/);
    assert.equal(docker(...provider, 'ps', '--status', 'running', '--services').split('\n').includes('traefik'), true);
    console.log('Hostinger default Traefik + real TLS-ALPN certificate + private owner setup + restart verified.');
  } finally {
    for (const [name, command] of [['application', application], ['provider', provider]]) {
      const logs = run('docker', [...command, 'logs', '--no-color'], { allowFailure: true });
      if (process.env.GODSPEED_TEST_EVIDENCE) { fs.mkdirSync(process.env.GODSPEED_TEST_EVIDENCE, { recursive: true }); fs.writeFileSync(path.join(process.env.GODSPEED_TEST_EVIDENCE, name + '.log'), logs.stdout + logs.stderr); }
      run('docker', [...command, 'down', '--volumes', '--remove-orphans'], { allowFailure: true });
    }
    if (service) await new Promise(resolve => service.server.close(resolve));
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep + 'godspeed-hostinger-traefik-'));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
