#!/bin/bash
# The Docker image's test, run by CI on every push and by hand before a release:
#
#   bash docker/test.sh            (from the repository root, on a machine with Docker)
#
# Builds the image twice (v1, then v2) and walks a reader's path on a fresh volume:
# start, unattended setup (GitHub answered by docker/test/fake-gh, no Telegram, no
# sign-in), the promises the image makes, a runaway command the patrol must stop, then
# the upgrade to v2 on the same volume. Prints PASS or FAIL per check and exits 1 when
# any check failed. Leaves nothing behind.
set -u
cd "$(dirname "$0")/.."
ROOT="$PWD"
IMG=godspeed-mc:test
WORK="$(mktemp -d)"
FAILS=0

check() { local what="$1"; shift; if "$@" >/dev/null 2>&1; then printf 'PASS  %s\n' "$what"; else printf 'FAIL  %s\n' "$what"; FAILS=$((FAILS+1)); fi; }
x()     { docker exec -u hermes -e HOME=/opt/data godspeed "$@"; }
health() { docker inspect -f '{{.State.Health.Status}}' godspeed 2>/dev/null; }
wait_healthy() { for _ in $(seq 1 60); do [ "$(health)" = healthy ] && return 0; sleep 3; done; return 1; }
build() { docker build -q --build-arg VERSION="$1" --build-arg REVISION="$(git rev-parse --short HEAD 2>/dev/null || echo local)" \
            -f docker/Dockerfile -t "$IMG" . >/dev/null; }
cleanup() { (cd "$WORK" && docker compose down -v >/dev/null 2>&1); rm -rf "$WORK"; }
trap cleanup EXIT

cp docker/compose.yaml "$WORK/compose.yaml"
cat > "$WORK/compose.override.yaml" <<EOF
services:
  godspeed:
    image: $IMG
    pull_policy: never
    volumes:
      - $ROOT/docker/test/fake-gh:/usr/local/bin/gh:ro
EOF
cd "$WORK"

echo "== v1: build and start on a fresh volume"
(cd "$ROOT" && build v1) || { echo "FAIL  the image does not build"; exit 1; }
docker compose up -d >/dev/null 2>&1
check "the container is healthy after a fresh start" wait_healthy

echo "== setup, unattended"
timeout 900 docker exec -e KB_TELEGRAM_SKIP=1 -e KB_MORNING_BRIEF=no -e KB_SIGNIN_SKIP=1 -e KB_REPO_NAME=test \
  godspeed godspeed-setup </dev/null > "$WORK/setup.log" 2>&1
rc=$?
check "setup finishes with exit 0" test "$rc" -eq 0
check "the folder is in the volume" x test -f /opt/data/godspeed/AGENTS.md
check "the first commit reached the (stand-in) GitHub" x git -C /opt/data/godspeed ls-remote --exit-code origin
check "Hermes works in the folder" sh -c "docker exec -u hermes -e HOME=/opt/data godspeed hermes config get terminal.cwd | grep -q /opt/data/godspeed"
check "the prompt archive's daily job is on the clock" sh -c "docker exec -u hermes godspeed crontab -l | grep -q prompt-harvest"
check "setup never says there is no cron" sh -c "! grep -q 'has no cron' '$WORK/setup.log'"
check "the scheduler runs, as the assistant's account" sh -c "docker exec godspeed ps -eo user,args | grep -q '^hermes .*supercronic'"
check "the patrol runs, as the assistant's account" sh -c "docker exec godspeed ps -eo user,args | grep -q '^hermes .*godspeed-patrol'"
check "the gateway runs, as the assistant's account" sh -c "docker exec godspeed ps -eo user,args | grep -q '^hermes .*gateway run'"
check "the container patrol is in procedures.md" x grep -q '^## Container patrol' /opt/data/godspeed/procedures.md
check "the image version is recorded" sh -c "docker exec godspeed grep -q '^v1+' /opt/data/.godspeed/image-version"
check "healthy after setup restarted the gateway" wait_healthy
check "nothing in the volume belongs to root" sh -c "[ -z \"\$(docker exec godspeed find /opt/data -user root -print -quit)\" ]"
check "no Docker socket inside" sh -c "! docker exec godspeed test -e /var/run/docker.sock"
check "no port is published" sh -c "[ -z \"\$(docker port godspeed)\" ]"
check "the CPU limit is in force" sh -c "docker exec godspeed cat /sys/fs/cgroup/cpu.max | grep -q '^100000 100000'"
check "no new privileges" sh -c "docker exec godspeed grep -q '^NoNewPrivs:[[:space:]]*1' /proc/1/status"

echo "== a runaway command"
docker exec -u hermes -d godspeed sh -c 'nohup sh -c "while :; do :; done" >/dev/null 2>&1 &'
sleep 3
docker exec -u hermes -e REAP_MIN_AGE=2 -e PATROL_STATE=/tmp/patrol-test godspeed godspeed-patrol once
sleep 15
docker exec -u hermes -e REAP_MIN_AGE=2 -e PATROL_STATE=/tmp/patrol-test godspeed godspeed-patrol once
sleep 7
check "the patrol stopped it" sh -c "! docker exec godspeed pgrep -f 'while :; do :; done'"
check "the gateway was left alone" wait_healthy

echo "== v2: upgrade on the same volume"
x sh -c 'echo "remember me" > /opt/data/godspeed/volume-probe.txt'
(cd "$ROOT" && build v2) || { echo "FAIL  v2 does not build"; exit 1; }
docker compose up -d >/dev/null 2>&1
for _ in $(seq 1 200); do docker exec godspeed grep -q '^v2+' /opt/data/.godspeed/image-version 2>/dev/null && break; sleep 3; done
check "the new image ran the update path once" sh -c "docker exec godspeed grep -q '^v2+' /opt/data/.godspeed/image-version"
check "the folder survived the upgrade" x grep -q 'remember me' /opt/data/godspeed/volume-probe.txt
check "healthy after the upgrade" wait_healthy

echo
if [ "$FAILS" -eq 0 ]; then echo "ALL PASS"; else
  echo "$FAILS FAILED. Setup's output:"; sed 's/\x1b\[[0-9;]*m//g' "$WORK/setup.log" | tail -60
  docker exec godspeed tail -20 /opt/data/logs/godspeed-upgrade.log 2>/dev/null
  exit 1
fi
