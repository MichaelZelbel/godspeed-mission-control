import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { composeFor } from './compose.mjs';
import { localTraefikFixture } from './local-traefik-fixture.mjs';

const job = { id: 'a'.repeat(64), callback: 'b'.repeat(64) };
const options = { origin: 'http://host.docker.internal:8794/godspeed-install', hostnameFile: '/tmp/fixture/hostname', testing: true };
test('local fixture changes only the public certificate issuer, preserving default Traefik topology and all application bytes', () => {
  const original = composeFor(job, options);
  const fixture = localTraefikFixture(original);
  assert.equal(fixture.compose.replace(" '  tls internal'", " '  tls {' '    issuer acme {' '      disable_http_challenge' '    }' '  }'"), original);
  assert.match(fixture.compose, /tls\.passthrough: "true"/);
  assert.match(fixture.compose, /loadbalancer\.server\.port: "443"/);
  assert.match(fixture.compose, /expose: \["443"\]/);
  assert.doesNotMatch(fixture.compose, /ports:/);
  assert.notEqual(fixture.provenance.publicComposeSha256, fixture.provenance.localTlsComposeSha256);
  assert.match(fixture.provenance.publicComposeSha256, /^[a-f0-9]{64}$/);
});
test('fixture refuses production names, duplicate issuers and unexpected generated deployments', () => {
  const original = composeFor(job, options);
  assert.throws(() => localTraefikFixture(original.replace('HostSNI(`localhost`)', 'HostSNI(`server.example`)')));
  assert.throws(() => localTraefikFixture(original + original));
  assert.throws(() => localTraefikFixture(original.replace('disable_http_challenge', 'unexpected')));
  assert.throws(() => localTraefikFixture(composeFor(job, { ...options, proxy: 'standalone' })));
});
test('edge fixture adds real pinned Traefik and delegates the original HTTP redirect to Caddy', () => {
  const edge = fs.readFileSync(new URL('./traefik-test.yaml', import.meta.url), 'utf8');
  assert.match(edge, /image: traefik:v3\.6@sha256:[a-f0-9]{64}/);
  assert.match(edge, /--providers\.docker\.exposedbydefault=false/);
  assert.match(edge, /\/var\/run\/docker\.sock:\/var\/run\/docker\.sock:ro/);
  assert.match(edge, /127\.0\.0\.1:443:443/);
  assert.match(edge, /fixture-http\.loadbalancer\.server\.port: "80"/);
  assert.doesNotMatch(edge, /tls\.passthrough|GODSPEED_ACCESS_TOKEN|GODSPEED_INSTALL_CALLBACK|entrypoint:/);
});
