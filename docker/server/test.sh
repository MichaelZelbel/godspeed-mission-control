#!/bin/bash
# The one-line server installer's test (docker/server/install.sh):
#
#   bash docker/server/test.sh          the parts that need no Docker: the sslip.io address, the
#                                       busy-port and certificate-timeout messages, the systems it
#                                       installs Docker on. Runs anywhere with bash and python3.
#   sudo bash docker/server/test.sh e2e also the whole reader's path on THIS machine, as root:
#                                       install (Docker too, if missing) with GODSPEED_HOST=localhost,
#                                       the printed link, a browser making the account and reaching
#                                       Connect Telegram (when node and playwright are here), then a
#                                       second run that keeps the account and hands out no new link.
#                                       Use a machine you can throw away: it takes ports 80 and 443
#                                       and leaves Docker installed. KEEP=1 leaves Godspeed running.
#
# Prints PASS or FAIL per check and exits 1 when any check failed.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
ROOT="$PWD"
FAILS=0
pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; FAILS=$((FAILS+1)); }
check() { local what="$1"; shift; if "$@" >/dev/null 2>&1; then pass "$what"; else fail "$what"; fi; }
# "expect_out WHAT PATTERN command...": the command's output (both streams) contains PATTERN.
expect_out() { local what="$1" pat="$2" out; shift 2; out="$("$@" 2>&1)"; if printf '%s' "$out" | grep -qE -- "$pat"; then pass "$what"; else fail "$what"; printf '      got: %s\n' "$out" | head -5; fi; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# --- Without Docker ---------------------------------------------------------------
lib() { GODSPEED_INSTALL_LIB=1 GODSPEED_DIR="$WORK/dir" bash -c "source '$ROOT/docker/server/install.sh'; $1"; }

check "the script parses" bash -n docker/server/install.sh
expect_out "a public address becomes <a-b-c-d>.sslip.io" '^203-0-113-7\.sslip\.io$' lib 'sslip_host 203.0.113.7'
check "an impossible address is refused" bash -c "! GODSPEED_INSTALL_LIB=1 bash -c 'source $ROOT/docker/server/install.sh; sslip_host 300.1.2.3'"
check "a home-network address is not taken as public" lib 'is_private_ipv4 192.168.1.20 && is_private_ipv4 10.0.0.5 && is_private_ipv4 172.20.1.1 && is_private_ipv4 100.86.49.3 && is_private_ipv4 127.0.0.1'
check "a public address is" lib '! is_private_ipv4 203.0.113.7 && ! is_private_ipv4 172.32.0.1 && ! is_private_ipv4 8.8.8.8'
expect_out "GODSPEED_HOST loses https://, a path and capitals" '^mission\.example\.com$' lib 'clean_host https://Mission.Example.com/'
check "GODSPEED_HOST with a space is refused" bash -c "! GODSPEED_INSTALL_LIB=1 bash -c 'source $ROOT/docker/server/install.sh; clean_host \"bad host\"'"
check "localhost gets Caddy's own certificate, sslip.io a real one" lib 'local_host localhost && ! local_host 203-0-113-7.sslip.io'

printf 'ID=ubuntu\nPRETTY_NAME="Ubuntu 24.04.5 LTS"\n' > "$WORK/ubuntu"
printf 'ID=linuxmint\nID_LIKE="ubuntu debian"\n' > "$WORK/mint"
printf 'ID=fedora\nPRETTY_NAME="Fedora Linux 42"\n' > "$WORK/fedora"
check "Ubuntu, Debian and their family get Docker installed" lib "os_supported $WORK/ubuntu && os_supported $WORK/mint"
check "another system is said by name" lib "! os_supported $WORK/fedora && [ \"\$(os_name $WORK/fedora)\" = 'Fedora Linux 42' ]"

# A port something else holds: one plain sentence, and the other program is left alone.
port="$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])')"
python3 -c "import socket,time;s=socket.socket();s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);s.bind(('0.0.0.0',$port));s.listen();time.sleep(30)" &
holder=$!
sleep 1
expect_out "a busy port stops with one sentence naming it" "Another program on this server already uses port $port.*nothing was changed" lib "check_ports $port"
check "and the program holding it still runs" kill -0 "$holder"
kill "$holder" 2>/dev/null; wait "$holder" 2>/dev/null
check "a free port passes" lib "check_ports $port"

# No certificate in time: what to open, and to run the line again. Nothing listens on that port.
expect_out "a certificate that never comes says: ports 80 and 443, then run again" \
  'could not get its security certificate for https://203-0-113-7\.sslip\.io within 1 minute\. .*ports 80 and 443.*run this line again' \
  lib "CERT_WAIT=2; HTTPS_PORT=$port; wait_certificate 203-0-113-7.sslip.io"
check "the certificate wait exits 1, without a stack trace" bash -c "! GODSPEED_INSTALL_LIB=1 bash -c 'source $ROOT/docker/server/install.sh; CERT_WAIT=1; HTTPS_PORT=$port; wait_certificate localhost' 2>&1 | grep -qiE 'trace|line [0-9]+:'"

# With internet: the name really points back at the address, and this machine's address is found.
if command -v getent >/dev/null 2>&1 && getent hosts sslip.io >/dev/null 2>&1; then
  expect_out "sslip.io answers 203-0-113-7.sslip.io with 203.0.113.7" '^203\.0\.113\.7 ' getent ahostsv4 203-0-113-7.sslip.io
  expect_out "this machine's public IPv4 address is found" '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' lib public_ipv4
else
  echo "SKIP  sslip.io and the public address (no internet here)"
fi

if [ "${1:-}" != e2e ]; then
  [ "$FAILS" -eq 0 ] && echo "All checks passed." || echo "$FAILS check(s) failed."
  exit $((FAILS > 0))
fi

# --- The whole path, on this machine ------------------------------------------------
[ "$(id -u)" -eq 0 ] || { echo "e2e needs root: sudo bash docker/server/test.sh e2e"; exit 1; }
DIR="${GODSPEED_DIR:-/opt/godspeed-mission-control}"
export GODSPEED_HOST=localhost GODSPEED_RAW="file://$ROOT"
command -v docker >/dev/null 2>&1 && had_docker=yes || had_docker=no
echo "Docker before the first run: $had_docker"
curl -fsSL "$GODSPEED_RAW/docker/server/install.sh" | bash > "$WORK/run1.txt" 2>&1; rc1=$?   # the way the book prints it
echo "----- what the reader sees, first run -----"; cat "$WORK/run1.txt"; echo "-------------------------------------------"
check "the first run succeeds" test "$rc1" -eq 0
check "Docker is there afterwards" docker info
check ".env holds the address and a 64-character setup code, readable by root only" \
  bash -c "grep -qx 'GODSPEED_HOST=localhost' $DIR/.env && grep -qE '^GODSPEED_SETUP_CODE=[a-f0-9]{64}$' $DIR/.env && [ \"\$(stat -c %a $DIR/.env)\" = 600 ]"
check "compose.yaml is Hostinger's, byte for byte" cmp -s "$DIR/compose.yaml" docker/hostinger/compose.yaml
link="$(grep -oE 'https://localhost/setup#invite=[a-f0-9]{64}' "$WORK/run1.txt" | head -1)"
check "it prints one private link" test -n "$link"
cid="$(docker compose -p godspeed-mission-control ps -q godspeed)"
check "the app is healthy" test "$(docker inspect -f '{{.State.Health.Status}}' "$cid")" = healthy
check "HTTPS answers" curl -fsSk https://localhost/health
invite_status() { curl -sk -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -d "{\"invite\":\"${1##*#invite=}\"}" https://localhost/api/auth/invite; }
check "the server accepts the printed link" test "$(invite_status "$link")" = 200

# Run again before the account exists: a fresh link, and the first one stops working.
curl -fsSL "$GODSPEED_RAW/docker/server/install.sh" | bash > "$WORK/run-again.txt" 2>&1; rc=$?
echo "----- what the reader sees, run again before making the account -----"; cat "$WORK/run-again.txt"; echo "---------------------------------------------------------------------"
check "running it again before the account succeeds" test "$rc" -eq 0
fresh="$(grep -oE 'https://localhost/setup#invite=[a-f0-9]{64}' "$WORK/run-again.txt" | head -1)"
check "and prints a fresh link" test -n "$fresh" -a "$fresh" != "$link"
check "the earlier link no longer works" test "$(invite_status "$link")" = 401
check "the fresh one does" test "$(invite_status "$fresh")" = 200
link="$fresh"

# Port 80 held by another program (the HTTPS service stopped, a stand-in listening): one
# sentence, nothing changed, and the stand-in still runs.
dc() { docker compose -p godspeed-mission-control --project-directory "$DIR" -f "$DIR/compose.yaml" --env-file "$DIR/.env" "$@"; }
dc stop https >/dev/null 2>&1
python3 -m http.server 80 --bind 0.0.0.0 >/dev/null 2>&1 &
other=$!; sleep 1
curl -fsSL "$GODSPEED_RAW/docker/server/install.sh" | bash > "$WORK/run-busy.txt" 2>&1; rc=$?
echo "----- what the reader sees when port 80 is taken -----"; cat "$WORK/run-busy.txt"; echo "------------------------------------------------------"
check "a taken port 80 stops the run" test "$rc" -ne 0
check "with one sentence naming the port and the program" grep -q 'already uses port 80 (python3' "$WORK/run-busy.txt"
check "and the other program still runs" kill -0 "$other"
kill "$other"; wait "$other" 2>/dev/null
dc up -d >/dev/null 2>&1
for _ in $(seq 1 30); do curl -fsSk -o /dev/null https://localhost/health 2>/dev/null && break; sleep 2; done
if [ -n "${PLAYWRIGHT_NODE_PATH:-}" ] || node -e 'require("playwright")' >/dev/null 2>&1; then
  EVIDENCE="${EVIDENCE:-$WORK/evidence}"; mkdir -p "$EVIDENCE"
  if NODE_PATH="${PLAYWRIGHT_NODE_PATH:-${NODE_PATH:-}}" GODSPEED_VERIFY_ORIGIN=https://localhost GODSPEED_VERIFY_INVITATION_URL="$link" \
       node docker/full-candidate/test-browser.cjs "$cid" "$EVIDENCE"; then
    pass "the link makes the account, shows the recovery code, reaches Connect Telegram, and a made-up key is refused"
  else fail "the browser path from the link"; fi
else
  echo "SKIP  the browser path (no node with playwright here; set PLAYWRIGHT_NODE_PATH)"
fi
code1="$(sed -n 's/^GODSPEED_SETUP_CODE=//p' "$DIR/.env")"
curl -fsSL "$GODSPEED_RAW/docker/server/install.sh" | bash > "$WORK/run2.txt" 2>&1; rc2=$?
echo "----- what the reader sees, second run -----"; cat "$WORK/run2.txt"; echo "--------------------------------------------"
check "the second run succeeds" test "$rc2" -eq 0
if grep -q 'account already exists' "$WORK/run2.txt"; then
  check "with an account, the second run hands out no link" bash -c "! grep -q 'invite=' $WORK/run2.txt"
  code="$(sed -n 's/^GODSPEED_SETUP_CODE=//p' "$DIR/.env")"
  check "and the setup code can no longer make an owner" bash -c "curl -sk -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -d '{\"token\":\"$code\"}' https://localhost/api/auth/bootstrap | grep -qx 409"
else
  check "without an account, the second run hands out a fresh link" grep -qE 'https://localhost/setup#invite=[a-f0-9]{64}' "$WORK/run2.txt"
fi
check "the setup code is the same after the second run" grep -qx "GODSPEED_SETUP_CODE=$code1" "$DIR/.env"
if [ "${KEEP:-}" != 1 ]; then
  dc down -v >/dev/null 2>&1
  rm -rf "$DIR"
fi
[ "$FAILS" -eq 0 ] && echo "All checks passed." || echo "$FAILS check(s) failed."
exit $((FAILS > 0))
