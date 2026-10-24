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
#   GODSPEED_INSTALL_COUNT=yes         send one anonymous note that the install worked (default: nothing is sent)
#   GODSPEED_IMAGE=ghcr.io/michaelzelbel/godspeed-mission-control:v2-sha-<commit>
#                                      try one version before it is released to everybody (kept for
#                                      later runs; GODSPEED_IMAGE=release goes back to the released one)
#   GODSPEED_APT_WAIT=900              seconds to wait for a new server to finish installing its own
#                                      updates before Docker is installed (default 15 minutes)
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
APT_WAIT="${GODSPEED_APT_WAIT:-900}"     # seconds to wait for the server's own updates to finish
NEED_GB=8                                # free disk space the first download needs
HTTPS_PORT=443                           # the tests point this elsewhere; the server uses 443
SELF_FILE="${BASH_SOURCE[0]:-}"
LOG="$DIR/install.log"

say()  { printf '%s\n' "$*"; }
step() { printf -- '- %s\n' "$*"; }
stop() { printf '\n%s\n\n' "$*" >&2; exit 1; }
minutes() { local m=$(( ($1 + 59) / 60 )); [ "$m" -eq 1 ] && echo "1 minute" || echo "$m minutes"; }
log()  { [ -d "$DIR" ] && printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "$LOG" 2>/dev/null; return 0; }
log_lines() { local n; n="$(wc -l 2>/dev/null < "$LOG")"; echo "$((${n:-0}))"; }

# What a program wrote to the log after line $1 that says what went wrong: apt's own error lines
# ("E: Could not get lock ...") when there are any, otherwise its last five lines. Our own dated
# lines are left out, a line repeated by a second try is shown once.
log_reason() {
  local new errors
  new="$(tail -n +"$((${1:-0} + 1))" "$LOG" 2>/dev/null | grep -vE '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]{8}Z ' \
         | sed 's/[[:space:]]*$//' | grep -v '^$' | cut -c1-200)"
  errors="$(printf '%s\n' "$new" | grep -E '^(E: |ERROR)')"
  [ -n "$errors" ] || errors="$(printf '%s\n' "$new" | tail -n 5)"
  printf '%s\n' "$errors" | awk 'NF && !seen[$0]++' | tail -n 5
}

# Stops with sentence $1 and, under it, what went wrong since log line $2, so the reader sees the
# reason without opening a file.
stop_showing_log() {
  local reason; reason="$(log_reason "${2:-0}")"
  [ -n "$reason" ] || stop "$1 What went wrong is written in $LOG."
  stop "$1 This is what went wrong:

$(printf '%s\n' "$reason" | sed 's/^/    /')

The whole story is in $LOG."
}

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

# --- A version to try before it is released ---------------------------------------------
# (16 October 2026.) The compose.yaml on main pins the released image by digest, the same one
# Hostinger's one-click installs. GODSPEED_IMAGE names another image of this product, one the
# "Integrated Godspeed v2" check built and published for a commit (:v2-sha-<commit>, or @sha256:...),
# and this server runs that one instead. It is kept in .env, so running the line again stays on it
# (going back to the older released image could meet data the newer one already changed);
# GODSPEED_IMAGE=release goes back to what compose.yaml pins.
IMAGE_REPO=ghcr.io/michaelzelbel/godspeed-mission-control
test_image() { [[ "$1" =~ ^ghcr\.io/michaelzelbel/godspeed-mission-control(:v2-sha-[0-9a-f]{40}|@sha256:[0-9a-f]{64})$ ]]; }
# Puts image $2 on the godspeed service's image line of compose file $1; the HTTPS service's stays.
pin_image() {
  sed -i -E "s#^(    image: )ghcr\.io/michaelzelbel/godspeed-mission-control[@:][^[:space:]]*\$#\1$2#" "$1" \
    && grep -qx "    image: $2" "$1"
}

# A host add-on asks the installed container for a model answer. No model key or
# subscription login leaves that container; no new port or Docker socket mount.
install_model_command() {
  local command_dir="${GODSPEED_MODEL_COMMAND_DIR:-/usr/local/bin}"
  mkdir -p "$DIR/.godspeed" "$command_dir" || return 1
  curl -fsSL "$GODSPEED_RAW/notebook/bin/godspeed-docker-model.mjs" -o "$DIR/.godspeed/model.mjs.new" \
    || { rm -f "$DIR/.godspeed/model.mjs.new"; return 1; }
  mv -f "$DIR/.godspeed/model.mjs.new" "$DIR/.godspeed/model.mjs" || return 1
  printf '%s\n' '{"format":1,"kind":"godspeed-docker","service":"godspeed","workspace":"/opt/data/full-candidate/workspace"}' > "$DIR/.godspeed/model-host.json"
  # An existing command can belong to another native Godspeed installation.
  # Leave it alone: an add-on bound here uses this folder's model.mjs first.
  if [ ! -e "$command_dir/godspeed-model" ] && [ ! -L "$command_dir/godspeed-model" ]; then
    {
      printf '#!/bin/bash\n# Godspeed Docker model command\ninstall=%q\ndocker=%q\n' "$DIR" "$(command -v docker)"
      cat <<'MODEL'
describe=no
chosen=no
while [ "$#" -gt 0 ]; do
  case "$1" in
    --workspace)
      [ "$chosen" = no ] && [ "$#" -ge 2 ] && [ -d "$2" ] && [ "$(cd "$2" && pwd -P)" = "$(cd "$install" && pwd -P)" ] \
        || { echo 'This model command belongs to a different Godspeed server installation.' >&2; exit 1; }
      chosen=yes; shift 2 ;;
    --check|--describe) describe=yes; shift ;;
    *) echo 'Use godspeed-model with --workspace and optional --check.' >&2; exit 1 ;;
  esac
