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
cleanup() { docker rm -f gs-home >/dev/null 2>&1; (cd "$WORK" && docker compose down -v >/dev/null 2>&1); rm -rf "$WORK"; }
trap cleanup EXIT

cp docker/compose.yaml "$WORK/compose.yaml"
cat > "$WORK/compose.override.yaml" <<EOF
services:
  godspeed:
    image: $IMG
    pull_policy: never
    volumes:
      - $ROOT/docker/test/fake-gh:/usr/local/bin/gh:ro
      - $ROOT/docker/test/probe-browser.py:/opt/test/probe-browser.py:ro
      - $ROOT/docker/test/probe-computer.py:/opt/test/probe-computer.py:ro
    environment:
      # The computer link's test round: the stand-in computer reaches the server by its name on
      # the compose network, and its test site lives on its own 127.0.0.1.
      GODSPEED_PUBLIC_HOST: godspeed
      GODSPEED_COMPUTER_ALLOW_HOSTS: 127.0.0.1
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
# The deadline tool a reader gets knows a target (a day you would like it done): one that has
# passed asks its one question in the brief, in plain words. Tools come from the kit's main at
# setup, so this checks what a reader installing today actually receives.
check "the deadline tool takes a target alone, and asks once when it has passed" x sh -c \
  'D=/opt/data/.local/bin/mc-due; G=/opt/data/godspeed; export GODSPEED_TODAY=2026-05-01;
   "$D" --godspeed "$G" add present --title "A present" --target 2026-04-20 --done-when "bought" >/dev/null &&
   "$D" --godspeed "$G" today | grep -q "A present: you aimed for 2026-04-20. A new date, or as soon as you can?" &&
   "$D" --godspeed "$G" drop present --yes >/dev/null'
# The weekly number (D-266): the goal register a reader receives reads, bets and settles, and the
# next-action recipe in the mission control carries the BET line.
check "the goal register reads, bets and settles each goal's weekly number" x sh -c \
  'H=$(/opt/data/.local/bin/mc-goals help) && for w in "read <id>" "bets --moves" "settle ["; do printf "%s" "$H" | grep -qF "$w" || exit 1; done &&
   grep -q "BET:" /opt/data/godspeed/skills/next-action/SKILL.md'
# The install count (kit-bootstrap lib.sh, THE INSTALL COUNT): asked only of a person, so an
# unattended setup writes no answer and sends nothing, and the program that would send the
# first-brief word is installed and does nothing without a yes.
check "unattended setup writes no install-count answer" x sh -c '! grep -q "^GODSPEED_INSTALL_COUNT" /opt/data/.godspeed/device.env'
check "the install-count program is installed and silent without a yes" x sh -c \
  'test -x /opt/data/.local/bin/mc-install-count && KB_INSTALL_COUNT_URL=http://127.0.0.1:9/none /opt/data/.local/bin/mc-install-count first-brief'
check "the image version is recorded" sh -c "docker exec godspeed grep -q '^v1+' /opt/data/.godspeed/image-version"
check "healthy after setup restarted the gateway" wait_healthy
check "nothing in the volume belongs to root" sh -c "[ -z \"\$(docker exec godspeed find /opt/data -user root -print -quit)\" ]"
check "no Docker socket inside" sh -c "! docker exec godspeed test -e /var/run/docker.sock"
check "only the computer door is published" sh -c "docker port godspeed | grep -q '^7443/tcp' && [ -z \"\$(docker port godspeed | grep -v '^7443/tcp')\" ]"
check "the CPU limit is in force" sh -c "docker exec godspeed cat /sys/fs/cgroup/cpu.max | grep -q '^100000 100000'"
check "no new privileges" sh -c "docker exec godspeed grep -q '^NoNewPrivs:[[:space:]]*1' /proc/1/status"

# Web pages (D-283): the assistant's own browser tools, called the way a model's tool call
# calls them (docker/test/probe-browser.py), as the assistant's account, inside the walls above.
# A page served inside the container must come back word for word; the public page is this
# repository's own page on GitHub, not example.com, which asks not to be used for testing and
# monitoring. GitHub is where CI runs and where the image comes from, so it is up when CI is.
echo "== the assistant reads web pages"
BROWSE="$(docker exec -u hermes -e HOME=/opt/data godspeed timeout 300 /opt/hermes/.venv/bin/python3 \
  /opt/test/probe-browser.py https://github.com/MichaelZelbel/godspeed-mission-control godspeed-mission-control 2>&1)"
