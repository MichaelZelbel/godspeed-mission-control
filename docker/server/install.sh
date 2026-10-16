#!/bin/bash
# =============================================================================
# Godspeed Mission Control on any Linux server you already have, in one line.
#
# On the server, logged in as root (or as a user who may use sudo):
#
#   curl -fsSL https://teachitonce.com/server | bash
#
# (the same file as https://raw.githubusercontent.com/MichaelZelbel/godspeed-mission-control/main/docker/server/install.sh)
#
# What it does: installs Docker if the server has none, puts the very compose.yaml that
# Hostinger's one-click deploys (docker/hostinger/compose.yaml, the image pinned by digest)
# in /opt/godspeed-mission-control with its two settings in .env, starts it, waits until the
# web page answers over HTTPS, and prints one private link. That link opens the account page
# with the setup code already filled in: the reader picks a username and password, saves the
# recovery code, and goes on to Connect Telegram, exactly like a Hostinger reader.
#
# The address: GODSPEED_HOST if you set it (your own domain, pointed at this server), otherwise
# this server's public IPv4 address as <a-b-c-d>.sslip.io, a free name that points back at that
# address, so the HTTPS certificate is a real one without you owning a domain.
#
# Safe to run again: it keeps the setup code, the address and all data, updates to the image
# compose.yaml pins today, and never makes a second owner. Before the account exists it prints a
# fresh link (the old one stops working); after that it says to sign in.
#
# Settings, all optional:
#   GODSPEED_HOST=name.example.com     use your own domain instead of <ip>.sslip.io
#   GODSPEED_INSTALL_COUNT=yes         tell Michael once that an install worked (default: nothing is sent)
# docker/README.md, "Any Linux server, one line", has the rest; docker/server/test.sh tests it.
# =============================================================================

# Everything is inside functions and the last line calls main, so a download that breaks off
# halfway runs nothing at all.

GODSPEED_RAW="${GODSPEED_RAW:-https://raw.githubusercontent.com/MichaelZelbel/godspeed-mission-control/main}"
GODSPEED_SELF_URL="${GODSPEED_SELF_URL:-$GODSPEED_RAW/docker/server/install.sh}"
DIR="${GODSPEED_DIR:-/opt/godspeed-mission-control}"
PROJECT=godspeed-mission-control
CERT_WAIT="${GODSPEED_CERT_WAIT:-300}"   # seconds to wait for the HTTPS certificate
START_WAIT="${GODSPEED_START_WAIT:-600}" # seconds to wait for the app to answer
NEED_GB=8                                # free disk space the first download needs
HTTPS_PORT=443                           # the tests point this elsewhere; the server uses 443
SELF_FILE="${BASH_SOURCE[0]:-}"
LOG="$DIR/install.log"

say()  { printf '%s\n' "$*"; }
step() { printf -- '- %s\n' "$*"; }
stop() { printf '\n%s\n\n' "$*" >&2; exit 1; }
minutes() { local m=$(( ($1 + 59) / 60 )); [ "$m" -eq 1 ] && echo "1 minute" || echo "$m minutes"; }
log()  { [ -d "$DIR" ] && printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "$LOG" 2>/dev/null; return 0; }

# --- The address -------------------------------------------------------------

# 203.0.113.7 -> 0 when it is a well-formed IPv4 address.
is_ipv4() {
  local ip="$1" part parts
  [[ "$ip" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]] || return 1
  IFS=. read -r -a parts <<< "$ip"
  for part in "${parts[@]}"; do [ "$((10#$part))" -le 255 ] || return 1; done
  return 0
}

# Addresses nobody on the internet can reach: a home network, a provider's inside network,
# this machine itself. A certificate for one of them can never be issued.
is_private_ipv4() {
  local a b
  IFS=. read -r a b _ _ <<< "$1"
  [ "$a" = 10 ] || [ "$a" = 127 ] || [ "$a" = 0 ] || { [ "$a" = 169 ] && [ "$b" = 254 ]; } \
    || { [ "$a" = 172 ] && [ "$b" -ge 16 ] && [ "$b" -le 31 ]; } || { [ "$a" = 192 ] && [ "$b" = 168 ]; } \
    || { [ "$a" = 100 ] && [ "$b" -ge 64 ] && [ "$b" -le 127 ]; } || [ "$a" -ge 224 ]
}

