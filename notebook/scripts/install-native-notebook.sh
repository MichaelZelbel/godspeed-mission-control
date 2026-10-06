#!/usr/bin/env bash
# Adds the notebook to the folder the original Godspeed installer made.
#
# Each version is installed into a folder of its own (versions/<commit>) while the
# running notebook goes on undisturbed; then the notebook is stopped, the folder and
# the assistant are wired to the new version, and the notebook is started again and
# asked whether it answers. Until 6 October 2026 an upgrade replaced the code under
# the running notebook and `systemctl enable --now` left the old process running, so
# the new version never started.
set -euo pipefail

NODE_VERSION=22.19.0
SERVICE=godspeed-integrated-notebook.service

# --- Node.js ------------------------------------------------------------------------
# The notebook needs Node.js 22.19 or newer within 22 (node:sqlite). Stock Ubuntu and
# Debian ship Node 12 to 18, and until 6 October 2026 nothing checked, so the original
# setup finished and then the notebook's first command failed. So the installation
# keeps its own Node.js of that one version, as the Windows one does, checked against
# the checksum list Node.js publishes for it.
node_platform() {
  local os arch
  case "$(uname -s)" in Linux) os=linux ;; Darwin) os=darwin ;; *) return 1 ;; esac
  case "$(uname -m)" in
    x86_64|amd64) arch=x64 ;;
    aarch64|arm64) arch=arm64 ;;
    armv7l) [ "$os" = linux ] || return 1; arch=armv7l ;;
    *) return 1 ;;
  esac
  printf '%s-%s' "$os" "$arch"
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

node_fits() {
  local version
  version=$("$1" --version 2>/dev/null) || return 1
  [[ "$version" =~ ^v22\.([0-9]+)\. ]] && [ "${BASH_REMATCH[1]}" -ge 19 ]
}

# Prints the path of the installation's own node, downloading it when needed.
install_node() {
  local platform name dir tmp want
  platform=$(node_platform) || return 1
  name="node-v$NODE_VERSION-$platform"
  dir="$state/runtime/$name"
  if [ -x "$dir/bin/node" ] && [ "$("$dir/bin/node" --version 2>/dev/null)" = "v$NODE_VERSION" ]; then
    printf '%s' "$dir/bin/node"; return 0
  fi
  mkdir -p "$state/runtime" || return 1
  tmp=$(mktemp -d "$state/runtime/.download.XXXXXX") || return 1
  if ! curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt" \
     || ! curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/$name.tar.gz" -o "$tmp/$name.tar.gz"; then
    rm -rf "$tmp"; return 1
  fi
  want=$(awk -v file="$name.tar.gz" '$2 == file { print $1 }' "$tmp/SHASUMS256.txt")
  if [ -z "$want" ] || [ "$(sha256_of "$tmp/$name.tar.gz")" != "$want" ]; then
    echo 'The downloaded Node.js did not match its published checksum, so it was not used.' >&2
    rm -rf "$tmp"; return 1
  fi
  if ! tar -xzf - -C "$tmp" < "$tmp/$name.tar.gz" || ! "$tmp/$name/bin/node" --version >/dev/null 2>&1; then
    rm -rf "$tmp"; return 1
  fi
  rm -rf "$dir" && mv "$tmp/$name" "$dir" && rm -rf "$tmp" || return 1
  printf '%s' "$dir/bin/node"
}

# --- The source ---------------------------------------------------------------------
# The named commit and nothing else: one shallow fetch, and without the folder of
# installers (57 MB of Windows programs the notebook never runs). Until 6 October 2026
# every install cloned the whole history, 346 MB. Fetching without file contents first
# and taking only the ones checked out needs a newer Git; an older one gets the plain
# shallow fetch. The commit's name proves the content: Git names objects by their hash.
fetch_into() {
  local dir=$1 filter=$2
  git -C "$dir" init -q \
    && git -C "$dir" remote add origin "$repository" \
    && git -C "$dir" config core.sparseCheckout true \
    && printf '/*\n!/installers/\n' > "$dir/.git/info/sparse-checkout" \
    && git -C "$dir" fetch -q --depth 1 ${filter:+"$filter"} origin "$revision" \
    && git -C "$dir" -c advice.detachedHead=false checkout -q --detach FETCH_HEAD
}

