#!/usr/bin/env bash
# Run candidate scenarios against one native installation and one Docker installation.
set -u

HERE=$(cd "$(dirname "$0")" && pwd)
CATALOG=${GODSPEED_SCENARIO_CATALOG:-$HERE/scenario-catalog.tsv}
STAGE_REF=${1:?usage: bash scenarios/run-installed-scenarios.sh <stage ref> [picked]}
PICKED=${2:-all}
WORK=${GODSPEED_SCENARIO_POOL_WORK:-${RUNNER_TEMP:-/tmp}/installed-scenarios}
RESULTS=${GODSPEED_SCENARIO_RESULTS:?GODSPEED_SCENARIO_RESULTS names the result directory}
NATIVE_ROOT=${GODSPEED_SCENARIO_ROOT:-$HOME/godspeed-v2}
RAW=${GODSPEED_SCENARIO_RAW:-https://raw.githubusercontent.com/MichaelZelbel/godspeed-mission-control}
mkdir -p "$WORK" "$RESULTS"

selected() { [ "$PICKED" = all ] || [[ ",$PICKED," == *",$1,"* ]]; }
record() { # <id> <PASS|FAIL> <reason>
  local id=$1 status=$2 reason=$3 tmp
  tmp=$(mktemp "$RESULTS/.${id}.XXXXXX") || return 1
  printf '%s %s: %s\n' "$status" "$id" "$reason" >"$tmp" && mv -f "$tmp" "$RESULTS/$id.txt"
}
fingerprint_native() { sha256sum "$NATIVE_ROOT/.godspeed/integrated-runtime/version" 2>/dev/null | awk '{print $1}'; }

capture_native() {
  NATIVE_FINGERPRINT=$(fingerprint_native)
  [ -n "$NATIVE_FINGERPRINT" ] || return 1
  tar -C "$NATIVE_ROOT" --exclude='./.godspeed/integrated-runtime' -cf "$WORK/native-mutable.tar" .
}
reset_native() {
  local runtime=$NATIVE_ROOT/.godspeed/integrated-runtime now
  [ -f "$WORK/native-mutable.tar" ] || return 1
  # The runtime is deliberately left in place: reset is state recovery, never another installation.
  find "$NATIVE_ROOT" -mindepth 1 -maxdepth 1 ! -path "$runtime" ! -path "$NATIVE_ROOT/.godspeed" -exec rm -rf {} +
  find "$NATIVE_ROOT/.godspeed" -mindepth 1 -maxdepth 1 ! -path "$runtime" -exec rm -rf {} +
  tar -C "$NATIVE_ROOT" -xf "$WORK/native-mutable.tar" || return 1
  now=$(fingerprint_native)
  [ "$now" = "$NATIVE_FINGERPRINT" ] || return 1
  curl -fsS http://127.0.0.1:${GODSPEED_PORT:-47831}/health >/dev/null 2>&1
}

capture_server() {
  local container
  container=$(sudo docker compose -p godspeed-mission-control --project-directory /opt/godspeed-mission-control -f /opt/godspeed-mission-control/compose.yaml --env-file /opt/godspeed-mission-control/.env ps -q godspeed) || return 1
  [ -n "$container" ] || return 1
  sudo docker cp "$container:/opt/data" "$WORK/server-data" || return 1
  SERVER_IMAGE=$(sudo docker inspect -f '{{.Image}}' "$container")
}
reset_server() {
  local container now
  sudo docker compose -p godspeed-mission-control --project-directory /opt/godspeed-mission-control -f /opt/godspeed-mission-control/compose.yaml --env-file /opt/godspeed-mission-control/.env up -d >/dev/null || return 1
  container=$(sudo docker compose -p godspeed-mission-control --project-directory /opt/godspeed-mission-control -f /opt/godspeed-mission-control/compose.yaml --env-file /opt/godspeed-mission-control/.env ps -q godspeed) || return 1
  [ -n "$container" ] || return 1
  now=$(sudo docker inspect -f '{{.Image}}' "$container")
  [ "$now" = "$SERVER_IMAGE" ] || return 1
  sudo docker cp "$WORK/server-data/." "$container:/opt/data" || return 1
  for _ in $(seq 1 60); do sudo docker inspect -f '{{.State.Health.Status}}' "$container" 2>/dev/null | grep -qx healthy && return 0; sleep 2; done
  return 1
}

run_script() { # <id> <script> <native|docker|both>
  local id=$1 script=$2 system=$3 reset
  [ "$system" != native ] || reset=reset_native
  [ "$system" != docker ] || reset=reset_server
  if [ "$system" = both ]; then reset_native && reset_server || { record "$id" FAIL 'the pooled system could not be reset'; return; }; else
    "$reset" || { record "$id" FAIL "the pooled $system system could not be reset"; return; }
  fi
  GODSPEED_SCENARIO_REUSE_INSTALL=1 GODSPEED_SCENARIO_REUSE_SERVER=1 GODSPEED_SCENARIO_RESULTS="$RESULTS" \
    GODSPEED_SCENARIO_ROOT="$NATIVE_ROOT" bash "$HERE/$script" "$STAGE_REF" >/dev/null || true
  [ -s "$RESULTS/$id.txt" ] || record "$id" FAIL 'it stopped before its own verdict'
}

run_system() { # <native|docker>
  local id script execution system candidate extra
  while IFS=$'\t' read -r id script execution system candidate extra; do
    [ -n "$id" ] && [ "${id:0:1}" != '#' ] || continue
    selected "$id" || continue
    [ "$execution" = shared ] || continue
    case "$system" in "$1"|both) run_script "$id" "$script" "$system" ;; esac
  done <"$CATALOG"
}

install_native() {
  curl -fsSL "$RAW/$STAGE_REF/install-godspeed.sh" | GODSPEED_STAGE_REF="$STAGE_REF" GODSPEED_STAGE_RAW="$RAW" bash
}
install_server() {
  SCENARIO=pooled-docker STAGE_REF="$STAGE_REF" EVIDENCE="$WORK/server-install" RAW="$RAW" \
    bash -c '. "$1/scenario-lib.sh"; . "$1/server-lib.sh"; server_install' bash "$HERE"
}

if selected linux-install; then
  if install_native && capture_native; then record linux-install PASS "one native candidate install is ready"; else record linux-install FAIL "the native candidate install or baseline failed"; fi
fi
if selected docker-server; then
  if install_server && capture_server; then record docker-server PASS "one Docker candidate install is ready"; else record docker-server FAIL "the Docker candidate install or baseline failed"; fi
fi
if [ -s "$RESULTS/linux-install.txt" ] && grep -q '^PASS ' "$RESULTS/linux-install.txt"; then run_system native; fi &
if [ -s "$RESULTS/docker-server.txt" ] && grep -q '^PASS ' "$RESULTS/docker-server.txt"; then run_system docker; fi &
wait

# Install-changing native scenarios are intentionally not in this pool. The draft runs them in
# isolated jobs, and terminal checks run after the resettable native sequence.
for id in settings-on-install hermes-update-rollback; do
  selected "$id" || continue
  [ -s "$RESULTS/linux-install.txt" ] && grep -q '^PASS ' "$RESULTS/linux-install.txt" || { record "$id" FAIL 'the native candidate install was unavailable'; continue; }
  run_script "$id" "$id.sh" native
done