# 203.0.113.7 -> 203-0-113-7.sslip.io, a name sslip.io answers with that same address.
sslip_host() {
  is_ipv4 "$1" || return 1
  printf '%s.sslip.io\n' "${1//./-}"
}

# The address the internet sees this server under. Asked from outside first (a server behind
# a router only knows its inside address), then the server's own outgoing address if public.
public_ipv4() {
  local url ip
  for url in https://api.ipify.org https://ipv4.icanhazip.com https://ifconfig.me/ip; do
    ip="$(curl -4 -fsS --max-time 8 "$url" 2>/dev/null | tr -d ' \r\n')"
    if is_ipv4 "$ip" && ! is_private_ipv4 "$ip"; then printf '%s\n' "$ip"; return 0; fi
  done
  ip="$(ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p' | head -1)"
  if is_ipv4 "$ip" && ! is_private_ipv4 "$ip"; then printf '%s\n' "$ip"; return 0; fi
  return 1
}

# "https://Mission.Example.com/" -> mission.example.com; refuses anything that is not a name.
clean_host() {
  local h="${1#http://}"; h="${h#https://}"; h="${h%%/*}"
  h="$(printf '%s' "$h" | tr 'A-Z' 'a-z')"
  [[ "$h" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] || return 1
  printf '%s\n' "$h"
}

# Names Caddy makes its own certificate for (no public authority issues one for them).
local_host() {
  case "$1" in localhost|*.localhost|*.local|*.internal|*.home.arpa) return 0 ;; esac
  is_ipv4 "$1"
}

# --- The machine ---------------------------------------------------------------

# Docker for Debian and Ubuntu comes from Docker's own installer; elsewhere Docker must be there.
os_supported() {
  local file="${1:-/etc/os-release}" id="" like=""
  [ -r "$file" ] || return 1
  id="$(sed -n 's/^ID=//p' "$file" | tr -d '"')"; like="$(sed -n 's/^ID_LIKE=//p' "$file" | tr -d '"')"
  case " $id $like " in *" debian "*|*" ubuntu "*|*" raspbian "*) return 0 ;; esac
  return 1
}
os_name() { sed -n 's/^PRETTY_NAME=//p' "${1:-/etc/os-release}" 2>/dev/null | tr -d '"'; }