printf '%s\n' "$BROWSE" | grep -E '^(PASS|FAIL)  '
FAILS=$((FAILS + $(printf '%s\n' "$BROWSE" | grep -c '^FAIL  ')))
if [ "$(printf '%s\n' "$BROWSE" | grep -c '^PASS  ')" -ne 3 ] && ! printf '%s\n' "$BROWSE" | grep -q '^FAIL  '; then
  printf 'FAIL  the browser check did not finish: %s\n' "$(printf '%s' "$BROWSE" | tail -5 | tr '\n' ' ')"; FAILS=$((FAILS+1))
fi
check "the browser needed nothing downloaded on first use" sh -c \
  "[ -z \"\$(docker exec godspeed find /opt/data -path '*/_npx/*' -name agent-browser -print -quit)\" ]"

# Your computer lends its browser (computer use layer 2, D-285). A second container from the same
# image plays the user's computer: it pairs with the code the assistant would send and runs the
# helper with the image's headless Chrome. The assistant's tools are called the way a model's tool
# call calls them, through Hermes (docker/test/probe-computer.py).
echo "== your computer lends its browser"
has() { printf '%s' "$1" | grep -q -- "$2"; }
P() { docker exec -u hermes -e HOME=/opt/data godspeed timeout 300 /opt/hermes/.venv/bin/python3 /opt/test/probe-computer.py call "$@" 2>/dev/null | tail -1; }
connected() { for _ in $(seq 1 "${1:-30}"); do x godspeed-computer status 2>/dev/null | grep -q '^Connected' && return 0; sleep 1; done; return 1; }
check "the computer link runs, as the assistant's account" sh -c "docker exec godspeed ps -eo user,args | grep -q '^hermes .*computer/relay.js'"
check "the assistant has the computer tools" sh -c "docker exec -u hermes -e HOME=/opt/data godspeed hermes mcp list | grep -q computer"
check "nothing answers on the computer port before a code was asked for" sh -c "! curl -sk --max-time 5 https://127.0.0.1:7443/v1/ping"
OUT="$(P computer_browser_open '{"url":"https://example.org/"}')"
check "before a computer is paired, the tools say how to set it up" has "$OUT" "NOT SET UP"
LINE="$(x godspeed-computer pair | tail -1)"
check "\"connect my computer\" makes a connection code" has "$LINE" "^godspeed1\."
check "the door answers once a code was asked for" sh -c "for i in 1 2 3 4 5 6 7 8 9 10; do curl -sk --max-time 5 https://127.0.0.1:7443/v1/ping | grep -q computer && exit 0; sleep 1; done; exit 1"
NET="$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}' godspeed)"
docker run -d --name gs-home --network "$NET" -u hermes --entrypoint sh \
  -e GODSPEED_COMPUTER_HOME=/tmp/home -e GODSPEED_COMPUTER_SECRET=file -e GODSPEED_COMPUTER_HEADLESS=1 \
  -e GODSPEED_COMPUTER_NO_SANDBOX=1 -e GODSPEED_COMPUTER_BROWSER=/opt/godspeed/chrome-headless-shell \
  -e GODSPEED_COMPUTER_ALLOW_HOSTS=127.0.0.1 -e GODSPEED_COMPUTER_OFF_RETRY_MS=3000 -e LINE="$LINE" \
  -v "$ROOT/docker/test/home-site.js:/opt/test/home-site.js:ro" "$IMG" -c \
  'node /opt/test/home-site.js & node /opt/godspeed/kit/computer/helper.js pair "$LINE" --name "test computer" && exec node /opt/godspeed/kit/computer/helper.js run' >/dev/null
