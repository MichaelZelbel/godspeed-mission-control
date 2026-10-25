#!/bin/bash
# =============================================================================
# Godspeed Mission Control on any Linux server you already have, in one line.
#
# On the server, logged in as root (or as a user who may use sudo):
#
#   curl -fsSL https://teachitonce.com/server | bash
#
# (the same file as https://raw.githubusercontent.com/MichaelZelbel/godspeed-mission-control/beta/docker/server/install.sh,
#  on beta, the public stage, which holds the version the maintainer released)
#
# What it does: installs Docker if the server has none, puts the very compose.yaml that
# Hostinger's one-click deploys (docker/hostinger/compose.yaml) in /opt/godspeed-mission-control
# with its settings in .env, starts it, waits until the web page answers over HTTPS, and prints
# one private link. That link opens the account page with the setup code already filled in: the
# reader picks a username and password, saves the recovery code, and goes on to Connect Telegram,
# exactly like a Hostinger reader.
#
# Which version: the stage file of this line's stage (stage.json at GODSPEED_STAGE_REF, by default
# the branch beta) names the server image, and that image is what runs. A change merged into main
# reaches nobody until the stage moves.
#
# The address: GODSPEED_HOST if you set it (your own domain, pointed at this server), otherwise
# this server's public IPv4 address as <a-b-c-d>.sslip.io, a free name that points back at that
# address, so the HTTPS certificate is a real one without you owning a domain.
#
# Safe to run again: it keeps the setup code, the address and all data, moves the server to the
# image the stage names today, and never makes a second owner. Before the account exists it prints
# a fresh link (the old one stops working); after that it says to sign in.
#
# Settings, all optional:
#   GODSPEED_HOST=name.example.com     use your own domain instead of <ip>.sslip.io
#   GODSPEED_INSTALL_COUNT=yes         send one anonymous note that the install worked (default: nothing is sent)
#   GODSPEED_STAGE_REF=beta            the branch or tag whose stage file says which version to
#                                      install (default beta, the version everybody gets)
#   GODSPEED_IMAGE=ghcr.io/michaelzelbel/godspeed-mission-control:v2-sha-<commit>
#                                      try one version before it is released to everybody (kept for
#                                      later runs; GODSPEED_IMAGE=release goes back to the stage's)
#   GODSPEED_APT_WAIT=900              seconds to wait for a new server to finish installing its own
#                                      updates before Docker is installed (default 15 minutes)
# docker/README.md, "Any Linux server, one line", has the rest; docker/server/test.sh tests it.
# =============================================================================

# Everything is inside functions and the last line calls main, so a download that breaks off
# halfway runs nothing at all.

# The stage this line installs, and where its files come from. GODSPEED_RAW is built from the two
# in stage_setup, not here, because a ref that is not a plain branch or tag name must be refused
# before any address is made out of it; a GODSPEED_RAW given by hand still wins over both.
GODSPEED_STAGE_REF="${GODSPEED_STAGE_REF:-beta}"
GODSPEED_STAGE_RAW="${GODSPEED_STAGE_RAW:-https://raw.githubusercontent.com/MichaelZelbel/godspeed-mission-control}"
GODSPEED_STAGE_RAW="${GODSPEED_STAGE_RAW%/}"
GODSPEED_RAW="${GODSPEED_RAW:-}"
GODSPEED_SELF_URL="${GODSPEED_SELF_URL:-}"
STAGE_EDITION=server                     # the server edition of stage.json this line installs
STAGE_PUBLIC_REF=beta                    # the stage everybody gets, whose withdrawn list also counts
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

# --- Which version this server runs ------------------------------------------------------
# (25 October 2026.) One file says what a published version is made of: stage.json at the top of
# the repository, read with its own reader stage/stage.sh (no jq, no Node: a server may have
# neither). Both come from the same ref, the stage, so the compose file, the helper files and the
# image all belong to one version. GODSPEED_STAGE_REF names it, beta by default: the version
# everybody gets. A candidate can be installed before it is promoted with
# GODSPEED_STAGE_REF=candidate/<version>. GODSPEED_STAGE_RAW is the address the ref hangs off, the
# same name and the same value the Mac and Linux line uses; the tests point it at a folder of their
# own.

# The name of a branch or tag and nothing else. These are git's own rules for a ref name, written
# out because this judges the ref before anything is fetched from it, and the Mac and Linux line's
# install-godspeed.sh holds the same rule for the same reason: every part between the slashes holds
# something, starts with no dot and ends in no ".lock", and the whole name holds no "..", no slash
# at either end, no two slashes in a row and no dot at the end. The characters are narrowed further
# to letters, digits, dot, underscore, hyphen and slash, which leaves out the space, the control
# characters and everything a shell or a web address would read as something of its own.
ref_is_a_name() { # <ref>: true when it could be the name of a branch or tag
  case $1 in '' | -* | /* | */ | *//* | *..* | *. | *[!A-Za-z0-9._/-]*) return 1 ;; esac
  local rest=$1 part
  while :; do
    case $rest in
      */*) part=${rest%%/*}; rest=${rest#*/} ;;
      *)   part=$rest;       rest='' ;;
    esac
    case $part in '' | .* | *.lock) return 1 ;; esac
    [ -n "$rest" ] || return 0
  done
}