# Prints the folder holding the version, fetching it when it is not here yet.
fetch_version() {
  local incoming commit
  mkdir -p "$state/versions" || return 1
  if [[ "$revision" =~ ^[0-9a-f]{40}$ ]] && [ -f "$state/versions/$revision/notebook/bin/godspeed.mjs" ]; then
    printf '%s' "$state/versions/$revision"; return 0
  fi
  incoming=$(mktemp -d "$state/versions/.incoming.XXXXXX") || return 1
  if ! fetch_into "$incoming" --filter=blob:none >/dev/null 2>&1; then
    rm -rf "$incoming" && mkdir -p "$incoming" || return 1
    fetch_into "$incoming" "" || { rm -rf "$incoming"; return 1; }
  fi
  commit=$(git -C "$incoming" rev-parse HEAD) || { rm -rf "$incoming"; return 1; }
  if [[ "$revision" =~ ^[0-9a-f]{40}$ ]] && [ "$commit" != "$revision" ]; then
    echo "The download is not the version this installer names ($revision)." >&2
    rm -rf "$incoming"; return 1
  fi
  if [ -f "$state/versions/$commit/notebook/bin/godspeed.mjs" ]; then rm -rf "$incoming"
  else rm -rf "${state:?}/versions/$commit" && mv "$incoming" "$state/versions/$commit" || return 1; fi
  printf '%s' "$state/versions/$commit"
}

# --- The service --------------------------------------------------------------------
systemd_here() { [ -d /run/systemd/system ] && command -v systemctl >/dev/null 2>&1; }

# Root for the few steps that write the system's service list: directly when this is
# root, else through sudo, which asks for the password once if it has to and can.
root_available() {
  [ "$(id -u)" = 0 ] && return 0
  command -v sudo >/dev/null 2>&1 || return 1
  sudo -n true 2>/dev/null && return 0
  ( exec </dev/tty ) 2>/dev/null || return 1
  echo 'Your password is needed once, so the notebook starts with this computer.' >&2
  sudo -v </dev/tty
}
as_root() { if [ "$(id -u)" = 0 ]; then "$@"; else sudo "$@"; fi; }