# 0 when something on this machine listens on that TCP port.
port_in_use() {
  local p="$1"
  if command -v ss >/dev/null 2>&1; then
    [ -n "$(ss -Hltn "( sport = :$p )" 2>/dev/null)" ]
  else
    (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null
  fi
}
port_owner() { command -v ss >/dev/null 2>&1 && ss -Hltnp "( sport = :$1 )" 2>/dev/null | sed -n 's/.*users:(("\([^"]*\)".*/\1/p' | head -1; }

# Stops with one sentence when another program holds a port Godspeed needs.
check_ports() {
  local p who
  for p in "$@"; do
    port_in_use "$p" || continue
    who="$(port_owner "$p")"
    stop "Another program on this server already uses port $p${who:+ ($who)}. Godspeed Mission Control needs ports 80 and 443 for its secure web page, and this installer leaves other programs alone, so nothing was changed. Stop that program, or use a server that runs nothing else, then run this line again."
  done
}

# --- Waiting -----------------------------------------------------------------

compose() { docker compose -p "$PROJECT" --project-directory "$DIR" -f "$DIR/compose.yaml" --env-file "$DIR/.env" "$@"; }

# Until the notebook inside answers its health check.
wait_healthy() {
  local deadline=$((SECONDS + START_WAIT)) id state
  while [ "$SECONDS" -lt "$deadline" ]; do
    id="$(compose ps -q godspeed 2>/dev/null | head -1)"
    state="$([ -n "$id" ] && docker inspect -f '{{.State.Health.Status}}' "$id" 2>/dev/null)"
    [ "$state" = healthy ] && return 0
    sleep 3
  done
  return 1
}

# Until https://HOST answers with a certificate the browser will accept (Caddy's own for
# localhost-like names). Asked on this machine, so a router that cannot loop back is no obstacle.
https_ready() {
  local host="$1" insecure=()
  local_host "$host" && insecure=(-k)
  curl -fsS "${insecure[@]}" --max-time 10 -o /dev/null \
    --resolve "$host:$HTTPS_PORT:127.0.0.1" "https://$host:$HTTPS_PORT/health" 2>/dev/null
}
wait_certificate() {
  local host="$1" deadline=$((SECONDS + CERT_WAIT))
  while :; do
    https_ready "$host" && return 0
    [ "$SECONDS" -ge "$deadline" ] && break
    sleep 5
  done
  stop "Godspeed Mission Control is running, but it could not get its security certificate for https://$host within $(minutes "$CERT_WAIT"). The certificate is only given to a server the internet can reach on ports 80 and 443. Open those two ports in your hosting company's firewall (or forward them on your home router to this machine), then run this line again; your settings and data are kept."
}

# --- The owner's link ----------------------------------------------------------

# Asks the app inside for a private /setup#invite=... link, with the setup code on standard
# input (never on a command line, where every account on the server could read it).
# Prints "link <path>", "owner" (an account exists already) or "error <message>".
owner_link() {
  printf '%s' "$1" | compose exec -T godspeed node --input-type=module -e '
let code="";for await(const c of process.stdin)code+=c;
try{const r=await fetch("http://127.0.0.1:47831/api/auth/bootstrap",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:code.trim()})});
const d=await r.json().catch(()=>({}));
if(r.ok&&/^\/setup#invite=[a-f0-9]{64}$/.test(d.path||""))console.log("link "+d.path);
else if(r.status===409)console.log("owner");
else console.log("error "+(d.error||("status "+r.status)));}
catch(e){console.log("error "+e.message)}' 2>>"$LOG"
}

# --- The install count -----------------------------------------------------------

# The other installers ask; this one, run through a pipe, only honours GODSPEED_INSTALL_COUNT=yes
# set by the reader (default: nothing is sent). It sends the word "installed", the kind of
# install and a random number made here, once (THE INSTALL COUNT in kit-bootstrap's lib.sh).
count_install() {
  case "${GODSPEED_INSTALL_COUNT:-}" in [Yy]*|1) ;; *) return 0 ;; esac
  case "${DO_NOT_TRACK:-}" in ""|0|false|no) ;; *) return 0 ;; esac
  local file="$DIR/install-count" id
  [ -f "$file" ] && grep -q '^sent=installed' "$file" && return 0
  id="$(sed -n 's/^id=//p' "$file" 2>/dev/null)"
  [ -n "$id" ] || id="$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
  printf 'id=%s\n' "$id" > "$file"
  if curl -fsS -m 8 -o /dev/null -X POST -H 'Content-Type: application/json' \
       --data "{\"product\":\"mission-control\",\"event\":\"installed\",\"install\":\"$id\",\"kind\":\"docker-server\",\"run\":\"new\"}" \
       "${KB_INSTALL_COUNT_URL:-https://srv1328602.hstgr.cloud/signal/v1}" >/dev/null 2>&1; then
    printf 'sent=installed\n' >> "$file"
  fi
  return 0
}

# The last words a person reads after installing: where the mission control is, how to start
# talking to it, and where to hear more. The Linux and Mac installer and the Windows setup's
# finish page end with the same three things. With a private link (the account is not made yet)
# it is a first install; without one the account exists. A run that failed never gets here.
finished_words() {
  local host="$1" link="${2:-}"
  say ""
  if [ -n "$link" ]; then
    say "Your mission control is installed at https://$host."
    say ""
    say "To talk to it, open this private link in your browser to make your account:"
    say ""
    say "  https://$host$link"
    say ""
    say "Choose a username and password there, and save the recovery code it shows you."
    say "The link works once, within 24 hours. Run this line again for a new one."
  else
    say "Your mission control is up to date at https://$host, and your account already exists."
    say "To talk to it, sign in there with your username and password."
  fi
  say ""
  say "I write about what it does and what broke, free: https://michaelzelbel.substack.com/subscribe"
  say ""
}