check "the computer pairs with the code and connects out to the server" connected 40
check "the same code does not work a second time" sh -c "docker exec gs-home node /opt/godspeed/kit/computer/helper.js pair '$LINE' | grep -q 'not valid any more'"
check "a Telegram chat is offered the computer tools" x timeout 300 /opt/hermes/.venv/bin/python3 /opt/test/probe-computer.py offered
P computer_browser_open '{"url":"http://127.0.0.1:8099/login"}' >/dev/null
P computer_browser_open '{"url":"http://127.0.0.1:8099/account"}' >/dev/null
OUT="$(P computer_browser_read)"
check "the assistant reads a page behind the login made on the computer" has "$OUT" "gs_login=yes"
OUT="$(P computer_browser_open '{"url":"http://192.168.1.1/"}')"
check "the tools never open the home network" has "$OUT" "Not opened"
check "every page the assistant opened is listed on the computer" sh -c "docker exec gs-home node /opt/godspeed/kit/computer/helper.js pages | grep -q '8099/account'"
docker pause gs-home >/dev/null
sleep 20
OUT="$(P computer_browser_open '{"url":"http://127.0.0.1:8099/account"}')"
check "a computer that falls asleep is noticed, and the assistant is told in plain words" has "$OUT" "NOT CONNECTED"
P computer_when_back '{"task":"read the account page on my computer"}' >/dev/null
check "a job can wait for the computer" sh -c "docker exec -u hermes -e HOME=/opt/data godspeed godspeed-computer waiting | grep -q 'account page'"
docker unpause gs-home >/dev/null
check "the computer is back by itself after waking" connected 40
check "the waiting job is picked up when the computer is back" sh -c \
  "for i in \$(seq 1 30); do docker exec -u hermes -e HOME=/opt/data godspeed godspeed-computer waiting | grep -q 'Nothing is waiting' && docker logs godspeed 2>&1 | grep -q 'running a job that waited' && exit 0; sleep 1; done; exit 1"
x godspeed-computer off >/dev/null
check "\"stop using my computer\" disconnects it" sh -c "sleep 5; ! docker exec -u hermes -e HOME=/opt/data godspeed godspeed-computer status | grep -q '^Connected'"
OUT="$(P computer_browser_read)"
check "while switched off, the tools refuse in plain words" has "$OUT" "SWITCHED OFF"
x godspeed-computer on >/dev/null
check "\"use my computer again\" brings it back" connected 40

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
check "after the upgrade the computer reconnects by itself, with no new code" connected 60
check "after the upgrade the assistant still has the computer tools" sh -c "docker exec -u hermes -e HOME=/opt/data godspeed hermes mcp list | grep -q computer"
check "without a bot token the chat setup stays out of the way" sh -c \
  "! docker exec godspeed pgrep -f 'bin/godspeed-telegram-setup'"

# Setup from Telegram (usr/local/bin/godspeed-telegram-setup): a fresh volume that is given a
# bot token and nothing else, as a hosting company's form would. A stand-in Telegram inside the
# container (docker/test/fake-telegram.py) plays the reader: Start, a stranger writing second,
# three buttons. The real installer runs; only GitHub (fake-gh) and the ChatGPT code are stood in.
echo "== setup from Telegram, on a fresh volume, nothing typed"
docker compose down -v >/dev/null 2>&1
TG_TOKEN="123456789:TESTtoken_docker"
mkdir -p "$WORK/tg"
cat > "$WORK/tg/scenario.json" <<'EOF'
{"users": {"111": {"first_name": "Tess", "username": "tess"}, "999": {"first_name": "Eve"}},
 "start": [{"from": 111, "text": "/start"}, {"from": 999, "text": "hi"}],
 "rules": [{"when": "already have a Mission Control", "do": [{"from": 111, "press": "repo:fresh"}]},
           {"when": "morning brief", "do": [{"from": 111, "press": "brief:no"}]}]}
EOF
cat > "$WORK/compose.override.yaml" <<EOF
services:
  godspeed:
    image: $IMG
    pull_policy: never
    environment:
      GODSPEED_TELEGRAM_TOKEN: "$TG_TOKEN"
      GODSPEED_TELEGRAM_API: "http://127.0.0.1:8081"
      KB_SIGNIN_SKIP: "1"
    volumes:
      - $ROOT/docker/test/fake-gh:/usr/local/bin/gh:ro
      - $ROOT/docker/test/fake-telegram.py:/opt/test/fake-telegram.py:ro
      - $ROOT/docker/test/probe-chatgpt-code.py:/opt/test/probe-chatgpt-code.py:ro
      - $WORK/tg:/opt/test/tg
