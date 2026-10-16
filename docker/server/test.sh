#!/bin/bash
# The one-line server installer's test (docker/server/install.sh):
#
#   bash docker/server/test.sh          the parts that need no Docker: the sslip.io address, the
#                                       busy-port and certificate-timeout messages, the systems it
#                                       installs Docker on, waiting while the server installs its
#                                       own updates, Docker's installer tried three times with a
#                                       stand-in for get.docker.com. Runs anywhere with bash and
#                                       python3; the waiting part needs Linux and perl.
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

# The last words (16 October 2026): where it is, how to start talking to it, where to hear more.
newsletter='I write about what it does and what broke, free: https://michaelzelbel.substack.com/subscribe'
first_words="$(lib 'finished_words 203-0-113-7.sslip.io "/setup#invite=abc"')"
again_words="$(lib 'finished_words 203-0-113-7.sslip.io')"
check "a first install says where it is" grep -qx 'Your mission control is installed at https://203-0-113-7\.sslip\.io\.' <<<"$first_words"
check "and how to start talking to it: the private link" bash -c 'grep -qx "To talk to it, open this private link in your browser to make your account:" <<<"$1" && grep -qx "  https://203-0-113-7.sslip.io/setup#invite=abc" <<<"$1"' _ "$first_words"
check "and ends with the newsletter" test "$(sed '/^$/d' <<<"$first_words" | tail -1)" = "$newsletter"
check "a run with the account made says so and how to sign in" bash -c 'grep -q "up to date at https://203-0-113-7.sslip.io, and your account already exists\." <<<"$1" && grep -qx "To talk to it, sign in there with your username and password." <<<"$1"' _ "$again_words"
check "and hands out no link, the newsletter last" bash -c '! grep -q "invite=" <<<"$1" && [ "$(sed "/^\$/d" <<<"$1" | tail -1)" = "$2" ]' _ "$again_words" "$newsletter"

# A version to try before it is released (GODSPEED_IMAGE): only an image of this product, by a
# commit's tag or a digest, and it goes on the godspeed service's line only, never Caddy's.
sha=0123456789abcdef0123456789abcdef01234567
check "a commit's image or a digest of this product can be tried" lib "test_image ghcr.io/michaelzelbel/godspeed-mission-control:v2-sha-$sha && test_image ghcr.io/michaelzelbel/godspeed-mission-control@sha256:$sha${sha:0:24}"
check "anything else is refused" lib "! test_image docker.io/evil/image:latest && ! test_image ghcr.io/michaelzelbel/godspeed-mission-control:latest && ! test_image 'ghcr.io/michaelzelbel/godspeed-mission-control:v2-sha-$sha; rm -rf /'"
cp docker/hostinger/compose.yaml "$WORK/compose.yaml"
check "the version to try replaces the pinned image" lib "pin_image $WORK/compose.yaml ghcr.io/michaelzelbel/godspeed-mission-control:v2-sha-$sha"
check "and nothing else: Caddy stays as pinned" bash -c "grep -qx '    image: ghcr.io/michaelzelbel/godspeed-mission-control:v2-sha-$sha' '$WORK/compose.yaml' && grep -q 'image: caddy:2.10.2-alpine@sha256:' '$WORK/compose.yaml' && [ \"\$(diff docker/hostinger/compose.yaml '$WORK/compose.yaml' | grep -c '^[<>]')\" = 2 ]"

printf 'ID=ubuntu\nPRETTY_NAME="Ubuntu 24.04.5 LTS"\n' > "$WORK/ubuntu"
printf 'ID=linuxmint\nID_LIKE="ubuntu debian"\n' > "$WORK/mint"
printf 'ID=fedora\nPRETTY_NAME="Fedora Linux 42"\n' > "$WORK/fedora"
check "Ubuntu, Debian and their family get Docker installed" lib "os_supported $WORK/ubuntu && os_supported $WORK/mint"
check "another system is said by name" lib "! os_supported $WORK/fedora && [ \"\$(os_name $WORK/fedora)\" = 'Fedora Linux 42' ]"