# The stage and the addresses that follow from it, before anything is downloaded.
stage_setup() {
  ref_is_a_name "$GODSPEED_STAGE_REF" \
    || stop "GODSPEED_STAGE_REF should be the name of a branch or a tag, like beta or candidate/2.0.0-beta.7, and it is $GODSPEED_STAGE_REF. Nothing was changed."
  [ -n "$GODSPEED_RAW" ] || GODSPEED_RAW="$GODSPEED_STAGE_RAW/$GODSPEED_STAGE_REF"
  [ -n "$GODSPEED_SELF_URL" ] || GODSPEED_SELF_URL="$GODSPEED_RAW/docker/server/install.sh"
}

# The stage file of the ref at $1 and the reader for it, into the folder $2.
STAGE_DIR=""       # where the stage file being installed and its reader were put
STAGE_VERSION=""   # the version that stage file names
STAGE_IMAGE=""     # the image its server edition names
# Nothing here writes to the log: this runs before the install folder exists.
stage_download() {
  mkdir -p "$2" \
    && curl -fsSL "$1/stage.json" -o "$2/stage.json" 2>/dev/null \
    && curl -fsSL "$1/stage/stage.sh" -o "$2/stage.sh" 2>/dev/null
}
# The public stage's own file, the address $1 into the file $2. Its own function, like the one
# above, so the browser installer can put its hardened download in place of this plain curl.
stage_file_download() { curl -fsSL "$1" -o "$2" 2>/dev/null; }
# One field of the stage file in STAGE_DIR, in the reader's own words when it refuses the file.
stage_get() { sh "$STAGE_DIR/stage.sh" "$STAGE_DIR/stage.json" get "$1"; }

# Which version this run installs, before anything is installed, downloaded or changed: the stage
# file of GODSPEED_STAGE_REF, refused when it cannot be read, and refused when the version it names
# was taken back, by its own withdrawn list or by the public stage's. The answer must be exactly
# "no", so every failure fails closed.
read_stage() { # [a folder of its own for the stage file and its reader; one is made when none is given]
  local work="${1:-}" reason answer public public_url
  [ -n "$work" ] || work="$(mktemp -d)" \
    || stop "Could not make a temporary folder to read which version to install in. Nothing was changed."
  mkdir -p "$work" || stop "Could not make the folder $work to read which version to install in. Nothing was changed."
  STAGE_DIR="$work"
  stage_download "$GODSPEED_RAW" "$work" \
    || { rm -rf "$work"; stop "Could not read which version to install from $GODSPEED_RAW/stage.json. Check that this server can reach github.com, or name another stage with GODSPEED_STAGE_REF; nothing was changed."; }
  reason="$(sh "$work/stage.sh" "$work/stage.json" check 2>&1)" \
    || { rm -rf "$work"; stop "Which version to install could not be read: $reason Nothing was changed."; }
  STAGE_VERSION="$(stage_get version)"
  STAGE_IMAGE="$(stage_get "serverEditions.$STAGE_EDITION.image")" \
    || { rm -rf "$work"; stop "The stage file at $GODSPEED_RAW/stage.json names no $STAGE_EDITION edition to install. Nothing was changed."; }
  # The public stage's withdrawn list counts as well, so no saved link installs a version that was
  # taken back since it was saved: not a link naming an older stage, and not the link to one
  # immutable commit the website hands the browser installer. The public stage is always the same
  # file, $GODSPEED_STAGE_RAW/beta/stage.json, and the one read above is enough only when it is
  # that very file - which is how the public line and the tests of it read once and reach nothing
  # else.
  public="$work/stage.json"
  public_url="$GODSPEED_STAGE_RAW/$STAGE_PUBLIC_REF/stage.json"
  if [ "$GODSPEED_RAW" != "$GODSPEED_STAGE_RAW/$STAGE_PUBLIC_REF" ]; then
    stage_file_download "$public_url" "$work/public.json" \
      || { rm -rf "$work"; stop "Could not read the stage everybody gets from $public_url, which says whether $STAGE_VERSION was taken back. Check that this server can reach github.com, then run this line again; nothing was changed."; }
    public="$work/public.json"
  fi
  answer="$(sh "$work/stage.sh" withdrawn "$work/stage.json" "$public" "$STAGE_VERSION" 2>&1)"
  case "$answer" in
    no) ;;
    yes) rm -rf "$work"
         stop "Godspeed Mission Control $STAGE_VERSION was taken back and cannot be installed. Run this line again without GODSPEED_STAGE_REF to install the version everybody gets; nothing was changed." ;;
    *)   rm -rf "$work"
         stop "Whether Godspeed Mission Control $STAGE_VERSION was taken back could not be read: $answer Nothing was changed." ;;
  esac
  log "stage $GODSPEED_STAGE_REF: version $STAGE_VERSION, image $STAGE_IMAGE"
}

