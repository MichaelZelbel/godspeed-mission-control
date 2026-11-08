#!/usr/bin/env node
// Creates a local release history and its harmless Hermes command. It never contacts a registry.
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const option = name => {
  const at = process.argv.indexOf(name);
  return at === -1 ? '' : process.argv[at + 1];
};
const dir = option('--dir');
const reveal = option('--reveal');
const log = option('--log');
const metadata = process.argv.includes('--metadata');
if (!dir) throw new Error('usage: hermes-update-fixture.mjs --dir <folder> [--reveal <version>]');
const stateFile = `${resolve(dir)}.fixture-state.json`;
const shellQuote = value => `'${value.replaceAll("'", "'\"'\"'")}'`;
const git = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });

if (metadata) {
  const now = Date.parse('2026-11-07T04:15:30Z');
  const tags = execFileSync('git', ['-C', dir, 'tag', '--list', '--sort=v:refname'], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
  const releases = tags.map(tag => {
    const release = JSON.parse(execFileSync('git', ['-C', dir, 'show', `${tag}:release.json`], { encoding: 'utf8' }));
    return { version: release.version, healthy: release.healthy, age_days: Math.floor((now - Date.parse(release.published)) / 86400000) };
  });
  process.stdout.write(`${JSON.stringify(releases)}\n`);
  process.exit(0);
}

if (reveal) {
  const state = JSON.parse(await readFile(stateFile, 'utf8'));
  await writeFile(stateFile, JSON.stringify({ ...state, reveal }) + '\n');
  process.stdout.write(`${reveal}\n`);
  process.exit(0);
}

await mkdir(join(dir, 'bin'), { recursive: true });
await mkdir(join(dir, 'hermes_cli'), { recursive: true });
await mkdir(join(dir, 'venv', 'bin'), { recursive: true });
git('init', '-q'); git('config', 'user.name', 'Scenario'); git('config', 'user.email', 'scenario@example.invalid');
git('remote', 'add', 'origin', 'https://github.com/NousResearch/hermes-agent.git');
const command = `#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
fixture_state=${shellQuote(stateFile)}
fixture_log=$(node -p "try{require(process.argv[1]).log||''}catch(e){''}" "$fixture_state")
log() { destination=\${HERMES_FIXTURE_LOG:-\$fixture_log}; [ -z "\$destination" ] || printf '%s\\n' "$*" >>"\$destination"; }
version=$(node -p "require(process.argv[1]).version" "$root/release.json")
healthy=$(node -p "require(process.argv[1]).healthy" "$root/release.json")
case "\${1:-}" in
  --version) log "version $version"; printf '%s\\n' "$version" ;;
  update)
    case "\${2:-}" in
      --check)
        reveal=$(node -p "try{require(process.argv[1]).reveal}catch(e){'1.1.0'}" "$fixture_state")
        log "update-check $reveal"; printf '%s\\n' "$reveal" ;;
      --no-backup)
        release=$(node -p "try{require(process.argv[1]).reveal}catch(e){'1.1.0'}" "$fixture_state")
        log "update $release"; git -C "$root" checkout -q "v$release" ;;
      *) if [ "\${2:-}" = --backup ]; then release=$(node -p "try{require(process.argv[1]).reveal}catch(e){'1.1.0'}" "$fixture_state"); else release=\${2#v}; fi; log "update $release"; git -C "$root" checkout -q "v$release" ;;
    esac ;;
  backup) log "backup $version" ;;
  cron)
    [ "\${2:-}" = list ] || exit 2
    log "cron-list $version"
    [ "$healthy" = true ] || { printf '%s\\n' 'cron list failed' >&2; exit 1; }
    printf '%s\\n' 'scenario-cron' ;;
  plugins)
    [ "\${2:-}" = list ] || exit 2
    log "plugins-list $version"; printf '%s\\n' 'scenario-plugin' ;;
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
  git('add', 'release.json', 'bin/hermes', 'hermes_cli/__init__.py', 'venv/bin/python3');
  execFileSync('git', ['-C', dir, 'commit', '-q', '-m', version], { env: { ...process.env, GIT_AUTHOR_DATE: published, GIT_COMMITTER_DATE: published } });
  git('tag', `v${version}`);
}
git('checkout', '-q', 'v1.0.0');
await writeFile(stateFile, JSON.stringify({ reveal: '1.1.0', log }) + '\n');
process.stdout.write(`${dir}\n`);