# A new server busy installing its own updates (16 October 2026). Apt's lock files, held the way
# apt holds them (an fcntl lock, which flock cannot see), make the installer wait; a wait that
# runs out says so in one plain sentence. Needs Linux and perl, which every Debian and Ubuntu has.
hold_lock() {   # hold_lock FILE SECONDS, in the background; $locker is the program holding it
  rm -f "$1.ready"
  perl -MFcntl -e 'open(my $f, ">>", $ARGV[0]) or die "open: $!"; my $l = pack("ssx4qqix4", F_WRLCK, 0, 0, 0, 0);
    fcntl($f, F_SETLKW, $l) or die "lock: $!"; open(my $r, ">", "$ARGV[0].ready") and close $r; sleep $ARGV[1];' "$1" "$2" &
  locker=$!
  for _ in $(seq 1 50); do [ -e "$1.ready" ] && return 0; sleep 0.1; done
  return 1
}
if [ "$(uname -s)" = Linux ] && command -v perl >/dev/null 2>&1; then
  lock="$WORK/lists-lock"; : > "$lock"
  check "apt counts as free when nobody holds its locks" lib "APT_LOCKS='$WORK/missing $lock'; ! apt_busy"
  check "and a free apt is not waited for, nothing said" test -z "$(lib "APT_LOCKS='$lock'; wait_for_apt" 2>&1)"
  hold_lock "$lock" 30
  check "apt counts as busy while another program holds one of its locks" lib "APT_LOCKS='$WORK/missing $lock'; apt_busy"
  kill "$locker" 2>/dev/null; wait "$locker" 2>/dev/null
  check "and as free again once that program lets go" lib "APT_LOCKS='$lock'; ! apt_busy"

  hold_lock "$lock" 3
  t0=$SECONDS
  out="$(lib "APT_LOCKS='$lock'; APT_WAIT=20; wait_for_apt; echo free now" 2>&1)"
  waited=$((SECONDS - t0))
  wait "$locker" 2>/dev/null
  check "a busy apt is waited for, said in one line" test "$(grep -cx -- '- This server is still installing its own updates\. Waiting for them to finish (up to 1 minute)\.' <<<"$out")" = 1
  check "and the wait ends when the updates finish (after $waited s)" bash -c '[ "$(tail -1 <<<"$1")" = "free now" ] && [ "$2" -ge 2 ] && [ "$2" -lt 15 ]' _ "$out" "$waited"

  hold_lock "$lock" 30
  expect_out "a wait that runs out stops with one plain sentence" \
    '^This server is still busy installing its own updates\. Run this line again in a few minutes; nothing was changed\.$' \
    lib "APT_LOCKS='$lock'; APT_WAIT=2; wait_for_apt"
  check "and exits 1, without a stack trace" bash -c 'out="$(GODSPEED_INSTALL_LIB=1 GODSPEED_DIR="$1" bash -c "source \"$2\"; APT_LOCKS=\"$3\"; APT_WAIT=1; wait_for_apt" 2>&1)"; [ $? -eq 1 ] && ! grep -qiE "trace|line [0-9]+:" <<<"$out"' _ "$WORK/dir" "$ROOT/docker/server/install.sh" "$lock"
  kill "$locker" 2>/dev/null; wait "$locker" 2>/dev/null
else
  echo "SKIP  waiting for a busy apt (needs Linux and perl)"
fi

# Docker's installer meeting a busy apt: apt told to wait for a lock (the setting APT_CONFIG adds),
# three tries, and when none works the reader sees apt's own words without opening the log.
# A stand-in for get.docker.com, so no Docker is installed here.
mkdir -p "$WORK/dir"
cat > "$WORK/get-docker-busy.sh" <<'EOF'
echo "+ sh -c 'apt-get -qq update >/dev/null'"
echo "APT_CONFIG adds: $(cat "$APT_CONFIG")"
echo "E: Could not get lock /var/lib/apt/lists/lock. It is held by process 10 (perl)"
echo "E: Unable to lock directory /var/lib/apt/lists/"
exit 100
EOF
cat > "$WORK/get-docker-once.sh" <<EOF
[ -e "$WORK/tried-once" ] && { echo "Docker installed"; exit 0; }
: > "$WORK/tried-once"
echo "E: Could not get lock /var/lib/apt/lists/lock. It is held by process 10 (perl)"
exit 100
EOF
docker_from() { lib "APT_LOCKS='$WORK/missing'; DOCKER_URL='file://$WORK/$1'; DOCKER_PAUSE=0; install_docker"; }
printf '%s\n' '2026-10-15T08:00:00Z install started' 'E: an error from an earlier run' > "$WORK/dir/install.log"
out="$(docker_from get-docker-busy.sh 2>&1)"; rc=$?
check "a Docker install that never works stops" test "$rc" -ne 0
check "with the sentence the reader knows" grep -qx 'Docker could not be installed. This is what went wrong:' <<<"$out"
check "and apt's own error lines under it, indented, each once" bash -c 'grep -qx "    E: Could not get lock /var/lib/apt/lists/lock. It is held by process 10 (perl)" <<<"$1" && grep -qx "    E: Unable to lock directory /var/lib/apt/lists/" <<<"$1" && [ "$(grep -c "Could not get lock" <<<"$1")" = 1 ]' _ "$out"
check "but nothing from an earlier run" bash -c '! grep -q "earlier run" <<<"$1"' _ "$out"
check "then where the whole story is" grep -qx "The whole story is in $WORK/dir/install.log." <<<"$out"
check "it was tried three times" test "$(grep -c 'installing Docker, try [0-9] of 3' "$WORK/dir/install.log")" = 3
check "each time with apt told to wait up to five minutes for a lock" test "$(grep -c 'APT_CONFIG adds: DPkg::Lock::Timeout "300";' "$WORK/dir/install.log")" = 3
check "and the downloaded installer and that setting are gone afterwards" bash -c "[ ! -e '$WORK/dir/get-docker.sh' ] && [ ! -e '$WORK/dir/apt-wait.conf' ]"
check "a try that meets a held lock is tried again, and the next one installs Docker" docker_from get-docker-once.sh
check "and the log says on which try" grep -q 'Docker installed on try 2$' "$WORK/dir/install.log"
printf '%s\n' one two three four five six seven > "$WORK/dir/install.log"
expect_out "without apt error lines, the last five lines are shown" '^    three$' lib 'stop_showing_log "Docker is installed but does not start." 0'
check "and no more" bash -c "! GODSPEED_INSTALL_LIB=1 GODSPEED_DIR='$WORK/dir' bash -c \"source '$ROOT/docker/server/install.sh'; stop_showing_log x 0\" 2>&1 | grep -qx '    two'"

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