EOF
docker compose up -d >/dev/null 2>&1
check "the container is healthy with only a bot token" wait_healthy
docker exec -d godspeed sh -c 'PY=/opt/hermes/.venv/bin/python3; [ -x "$PY" ] || PY=python3;
  exec "$PY" /opt/test/fake-telegram.py --port 8081 --token "'"$TG_TOKEN"'" \
    --scenario /opt/test/tg/scenario.json --record /opt/test/tg/record.json'
tg_done() { docker exec godspeed grep -q '"done": true' /opt/data/.godspeed/telegram-setup.json 2>/dev/null; }
for _ in $(seq 1 300); do tg_done && break; sleep 3; done
check "the chat setup finishes by itself" tg_done
check "the first writer is greeted and owns the bot" grep -q 'Hi Tess' "$WORK/tg/record.json"
check "a stranger is turned away" grep -q 'This assistant belongs to someone else' "$WORK/tg/record.json"
check "the installer built the folder and pushed it" x sh -c \
  'test -f /opt/data/godspeed/AGENTS.md && git -C /opt/data/godspeed ls-remote --exit-code origin >/dev/null'
check "the chat asks no install-count question and the installer sends nothing" x grep -q '^GODSPEED_INSTALL_COUNT=0' /opt/data/.godspeed/device.env
check "the image's GitHub tool knows every flag the shared installer uses" x sh -c '/usr/bin/gh auth login --help | grep -q -- --skip-ssh-key'
check "the bot is handed to Hermes, for its owner only" x sh -c \
  "grep -qx 'TELEGRAM_ALLOWED_USERS=111' /opt/data/.env && grep -qx 'TELEGRAM_HOME_CHANNEL=111' /opt/data/.env && grep -q '^TELEGRAM_BOT_TOKEN=' /opt/data/.env"
check "the Hermes settings file is private" x sh -c '[ "$(stat -c %a /opt/data/.env)" = 600 ]'
check "the first message reached the chat" grep -q 'this is its chat' "$WORK/tg/record.json"
check "the token is not in the chat setup's log" sh -c \
  "docker exec godspeed test -s /opt/data/logs/godspeed-telegram-setup.log && ! docker exec godspeed grep -qF '$TG_TOKEN' /opt/data/logs/godspeed-telegram-setup.log"
check "the chat setup is gone once done" sh -c "! docker exec godspeed pgrep -f 'bin/godspeed-telegram-setup'"
check "nothing in the volume belongs to root after the chat setup" sh -c "[ -z \"\$(docker exec godspeed find /opt/data -user root -print -quit)\" ]"
check "healthy after the bot was handed over" wait_healthy

# The one part stood in above is the ChatGPT code. Here the real Hermes of this image prints
# one, in a throwaway settings folder, and the chat setup must read it. No network is not
# counted as a failure; a code printed and not read is.
PROBE="$(docker exec -u hermes -e HOME=/opt/data godspeed sh -c \
  'D=$(mktemp -d); PY=/opt/hermes/.venv/bin/python3; [ -x "$PY" ] || PY=python3;
   HERMES_HOME=$D PATH=/opt/hermes/.venv/bin:$PATH timeout 90 "$PY" /opt/test/probe-chatgpt-code.py; rm -rf "$D"' 2>&1 | tail -1)"
case "$PROBE" in
  FOUND*)      printf 'PASS  the real ChatGPT sign-in prints a code the chat setup reads (%s)\n' "${PROBE#FOUND }" ;;
  UNREACHED*)  printf 'NOTE  ChatGPT'"'"'s sign-in could not be reached from here, so the real code was not read: %s\n' "${PROBE#UNREACHED }" ;;
  *)           printf 'FAIL  the chat setup cannot read the code the real ChatGPT sign-in prints: %s\n' "$PROBE"; FAILS=$((FAILS+1)) ;;
esac

echo
if [ "$FAILS" -eq 0 ]; then echo "ALL PASS"; else
  echo "$FAILS FAILED. Setup's output:"; sed 's/\x1b\[[0-9;]*m//g' "$WORK/setup.log" | tail -60
  docker exec godspeed tail -20 /opt/data/logs/godspeed-upgrade.log 2>/dev/null
  echo "== the chat setup's log"; docker exec godspeed tail -60 /opt/data/logs/godspeed-telegram-setup.log 2>/dev/null
  echo "== what the stand-in Telegram received"; cat "$WORK/tg/record.json" 2>/dev/null | head -80
  exit 1
fi
