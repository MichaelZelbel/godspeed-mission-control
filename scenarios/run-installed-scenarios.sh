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

native_assistant_home() {
  node -e 'const fs=require("fs");process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).home||"")' \
    "$NATIVE_ROOT/.godspeed/assistant.json" 2>/dev/null
}

capture_native() {
  local assistant
  NATIVE_FINGERPRINT=$(fingerprint_native)
  [ -n "$NATIVE_FINGERPRINT" ] || return 1
  tar -C "$NATIVE_ROOT" --exclude='./.godspeed/integrated-runtime' -cf "$WORK/native-mutable.tar" . || return 1
  assistant=$(native_assistant_home) || return 1
  [ -n "$assistant" ] && [ -d "$assistant" ] || return 1
  NATIVE_ASSISTANT_HOME=$assistant
  tar -C "$assistant" -cf "$WORK/native-assistant.tar" . || return 1
  if [ -d "$HOME/.config/systemd/user/godspeed-integrated-notebook.service.d" ]; then
    tar -C "$HOME/.config/systemd/user" -cf "$WORK/native-service-config.tar" godspeed-integrated-notebook.service.d
  else
    : >"$WORK/native-service-config.absent"
  fi
}
reset_native() {
  local runtime=$NATIVE_ROOT/.godspeed/integrated-runtime now
  [ -f "$WORK/native-mutable.tar" ] || return 1
  # The runtime is deliberately left in place: reset is state recovery, never another installation.
  systemctl --user stop godspeed-integrated-notebook.service 2>/dev/null || sudo systemctl stop godspeed-integrated-notebook.service 2>/dev/null || return 1
  find "$NATIVE_ROOT" -mindepth 1 -maxdepth 1 ! -path "$runtime" ! -path "$NATIVE_ROOT/.godspeed" -exec rm -rf {} +
  find "$NATIVE_ROOT/.godspeed" -mindepth 1 -maxdepth 1 ! -path "$runtime" -exec rm -rf {} +
  tar -C "$NATIVE_ROOT" -xf "$WORK/native-mutable.tar" || return 1
  [ -n "${NATIVE_ASSISTANT_HOME:-}" ] && [ -f "$WORK/native-assistant.tar" ] || return 1
  find "$NATIVE_ASSISTANT_HOME" -mindepth 1 -maxdepth 1 -exec rm -rf {} + || return 1
  tar -C "$NATIVE_ASSISTANT_HOME" -xf "$WORK/native-assistant.tar" || return 1
  rm -rf "$HOME/.config/systemd/user/godspeed-integrated-notebook.service.d"
  if [ -f "$WORK/native-service-config.tar" ]; then
    mkdir -p "$HOME/.config/systemd/user" || return 1
    tar -C "$HOME/.config/systemd/user" -xf "$WORK/native-service-config.tar" || return 1
  fi
  now=$(fingerprint_native)
  [ "$now" = "$NATIVE_FINGERPRINT" ] || return 1
  systemctl --user daemon-reload 2>/dev/null || sudo systemctl daemon-reload || return 1
  systemctl --user restart godspeed-integrated-notebook.service 2>/dev/null || sudo systemctl restart godspeed-integrated-notebook.service || return 1
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
  sudo docker compose -p godspeed-mission-control --project-directory /opt/godspeed-mission-control -f /opt/godspeed-mission-control/compose.yaml --env-file /opt/godspeed-mission-control/.env stop >/dev/null || return 1
  container=$(sudo docker compose -p godspeed-mission-control --project-directory /opt/godspeed-mission-control -f /opt/godspeed-mission-control/compose.yaml --env-file /opt/godspeed-mission-control/.env ps -q godspeed) || return 1
  [ -n "$container" ] || return 1
  sudo docker cp "$WORK/server-data/." "$container:/opt/data" || return 1
  sudo docker compose -p godspeed-mission-control --project-directory /opt/godspeed-mission-control -f /opt/godspeed-mission-control/compose.yaml --env-file /opt/godspeed-mission-control/.env up -d >/dev/null || return 1
  container=$(sudo docker compose -p godspeed-mission-control --project-directory /opt/godspeed-mission-control -f /opt/godspeed-mission-control/compose.yaml --env-file /opt/godspeed-mission-control/.env ps -q godspeed) || return 1
  [ -n "$container" ] || return 1
  now=$(sudo docker inspect -f '{{.Image}}' "$container")
  [ "$now" = "$SERVER_IMAGE" ] || return 1
  for _ in $(seq 1 60); do sudo docker inspect -f '{{.State.Health.Status}}' "$container" 2>/dev/null | grep -qx healthy && return 0; sleep 2; done
  return 1
}

