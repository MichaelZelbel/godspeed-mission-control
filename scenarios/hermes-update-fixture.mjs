#!/usr/bin/env node
// Creates a local release history and its harmless Hermes command. It never contacts a registry.
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { HERMES_HTTPS_ORIGIN, SCENARIO_HERMES_RELEASES_PATH, scenarioHermesReleaseUrl } from '../notebook/core/hermes-update.mjs';

const option = name => {
  const at = process.argv.indexOf(name);
  return at === -1 ? '' : process.argv[at + 1];
};
const dir = option('--dir');
const reveal = option('--reveal');
const log = option('--log');
const metadata = process.argv.includes('--metadata');
const serve = process.argv.includes('--serve');
if (!dir) throw new Error('usage: hermes-update-fixture.mjs --dir <folder> [--reveal <version>]');
const stateFile = join(dir, '.fixture-state.json');
const git = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });

const fixtureReleases = () => {
  const tags = execFileSync('git', ['-C', dir, 'tag', '--list', '--sort=v:refname'], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
  return tags.map(tag => {
    const release = JSON.parse(execFileSync('git', ['-C', dir, 'show', `${tag}:release.json`], { encoding: 'utf8' }));
    return { tag, ...release };
  });
};

if (metadata) {
  const now = Date.parse('2026-11-07T04:15:30Z');
  const releases = fixtureReleases().map(release => ({ version: release.version, healthy: release.healthy, age_days: Math.floor((now - Date.parse(release.published)) / 86400000) }));
  process.stdout.write(`${JSON.stringify(releases)}\n`);
  process.exit(0);
}

if (reveal) {
  const state = JSON.parse(await readFile(stateFile, 'utf8'));
  await writeFile(stateFile, JSON.stringify({ ...state, reveal }) + '\n');
  process.stdout.write(`${reveal}\n`);
  process.exit(0);
}

if (serve) {
  const server = createServer(async (request, response) => {
    if (request.method !== 'GET' || request.url !== SCENARIO_HERMES_RELEASES_PATH) { response.writeHead(404); response.end(); return; }
    const { reveal: revealed } = JSON.parse(await readFile(stateFile, 'utf8'));
    const releases = fixtureReleases().filter(release => release.version <= revealed).map(release => ({tag_name:release.tag,published_at:release.published,prerelease:false,draft:false}));
    response.writeHead(200, {'Content-Type':'application/json'}); response.end(JSON.stringify(releases));
  });
  server.listen(0, '127.0.0.1', () => process.stdout.write(`${scenarioHermesReleaseUrl(server.address().port)}\n`));
  await new Promise(resolve => server.on('close', resolve));
}

await mkdir(join(dir, 'bin'), { recursive: true });
await mkdir(join(dir, 'hermes_cli'), { recursive: true });
await mkdir(join(dir, 'venv', 'bin'), { recursive: true });
git('init', '-q'); git('config', 'user.name', 'Scenario'); git('config', 'user.email', 'scenario@example.invalid');
git('remote', 'add', 'origin', HERMES_HTTPS_ORIGIN);
await writeFile(join(dir, '.gitignore'), '.fixture-state.json\n');
const command = `#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
fixture_state="$root/.fixture-state.json"
fixture_log=$(node -p "try{require(process.argv[1]).log||''}catch(e){''}" "$fixture_state")
log() { destination=\${HERMES_FIXTURE_LOG:-\$fixture_log}; [ -z "\$destination" ] || printf '%s\\n' "$*" >>"\$destination"; }
reveal() { node -p "require(process.argv[1]).reveal" "$fixture_state"; }
version=$(node -p "require(process.argv[1]).version" "$root/release.json")
healthy=$(node -p "require(process.argv[1]).healthy" "$root/release.json")
case "\${1:-}" in
  --version) log "version $version"; printf '%s\\n' "$version" ;;
  update)
    case "\${2:-}" in
      --check)
        reveal=$(reveal)
        log "update-check $reveal"; printf '%s\\n' "$reveal" ;;
      --no-backup)
        release=$(reveal)
        log "update $release"; git -C "$root" checkout -q "v$release" ;;
      *) if [ "\${2:-}" = --backup ]; then release=$(reveal); else release=\${2#v}; fi; log "update $release"; git -C "$root" checkout -q "v$release" ;;
    esac ;;
  backup)
    output=
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --output) output=\${2:-}; shift 2 ;;
        *) shift ;;
      esac
    done
    [ -n "$output" ] || exit 2
    mkdir -p "$(dirname "$output")"
    : > "$output"
    log "backup $version" ;;
  import)
    [ -f "\${2:-}" ] && [ "\${3:-}" = --force ] || exit 2
    log "import $version" ;;
  pm)
    [ "\${2:-}" = install ] || exit 2
    log "pm-install $version" ;;
  cron)
    [ "\${2:-}" = list ] || exit 2
    log "cron-list $version"
    [ "$healthy" = true ] || { printf '%s\\n' 'cron list failed' >&2; exit 1; }
    printf '%s\\n' 'scenario-cron' ;;
  plugins)
    case "\${2:-}" in
      list) log "plugins-list $version"; printf '%s\\n' 'scenario-plugin' ;;
      doctor) [ -n "\${3:-}" ] && [ "\${4:-}" = --ci ] || exit 2; log "plugins-doctor $version" ;;
      *) exit 2 ;;
    esac ;;
  gateway)
    log "gateway \${2:-status} $version"; printf '%s\\n' ok ;;
  chat) log "chat $version"; printf '%s\\n' 'Scenario answer' ;;
  *) log "unknown $*"; exit 2 ;;
esac
`;
for (const [version, healthy, published] of [
  ['1.0.0', true, '2026-10-20T00:00:00Z'],
  ['1.1.0', true, '2026-10-29T00:00:00Z'],
  ['1.2.0', false, '2026-10-30T00:00:00Z'],
  ['1.3.0', true, '2026-11-04T00:00:00Z'],
]) {
  await writeFile(join(dir, 'release.json'), JSON.stringify({ version, healthy, published }) + '\n');
  await writeFile(join(dir, 'bin', 'hermes'), command);
  await writeFile(join(dir, 'hermes_cli', '__init__.py'), '');
  await writeFile(join(dir, 'venv', 'bin', 'python3'), '#!/bin/sh\nexit 0\n');
  await chmod(join(dir, 'bin', 'hermes'), 0o755);
  await chmod(join(dir, 'venv', 'bin', 'python3'), 0o755);
  git('add', 'release.json', 'bin/hermes', 'hermes_cli/__init__.py', 'venv/bin/python3', '.gitignore');
  execFileSync('git', ['-C', dir, 'commit', '-q', '-m', version], { env: { ...process.env, GIT_AUTHOR_DATE: published, GIT_COMMITTER_DATE: published } });
  git('tag', `v${version}`);
}
git('checkout', '-q', 'v1.0.0');
await writeFile(stateFile, JSON.stringify({ reveal: '1.1.0', log }) + '\n');
process.stdout.write(`${dir}\n`);