done
args=()
[ "$describe" = no ] || args+=(--check)
exec "$docker" compose -p godspeed-mission-control --project-directory "$install" -f "$install/compose.yaml" --env-file "$install/.env" \
  exec -T --user hermes godspeed timeout 245 node /opt/godspeed/kit/notebook/bin/godspeed-model.mjs --workspace /opt/data/full-candidate/workspace "${args[@]}"
MODEL
    } > "$command_dir/godspeed-model"
    chmod 755 "$command_dir/godspeed-model"
  fi
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

# --- Docker, and apt that installs it -------------------------------------------------
# (16 October 2026.) Docker comes from Docker's own installer (get.docker.com), which installs it
# with apt, the program that installs software on Debian and Ubuntu. Apt lets one program at a
# time do that, and each one holds these files locked while it works. A server that was just made
# or reinstalled spends its first minutes installing its own updates, so Docker's installer met
# those locks and stopped at once ("Could not get lock /var/lib/apt/lists/lock"). Now we wait
# until apt is free, tell apt to wait for a lock instead of stopping, and try three times.
APT_LOCKS="/var/lib/dpkg/lock-frontend /var/lib/dpkg/lock /var/lib/apt/lists/lock /var/cache/apt/archives/lock"
DOCKER_URL=https://get.docker.com
DOCKER_TRIES=3
DOCKER_PAUSE=10      # seconds between two tries
APT_WAITED=no        # the waiting line is said once per run

# 0 when another program holds one of APT_LOCKS. They are fcntl locks, which flock cannot see, so
# perl (always there on Debian and Ubuntu, apt and dpkg need it) asks the system who holds each.
# Without perl, fuser says whether any program has one of them open. Not knowing counts as free:
# apt's own wait and the three tries are still there.
apt_busy() {
  local f
  if command -v perl >/dev/null 2>&1; then
    # shellcheck disable=SC2086  # APT_LOCKS is a list of paths without spaces
    perl -MFcntl -e '
      for my $file (@ARGV) {
        open(my $fh, "<", $file) or next;
        my $lock = pack("ssx4qqix4", F_WRLCK, 0, 0, 0, 0);
        fcntl($fh, F_GETLK, $lock) or next;
        my ($type) = unpack("s", $lock);
        exit 0 if $type == F_WRLCK || $type == F_RDLCK;
      }
      exit 1;' $APT_LOCKS
    return
  fi
  command -v fuser >/dev/null 2>&1 || return 1
  for f in $APT_LOCKS; do [ -e "$f" ] && fuser "$f" >/dev/null 2>&1 && return 0; done
  return 1
}

# Until apt is free, up to APT_WAIT seconds. Says so once, and only when it has to wait. $1 is how
# the sentence ends when it gives up.
wait_for_apt() {
  local ending="${1:-nothing was changed.}" deadline=$((SECONDS + APT_WAIT))
  apt_busy || return 0
  if [ "$APT_WAITED" = no ]; then
    step "This server is still installing its own updates. Waiting for them to finish (up to $(minutes "$APT_WAIT"))."
    APT_WAITED=yes
  fi
  log "apt is busy with another program; waiting"
  while apt_busy; do
    if [ "$SECONDS" -ge "$deadline" ]; then
      log "apt was still busy after $APT_WAIT seconds"
      stop "This server is still busy installing its own updates. Run this line again in a few minutes; $ending"
    fi
    sleep 2
  done
  log "apt is free"
}

# Runs a command with apt told to wait up to five minutes for a lock instead of stopping at once.
# APT_CONFIG adds this one setting to apt's own settings; it replaces none of them.
patient_apt() {
  local conf="$DIR/apt-wait.conf" rc
  printf 'DPkg::Lock::Timeout "300";\n' > "$conf"
  APT_CONFIG="$conf" "$@"; rc=$?
  rm -f "$conf"
  return "$rc"
}