# A value inside double quotes, the way systemd reads it: \ and " escaped, % doubled
# (systemd's own placeholders), and in a command line $ doubled (its variables).
unit_quoted() {
  local value=$1 bs='\' q='"'
  value=${value//"$bs"/"$bs$bs"}; value=${value//"$q"/"$bs$q"}; value=${value//"%"/"%%"}
  printf '"%s"' "$value"
}
unit_word() { local value d='$'; value=$(unit_quoted "$1"); printf '%s' "${value//"$d"/"$d$d"}"; }

# The unit, for the system (with the account it runs as) or for that account's own
# systemd. Git signs in through the user's credential helper (gh on a server), which
# needs a home folder; a system service starts without one, so the notebook could not
# sync (6 October 2026).
unit_text() {
  local kind=$1
  printf '[Unit]\nDescription=Godspeed Mission Control notebook\nWants=network-online.target\nAfter=network-online.target\n'
  printf '[Service]\n'
  # Account names hold no spaces, quotes or percent signs, and systemd reads them bare.
  if [ "$kind" = system ]; then printf 'User=%s\nGroup=%s\n' "$service_user" "$service_group"; fi
  printf 'Environment=%s\n' "$(unit_quoted "HOME=$HOME")" "$(unit_quoted "PATH=$PATH")"
  printf 'WorkingDirectory=%s\n' "${root//"%"/"%%"}"
  printf 'ExecStart=%s %s\n' "$(unit_word "$node")" "$(unit_word "$state/start.mjs")"
  printf 'Restart=on-failure\nRestartSec=5\n[Install]\n'
  if [ "$kind" = system ]; then printf 'WantedBy=multi-user.target\n'; else printf 'WantedBy=default.target\n'; fi
}

answers() {
  local attempt
  for attempt in $(seq 1 60); do
    if "$node" -e 'fetch("http://127.0.0.1:"+process.argv[1]+"/health").then(r=>process.exit(r.ok?0:1),()=>process.exit(1))' "$GODSPEED_PORT" 2>/dev/null; then return 0; fi
    sleep 2
  done
  return 1
}

# Lets a test load the functions above without installing anything.
if [ "${GODSPEED_INSTALLER_FUNCTIONS_ONLY:-}" = 1 ]; then return 0 2>/dev/null || exit 0; fi

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
repository=${GODSPEED_PRODUCT_REPOSITORY:-https://github.com/MichaelZelbel/godspeed-mission-control.git}

if ! node=$(install_node); then
  node=$(command -v node || true)
  if [ -z "$node" ] || ! node_fits "$node"; then
    echo "The notebook needs Node.js 22 (22.19 or newer), and it could not be downloaded from nodejs.org. Check this computer can reach the internet, then run the installer again." >&2
    exit 1
  fi
  echo "Using this computer's Node.js $("$node" --version), because the notebook's own could not be downloaded." >&2
fi
# Every node, npm and the programs the build starts are this one from here on.
node_folder=$(dirname "$node")
export PATH="$node_folder:$PATH"

version=$(fetch_version) || { echo 'The notebook could not be downloaded. Check this computer can reach GitHub, then run the installer again.' >&2; exit 1; }
# A server nobody browses (a routine runner) can skip building the screens:
# the build needs more memory than a small server spares.
if [ "${GODSPEED_SKIP_UI:-}" != 1 ] && [ ! -f "$version/notebook/ui/.godspeed-built" ]; then
  command -v npm >/dev/null || { echo "This computer's Node.js has no npm, which builds the notebook's screens. Install npm, then run the installer again." >&2; exit 1; }
  npm --prefix "$version/notebook/ui" ci --no-audit --no-fund
  npm --prefix "$version/notebook/ui" run build
  # The screens are built; the build's own packages are not needed to show them.
  rm -rf "$version/notebook/ui/node_modules"
  : > "$version/notebook/ui/.godspeed-built"
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

# The notebook runs as the account that installed it, where the original installer put
# Hermes, its settings and the folder. A system service starts with the computer and
# keeps running after logout; until 6 October 2026 an ordinary account got a service of
# its own login session, which stopped at logout and never started at boot, and under
# su or sudo -u, which has no such session, the installer stopped halfway.
service_user=$(id -un)
service_group=$(id -gn)
system_unit="/etc/systemd/system/$SERVICE"
user_unit="$HOME/.config/systemd/user/$SERVICE"
manager=none
if systemd_here; then
  if root_available; then manager=system; else manager=user; fi
fi

# Stop the notebook before its folder and its assistant are changed, and start the one
# that ran before again if the installation stops before it is switched over.
stopped=""
switched=""
trap 'status=$?; if [ "$status" -ne 0 ] && [ -n "$stopped" ] && [ -z "$switched" ]; then echo "The installation stopped, so the notebook that ran before is started again." >&2; if [ "$stopped" = system ]; then as_root systemctl start "$SERVICE" >/dev/null 2>&1 || true; else systemctl --user start "$SERVICE" >/dev/null 2>&1 || true; fi; fi' EXIT
# A unit whose file is here is stopped even when it is not running at this moment: one
# that keeps failing restarts every few seconds and could start in the middle of this.
if systemd_here; then
  if [ "$manager" = system ] && [ -f "$system_unit" ]; then
    if systemctl is-active --quiet "$SERVICE" 2>/dev/null; then stopped=system; fi
    as_root systemctl stop "$SERVICE"
  elif systemctl is-active --quiet "$SERVICE" 2>/dev/null; then
    echo "A notebook started by the computer's administrator is running. Ask them to stop it (sudo systemctl stop $SERVICE), then run the installer again." >&2; exit 1
  fi
  if [ -f "$user_unit" ]; then
    if systemctl --user is-active --quiet "$SERVICE" 2>/dev/null; then stopped=${stopped:-user}; fi
    systemctl --user stop "$SERVICE" >/dev/null 2>&1 || true
  fi
fi

"$node" "$version/notebook/bin/godspeed.mjs" init
# Joining: a mission control that is its own Git repository carries the notebook in it.
if [ ! -f "$root/.godspeed/sync-config.json" ] && git -C "$root" remote get-url origin >/dev/null 2>&1; then
  "$node" "$version/notebook/bin/godspeed.mjs" sync folder || echo 'The notebook was not joined to the repository; it works on this machine alone until it is.' >&2
fi
"$node" "$version/notebook/scripts/wire-assistant.mjs" "$HERMES_HOME"
"$node" --input-type=module - "$assistant" <<'NODE'
import fs from 'node:fs';import path from 'node:path';
fs.writeFileSync(path.join(process.env.GODSPEED_WORKSPACE,'.godspeed/assistant.json'),JSON.stringify({verified:true,executable:process.argv[2],home:process.env.HERMES_HOME}),{mode:0o600});
NODE
"$node" "$version/notebook/scripts/native-start-script.mjs" "$state/start.mjs" "$version/notebook/scripts/supervise.mjs"
before=$(cat "$state/version" 2>/dev/null || true)
if [ -n "$before" ] && [ "$before" != "$(basename "$version")" ]; then printf '%s\n' "$before" > "$state/previous-version"; fi
basename "$version" > "$state/version"
previous=$(cat "$state/previous-version" 2>/dev/null || true)
switched=1

started=""
case "$manager" in
  system)
    # A user service from an earlier installation would hold the same address.
    if [ -f "$user_unit" ]; then
      systemctl --user disable --now "$SERVICE" >/dev/null 2>&1 || true
      rm -f "$user_unit" "$HOME/.config/systemd/user/default.target.wants/$SERVICE"
      systemctl --user daemon-reload >/dev/null 2>&1 || true
    fi
    unit_text system | as_root tee "$system_unit" >/dev/null
    as_root systemctl daemon-reload
    as_root systemctl enable "$SERVICE" >/dev/null 2>&1
    as_root systemctl restart "$SERVICE"
    started=system
    ;;
  user)
    mkdir -p "$(dirname "$user_unit")/default.target.wants"
    unit_text user > "$user_unit"
    ln -sf "../$SERVICE" "$(dirname "$user_unit")/default.target.wants/$SERVICE"
    # Without lingering, a user's services stop at logout and wait for the next login.
    # Never a hidden password prompt: without the right to it, this simply fails.
    loginctl --no-ask-password enable-linger "$service_user" >/dev/null 2>&1 || true
    if systemctl --user daemon-reload >/dev/null 2>&1 && systemctl --user restart "$SERVICE" >/dev/null 2>&1; then started=user; fi
    if [ "$(loginctl show-user "$service_user" -p Linger --value 2>/dev/null || true)" != yes ]; then
      echo "The notebook runs while you are logged in. For it to start with the computer and keep running after you log out, ask whoever runs this computer to run once: sudo loginctl enable-linger $service_user" >&2
    fi
    [ -n "$started" ] || echo "The notebook starts the next time you log in. To start it now: '$node' '$state/start.mjs'" >&2
    ;;
  *)
    echo "Start the notebook with: '$node' '$state/start.mjs'"
    ;;
esac

if [ -n "$started" ]; then
  if ! answers; then
    if [ "$started" = system ]; then logs="journalctl -u $SERVICE -n 50"; else logs="journalctl --user -u $SERVICE -n 50"; fi
    echo "The notebook did not answer after it was started. What it said is shown by: $logs" >&2
    exit 1
  fi
  # This version and the one before it stay; older ones, and the full download of the
  # installations before versions had folders of their own, are removed.
  for old in "$state"/versions/*/; do
    old=$(basename "$old")
    [ "$old" = "$(basename "$version")" ] || [ "$old" = "$previous" ] || rm -rf "${state:?}/versions/$old"
  done
  rm -rf "${state:?}/source" "$state"/versions/.incoming.* "$state"/runtime/.download.*
fi
if [ "$service_user" = root ]; then
  echo 'The notebook and its assistant run as root here, so the assistant can change anything on this computer. Installing from an ordinary account avoids that.' >&2
fi
echo "Godspeed Mission Control folder: $root"
echo "Notebook: http://127.0.0.1:$GODSPEED_PORT/dashboard"
