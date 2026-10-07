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
    # The notebook's own /health (notebook/server/main.mjs), not merely any HTTP answer on the
    # port: JSON with ok:true, record format 1 and a version string. The old "r.ok" check passed
    # for anything on the port, so a stale or foreign process could hide a failed switch-over.
    if "$node" -e 'fetch("http://127.0.0.1:"+process.argv[1]+"/health").then(r=>r.ok?r.json():Promise.reject()).then(h=>process.exit(h&&h.ok===true&&h.format===1&&typeof h.version==="string"?0:1),()=>process.exit(1))' "$GODSPEED_PORT" 2>/dev/null; then return 0; fi
    sleep 2
  done
  return 1
}

# A re-run keeps the settings the installation ran with until now, which start.mjs
# holds: above all the machine's name, since the one named owner runs the routines.
# Until 6 October 2026 a re-run without GODSPEED_DEVICE renamed a server called
# "production" to "local", and every routine it owned stopped running.
previous_setting() {
  [ -f "$state/start.mjs" ] || return 0
  "$node" -e 'const t=require("fs").readFileSync(process.argv[1],"utf8"),m=t.match(new RegExp("\""+process.argv[2]+"\":(\"(?:[^\"\\\\]|\\\\.)*\")"));if(m)process.stdout.write(JSON.parse(m[1]))' "$state/start.mjs" "$1" 2>/dev/null || true
}

# --- The web address, on a server ---------------------------------------------------
# A server gets a web address with HTTPS, and every visit through it signs in. Caddy takes
# the certificate and hands each visit to the notebook's web door (GODSPEED_WEB_PORT),
# which answers only on this machine; the door on GODSPEED_PORT stays as it was for the
# assistant, the routines and the tools here. Until 7 October 2026 a server installed this
# way had only http://127.0.0.1:47831, which no other computer or phone can open. A server
# is a computer without a desktop whose public address has a name in public DNS
# (server-address.mjs), or one named in GODSPEED_HOST.
CADDY_VERSION=2.11.4
HTTPS_SERVICE=godspeed-https.service
CADDYFILE=/etc/caddy/Caddyfile
SITE_FILE=/etc/caddy/godspeed-notebook.caddy

desktop_here() { systemd_here && systemctl is-active --quiet display-manager 2>/dev/null; }

caddy_platform() {
  [ "$(uname -s)" = Linux ] || return 1
  case "$(uname -m)" in
    x86_64|amd64) printf linux_amd64 ;;
    aarch64|arm64) printf linux_arm64 ;;
    armv7l) printf linux_armv7 ;;
    *) return 1 ;;
  esac
}

# Prints the path of the installation's own Caddy, downloading it when needed, checked
# against the checksum list Caddy publishes beside it, the way Node.js is above.
install_caddy() {
  local platform name base dir tmp want
  platform=$(caddy_platform) || return 1
  name="caddy_${CADDY_VERSION}_$platform.tar.gz"
  base="https://github.com/caddyserver/caddy/releases/download/v$CADDY_VERSION"
  dir="$state/runtime/caddy-$CADDY_VERSION"
  # Output is read whole, never piped into grep -q: under pipefail a grep that stops at its
  # first match can fail the command that is still writing, and a match reads as none.
  if [ -x "$dir/caddy" ]; then
    case "$("$dir/caddy" version 2>/dev/null)" in "v$CADDY_VERSION "*) printf '%s' "$dir/caddy"; return 0 ;; esac
  fi
  mkdir -p "$state/runtime" || return 1
  tmp=$(mktemp -d "$state/runtime/.download.XXXXXX") || return 1
  if ! curl -fsSL "$base/caddy_${CADDY_VERSION}_checksums.txt" -o "$tmp/checksums.txt" \
     || ! curl -fsSL "$base/$name" -o "$tmp/$name"; then
    rm -rf "$tmp"; return 1
  fi
  want=$(awk -v file="$name" '$2 == file { print $1 }' "$tmp/checksums.txt")
  if [ -z "$want" ] || [ "$(sha512sum "$tmp/$name" | cut -d' ' -f1)" != "$want" ]; then
    echo 'The downloaded Caddy did not match its published checksum, so it was not used.' >&2
    rm -rf "$tmp"; return 1
  fi
  if ! mkdir "$tmp/out" || ! tar -xzf - -C "$tmp/out" caddy < "$tmp/$name" || ! "$tmp/out/caddy" version >/dev/null 2>&1; then
    rm -rf "$tmp"; return 1
  fi
  rm -rf "$dir" && mkdir -p "$dir" && mv "$tmp/out/caddy" "$dir/caddy" && rm -rf "$tmp" || return 1
  printf '%s' "$dir/caddy"
}

