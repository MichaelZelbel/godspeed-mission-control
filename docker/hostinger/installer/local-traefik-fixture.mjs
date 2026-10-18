// Disposable CI only. Keep the fetched public deployment's routing and application bytes.
// A public CA cannot issue localhost certificates, so change only Caddy's test issuer.
// https://caddyserver.com/docs/caddyfile/directives/tls#syntax
import { createHash } from 'node:crypto';

const publicIssuer = " '  tls {' '    issuer acme {' '      disable_http_challenge' '    }' '  }'";
const localIssuer = " '  tls internal'";
export function localTraefikFixture(compose) {
  if (!compose.includes('HostSNI(`localhost`)') || compose.split(publicIssuer).length !== 2) {
    throw Error('Expected exactly one localhost Traefik TLS issuer in the disposable deployment');
  }
  const fixture = compose.replace(publicIssuer, localIssuer);
  if (fixture.replace(localIssuer, publicIssuer) !== compose) throw Error('Fixture changed more than the localhost issuer');
  const hash = text => createHash('sha256').update(text).digest('hex');
  return { compose: fixture, provenance: { publicComposeSha256: hash(compose), localTlsComposeSha256: hash(fixture), onlyDeploymentChange: 'localhost certificate issuer: public ACME to Caddy internal CA', edge: 'real Traefik Docker provider; original HTTPS passthrough labels and exposed backend port' } };
}
