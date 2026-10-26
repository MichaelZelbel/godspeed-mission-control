// Source/mock checks only: never starts Docker, installs packages or connects to a VPS.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const wrapper = resolve(import.meta.dirname, 'install-browser.sh');
const helpers = resolve(import.meta.dirname, 'install.sh');
const setup = 'a'.repeat(64), job = 'b'.repeat(64), callback = 'c'.repeat(64);
const pin = `https://raw.githubusercontent.com/MichaelZelbel/godspeed-mission-control/${'d'.repeat(40)}`;
// The image this commit's stage file names: what the private .env must tell Compose to run.
const stageImage = JSON.parse(readFileSync(resolve(root, 'stage.json'), 'utf8')).serverEditions.server.image;
const quote = s => `'${s.replaceAll("'", "'\\''")}'`;
function bash(body, { input = '', env = {} } = {}) {
  const r = spawnSync('bash', ['-c', `GODSPEED_INSTALL_LIB=1 source ${quote(helpers)}\nGODSPEED_BROWSER_LIB=1 source ${quote(wrapper)}\n${body}`], {
    encoding: 'utf8', input, cwd: root, env: { ...process.env, TEST_RULE: 'traefik.http.routers.app.rule = Host(`other.example.com`)', ...env }, timeout: 10_000,
  });
  assert.ifError(r.error);
  return r;
}
function output(r) { return JSON.parse(r.stdout.trim()); }
const base = `
id(){ printf '0\\n'; }
uname(){ printf 'x86_64\\n'; }
df(){ printf 'Filesystem 1024-blocks Used Available Capacity Mounted\\nmock 30000000 1 29999999 1%% /\\n'; }
stat(){ if [ "$1" = -c ]; then case "$2" in %u) echo 0 ;; %a) echo 700 ;; esac; else command stat "$@"; fi; }
os_supported(){ return 0; }
ss(){ :; }
port_in_use(){ return 1; }
browser_existing(){ BROWSER_EXISTING=; }
BROWSER_DIR=/nonexistent-godspeed-browser-test-folder
`;
const noDocker = `command(){ if [ "$1" = -v ] && [ "$2" = docker ]; then return 1; fi; builtin command "$@"; }
function [ { if builtin [ "$1 $2" = '! -S' ]; then return 0; fi; builtin [ "$@"; }`;
const traefik = `
docker(){
 case "$1 \${2:-}" in
  'info ') return 0 ;;
  'ps -q') printf 'proxy\\napp\\n' ;;
  'ps -aq') [ "\${3:-}" = --filter ] || printf 'proxy\\napp\\n' ;;
  'volume ls') : ;;
  'volume inspect'|'network inspect') return 1 ;;
  'inspect -f')
   case "$3:$4" in
    '{{.Config.Image}}:proxy') echo traefik:latest ;;
    '{{.Config.Image}}:app') echo example/app:1 ;;
    '{{.HostConfig.NetworkMode}}:proxy') echo host ;;
    '{{.State.Pid}}:proxy') echo 123 ;;
    *'.Config.Cmd'*:proxy) printf '%s\\n' --providers.docker=true --providers.docker.exposedbydefault=false --entrypoints.web.address=:80 --entrypoints.websecure.address=:443 --certificatesresolvers.myresolver.acme.httpchallenge=true ;;
    *'.Config.Labels'*:app) printf '%s\\n' "$TEST_RULE" ;;
   esac ;;
 esac
}
browser_port_pid(){ echo 123; }
port_in_use(){ return 0; }
`;
function freshMock(dir) {
  return `${base}\n${noDocker}
BROWSER_DIR=${quote(dir)}; GODSPEED_RAW=${quote(pin)}
browser_host(){ echo srv123.hstgr.cloud; }
browser_load_helpers(){ browser_bind_helpers; }
command(){ if [ "$1" = -v ] && [ "$2" = docker ]; then [ -f "$BROWSER_DIR/docker-installed" ]; else builtin command "$@"; fi; }
browser_fetch(){ case "$1" in
  */stage.json) cp ${quote(resolve(root, 'stage.json'))} "$2" ;;
  */stage/stage.sh) cp ${quote(resolve(root, 'stage/stage.sh'))} "$2" ;;
  *) cp ${quote(resolve(root, 'docker/hostinger/compose.yaml'))} "$2" ;;
 esac; }
docker(){ case "$1 \${2:-}" in 'info '|'compose version') [ -f "$BROWSER_DIR/docker-installed" ] ;; 'volume inspect'|'network inspect') return 1 ;; *) return 0 ;; esac; }
install_docker(){ printf installed > "$BROWSER_DIR/docker-installed"; }
compose(){ printf '%s\\n' "$*" >> "$BROWSER_DIR/compose-calls"; }
wait_healthy(){ return 0; }
wait_certificate(){ return 0; }
owner_link(){ printf 'link /setup#invite=${setup}'; }`;
}