# The site: the address, and the notebook's web door behind it.
site_text() {
  printf '# The Godspeed Mission Control notebook'"'"'s web address. Its installer writes this file.\n'
  printf '%s {\n\treverse_proxy 127.0.0.1:%s\n}\n' "$1" "$2"
}
# The whole configuration of the installation's own Caddy. It has no admin endpoint (a
# change restarts it), so it never holds the port another Caddy's endpoint uses.
own_caddyfile() { printf '{\n\tadmin off\n}\n\n'; site_text "$1" "$2"; }

https_unit_text() {
  printf '[Unit]\nDescription=Godspeed Mission Control web address\nWants=network-online.target\nAfter=network-online.target\n'
  printf '[Service]\nUser=%s\nGroup=%s\n' "$service_user" "$service_group"
  printf 'Environment=%s\n' "$(unit_quoted "HOME=$HOME")" "$(unit_quoted "XDG_DATA_HOME=$state/https")" "$(unit_quoted "XDG_CONFIG_HOME=$state/https")"
  printf 'ExecStart=%s run --config %s --adapter caddyfile\n' "$(unit_word "$1")" "$(unit_word "$state/https/Caddyfile")"
  printf 'AmbientCapabilities=CAP_NET_BIND_SERVICE\nRestart=on-failure\nRestartSec=5\n[Install]\nWantedBy=multi-user.target\n'
}

# How the address is made depends on who answers on ports 80 and 443, which a certificate
# needs: the installation's own Caddy when nobody does (or it already does), the server's
# own Caddy when that is the one (the notebook's site is added to it), and nothing when
# another program holds them.
web_front() {
  if [ -f "/etc/systemd/system/$HTTPS_SERVICE" ]; then echo own; return; fi
  if systemctl is-active --quiet caddy 2>/dev/null && [ -f "$CADDYFILE" ]; then echo caddy; return; fi
  if [ -z "$(ss -ltnH '( sport = :80 or sport = :443 )' 2>/dev/null)" ]; then echo own; return; fi
  echo taken
}
port_holders() { as_root ss -ltnpH '( sport = :80 or sport = :443 )' 2>/dev/null | grep -o 'users:(("[^"]*"' | cut -d'"' -f2 | sort -u | paste -sd, - || true; }

# On the server's own Caddy, a name it already serves on 443 keeps that site, and the
# notebook gets a port of its own beside it under the same name and certificate.
caddy_site() {
  if awk -v name="$1" -v own="import $SITE_FILE" 'BEGIN { name = tolower(name) } /^[[:space:]]*#/ || $0 == own { next } index(tolower($0), name) { found = 1 } END { exit !found }' "$CADDYFILE"; then
    printf '%s:%s' "$1" "${GODSPEED_HTTPS_PORT:-48443}"
  else
    printf '%s' "$1"
  fi
}

# A firewall this server runs lets the port in.
open_port() {
  if command -v ufw >/dev/null 2>&1 && [[ "$(as_root ufw status 2>/dev/null)" == "Status: active"* ]]; then
    as_root ufw allow "$1/tcp" >/dev/null || true
  fi
  if command -v firewall-cmd >/dev/null 2>&1 && as_root firewall-cmd --state >/dev/null 2>&1; then
    as_root firewall-cmd --quiet --permanent --add-port="$1/tcp" && as_root firewall-cmd --quiet --reload || true
  fi
}

# Adds the site to the server's Caddy. A reload Caddy refuses leaves it serving what it
# served before, and the two files are put back as they were.
add_to_caddy() {
  local keep
  keep=$(mktemp -d) || return 1
  as_root cp -p "$CADDYFILE" "$keep/Caddyfile" || { rm -rf "$keep"; return 1; }
  if [ -f "$SITE_FILE" ]; then as_root cp -p "$SITE_FILE" "$keep/site"; fi
  if ! { site_text "$1" "$GODSPEED_WEB_PORT" | as_root tee "$SITE_FILE" >/dev/null \
         && as_root chmod 644 "$SITE_FILE" \
         && { grep -qxF "import $SITE_FILE" "$CADDYFILE" \
              || printf '\n# The Godspeed Mission Control notebook'"'"'s web address (its installer keeps this line).\nimport %s\n' "$SITE_FILE" | as_root tee -a "$CADDYFILE" >/dev/null; } \
         && as_root systemctl reload caddy; }; then
    as_root cp -p "$keep/Caddyfile" "$CADDYFILE"
    if [ -f "$keep/site" ]; then as_root cp -p "$keep/site" "$SITE_FILE"; else as_root rm -f "$SITE_FILE"; fi
    rm -rf "$keep"; return 1
  fi
  rm -rf "$keep"
}

