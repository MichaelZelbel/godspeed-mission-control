#!/usr/bin/env bash
# Adds the notebook to the folder the original Godspeed installer made.
set -euo pipefail
root=${1:?The original installer must supply its Godspeed folder}
[ -f "$root/AGENTS.md" ] && [ -d "$root/rules" ] || { echo 'The original Godspeed installation did not finish.' >&2; exit 1; }
root=$(cd "$root" && pwd -P)
state="$root/.godspeed/integrated-runtime"
mkdir -p "$state"
# One exact version, named by the installer that runs this. Until 6 October 2026 it
# defaulted to the development branch, so two installs a day apart got different code.
revision=${GODSPEED_PRODUCT_REF:-}
if ! [[ "$revision" =~ ^[0-9a-f]{40}$ ]] && [ "${GODSPEED_ALLOW_MOVING_REF:-}" != 1 ]; then
  echo 'Run the published installer: it names the exact version to install.' >&2; exit 1
fi
if [ ! -d "$state/source/.git" ]; then
  git clone --no-checkout https://github.com/MichaelZelbel/godspeed-mission-control.git "$state/source"
fi
git -C "$state/source" fetch origin "$revision"
git -C "$state/source" checkout --detach FETCH_HEAD
# A server nobody browses (a routine runner) can skip building the screens:
# the build needs more memory than a small server spares.
if [ "${GODSPEED_SKIP_UI:-}" != 1 ]; then
  npm --prefix "$state/source/notebook/ui" ci --no-audit --no-fund
  npm --prefix "$state/source/notebook/ui" run build
fi
export GODSPEED_WORKSPACE="$root" GODSPEED_ORIGINAL_RUNTIME=on
export GODSPEED_PORT=${GODSPEED_PORT:-47831} GODSPEED_BIND=127.0.0.1
# The machine's name in the notebook; the one named owner runs the routines.
export GODSPEED_DEVICE=${GODSPEED_DEVICE:-local} GODSPEED_MEDIA_ROOT=${GODSPEED_MEDIA_ROOT:-$state/media}
original_home=${HERMES_HOME:-$HOME/.hermes}
export HERMES_HOME="$original_home"
if [ "${GODSPEED_INTEGRATED_BESIDE:-}" = 1 ]; then
  export HERMES_HOME="$state/hermes"
  mkdir -p "$HERMES_HOME"
  # Existing credentials may be reused; the original profile is never edited.
  for name in auth.json .env; do
    if [ -f "$original_home/$name" ] && [ ! -e "$HERMES_HOME/$name" ]; then
      cp -p "$original_home/$name" "$HERMES_HOME/$name"
      chmod 600 "$HERMES_HOME/$name"
    fi
  done
fi
assistant=$(command -v hermes || true)
[ -n "$assistant" ] || { echo 'The original installer has not installed Hermes yet.' >&2; exit 1; }
node "$state/source/notebook/bin/godspeed.mjs" init
# Joining: a mission control that is its own Git repository carries the notebook in it.
if [ ! -f "$root/.godspeed/sync-config.json" ] && git -C "$root" remote get-url origin >/dev/null 2>&1; then
  node "$state/source/notebook/bin/godspeed.mjs" sync folder || echo 'The notebook was not joined to the repository; it works on this machine alone until it is.' >&2
fi
node "$state/source/notebook/scripts/wire-assistant.mjs" "$HERMES_HOME"
node --input-type=module - "$assistant" <<'NODE'
import fs from 'node:fs';import path from 'node:path';
fs.writeFileSync(path.join(process.env.GODSPEED_WORKSPACE,'.godspeed/assistant.json'),JSON.stringify({verified:true,executable:process.argv[2],home:process.env.HERMES_HOME}),{mode:0o600});
NODE
node --input-type=module - "$state" <<'NODE'
import fs from 'node:fs';import path from 'node:path';
const state=process.argv[2],env=Object.fromEntries(['GODSPEED_WORKSPACE','GODSPEED_ORIGINAL_RUNTIME','GODSPEED_PORT','GODSPEED_BIND','HERMES_HOME','GODSPEED_DEVICE','GODSPEED_MEDIA_ROOT'].map(k=>[k,process.env[k]]));
fs.writeFileSync(path.join(state,'start.mjs'),`import {spawn} from 'node:child_process';const p=spawn(${JSON.stringify(process.execPath)},[${JSON.stringify(path.join(state,'source/notebook/scripts/supervise.mjs'))}],{stdio:'inherit',env:{...process.env,...${JSON.stringify(env)}}});for(const s of ['SIGTERM','SIGINT'])process.on(s,()=>p.kill(s));p.on('exit',c=>process.exit(c||0));`,{mode:0o600});
NODE
if command -v systemctl >/dev/null; then
  unitroot="$HOME/.config/systemd/user";manager=(systemctl --user)
  if [ "$(id -u)" = 0 ]; then unitroot=/etc/systemd/system;manager=(systemctl);fi
  mkdir -p "$unitroot"
  cat > "$unitroot/godspeed-integrated-notebook.service" <<UNIT
[Unit]
Description=Godspeed Mission Control integrated notebook
After=network-online.target
[Service]
# Git signs in through the user's credential helper (gh on a server), which needs a home folder;
# a system service starts without one, so the notebook could not sync (6 October 2026).
Environment=HOME=$HOME
Environment=PATH=$PATH
WorkingDirectory=$root
ExecStart=$(command -v node) "$state/start.mjs"
Restart=on-failure
[Install]
WantedBy=default.target
UNIT
  "${manager[@]}" daemon-reload
  "${manager[@]}" enable --now godspeed-integrated-notebook.service
else
  echo "Start the notebook with: node $state/start.mjs"
fi
echo "Godspeed Mission Control folder: $root"
echo "Notebook: http://127.0.0.1:$GODSPEED_PORT/dashboard"