# Docker from Docker's own installer, up to three tries, each after apt is free again: the
# server's updates can take apt back between our look and Docker's first apt command.
install_docker() {
  local try from
  wait_for_apt
  step "Installing Docker, the program Godspeed runs in. This takes a few minutes."
  from="$(log_lines)"
  curl -fsSL "$DOCKER_URL" -o "$DIR/get-docker.sh" 2>>"$LOG" \
    || { rm -f "$DIR/get-docker.sh"; stop "Docker's installer could not be downloaded from $DOCKER_URL. Check that this server can reach the internet, then run this line again; nothing was changed."; }
  for try in $(seq 1 "$DOCKER_TRIES"); do
    [ "$try" -eq 1 ] || { sleep "$DOCKER_PAUSE"; wait_for_apt "it picks up where it stopped."; }
    log "installing Docker, try $try of $DOCKER_TRIES"
    if patient_apt sh "$DIR/get-docker.sh" </dev/null >>"$LOG" 2>&1; then
      log "Docker installed on try $try"
      rm -f "$DIR/get-docker.sh"
      return 0
    fi
    log "Docker's installer did not finish (try $try of $DOCKER_TRIES)"
  done
  rm -f "$DIR/get-docker.sh"
  stop_showing_log "Docker could not be installed." "$from"
}

# Starts Docker when it is installed but not running. When it will not start, the reason is in
# Docker's own journal, so its last lines go into the log and on the screen.
start_docker() {
  local from; from="$(log_lines)"
  systemctl enable --now docker >>"$LOG" 2>&1 || service docker start >>"$LOG" 2>&1 || true
  for _ in $(seq 1 20); do docker info >/dev/null 2>&1 && return 0; sleep 1; done
  command -v journalctl >/dev/null 2>&1 && journalctl -u docker.service --no-pager -n 30 >>"$LOG" 2>&1
  stop_showing_log "Docker is installed but does not start." "$from"
}

# The compose plugin, when a Docker that was here already came without it.
add_compose_plugin() {
  wait_for_apt
  { patient_apt apt-get update && patient_apt apt-get install -y docker-compose-plugin; } </dev/null >>"$LOG" 2>&1 || true
  docker compose version >/dev/null 2>&1 || stop "Docker is here but its compose plugin is not, and it could not be added. Install docker-compose-plugin, then run this line again."
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
# install and a random number made here, once, to the website godspeedmissioncontrol.com, which
# counts it and keeps no address (THE INSTALL COUNT in kit-bootstrap's lib.sh).
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
       "${KB_INSTALL_COUNT_URL:-https://godspeedmissioncontrol.com/signal/v1}" >/dev/null 2>&1; then
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
  for v in GODSPEED_HOST GODSPEED_IMAGE GODSPEED_RAW GODSPEED_SELF_URL GODSPEED_DIR GODSPEED_INSTALL_COUNT DO_NOT_TRACK GODSPEED_CERT_WAIT GODSPEED_START_WAIT GODSPEED_APT_WAIT; do
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
    install_docker
  fi
  docker info >/dev/null 2>&1 || start_docker
  docker compose version >/dev/null 2>&1 || add_compose_plugin
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
  local host="" code="" ip="" first=yes image=""
  if [ -f "$DIR/.env" ]; then
    first=no
    host="$(sed -n 's/^GODSPEED_HOST=//p' "$DIR/.env" | tail -1)"
    code="$(sed -n 's/^GODSPEED_SETUP_CODE=//p' "$DIR/.env" | tail -1)"
    image="$(sed -n 's/^GODSPEED_IMAGE=//p' "$DIR/.env" | tail -1)"
  fi
  case "${GODSPEED_IMAGE:-}" in
    "") ;;
    release) image="" ;;
    *) test_image "$GODSPEED_IMAGE" || stop "GODSPEED_IMAGE should name one version of Godspeed Mission Control, like $IMAGE_REPO:v2-sha-<commit>, or be release. Nothing was changed."
       image="$GODSPEED_IMAGE" ;;
  esac
  test_image "$image" || image=""
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
  if [ -n "$image" ]; then
    pin_image "$DIR/compose.yaml.new" "$image" || { rm -f "$DIR/compose.yaml.new"; stop "Could not set the version to try ($image) in the settings file, so nothing was changed."; }
    step "Using the version to try instead of the released one: $image"
  fi
  mv -f "$DIR/compose.yaml.new" "$DIR/compose.yaml"
  ( umask 077; printf 'GODSPEED_HOST=%s\nGODSPEED_SETUP_CODE=%s\n' "$host" "$code" > "$DIR/.env.new"
    [ -z "$image" ] || printf 'GODSPEED_IMAGE=%s\n' "$image" >> "$DIR/.env.new" ) && mv -f "$DIR/.env.new" "$DIR/.env"
  chmod 600 "$DIR/.env"
  log "address $host, first run: $first${image:+, image $image}"

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
  install_model_command || stop "Godspeed runs, but its connection for add-ons could not be installed. Check this server can reach github.com, then run this installer again."
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