start_own_caddy() {
  local caddy
  caddy=$(install_caddy) || return 1
  mkdir -p "$state/https" && own_caddyfile "$1" "$GODSPEED_WEB_PORT" > "$state/https/Caddyfile" || return 1
  https_unit_text "$caddy" | as_root tee "/etc/systemd/system/$HTTPS_SERVICE" >/dev/null
  as_root systemctl daemon-reload && as_root systemctl enable "$HTTPS_SERVICE" >/dev/null 2>&1 && as_root systemctl restart "$HTTPS_SERVICE"
}

# The address answers with the notebook's own /health, over a certificate curl trusts. A
# new certificate takes Caddy seconds to a minute or two.
address_answers() {
  local attempt
  for attempt in $(seq 1 "${1:-30}"); do
    case "$(curl -fsS -m 8 "$web_address/health" 2>/dev/null)" in *'"ok":true'*) return 0 ;; esac
    sleep 4
  done
  return 1
}

# The private link that makes the owner's account, from the door on this machine; nothing
# once the account exists.
setup_path() {
  "$node" -e 'const base="http://127.0.0.1:"+process.argv[1];fetch(base+"/api/auth/status").then(r=>r.json()).then(s=>s.configured?"":fetch(base+"/api/login-link",{method:"POST",headers:{"content-type":"application/json"},body:"{}"}).then(r=>r.json()).then(d=>d.path||Promise.reject())).then(p=>process.stdout.write(p),()=>process.exit(1))' "$GODSPEED_PORT"
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

# What this installation ran with until now stays, unless this run names it (previous_setting).
for setting in GODSPEED_DEVICE GODSPEED_PORT GODSPEED_MEDIA_ROOT GODSPEED_WEB_PORT GODSPEED_HOST; do
  if [ -z "${!setting:-}" ]; then
    value=$(previous_setting "$setting")
    if [ -n "$value" ]; then export "$setting=$value"; fi
  fi
done
if [ -z "${GODSPEED_INTEGRATED_BESIDE:-}" ] && [ "$(previous_setting HERMES_HOME)" = "$state/hermes" ]; then GODSPEED_INTEGRATED_BESIDE=1; fi
export GODSPEED_WORKSPACE="$root" GODSPEED_ORIGINAL_RUNTIME=on
export GODSPEED_PORT=${GODSPEED_PORT:-47831} GODSPEED_BIND=127.0.0.1
# The machine's name in the notebook; the one named owner runs the routines. Unnamed, the
# notebook names the machine itself once (core/device-id.mjs); "local", which every machine
# was given until 6 October 2026, could not tell two machines apart.
if [ -n "${GODSPEED_DEVICE:-}" ] && [ "$GODSPEED_DEVICE" != local ]; then export GODSPEED_DEVICE; else unset GODSPEED_DEVICE; fi
export GODSPEED_MEDIA_ROOT=${GODSPEED_MEDIA_ROOT:-$state/media}
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

# A server's web address ("The web address, on a server" above): the name it had, or the
# one GODSPEED_HOST gives, or the one public DNS has for it. Decided here, before the
# notebook is stopped, and made once the new notebook answers.
web_host=""
web_front_kind=""
web_site=""
web_problem=""
if [ -n "${GODSPEED_HOST:-}" ]; then
  web_host=$("$node" "$version/notebook/scripts/server-address.mjs" --name "$GODSPEED_HOST") \
    || { echo "GODSPEED_HOST is not a name a web address can have: $GODSPEED_HOST" >&2; exit 1; }
elif [ "$(uname -s)" = Linux ] && ! desktop_here; then
  web_host=$("$node" "$version/notebook/scripts/server-address.mjs" 2>/dev/null || true)
fi
if [ -n "$web_host" ]; then
  export GODSPEED_HOST="$web_host" GODSPEED_WEB_PORT=${GODSPEED_WEB_PORT:-47833}
  if [ "$manager" != system ]; then
    web_problem="This is a server, and making its web address needs systemd and the administrator's rights once. Run the installer again from an account that may use sudo."
  else
    web_front_kind=$(web_front)
    case "$web_front_kind" in
      own) web_site=$web_host ;;
      caddy) web_site=$(caddy_site "$web_host") ;;
      *) web_problem="This is a server, but another program ($(port_holders)) answers on ports 80 and 443, which its web address needs for a certificate, so the notebook has no web address yet." ;;
    esac
  fi