test('private final result accepts only verified same-server HTTPS account paths', () => {
  const r = bash(`browser_result installed srv123.hstgr.cloud traefik /setup#invite=${setup}`);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(output(r), { ok: true, state: 'installed', hostname: 'srv123.hstgr.cloud', mode: 'traefik', url: `https://srv123.hstgr.cloud/setup#invite=${setup}` });
  const bad = bash('browser_result installed srv123.hstgr.cloud traefik https://attacker.example/');
  assert.equal(bad.status, 1);
  assert.deepEqual(output(bad), { ok: false, error: 'account_link_unavailable' });
});

test('metadata is accepted only from canonical private stdin, never an arbitrary callback URL', () => {
  const r = bash('browser_metadata; printf "%s %s" "$BROWSER_JOB" "$BROWSER_CALLBACK"', { input: `{"job":"${job}","callback":"${callback}"}\n` });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, `${job} ${callback}`);
  for (const input of [`{"job":"${job}","callback":"https://attacker.example"}`, `{"job":"../${job}","callback":"${callback}"}`, `{"job":"${job}","callback":"${callback}","extra":true}`]) {
    const bad = bash('browser_metadata || browser_fail invalid_job_metadata', { input });
    assert.equal(bad.status, 1);
    assert.deepEqual(output(bad), { ok: false, error: 'invalid_job_metadata' });
  }
});

test('plain Ubuntu without Docker chooses standalone without writing settings or installing packages', () => {
  const r = bash(`${base}\n${noDocker}\nbrowser_preflight srv123.hstgr.cloud; printf '%s' "$BROWSER_MODE"`);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'standalone');
});

test('unknown occupied web port refuses before package or application changes with one safe error', () => {
  const r = bash(`${base}\n${noDocker}\nport_in_use(){ return 0; }\nbrowser_preflight srv123.hstgr.cloud`);
  assert.equal(r.status, 1);
  assert.deepEqual(output(r), { ok: false, error: 'web_ports_in_use' });
});

test('Hostinger default host-network Traefik can keep ports 80 and 443', () => {
  const r = bash(`${base}\n${traefik}\nbrowser_preflight srv123.hstgr.cloud; printf '%s' "$BROWSER_MODE"`);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'traefik');
});

test('Traefik routers for this hostname, wildcard SNI or unknown expressions are preserved by refusing', () => {
  for (const rule of ['Host(`srv123.hstgr.cloud`)', 'Host(`other.example.com`, `srv123.hstgr.cloud`)', 'HostSNI(`*`)', 'HostRegexp(`.+`)', 'PathPrefix(`/`)', 'Host(`other.example.com`) || PathPrefix(`/`)']) {
    const r = bash(`${base}\n${traefik}\nbrowser_preflight srv123.hstgr.cloud`, { env: { TEST_RULE: `traefik.http.routers.app.rule = ${rule}` } });
    assert.equal(r.status, 1, rule);
    assert.deepEqual(output(r), { ok: false, error: 'hostname_already_routed' }, rule);
  }
});

test('a different app already using the same Traefik router name is never shadowed', () => {
  const r = bash(`${base}\n${traefik}\nbrowser_preflight srv123.hstgr.cloud`, { env: { TEST_RULE: 'traefik.tcp.routers.godspeed-mission-control.rule = HostSNI(`other.example.com`)' } });
  assert.equal(r.status, 1);
  assert.deepEqual(output(r), { ok: false, error: 'hostname_already_routed' });
});