# --- A version to try before the stage names it ------------------------------------------
# (16 October 2026, rewritten 25 October.) GODSPEED_IMAGE names another image of this product, one
# the "Integrated Godspeed v2" check built and published for a commit (:v2-sha-<commit>, or
# @sha256:...), and this server runs that one instead of the stage's. It is kept in .env, so
# running the line again stays on it (going back to an older image could meet data the newer one
# already changed); GODSPEED_IMAGE=release goes back to the stage's image.
IMAGE_REPO=ghcr.io/michaelzelbel/godspeed-mission-control
test_image() { [[ "$1" =~ ^ghcr\.io/michaelzelbel/godspeed-mission-control(:v2-sha-[0-9a-f]{40}|@sha256:[0-9a-f]{64})$ ]]; }

# The image this run starts (IMAGE) and the version to try it came from, if any (TRY): what the
# reader asks for now, else what an earlier run was told to try, else the stage's image.
IMAGE=""
TRY=""
decide_image() {
  case "${GODSPEED_IMAGE:-}" in
    "") ;;
    release) TRY="" ;;
    *) test_image "$GODSPEED_IMAGE" || stop "GODSPEED_IMAGE should name one version of Godspeed Mission Control, like $IMAGE_REPO:v2-sha-<commit>, or be release. Nothing was changed."
       TRY="$GODSPEED_IMAGE" ;;
  esac
  test_image "$TRY" || TRY=""
  IMAGE="${TRY:-$STAGE_IMAGE}"
}

# The install's settings: the address, the setup code, the image the compose file starts, and the
# version to try when there is one, so a later run stays on it. Only root may read them.
write_env() { # <host> <setup code>
  ( umask 077
    { printf 'GODSPEED_HOST=%s\nGODSPEED_SETUP_CODE=%s\nGODSPEED_SERVER_IMAGE=%s\n' "$1" "$2" "$IMAGE"
      [ -z "$TRY" ] || printf 'GODSPEED_IMAGE=%s\n' "$TRY"
    } > "$DIR/.env.new" ) || return 1
  mv -f "$DIR/.env.new" "$DIR/.env" && chmod 600 "$DIR/.env"
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
  for v in GODSPEED_HOST GODSPEED_IMAGE GODSPEED_STAGE_REF GODSPEED_STAGE_RAW GODSPEED_RAW GODSPEED_SELF_URL GODSPEED_DIR GODSPEED_INSTALL_COUNT DO_NOT_TRACK GODSPEED_CERT_WAIT GODSPEED_START_WAIT GODSPEED_APT_WAIT; do
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
  stage_setup   # before sudo is asked for: a stage that is not a branch or tag name is refused here
  as_root

  say "Installing Godspeed Mission Control on this server."
  case "$(uname -m)" in x86_64|amd64) ;; *)
    stop "This server's processor is $(uname -m). Godspeed Mission Control runs on ordinary x86-64 (Intel or AMD) servers for now, so nothing was changed." ;;
  esac

  # Which version, before anything is installed, downloaded or changed: a stage file that cannot be
  # read and a version that was taken back both stop the run here, with nothing touched.
  read_stage
  rm -rf "$STAGE_DIR"
  say "Installing Godspeed Mission Control $STAGE_VERSION, the version the $GODSPEED_STAGE_REF line names."

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
  local host="" code="" ip="" first=yes
  if [ -f "$DIR/.env" ]; then
    first=no
    host="$(sed -n 's/^GODSPEED_HOST=//p' "$DIR/.env" | tail -1)"
    code="$(sed -n 's/^GODSPEED_SETUP_CODE=//p' "$DIR/.env" | tail -1)"
    TRY="$(sed -n 's/^GODSPEED_IMAGE=//p' "$DIR/.env" | tail -1)"
  fi
  decide_image
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

  # The one definition of what runs: the same compose.yaml as Hostinger's one-click, from the same
  # ref as the stage file, and used exactly as it is downloaded. Which image it starts is the one
  # setting GODSPEED_SERVER_IMAGE in .env, so nothing is ever edited into this file here.
  curl -fsSL "$GODSPEED_RAW/docker/hostinger/compose.yaml" -o "$DIR/compose.yaml.new" 2>>"$LOG" \
    && grep -q "^name: $PROJECT" "$DIR/compose.yaml.new" \
    || { rm -f "$DIR/compose.yaml.new"; stop "Could not download Godspeed Mission Control's settings file. Check that this server can reach github.com, then run this line again."; }
  mv -f "$DIR/compose.yaml.new" "$DIR/compose.yaml"
  [ -z "$TRY" ] || step "Using the version to try instead of the one the $GODSPEED_STAGE_REF line names: $TRY"
  write_env "$host" "$code" || stop "Could not write the settings in $DIR/.env, so nothing was changed."
  log "address $host, first run: $first, image $IMAGE${TRY:+ (the version to try)}"

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