fi
web_address=${web_site:+https://$web_site}

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

# Before the new version is wired in, keep a checked backup of the knowledge and media
# (release-contract.md line 15), using the previous notebook's own backup command. Only on an
# upgrade: a first install has nothing to back up yet. Until 7 October 2026 the new version's
# init and wire-assistant ran with no backup and no way back. Added 7 October 2026.
upgrading=""
backup_dir=""
before=$(cat "$state/version" 2>/dev/null || true)
if [ -n "$before" ]; then
  upgrading=1
  backup_dir="$state/backups/$(date -u +%Y%m%d-%H%M%S)-$before"
  backup_cli="$state/versions/$before/notebook/bin/godspeed.mjs"
  [ -f "$backup_cli" ] || backup_cli="$version/notebook/bin/godspeed.mjs"
  if "$node" "$backup_cli" backup "$backup_dir" >/dev/null 2>&1; then
    echo "A backup of your knowledge and media was made at: $backup_dir" >&2
  else
    echo 'The pre-upgrade backup could not be made, so the upgrade was not started.' >&2
    exit 1
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
# "before" is read above, before the new version's init could change anything.
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
    # The new version did not answer. On an upgrade, put the version that ran before back, so
    # the server is not left on a broken notebook with no way home: until 7 October 2026 it
    # exited here with the new version switched in and the previous one stopped. Added 7 Oct 2026.
    if [ -n "$upgrading" ] && [ -n "$before" ] && [ "$before" != "$(basename "$version")" ] && [ -f "$state/versions/$before/notebook/scripts/supervise.mjs" ]; then
      echo "The new notebook did not answer, so the version that ran before is being put back. What the new one said is shown by: $logs" >&2
      "$node" "$version/notebook/scripts/native-start-script.mjs" "$state/start.mjs" "$state/versions/$before/notebook/scripts/supervise.mjs"
      printf '%s\n' "$before" > "$state/version"
      if [ "$started" = system ]; then as_root systemctl restart "$SERVICE"; else systemctl --user restart "$SERVICE" >/dev/null 2>&1 || true; fi
      if answers; then
        echo "The previous notebook is running again; the upgrade was not applied. Your data backup is at: $backup_dir" >&2
      else
        echo "The previous notebook did not come back either. Start it by hand: '$node' '$state/start.mjs'. Your data backup is at: $backup_dir" >&2
      fi
    else
      echo "The notebook did not answer after it was started. What it said is shown by: $logs${backup_dir:+. Your data backup is at: $backup_dir}" >&2
    fi
    exit 1
  fi
  # This version and the one before it stay; older ones, and the full download of the
  # installations before versions had folders of their own, are removed.
  for old in "$state"/versions/*/; do
    old=$(basename "$old")
    [ "$old" = "$(basename "$version")" ] || [ "$old" = "$previous" ] || rm -rf "${state:?}/versions/$old"
  done
  rm -rf "${state:?}/source" "$state"/versions/.incoming.* "$state"/runtime/.download.*

  # The web address, now that the notebook's web door answers.
  if [ -n "$web_site" ]; then
    web_ports="ports 80 and 443"
    case "$web_front_kind" in
      own)
        open_port 80; open_port 443
        start_own_caddy "$web_site" \
          || web_problem="Caddy, which gives the notebook its web address, could not be set up here. What it said is shown by: journalctl -u $HTTPS_SERVICE -n 50"
        ;;
      caddy)
        case "$web_site" in *:*) web_ports="port ${web_site##*:}"; open_port "${web_site##*:}" ;; esac
        add_to_caddy "$web_site" \
          || web_problem="This server's Caddy did not take the notebook's web address, so it goes on serving what it served before. What it said is shown by: journalctl -u caddy -n 50"
        ;;
    esac
    if [ -z "$web_problem" ] && ! address_answers; then
      if [ "$web_front_kind" = own ]; then logs="journalctl -u $HTTPS_SERVICE -n 50"; else logs="journalctl -u caddy -n 50"; fi
      web_problem="The notebook's web address $web_address does not answer yet. If the hosting provider has a firewall, it must let in $web_ports. What Caddy said is shown by: $logs"
    fi
  fi
fi
if [ "$service_user" = root ]; then
  echo 'The notebook and its assistant run as root here, so the assistant can change anything on this computer. Installing from an ordinary account avoids that.' >&2
fi
echo "Godspeed Mission Control folder: $root"
if [ -n "$web_address" ] && [ -z "$web_problem" ]; then
  setup=$(setup_path || true)
  if [ -n "$setup" ]; then
    echo "Notebook: open this private link to make your account. It works once, for 24 hours, and running the installer again makes a new one:"
    echo "$web_address$setup"
  else
    echo "Notebook: $web_address/dashboard"
  fi
else
  echo "Notebook: http://127.0.0.1:$GODSPEED_PORT/dashboard"
  # A server without its web address is not finished.
  if [ -n "$web_problem" ]; then echo "$web_problem" >&2; exit 1; fi
fi
