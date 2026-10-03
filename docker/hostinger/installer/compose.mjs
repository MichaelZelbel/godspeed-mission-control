const IMAGE = 'ghcr.io/michaelzelbel/godspeed-mission-control@sha256:e0c2c930d4de7bfc94932bade8f49afb936f8881ce20d95bf6df00bf8c5c39a6';
const CADDY = 'caddy:2.10.2-alpine@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d';

// Private per-installation configuration. No public or user-chosen setup key.
export function composeFor(job, { origin, hostnameFile = '/etc/hostname', testing = false }) {
  for (const value of [job.id, job.bootstrap, job.callback]) if (!/^[a-f0-9]{64}$/.test(value)) throw new Error('Invalid installation credential');
  const endpoint = new URL(origin);
  if (endpoint.protocol !== 'https:' && !testing) throw new Error('Installation coordinator requires HTTPS');
  if (!/^[a-zA-Z0-9._:/-]+$/.test(hostnameFile)) throw new Error('Invalid hostname file');
  const hostnameCode = `const fs=require('fs');let h=fs.readFileSync('/run/godspeed-vps-hostname','utf8').trim();if(/^srv[0-9]+$/.test(h))h+='.hstgr.cloud';if(!/^srv[0-9]+\\.hstgr\\.cloud$/.test(h)${testing ? "&&h!=='localhost'" : ''})throw Error('Hostinger server address could not be detected');`;
  const callbackCode = `${hostnameCode}async function ready(){for(let i=0;i<180;i++){try{const r=await fetch('http://127.0.0.1:47831/health',{signal:AbortSignal.timeout(3000)});if(r.ok){const c=await fetch(${JSON.stringify(origin + '/api/ready/' + job.id)},{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+process.env.GODSPEED_INSTALL_CALLBACK},body:JSON.stringify({hostname:h}),signal:AbortSignal.timeout(10000)});if(c.ok)return;}}catch{}await new Promise(r=>setTimeout(r,5000));}console.error('Automatic installation handoff could not reach the installation page');}ready();`;
  const hostScript = `h=$$(cat /run/godspeed-vps-hostname | tr -d '\\r\\n'); printf '%s' "$$h" | grep -Eq '^srv[0-9]+(\\.hstgr\\.cloud)?$$${testing ? '|^localhost$$' : ''}' || { echo 'Hostinger server address could not be detected' >&2; exit 1; }; case "$$h" in *.hstgr.cloud${testing ? '|localhost' : ''}) ;; *) h="$$h.hstgr.cloud";; esac; exec caddy reverse-proxy --from "$$h" --to godspeed:47831`;
  return `name: godspeed-${job.id.slice(0, 12)}
services:
  godspeed:
    image: ${IMAGE}
    restart: unless-stopped
    environment:
      GODSPEED_ACCESS_TOKEN: ${JSON.stringify(job.bootstrap)}
      GODSPEED_INSTALL_CALLBACK: ${JSON.stringify(job.callback)}
      GODSPEED_DEVICE: vps
      GODSPEED_COMPUTER: "off"
      GODSPEED_TELEGRAM: "off"
    entrypoint: ["/bin/sh", "-ec"]
    command:
      - ${JSON.stringify(`node -e ${shellQuote(callbackCode)} & exec /opt/godspeed/kit/docker/full-candidate/entrypoint.sh`)}
    volumes:
      - godspeed-data:/opt/data/full-candidate
      - ${hostnameFile}:/run/godspeed-vps-hostname:ro
    expose: ["47831"]
${testing ? '    extra_hosts: ["host.docker.internal:host-gateway"]\n' : ''}    logging:
      driver: json-file
      options: {max-size: "10m", max-file: "3"}
  https:
    image: ${CADDY}
    restart: unless-stopped
    entrypoint: ["/bin/sh", "-ec"]
    command:
      - ${JSON.stringify(hostScript)}
    ports: ["80:80", "443:443"]
    volumes:
      - godspeed-certificates:/data
      - godspeed-proxy-config:/config
      - ${hostnameFile}:/run/godspeed-vps-hostname:ro
    depends_on:
      godspeed: {condition: service_healthy}
    logging:
      driver: json-file
      options: {max-size: "10m", max-file: "3"}
volumes:
  godspeed-data: {}
  godspeed-certificates: {}
  godspeed-proxy-config: {}
`;
}
function shellQuote(value) { return "'" + value.replace(/'/g, "'\\''") + "'"; }