test('TLS-challenge Traefik or a different port owner is refused without changing that proxy', () => {
  for (const change of ["browser_port_pid(){ echo 999; }", "docker_orig=; eval \"$(declare -f docker | sed '1s/docker/docker_original/')\"; docker(){ if [[ \"$1 $2 $3\" = *'.Config.Cmd'* ]]; then docker_original \"$@\"; echo --certificatesresolvers.other.acme.tlschallenge=true; else docker_original \"$@\"; fi; }"]) {
    const r = bash(`${base}\n${traefik}\n${change}\nbrowser_preflight srv123.hstgr.cloud`);
    assert.equal(r.status, 1, r.stderr);
    assert.deepEqual(output(r), { ok: false, error: 'web_ports_in_use' });
  }
});

test('orphaned Godspeed volumes are protected even when no application container exists', () => {
  const r = bash(`${base}\n${traefik}\neval "$(declare -f docker | sed '1s/docker/docker_original/')"\ndocker(){ if [ "$1 $2" = 'volume ls' ]; then echo existing-data; else docker_original "$@"; fi; }\nbrowser_preflight srv123.hstgr.cloud`);
  assert.equal(r.status, 1);
  assert.deepEqual(output(r), { ok: false, error: 'existing_installation_data' });
});

test('existing canonical Docker resources are protected even without Compose labels', () => {
  for (const resource of ['volume', 'network', 'container']) {
    const r = bash(`${base}\n${traefik}\neval "$(declare -f docker | sed '1s/docker/docker_original/')"
docker(){
 if [ "$1 $2" = '${resource} inspect' ]; then return 0;
 elif [ "$1 $2" = 'ps -aq' ] && [ '${resource}' = container ]; then echo other-project-container;
 elif [ "$1 $2" = 'volume inspect' ] || [ "$1 $2" = 'network inspect' ]; then return 1;
 else docker_original "$@"; fi;
}
browser_preflight srv123.hstgr.cloud`);
    assert.equal(r.status, 1, resource);
    assert.deepEqual(output(r), { ok: false, error: 'existing_installation_data' }, resource);
  }
});

test('existing Godspeed returns login without pulling, restarting or changing its settings', () => {
  const r = bash(`${base}\n${traefik}
GODSPEED_RAW=${quote(pin)}
browser_host(){ echo srv123.hstgr.cloud; }
browser_load_helpers(){ browser_bind_helpers; }
browser_existing(){ BROWSER_EXISTING=existing-app; }
https_ready(){ return 0; }
browser_existing_link(){ echo /login; }
browser_fetch(){ echo unexpected-download >&2; return 1; }
compose(){ echo unexpected-compose >&2; return 1; }
install_docker(){ echo unexpected-package-change >&2; return 1; }
browser_run`);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(output(r), { ok: true, state: 'existing', hostname: 'srv123.hstgr.cloud', mode: 'traefik', url: 'https://srv123.hstgr.cloud/login' });
  assert.equal(r.stderr, '');
});

test('multiple existing Godspeed apps refuse instead of selecting or replacing one', () => {
  const r = bash(`docker(){
case "$1 $2" in
 'ps -aq') printf 'one\\ntwo\\n' ;;
 'inspect -f') [ "$3" != '{{.Config.Image}}' ] || echo ghcr.io/michaelzelbel/godspeed-mission-control:stable ;;
esac
}
browser_existing`);
  assert.equal(r.status, 1);
  assert.deepEqual(output(r), { ok: false, error: 'multiple_existing_installations' });
});