# --- The run ---------------------------------------------------------------------

as_root() {
  [ "$(id -u)" -eq 0 ] && return 0
  command -v sudo >/dev/null 2>&1 || stop "This needs the server's administrator account. Log in as root and run this line again."
  say "This needs the server's administrator rights, so it asks sudo (it may ask for your password)."
  local pass=() v
  for v in GODSPEED_HOST GODSPEED_RAW GODSPEED_SELF_URL GODSPEED_DIR GODSPEED_INSTALL_COUNT DO_NOT_TRACK GODSPEED_CERT_WAIT GODSPEED_START_WAIT; do
    [ -n "${!v:-}" ] && pass+=("$v=${!v}")
  done
  if [ -n "$SELF_FILE" ] && [ -f "$SELF_FILE" ]; then
    exec sudo env "${pass[@]}" bash "$SELF_FILE"
  fi
  curl -fsSL "$GODSPEED_SELF_URL" | sudo env "${pass[@]}" bash
  exit "${PIPESTATUS[1]}"
}

main() {
  set -uo pipefail
  as_root

  say "Installing Godspeed Mission Control on this server."
  case "$(uname -m)" in x86_64|amd64) ;; *)
    stop "This server's processor is $(uname -m). Godspeed Mission Control runs on ordinary x86-64 (Intel or AMD) servers for now, so nothing was changed." ;;
  esac
  mkdir -p "$DIR" && chmod 700 "$DIR" || stop "Could not create the folder $DIR."
  log "install started"

  # Docker, the program Godspeed runs in.
  if ! command -v docker >/dev/null 2>&1; then
    os_supported || stop "This installer can set up Docker on Debian and Ubuntu, and this server runs $(os_name || echo 'another system'). Install Docker with its compose plugin (docs.docker.com/engine/install), then run this line again."
    step "Installing Docker, the program Godspeed runs in. This takes a few minutes."
    { curl -fsSL https://get.docker.com -o "$DIR/get-docker.sh" && sh "$DIR/get-docker.sh"; } </dev/null >>"$LOG" 2>&1 \
      || stop "Docker could not be installed. What went wrong is written in $LOG."
    rm -f "$DIR/get-docker.sh"
  fi
  if ! docker info >/dev/null 2>&1; then
    systemctl enable --now docker >>"$LOG" 2>&1 || service docker start >>"$LOG" 2>&1 || true
    for _ in $(seq 1 20); do docker info >/dev/null 2>&1 && break; sleep 1; done
    docker info >/dev/null 2>&1 || stop "Docker is installed but does not start. What went wrong is written in $LOG."
  fi
  if ! docker compose version >/dev/null 2>&1; then
    { apt-get update && apt-get install -y docker-compose-plugin; } </dev/null >>"$LOG" 2>&1 || true
    docker compose version >/dev/null 2>&1 || stop "Docker is here but its compose plugin is not, and it could not be added. Install docker-compose-plugin, then run this line again."
  fi
  log "$(docker --version)"

  # Another Godspeed on this machine: the older container (docker/install.sh), or this
  # same project started from somewhere else (a hosting company's one-click). Both are left alone.
  local elsewhere
  if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx godspeed \
     || { [ -f "$DIR/compose.yaml" ] && ! grep -q 'godspeed-certificates' "$DIR/compose.yaml"; }; then
    stop "This server already runs an earlier Godspeed Mission Control, set up another way. This line does not replace it, so nothing was changed."
  fi
  elsewhere="$(docker ps -a --filter "label=com.docker.compose.project=$PROJECT" --format '{{.Label "com.docker.compose.project.working_dir"}}' 2>/dev/null | grep -vx "$DIR" | head -1)"
  [ -z "$elsewhere" ] || stop "Godspeed Mission Control already runs on this server, started from $elsewhere (for example by your hosting company's one-click install). Manage it there; nothing was changed."

  # The settings: kept from an earlier run, otherwise made now.
  local host="" code="" ip="" first=yes
  if [ -f "$DIR/.env" ]; then
    first=no
    host="$(sed -n 's/^GODSPEED_HOST=//p' "$DIR/.env" | tail -1)"
    code="$(sed -n 's/^GODSPEED_SETUP_CODE=//p' "$DIR/.env" | tail -1)"
  fi
  if [ -n "${GODSPEED_HOST:-}" ]; then
    host="$(clean_host "$GODSPEED_HOST")" || stop "GODSPEED_HOST should be a name like mission.example.com, without https:// and without a path."
  elif [ -z "$host" ]; then
    ip="$(public_ipv4)" || stop "Could not find this server's public internet address. If it has a domain name pointing at it, run the line again with that name: curl -fsSL https://teachitonce.com/server | GODSPEED_HOST=your.domain.com bash"
    host="$(sslip_host "$ip")"
  fi
  [[ "$code" =~ ^[a-f0-9]{64}$ ]] || code="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"

  # Ports 80 and 443, unless it is this installation that holds them already.
  if [ -z "$(compose ps -q --status running https 2>/dev/null)" ]; then
    check_ports 80 443
  fi

  # Room for the image (about 5 GB unpacked, more while it unpacks), checked before the first download.
  if [ "$first" = yes ]; then
    local root free_kb
    root="$(docker info -f '{{.DockerRootDir}}' 2>/dev/null)"
    free_kb="$(df -Pk "${root:-/var/lib/docker}" 2>/dev/null | awk 'NR==2 {print $4}')"
    if [ -n "$free_kb" ] && [ "$free_kb" -lt $((NEED_GB * 1024 * 1024)) ]; then
      stop "This server has $((free_kb / 1024 / 1024)) GB of free disk space, and Godspeed Mission Control needs about $NEED_GB GB. Free some space or choose a bigger server, then run this line again."
    fi
  fi

  # The one definition of what runs: the same compose.yaml as Hostinger's one-click.
  curl -fsSL "$GODSPEED_RAW/docker/hostinger/compose.yaml" -o "$DIR/compose.yaml.new" 2>>"$LOG" \
    && grep -q "^name: $PROJECT" "$DIR/compose.yaml.new" \
    || { rm -f "$DIR/compose.yaml.new"; stop "Could not download Godspeed Mission Control's settings file. Check that this server can reach github.com, then run this line again."; }
  mv -f "$DIR/compose.yaml.new" "$DIR/compose.yaml"
  ( umask 077; printf 'GODSPEED_HOST=%s\nGODSPEED_SETUP_CODE=%s\n' "$host" "$code" > "$DIR/.env.new" ) && mv -f "$DIR/.env.new" "$DIR/.env"
  chmod 600 "$DIR/.env"
  log "address $host, first run: $first"

  if [ "$first" = yes ]; then step "Downloading Godspeed Mission Control (a few minutes)."; else step "Updating Godspeed Mission Control if there is a newer version."; fi
  compose pull -q >>"$LOG" 2>&1 || stop "The download did not finish. Check that the server has internet and at least $NEED_GB GB of free disk space, then run this line again. What went wrong is written in $LOG."
  step "Starting it."
  compose up -d --remove-orphans >>"$LOG" 2>&1
  if ! wait_healthy; then
    compose logs --tail 100 >>"$LOG" 2>&1
    stop "Godspeed Mission Control did not start. What went wrong is written in $LOG."
  fi
  # A new image keeps the HTTPS service waiting for the app; make sure it runs now.
  compose up -d >>"$LOG" 2>&1
  step "Getting the security certificate for https://$host (up to $(minutes "$CERT_WAIT"))."
  wait_certificate "$host"

  local answer; answer="$(owner_link "$code")"
  log "owner link: ${answer%% *}"
  count_install   # sends at most once per server, and only when asked to
  case "$answer" in
    link\ *) finished_words "$host" "${answer#link }" ;;
    owner)   finished_words "$host" ;;
    *)
      stop "Godspeed Mission Control runs at https://$host, but it did not hand out your private link (${answer#error }). Run this line again in a minute." ;;
  esac
}

[ "${GODSPEED_INSTALL_LIB:-}" = 1 ] || main "$@"
