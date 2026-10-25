#!/bin/bash
# Authenticated browser installer. --detach receives canonical private JSON on
# stdin; the website revokes its temporary SSH key as soon as launch finishes.
# Only a public, immutable GODSPEED_RAW is accepted. Never enable shell tracing.
# The version it installs is the one the stage file of that same commit names (stage.json, read
# with stage/stage.sh); it writes that image into the private .env as GODSPEED_SERVER_IMAGE. A
# version the public stage has taken back since the website saved this link is refused, so an old
# link installs nothing: that read, like every other, goes through browser_fetch.

BROWSER_DIR="${GODSPEED_DIR:-/opt/godspeed-mission-control-browser}"
BROWSER_PROJECT=godspeed-mission-control
BROWSER_TEMP=
BROWSER_RESULT=no
BROWSER_ERROR=operation_failed
BROWSER_JOB=
BROWSER_CALLBACK=
BROWSER_JOB_DIR=
BROWSER_JSON=
BROWSER_MODE=
BROWSER_EXISTING=

browser_fail() {
  trap - ERR
  if [ "$BROWSER_RESULT" = no ]; then
    printf '{"ok":false,"error":"%s"}\n' "$1"
    BROWSER_RESULT=yes
  fi
  exit 1
}
browser_progress() { printf 'GODSPEED_PROGRESS %s\n' "$BROWSER_ERROR" >&2; }
browser_cleanup() {
  case "$BROWSER_TEMP" in /tmp/godspeed-browser-source.*) [ ! -d "$BROWSER_TEMP" ] || rm -rf -- "$BROWSER_TEMP" ;; esac
}
browser_source_valid() {
  [[ "${GODSPEED_RAW:-}" =~ ^https://raw\.githubusercontent\.com/MichaelZelbel/godspeed-mission-control/[a-f0-9]{40}$ ]]
}
browser_metadata() {
  local line= pattern='^\{"job":"([a-f0-9]{64})","callback":"([a-f0-9]{64})"\}$'
  IFS= read -r -n 512 line || [ -n "$line" ] || return 1
  [[ "$line" =~ $pattern ]] || return 1
  BROWSER_JOB="${BASH_REMATCH[1]}"; BROWSER_CALLBACK="${BASH_REMATCH[2]}"
}
browser_fetch() { curl --proto '=https' --tlsv1.2 -fsS --max-time 60 "$1" -o "$2" 2>/dev/null; }
# The stage file of the commit and its reader, and the public stage's own file, through this
# installer's own hardened download and never plain curl. They replace the installer's own
# stage_download and stage_file_download, both here (for a test that loads the two files as
# libraries) and again after install.sh has been sourced.
browser_stage_download() {
  mkdir -p "$2" && browser_fetch "$1/stage.json" "$2/stage.json" && browser_fetch "$1/stage/stage.sh" "$2/stage.sh"
}
stage_download() { browser_stage_download "$@"; }
stage_file_download() { browser_fetch "$1" "$2"; }
# What the one-line installer's own helpers do here instead of what they do on a screen: no
# sentences, every failure one safe JSON error, and downloads through browser_fetch. Its own
# function, so a test that loads the helpers from this checkout binds them the same way.
browser_bind_helpers() {
  stop() { browser_fail "$BROWSER_ERROR"; }
  step() { browser_progress; }
  say() { :; }
  stage_download() { browser_stage_download "$@"; }
  stage_file_download() { browser_fetch "$1" "$2"; }
}
browser_load_helpers() {
  browser_fetch "$GODSPEED_RAW/docker/server/install.sh" "$BROWSER_TEMP/install.sh" || browser_fail source_unavailable
  GODSPEED_INSTALL_LIB=1 GODSPEED_DIR="$BROWSER_DIR" source "$BROWSER_TEMP/install.sh"
  browser_bind_helpers
}
browser_host() {
  local host; host="$(tr -d '\r\n' < /etc/hostname)"
  [[ "$host" =~ ^srv[0-9]+$ ]] && host="$host.hstgr.cloud"
  [[ "$host" =~ ^srv[0-9]+\.hstgr\.cloud$ ]] || return 1
  printf '%s\n' "$host"
}
browser_result() {
  local state="$1" host="$2" mode="$3" path="$4"
  [[ "$state" = installed || "$state" = existing ]] || browser_fail invalid_result
  [[ "$mode" = standalone || "$mode" = traefik ]] || browser_fail invalid_result
  [[ "$host" =~ ^srv[0-9]+\.hstgr\.cloud$ ]] || browser_fail invalid_result
  [[ "$path" = /login || "$path" =~ ^/setup#invite=[a-f0-9]{64}$ ]] || browser_fail account_link_unavailable
  printf '{"ok":true,"state":"%s","hostname":"%s","mode":"%s","url":"https://%s%s"}\n' "$state" "$host" "$mode" "$host" "$path"
  BROWSER_RESULT=yes
}
browser_existing() {
  local id image name project service
  BROWSER_EXISTING=
  for id in $(docker ps -aq 2>/dev/null); do
    image="$(docker inspect -f '{{.Config.Image}}' "$id" 2>/dev/null)"
    name="$(docker inspect -f '{{.Name}}' "$id" 2>/dev/null)"
    project="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$id" 2>/dev/null)"
    service="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.service"}}' "$id" 2>/dev/null)"
    if [[ "$image" = ghcr.io/michaelzelbel/godspeed-mission-control:* || "$image" = ghcr.io/michaelzelbel/godspeed-mission-control@* || "$name" = /godspeed ]] \
       || { [[ "$project" = godspeed* ]] && [[ "$service" = godspeed || "$service" = notebook ]]; }; then
      [ -z "$BROWSER_EXISTING" ] || browser_fail multiple_existing_installations
      BROWSER_EXISTING="$id"
    fi
  done
}
browser_existing_link() {
  # The setup code is read inside the already-owned container, not docker argv.
  docker exec -i -e "GODSPEED_BROWSER_EXPECTED_HOST=$1" "$2" node --input-type=module -e '
import fs from "node:fs";
const host=process.env.GODSPEED_BROWSER_EXPECTED_HOST;
if(process.env.GODSPEED_WEB_ADDRESS&&new URL(process.env.GODSPEED_WEB_ADDRESS).hostname!==host)process.exit(1);
const status=await fetch("http://127.0.0.1:47831/api/auth/status",{redirect:"error",signal:AbortSignal.timeout(10000)});
if(!status.ok)process.exit(1);
if((await status.json()).configured===true){console.log("/login");process.exit(0)}
let token=process.env.GODSPEED_ACCESS_TOKEN;
if(!token)try{token=fs.readFileSync("/opt/data/full-candidate/.install-setup-code","utf8").trim()}catch{}
if(!/^[a-f0-9]{64}$/.test(token||""))process.exit(1);
const r=await fetch("http://127.0.0.1:47831/api/auth/bootstrap",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({token}),redirect:"error",signal:AbortSignal.timeout(10000)});
if(r.status===409)console.log("/login");
else{const data=await r.json();if(r.ok&&/^\/setup#invite=[a-f0-9]{64}$/.test(data.path||""))console.log(data.path);else process.exit(1)}
' 2>/dev/null
}
browser_port_pid() { ss -Hltnp "( sport = :$1 )" 2>/dev/null | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | sort -u; }
browser_proxy() {
  local id image args pid candidate= count=0
  for id in $(docker ps -q 2>/dev/null); do
    image="$(docker inspect -f '{{.Config.Image}}' "$id" 2>/dev/null)"
    [[ "$image" =~ (^|/)traefik([:@]|$) ]] || continue
    [ "$(docker inspect -f '{{.HostConfig.NetworkMode}}' "$id")" = host ] || continue
    args="$(docker inspect -f '{{range .Config.Cmd}}{{println .}}{{end}}' "$id")"
    grep -qx -- '--providers.docker=true' <<<"$args" || continue
    grep -qx -- '--providers.docker.exposedbydefault=false' <<<"$args" || continue
    grep -qx -- '--entrypoints.web.address=:80' <<<"$args" || continue
    grep -qx -- '--entrypoints.websecure.address=:443' <<<"$args" || continue
    grep -qiE -- '\.acme\.tlschallenge(=true)?$' <<<"$args" && continue
    pid="$(docker inspect -f '{{.State.Pid}}' "$id")"
    [ "$(browser_port_pid 80)" = "$pid" ] && [ "$(browser_port_pid 443)" = "$pid" ] || continue
    candidate="$id"; count=$((count+1))
  done
  [ "$count" -eq 1 ] || return 1
  printf '%s\n' "$candidate"
}
browser_route_free() {
  local host="$1" provider="$2" id labels rules rule expression
  local exact='^(Host|HostSNI)\((`[a-z0-9.-]+`|"[a-z0-9.-]+")([[:space:]]*,[[:space:]]*(`[a-z0-9.-]+`|"[a-z0-9.-]+"))*\)$'
  for id in $(docker ps -q 2>/dev/null); do
    [ "$id" = "$provider" ] && continue
    labels="$(docker inspect -f '{{range $key,$value := .Config.Labels}}{{println $key "=" $value}}{{end}}' "$id" 2>/dev/null)"
    grep -qE '^traefik\.tcp\.(routers|services)\.godspeed-mission-control\.' <<<"$labels" && return 1
    rules="$(grep -E '^traefik\.(http|tcp)\.routers\..*\.rule = ' <<<"$labels" || true)"
    while IFS= read -r rule; do
      [ -n "$rule" ] || continue
      expression="${rule#* = }"
      # Only explicit disjoint hostname lists can be proved safe here. Unknown
      # matchers, negation, catch-alls and compound expressions are preserved.
      [[ "$expression" =~ $exact ]] || return 1
      [[ "$rule" != *"\`$host\`"* && "$rule" != *"\"$host\""* ]] || return 1
    done <<<"$rules"
  done
}
browser_own_data_free() {
  local resource
  [ -z "$(docker volume ls --filter "label=com.docker.compose.project=$BROWSER_PROJECT" -q)" ] || browser_fail existing_installation_data
  [ -z "$(docker ps -aq --filter "label=com.docker.compose.project=$BROWSER_PROJECT")" ] || browser_fail existing_installation_data
  for resource in godspeed-data godspeed-certificates godspeed-proxy-config; do
    ! docker volume inspect "${BROWSER_PROJECT}_$resource" >/dev/null 2>&1 || browser_fail existing_installation_data
  done
  ! docker network inspect "${BROWSER_PROJECT}_default" >/dev/null 2>&1 || browser_fail existing_installation_data
}
browser_preflight() {
  local host="$1" provider= free_kb permission
  [ "$(id -u)" = 0 ] || browser_fail administrator_required
  case "$(uname -m)" in x86_64|amd64) ;; *) browser_fail unsupported_processor ;; esac
  command -v ss >/dev/null 2>&1 || browser_fail port_inspection_unavailable
  command -v flock >/dev/null 2>&1 || browser_fail install_lock_unavailable
  if command -v docker >/dev/null 2>&1; then
    docker info >/dev/null 2>&1 || browser_fail existing_docker_unavailable
    provider="$(browser_proxy || true)"
  else
    [ ! -S /var/run/docker.sock ] || browser_fail existing_docker_unavailable
    os_supported || browser_fail unsupported_operating_system
  fi
  if [ -n "$provider" ]; then
    browser_route_free "$host" "$provider" || browser_fail hostname_already_routed
    BROWSER_MODE=traefik
  else
    ! port_in_use 80 && ! port_in_use 443 || browser_fail web_ports_in_use
    BROWSER_MODE=standalone
  fi
  free_kb="$(df -Pk / 2>/dev/null | awk 'NR==2 {print $4}')"
  [[ "$free_kb" =~ ^[0-9]+$ ]] && [ "$free_kb" -ge $((8*1024*1024)) ] || browser_fail insufficient_disk_space
  if [ -e "$BROWSER_DIR" ] || [ -L "$BROWSER_DIR" ]; then
    [ -d "$BROWSER_DIR" ] && [ ! -L "$BROWSER_DIR" ] && [ "$(stat -c %u "$BROWSER_DIR")" = 0 ] || browser_fail installation_folder_conflict
    permission="$(stat -c %a "$BROWSER_DIR")"
    [ $((8#$permission & 0022)) -eq 0 ] || browser_fail installation_folder_conflict
    if [ -n "$(find "$BROWSER_DIR" -mindepth 1 -maxdepth 1 -print -quit)" ]; then
      [ -f "$BROWSER_DIR/.browser-installer" ] && [ ! -L "$BROWSER_DIR/.browser-installer" ] \
        && [ "$(cat "$BROWSER_DIR/.browser-installer")" = godspeed-browser-v1 ] || browser_fail installation_folder_conflict
    fi
  fi
  if command -v docker >/dev/null 2>&1; then browser_own_data_free; fi
}
browser_run() {
  set -euo pipefail
  umask 077
  trap browser_cleanup EXIT
  trap 'browser_fail "$BROWSER_ERROR"' ERR
  trap 'browser_fail installation_timed_out' TERM
  [ "$(id -u)" = 0 ] || browser_fail administrator_required
  browser_source_valid || browser_fail immutable_source_required
  command -v curl >/dev/null 2>&1 || browser_fail download_tool_unavailable
  local host mode path code manifest
  host="$(browser_host)" || browser_fail unsupported_server_hostname
  BROWSER_TEMP="$(mktemp -d /tmp/godspeed-browser-source.XXXXXX)"
  browser_load_helpers
  if command -v docker >/dev/null 2>&1; then
    docker info >/dev/null 2>&1 || browser_fail existing_docker_unavailable
    browser_existing
  fi
  if [ -n "$BROWSER_EXISTING" ]; then
    https_ready "$host" || browser_fail existing_installation_not_ready
    path="$(browser_existing_link "$host" "$BROWSER_EXISTING")" || browser_fail account_link_unavailable
    mode=standalone; browser_proxy >/dev/null 2>&1 && mode=traefik
    browser_result existing "$host" "$mode" "$path"
    return
  fi
  browser_preflight "$host"; mode="$BROWSER_MODE"
  BROWSER_ERROR=source_unavailable
  manifest=docker/hostinger/compose.yaml
  [ "$mode" != traefik ] || manifest=docker/server/browser-compose-traefik.yaml
  browser_fetch "$GODSPEED_RAW/$manifest" "$BROWSER_TEMP/compose.yaml"
  grep -qx "name: $BROWSER_PROJECT" "$BROWSER_TEMP/compose.yaml" || browser_fail invalid_compose_source
  # Which version this compose file runs: the stage file of this same commit says so, and its image
  # goes into the private .env below. The public stage says whether that version was taken back
  # since this link was made. Both are read before anything on the server is changed.
  read_stage "$BROWSER_TEMP/stage"
  decide_image
  BROWSER_ERROR=installation_folder_conflict
  mkdir -p "$BROWSER_DIR"; chmod 700 "$BROWSER_DIR"
  exec 9>"$BROWSER_DIR/install.lock"; flock -n 9 || browser_fail installation_already_running
  printf 'godspeed-browser-v1\n' > "$BROWSER_DIR/.browser-installer"
  DIR="$BROWSER_DIR"; LOG="$DIR/install.log"; PROJECT="$BROWSER_PROJECT"
  touch "$LOG"; chmod 600 "$LOG"
  BROWSER_ERROR=docker_install_failed; browser_progress
  if ! command -v docker >/dev/null 2>&1; then
    (install_docker) > /dev/null || browser_fail docker_install_failed
  fi
  docker info >/dev/null 2>&1 || { (start_docker) > /dev/null || browser_fail docker_install_failed; }
  docker compose version >/dev/null 2>&1 || { (add_compose_plugin) > /dev/null || browser_fail docker_install_failed; }
  # Do not adopt data or an app which appeared while apt was running.
  if [ "$mode" = standalone ]; then
    ! port_in_use 80 && ! port_in_use 443 || browser_fail web_ports_in_use
  else
    local provider; provider="$(browser_proxy)" || browser_fail web_proxy_changed
    browser_route_free "$host" "$provider" || browser_fail hostname_already_routed
  fi
  browser_existing; [ -z "$BROWSER_EXISTING" ] || browser_fail existing_installation_appeared
  browser_own_data_free
  BROWSER_ERROR=private_settings_unavailable
  [ ! -L "$DIR/.env" ] && [ ! -L "$DIR/.env.new" ] && [ ! -L "$DIR/compose.yaml" ] || browser_fail private_settings_unavailable
  code="$(sed -n 's/^GODSPEED_SETUP_CODE=//p' "$DIR/.env" 2>/dev/null || true)"
  [[ "$code" =~ ^[a-f0-9]{64}$ ]] || code="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
  printf 'GODSPEED_HOST=%s\nGODSPEED_SETUP_CODE=%s\nGODSPEED_SERVER_IMAGE=%s\n' "$host" "$code" "$IMAGE" > "$DIR/.env.new"
  chmod 600 "$DIR/.env.new"; mv "$DIR/.env.new" "$DIR/.env"
  cp "$BROWSER_TEMP/compose.yaml" "$DIR/compose.yaml"
  BROWSER_ERROR=invalid_compose_source; compose config --quiet >>"$LOG" 2>&1
  BROWSER_ERROR=application_download_failed; browser_progress; compose pull -q >>"$LOG" 2>&1
  BROWSER_ERROR=application_start_failed; browser_progress; compose up -d >>"$LOG" 2>&1
  wait_healthy || browser_fail application_start_failed
  BROWSER_ERROR=certificate_pending; browser_progress
  (wait_certificate "$host") > /dev/null || browser_fail certificate_pending
  BROWSER_ERROR=account_link_unavailable
  path="$(owner_link "$code")"
  case "$path" in link\ *) path="${path#link }" ;; owner) path=/login ;; *) browser_fail account_link_unavailable ;; esac
  browser_result installed "$host" "$mode" "$path"
}
browser_notify() {
  local config="$BROWSER_JOB_DIR/callback.conf" body="$BROWSER_JOB_DIR/result.json" status attempt
  umask 077
  printf '%s\n' "$BROWSER_JSON" > "$body"
  printf 'url = "https://godspeedmissioncontrol.com/godspeed-install/api/hostinger/complete/%s"\nheader = "Authorization: Bearer %s"\nheader = "Content-Type: application/json"\n' "$BROWSER_JOB" "$BROWSER_CALLBACK" > "$config"
  chmod 600 "$config" "$body"
  # No redirect following and no bearer/body on argv. At most 55 seconds,
  # including retries, after the child installer has stopped.
  for attempt in 1 2 3; do
    status="$(curl --ipv4 --proto '=https' --tlsv1.2 --silent --max-time 15 --connect-timeout 5 \
      --config "$config" --data-binary "@$body" --output /dev/null --write-out '%{http_code}' 2>/dev/null)" || status=000
    case "$status" in 200|202|204) return 0 ;; esac
    [ "$attempt" = 3 ] || sleep 5
  done
  return 1
}
browser_supervisor_finish() {
  trap - EXIT TERM INT HUP
  [ -n "$BROWSER_JSON" ] || BROWSER_JSON='{"ok":false,"error":"operation_failed"}'
  browser_notify || true
  # Delivery acknowledgement or the bounded callback expiry ends the credential
  # lifetime. Application data/settings are in BROWSER_DIR and stay untouched.
  rm -f -- "$BROWSER_JOB_DIR/input.json" "$BROWSER_JOB_DIR/callback.conf" "$BROWSER_JOB_DIR/result.json"
  BROWSER_CALLBACK=; BROWSER_JSON=
}
browser_supervise() {
  local rc=0
  trap browser_supervisor_finish EXIT
  trap 'BROWSER_JSON='\''{"ok":false,"error":"installation_interrupted"}'\''; exit 1' TERM INT HUP
  # The SSH connection can close immediately; this supervisor owns no SSH key.
  timeout --signal=TERM --kill-after=10s 1680 bash "$BROWSER_JOB_DIR/install-browser.sh" --run \
    > "$BROWSER_JOB_DIR/result.json" 2>> "$BROWSER_JOB_DIR/progress.log" || rc=$?
  BROWSER_JSON="$(cat "$BROWSER_JOB_DIR/result.json" 2>/dev/null)"
  if [ "$rc" = 124 ] || [ "$rc" = 137 ]; then BROWSER_JSON='{"ok":false,"error":"installation_timed_out"}'; fi
  browser_supervisor_finish
}
browser_background() {
  set -uo pipefail
  umask 077
  browser_metadata || exit 1
  BROWSER_JOB_DIR="/var/lib/godspeed-mission-control-installer/jobs/$BROWSER_JOB"
  browser_supervise
}
browser_launch() {
  GODSPEED_RAW="$GODSPEED_RAW" nohup bash "$BROWSER_JOB_DIR/install-browser.sh" --background < "$BROWSER_JOB_DIR/input.json" \
    > /dev/null 2>> "$BROWSER_JOB_DIR/progress.log" &
}
browser_detach() {
  set -euo pipefail
  umask 077
  BROWSER_ERROR=installer_launch_failed
  trap 'browser_fail "$BROWSER_ERROR"' ERR
  [ "$(id -u)" = 0 ] || browser_fail administrator_required
  browser_source_valid || browser_fail immutable_source_required
  command -v timeout >/dev/null 2>&1 || browser_fail timeout_tool_unavailable
  command -v nohup >/dev/null 2>&1 || browser_fail detached_launch_unavailable
  command -v curl >/dev/null 2>&1 || browser_fail download_tool_unavailable
  browser_metadata || browser_fail invalid_job_metadata
  local parent=/var/lib/godspeed-mission-control-installer dir
  for dir in "$parent" "$parent/jobs"; do
    [ ! -L "$dir" ] || browser_fail installation_folder_conflict
    if [ -e "$dir" ]; then
      [ -d "$dir" ] && [ "$(stat -c %u "$dir")" = 0 ] && [ "$(stat -c %a "$dir")" = 700 ] || browser_fail installation_folder_conflict
    else mkdir -m 700 "$dir"; fi
  done
  BROWSER_JOB_DIR="$parent/jobs/$BROWSER_JOB"
  mkdir -m 700 "$BROWSER_JOB_DIR" 2>/dev/null || browser_fail job_already_started
  cp -- "${BASH_SOURCE[0]}" "$BROWSER_JOB_DIR/install-browser.sh"
  printf '{"job":"%s","callback":"%s"}\n' "$BROWSER_JOB" "$BROWSER_CALLBACK" > "$BROWSER_JOB_DIR/input.json"
  browser_launch
  printf '{"ok":true,"state":"started"}\n'
  BROWSER_CALLBACK=
}

if [ "${GODSPEED_BROWSER_LIB:-}" != 1 ]; then
  case "${1:-}" in
    --detach) browser_detach ;;
    --background) browser_background ;;
    --run) browser_run ;;
    *) browser_fail invalid_invocation ;;
  esac
fi