test('private callback uses fixed IPv4 HTTPS origin and hides bearer and invitation from argv/stdout', () => {
  const dir = mkdtempSync(`${tmpdir()}/godspeed-browser-unit-`);
  try {
    const result = JSON.stringify({ ok: true, state: 'installed', hostname: 'srv123.hstgr.cloud', mode: 'traefik', url: `https://srv123.hstgr.cloud/setup#invite=${setup}` });
    const r = bash(`BROWSER_JOB=${job}; BROWSER_CALLBACK=${callback}; BROWSER_JOB_DIR=${quote(dir)}; BROWSER_JSON=${quote(result)}
curl(){ printf '%s\\n' "$@" > "$BROWSER_JOB_DIR/args"; local prev= a; for a in "$@"; do if [ "$prev" = --config ]; then cp "$a" "$BROWSER_JOB_DIR/captured-config"; stat -c %a "$a" > "$BROWSER_JOB_DIR/mode"; fi; prev="$a"; done; printf '204'; }
browser_notify`, {});
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '');
    const args = readFileSync(`${dir}/args`, 'utf8');
    assert.ok(args.includes('--ipv4\n') && args.includes('--proto\n=https\n'));
    assert.ok(!args.includes(callback) && !args.includes(setup) && !args.includes('--location'));
    const config = readFileSync(`${dir}/captured-config`, 'utf8');
    assert.ok(config.includes(`https://godspeedmissioncontrol.com/godspeed-install/api/hostinger/complete/${job}`));
    assert.ok(config.includes(`Authorization: Bearer ${callback}`));
    assert.equal(readFileSync(`${dir}/mode`, 'utf8').trim(), '600');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('callback retries are finite and an HTTP redirect never discloses a result to another origin', () => {
  const dir = mkdtempSync(`${tmpdir()}/godspeed-browser-unit-`);
  try {
    const r = bash(`BROWSER_JOB=${job}; BROWSER_CALLBACK=${callback}; BROWSER_JOB_DIR=${quote(dir)}; BROWSER_JSON='{"ok":false,"error":"web_ports_in_use"}'
curl(){ printf x >> "$BROWSER_JOB_DIR/attempts"; printf 302; }
sleep(){ :; }
browser_notify`);
    assert.equal(r.status, 1);
    assert.equal(r.stdout, '');
    assert.equal(readFileSync(`${dir}/attempts`, 'utf8'), 'xxx');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('detached supervisor reports timeout and erases only its private job credentials', () => {
  const dir = mkdtempSync(`${tmpdir()}/godspeed-browser-unit-`);
  try {
    writeFileSync(`${dir}/input.json`, callback);
    writeFileSync(`${dir}/unrelated-data`, 'keep');
    const r = bash(`BROWSER_JOB_DIR=${quote(dir)}
timeout(){ return 124; }
browser_notify(){ printf '%s' "$BROWSER_JSON" > "$BROWSER_JOB_DIR/received"; printf private > "$BROWSER_JOB_DIR/callback.conf"; return 0; }
browser_supervise`);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(readFileSync(`${dir}/received`, 'utf8')), { ok: false, error: 'installation_timed_out' });
    for (const file of ['input.json', 'callback.conf', 'result.json']) assert.equal(existsSync(`${dir}/${file}`), false, file);
    assert.equal(readFileSync(`${dir}/unrelated-data`, 'utf8'), 'keep');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('detached launcher propagates the immutable public source and sends metadata only on stdin', () => {
  const dir = mkdtempSync(`${tmpdir()}/godspeed-browser-unit-`);
  try {
    const metadata = `{"job":"${job}","callback":"${callback}"}\n`;
    writeFileSync(`${dir}/input.json`, metadata);
    const r = bash(`GODSPEED_RAW=${quote(pin)}; BROWSER_JOB_DIR=${quote(dir)}
nohup(){ printf '%s' "$GODSPEED_RAW" > "$BROWSER_JOB_DIR/source"; printf '%s\\n' "$@" > "$BROWSER_JOB_DIR/args"; cat > "$BROWSER_JOB_DIR/stdin"; }
browser_launch; wait`);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '');
    assert.equal(readFileSync(`${dir}/source`, 'utf8'), pin);
    assert.equal(readFileSync(`${dir}/stdin`, 'utf8'), metadata);
    const args = readFileSync(`${dir}/args`, 'utf8');
    assert.ok(args.endsWith('--background\n'));
    assert.ok(!args.includes(callback) && !args.includes(job));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('fresh plain OS mock installs Docker, creates private own settings and starts only its project', () => {
  const dir = mkdtempSync(`${tmpdir()}/godspeed-browser-unit-`);
  try {
    const r = bash(`${freshMock(dir)}\nbrowser_run`);
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.equal(output(r).state, 'installed');
    assert.equal(output(r).mode, 'standalone');
    assert.equal(readFileSync(`${dir}/docker-installed`, 'utf8'), 'installed');
    assert.equal(readFileSync(`${dir}/compose-calls`, 'utf8'), 'config --quiet\npull -q\nup -d\n');
    assert.match(readFileSync(`${dir}/.env`, 'utf8'), /^GODSPEED_HOST=srv123\.hstgr\.cloud\nGODSPEED_SETUP_CODE=[a-f0-9]{64}\nGODSPEED_SERVER_IMAGE=\S+\n$/);
    assert.equal(statSync(`${dir}/.env`).mode & 0o777, 0o600);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the private .env names the image the commit's stage file names", () => {
  const dir = mkdtempSync(`${tmpdir()}/godspeed-browser-unit-`);
  try {
    const r = bash(`${freshMock(dir)}\nbrowser_run`);
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    const env = readFileSync(`${dir}/.env`, 'utf8');
    assert.match(env, new RegExp(`^GODSPEED_SERVER_IMAGE=${stageImage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
    // The compose file it keeps beside those settings takes its image from exactly that name.
    assert.match(readFileSync(`${dir}/compose.yaml`, 'utf8'), /^ {4}image: \$\{GODSPEED_SERVER_IMAGE:-\S+\}$/m);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a stage file the reader refuses stops the browser install before anything is changed', () => {
  const dir = mkdtempSync(`${tmpdir()}/godspeed-browser-unit-`);
  try {
    const r = bash(`${freshMock(dir)}
browser_fetch(){ case "$1" in
  */stage.json) printf 'not a stage file\\n' > "$2" ;;
  */stage/stage.sh) cp ${quote(resolve(root, 'stage/stage.sh'))} "$2" ;;
  *) cp ${quote(resolve(root, 'docker/hostinger/compose.yaml'))} "$2" ;;
 esac; }
browser_run`);
    assert.equal(r.status, 1);
    assert.deepEqual(output(r), { ok: false, error: 'source_unavailable' });
    assert.ok(!existsSync(`${dir}/.env`), 'no private settings were written');
    assert.ok(!existsSync(`${dir}/docker-installed`), 'no package was installed');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a version the public stage took back after this link was made stops the browser install', () => {
  const dir = mkdtempSync(`${tmpdir()}/godspeed-browser-unit-`);
  // Beside the install folder, never inside it: anything of ours in there is a folder conflict.
  const aside = mkdtempSync(`${tmpdir()}/godspeed-browser-stage-`);
  try {
    // The commit this link names cannot know of a withdrawal made after it: the public stage says
    // so, and it is read from the branch beta, never from the link's own commit.
    const stage = JSON.parse(readFileSync(resolve(root, 'stage.json'), 'utf8'));
    const takenBack = `${aside}/public-stage.json`;
    writeFileSync(takenBack, `${JSON.stringify({ ...stage, withdrawn: [stage.version] }, null, 2)}\n`);
    const r = bash(`${freshMock(dir)}
browser_fetch(){ printf '%s\\n' "$1" >> ${quote(`${aside}/fetched`)}; case "$1" in
  */beta/stage.json) cp ${quote(takenBack)} "$2" ;;
  */stage.json) cp ${quote(resolve(root, 'stage.json'))} "$2" ;;
  */stage/stage.sh) cp ${quote(resolve(root, 'stage/stage.sh'))} "$2" ;;
  *) cp ${quote(resolve(root, 'docker/hostinger/compose.yaml'))} "$2" ;;
 esac; }
browser_run`);
    assert.equal(r.status, 1);
    assert.deepEqual(output(r), { ok: false, error: 'source_unavailable' });
    assert.ok(!existsSync(`${dir}/.env`), 'no private settings were written');
    assert.ok(!existsSync(`${dir}/docker-installed`), 'no package was installed');
    // It asked the public stage itself, through this installer's own download and at that one
    // address; a read from the link's commit would have answered "not taken back" forever.
    assert.match(readFileSync(`${aside}/fetched`, 'utf8'),
      /^https:\/\/raw\.githubusercontent\.com\/MichaelZelbel\/godspeed-mission-control\/beta\/stage\.json$/m);
  } finally { for (const d of [dir, aside]) rmSync(d, { recursive: true, force: true }); }
});

test('shared Docker and certificate failures retain one safe JSON error after stdout suppression', () => {
  for (const [helper, code] of [['install_docker', 'docker_install_failed'], ['wait_certificate', 'certificate_pending']]) {
    const dir = mkdtempSync(`${tmpdir()}/godspeed-browser-unit-`);
    try {
      const r = bash(`${freshMock(dir)}\n${helper}(){ browser_fail ${code}; }\nbrowser_run`);
      assert.equal(r.status, 1);
      assert.deepEqual(output(r), { ok: false, error: code });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test('immutable source validation rejects mutable branches before downloads or host operations', () => {
  const r = bash(`${base}\nGODSPEED_RAW=https://raw.githubusercontent.com/MichaelZelbel/godspeed-mission-control/main\nbrowser_run`);
  assert.equal(r.status, 1);
  assert.deepEqual(output(r), { ok: false, error: 'immutable_source_required' });
});

test('standalone and Traefik browser manifests use the same released application without public host ports in Traefik mode', () => {
  const manifest = readFileSync(resolve(import.meta.dirname, 'browser-compose-traefik.yaml'), 'utf8');
  const standalone = readFileSync(resolve(root, 'docker/hostinger/compose.yaml'), 'utf8');
  // Both take the image from the installers' one setting, and both fall back, when used on their
  // own without an installer, to the same image: the one the stage file of this commit names.
  const godspeedImage = file => file.match(/^ {4}image: \$\{GODSPEED_SERVER_IMAGE:-(\S+)\}$/m)?.[1];
  assert.equal(godspeedImage(manifest), stageImage);
  assert.equal(godspeedImage(standalone), stageImage);
  assert.ok(!/^\s*ports:/m.test(manifest));
  assert.ok(manifest.includes('tls.passthrough: "true"'));
  assert.ok(manifest.includes('disable_http_challenge'));
});

test('Docker renders both browser modes and their Caddy shell without starting containers', {
  skip: process.env.GODSPEED_TEST_COMPOSE !== '1' ? 'set GODSPEED_TEST_COMPOSE=1 for config parsing only' : false,
}, () => {
  for (const [mode, file] of [['traefik', 'docker/server/browser-compose-traefik.yaml'], ['standalone', 'docker/hostinger/compose.yaml']]) {
    const parsed = JSON.parse(execFileSync('docker', ['compose', '-f', resolve(root, file), 'config', '--format', 'json'], {
      encoding: 'utf8', env: { ...process.env, GODSPEED_HOST: 'srv123.hstgr.cloud', GODSPEED_SETUP_CODE: setup },
    }));
    assert.equal(parsed.name, 'godspeed-mission-control');
    assert.equal(parsed.services.godspeed.environment.GODSPEED_WEB_ADDRESS, 'https://srv123.hstgr.cloud');
    for (const service of Object.values(parsed.services)) assert.match(service.image, /@sha256:[a-f0-9]{64}$/);
    // Used on its own, without an installer, it runs the image the stage file names.
    assert.equal(parsed.services.godspeed.image, stageImage);
    // With the private settings an installer wrote, it runs the image named there, and Caddy
    // stays the pinned one.
    const envFile = `${mkdtempSync(`${tmpdir()}/godspeed-browser-env-`)}/.env`;
    const chosen = 'ghcr.io/michaelzelbel/godspeed-mission-control@sha256:' + '1'.repeat(64);
    writeFileSync(envFile, `GODSPEED_HOST=srv123.hstgr.cloud\nGODSPEED_SETUP_CODE=${setup}\nGODSPEED_SERVER_IMAGE=${chosen}\n`);
    try {
      const withEnv = JSON.parse(execFileSync('docker', ['compose', '-f', resolve(root, file), '--env-file', envFile, 'config', '--format', 'json'], { encoding: 'utf8' }));
      assert.equal(withEnv.services.godspeed.image, chosen);
      assert.equal(withEnv.services.https.image, parsed.services.https.image);
    } finally { rmSync(resolve(envFile, '..'), { recursive: true, force: true }); }
    if (mode === 'traefik') {
      assert.equal(parsed.services.https.ports?.length || 0, 0);
      assert.equal(parsed.services.https.labels['traefik.tcp.routers.godspeed-mission-control.rule'], 'HostSNI(`srv123.hstgr.cloud`)');
      for (const command of parsed.services.https.command) execFileSync('sh', ['-n', '-c', command.replaceAll('$$', '$')], { stdio: 'pipe' });
    } else assert.deepEqual(parsed.services.https.ports.map(port => Number(port.published)), [80, 443]);
  }
});