run_script() { # <id> <script> <native|docker|both>
  local id=$1 script=$2 system=$3 reset
  [ "$system" != native ] || reset=reset_native
  [ "$system" != docker ] || reset=reset_server
  if [ "$system" = both ]; then
    reset_native || { record "$id" FAIL 'the pooled native system could not be reset'; return 2; }
    reset_server || { record "$id" FAIL 'the pooled Docker system could not be reset'; return 3; }
  else
    "$reset" || { record "$id" FAIL "the pooled $system system could not be reset"; return 2; }
  fi
  GODSPEED_SCENARIO_REUSE_INSTALL=1 GODSPEED_SCENARIO_REUSE_SERVER=1 GODSPEED_SCENARIO_RESULTS="$RESULTS" \
    GODSPEED_SCENARIO_ROOT="$NATIVE_ROOT" bash "$HERE/capture-scenario-result.sh" "${script%.sh}" "$STAGE_REF" >/dev/null || true
  [ -s "$RESULTS/$id.txt" ] || record "$id" FAIL 'it stopped before its own verdict'
}

record_unavailable() { # <native|docker|both> <reason>
  local wanted=$1 reason=$2 id script execution system candidate extra
  while IFS=$'\t' read -r id script execution system candidate extra; do
    [ -n "$id" ] && [ "${id:0:1}" != '#' ] || continue
    selected "$id" || continue
    case "$system" in "$wanted"|both) [ -s "$RESULTS/$id.txt" ] || record "$id" FAIL "$reason" ;; esac
  done <"$CATALOG"
}

run_system() { # <native|docker>
  local id script execution system candidate extra status
  while IFS=$'\t' read -r id script execution system candidate extra; do
    [ -n "$id" ] && [ "${id:0:1}" != '#' ] || continue
    selected "$id" || continue
    [ "$execution" = shared ] || continue
    [ "$system" = both ] && continue
    case "$system" in "$1")
      run_script "$id" "$script" "$system"; status=$?
      [ "$status" != 2 ] || { record_unavailable "$1" "the pooled $1 system could not be reset"; return; }
      ;;
    esac
  done <"$CATALOG"
}

install_native() {
  curl -fsSL "$RAW/$STAGE_REF/install-godspeed.sh" | GODSPEED_STAGE_REF="$STAGE_REF" GODSPEED_STAGE_RAW="$RAW" bash
}
install_server() {
  SCENARIO=pooled-docker STAGE_REF="$STAGE_REF" EVIDENCE="$WORK/server-install" RAW="$RAW" \
    bash -c '. "$1/scenario-lib.sh"; . "$1/server-lib.sh"; server_install' bash "$HERE"
}

main() {
  if selected linux-install; then
    if install_native && capture_native; then record linux-install PASS "one native candidate install is ready"; else record linux-install FAIL "the native candidate install or baseline failed"; record_unavailable native 'the native candidate install or baseline failed'; fi
  fi
  if selected docker-server; then
    if install_server && capture_server; then record docker-server PASS "one Docker candidate install is ready"; else record docker-server FAIL "the Docker candidate install or baseline failed"; record_unavailable docker 'the Docker candidate install or baseline failed'; fi
  fi
  if [ -s "$RESULTS/linux-install.txt" ] && grep -q '^PASS ' "$RESULTS/linux-install.txt"; then run_system native; fi &
  if [ -s "$RESULTS/docker-server.txt" ] && grep -q '^PASS ' "$RESULTS/docker-server.txt"; then run_system docker; fi &
  wait

  # This one proof observes both systems.  It starts one shared local Hevy fixture, runs its Docker
  # and native phases against the two already-installed systems, and writes one combined verdict.
  if selected workouts-from-hevy; then
    if grep -q '^PASS ' "$RESULTS/linux-install.txt" 2>/dev/null && grep -q '^PASS ' "$RESULTS/docker-server.txt" 2>/dev/null; then
      run_script workouts-from-hevy workouts-from-hevy.sh both
      case $? in
        2) record_unavailable native 'the pooled native system could not be reset' ;;
        3) record_unavailable docker 'the pooled Docker system could not be reset' ;;
      esac
    else
      record workouts-from-hevy FAIL 'a required pooled candidate install was unavailable'
    fi
  fi

  # Install-changing native scenarios are intentionally not in this pool. The draft runs them in
  # isolated jobs, and terminal checks run after the resettable native sequence.
  for id in settings-on-install hermes-update-rollback; do
    selected "$id" || continue
    [ -s "$RESULTS/$id.txt" ] && continue
    [ -s "$RESULTS/linux-install.txt" ] && grep -q '^PASS ' "$RESULTS/linux-install.txt" || { record "$id" FAIL 'the native candidate install was unavailable'; continue; }
    run_script "$id" "$id.sh" native
  done
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then main; fi
