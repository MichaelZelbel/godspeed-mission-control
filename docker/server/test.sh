#!/bin/bash
# The one-line server installer's test (docker/server/install.sh):
#
#   bash docker/server/test.sh          the parts that need no Docker: the sslip.io address, which
#                                       version the stage file names and the refusals around it,
#                                       the busy-port and certificate-timeout messages, the systems
#                                       it installs Docker on, waiting while the server installs
#                                       its own updates, Docker's installer tried three times with
#                                       a stand-in for get.docker.com. Runs anywhere with bash and
#                                       python3; the waiting part needs Linux and perl, and the two
#                                       compose files are rendered where there is Docker.
#   sudo bash docker/server/test.sh e2e also the whole reader's path on THIS machine, as root:
#                                       install (Docker too, if missing) with GODSPEED_HOST=localhost
#                                       and a stage folder of its own naming the real image,
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

# A file:// address for a folder, which is how every download here is pointed at this checkout or
# at a stage folder made below. On Git Bash curl is a Windows program and cannot open a POSIX
# path, so there the address names the Windows one.
file_url() {
  if command -v cygpath >/dev/null 2>&1; then printf 'file:///%s\n' "$(cygpath -m "$1" | sed 's#^/*##')"
  else printf 'file://%s\n' "$1"; fi
}
ROOT_URL="$(file_url "$ROOT")"

# --- Without Docker ---------------------------------------------------------------
lib() { GODSPEED_INSTALL_LIB=1 GODSPEED_DIR="$WORK/dir" bash -c "source '$ROOT/docker/server/install.sh'; $1"; }

check "the script parses" bash -n docker/server/install.sh
check "the add-on model proxy is installed without Node, and another installation's command is preserved" lib "GODSPEED_RAW=$ROOT_URL; GODSPEED_MODEL_COMMAND_DIR=$WORK/model-bin; mkdir -p \"\$GODSPEED_MODEL_COMMAND_DIR\"; install_model_command && test -s \"\$DIR/.godspeed/model.mjs\" && grep -q godspeed-docker \"\$DIR/.godspeed/model-host.json\" && bash -n \"\$GODSPEED_MODEL_COMMAND_DIR/godspeed-model\" && printf 'keep another installation\n' > \"\$GODSPEED_MODEL_COMMAND_DIR/godspeed-model\" && install_model_command && grep -qx 'keep another installation' \"\$GODSPEED_MODEL_COMMAND_DIR/godspeed-model\""
expect_out "a public address becomes <a-b-c-d>.sslip.io" '^203-0-113-7\.sslip\.io$' lib 'sslip_host 203.0.113.7'
check "an impossible address is refused" bash -c "! GODSPEED_INSTALL_LIB=1 bash -c 'source $ROOT/docker/server/install.sh; sslip_host 300.1.2.3'"
check "a home-network address is not taken as public" lib 'is_private_ipv4 192.168.1.20 && is_private_ipv4 10.0.0.5 && is_private_ipv4 172.20.1.1 && is_private_ipv4 100.101.102.103 && is_private_ipv4 127.0.0.1'
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

# A version to try before the stage names it (GODSPEED_IMAGE): only an image of this product, by a
# commit's tag or a digest.
sha=0123456789abcdef0123456789abcdef01234567
check "a commit's image or a digest of this product can be tried" lib "test_image ghcr.io/michaelzelbel/godspeed-mission-control:v2-sha-$sha && test_image ghcr.io/michaelzelbel/godspeed-mission-control@sha256:$sha${sha:0:24}"
check "anything else is refused" lib "! test_image docker.io/evil/image:latest && ! test_image ghcr.io/michaelzelbel/godspeed-mission-control:latest && ! test_image 'ghcr.io/michaelzelbel/godspeed-mission-control:v2-sha-$sha; rm -rf /'"

# --- Which version this line installs: the stage ---------------------------------------
# (25 October 2026.) Stage folders of our own, each ref a folder, so what is walked here is the
# whole way the installer goes: the base address, the ref, that ref's stage.json, and its reader
# stage/stage.sh beside it. "clean/beta" is this checkout's own stage file, so beta.6's real
# values; every other folder is that file with one thing changed.
STAGE_IMG="$(sh stage/stage.sh stage.json get serverEditions.server.image)"
STAGE_VER="$(sh stage/stage.sh stage.json get version)"
CANDIDATE_REF=candidate/2.0.0-beta.7
CANDIDATE_VER=2.0.0-beta.7
TRY_IMG="ghcr.io/michaelzelbel/godspeed-mission-control:v2-sha-$sha"
OTHER_IMG="ghcr.io/michaelzelbel/godspeed-mission-control@sha256:$sha${sha:0:24}"
CODE=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef

# make_stage <remote folder> <ref> [python statements changing d, the stage read from stage.json]
# A fixture the reader itself refuses would prove nothing, so each one is checked as it is made.
make_stage() {
  local dir="$WORK/$1/$2"
  mkdir -p "$dir/stage" && cp stage/stage.sh "$dir/stage/stage.sh" || return 1
  python3 - "$dir/stage.json" "${3:-}" <<'PY' || return 1
import json, sys
d = json.load(open('stage.json'))
if sys.argv[2]:
    exec(sys.argv[2])
with open(sys.argv[1], 'w', newline='\n') as f:
    json.dump(d, f, indent=2)
    f.write('\n')
PY
  sh stage/stage.sh "$dir/stage.json" check
}
check "the stage folders the next checks read are stage files both readers take" bash -c "
  $(declare -f make_stage)
  WORK='$WORK'
  make_stage clean beta &&
  make_stage clean '$CANDIDATE_REF' \"d['version']='$CANDIDATE_VER'; d['serverEditions']['server']['image']='$OTHER_IMG'\" &&
  make_stage own-withdrawn beta \"d['withdrawn']=[d['version']]\" &&
  make_stage public-withdrawn beta \"d['withdrawn']=['$CANDIDATE_VER']\" &&
  make_stage public-withdrawn '$CANDIDATE_REF' \"d['version']='$CANDIDATE_VER'\" &&
  make_stage no-stage beta && rm '$WORK/no-stage/beta/stage.json' &&
  make_stage malformed beta && printf 'not a stage file\n' > '$WORK/malformed/beta/stage.json'"

# run_stage <remote folder> <ref or -> <GODSPEED_IMAGE or -> <the .env an earlier run left, or ->
# The installer's own way from the base address to the settings it writes, as its own library:
# the same calls, in the same order, as main makes.
run_stage() {
  local root="$1" ref="$2" img="$3" env0="$4" dir="$WORK/run"
  rm -rf "$dir" "$WORK/stage-work"; mkdir -p "$dir" || return 1
  [ "$env0" = - ] || printf '%s\n' "$env0" > "$dir/.env"
  local vars=(GODSPEED_INSTALL_LIB=1 "GODSPEED_DIR=$dir" "GODSPEED_STAGE_RAW=$(file_url "$WORK/$root")")
  [ "$ref" = - ] || vars+=("GODSPEED_STAGE_REF=$ref")
  [ "$img" = - ] || vars+=("GODSPEED_IMAGE=$img")
  env "${vars[@]}" bash -c "source '$ROOT/docker/server/install.sh'
    stage_setup
    read_stage '$WORK/stage-work'
    [ ! -f \"\$DIR/.env\" ] || TRY=\"\$(sed -n 's/^GODSPEED_IMAGE=//p' \"\$DIR/.env\" | tail -1)\"
    decide_image
    write_env localhost $CODE"
}
env_line() { grep -qx "$1" "$WORK/run/.env"; }
# "refused WHAT PATTERN remote ref": the run stops, says that in one plain sentence, and leaves
# the install's settings unwritten.
refused() {
  local what="$1" pat="$2" out rc
  out="$(run_stage "$3" "${4:--}" - - 2>&1)"; rc=$?
  if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -qE -- "$pat" \
     && [ "$(printf '%s\n' "$out" | grep -c .)" = 1 ] && [ ! -e "$WORK/run/.env" ]; then pass "$what"
  else fail "$what"; printf '      got (exit %s): %s\n' "$rc" "$out" | head -5; fi
}

# The same rule, and the same name for it, as the Mac and Linux line's install-godspeed.sh: the
# names git itself would take for a branch or a tag, and nothing a shell or a web address would
# read as something of its own.
check "a plain branch or tag name is the stage ref, anything else is refused" lib '
  ref_is_a_name beta && ref_is_a_name candidate/2.0.0-beta.7 && ref_is_a_name v2.0.0_rc-1 &&
  ref_is_a_name release-2.0 &&
  ! ref_is_a_name ../../etc/passwd && ! ref_is_a_name https://evil.example/x && ! ref_is_a_name -x &&
  ! ref_is_a_name "a b" && ! ref_is_a_name "x?y" && ! ref_is_a_name "a;rm -rf /" && ! ref_is_a_name beta/ &&
  ! ref_is_a_name a//b && ! ref_is_a_name beta.lock && ! ref_is_a_name a/b.lock && ! ref_is_a_name "" &&
  ! ref_is_a_name /x && ! ref_is_a_name a/.b && ! ref_is_a_name .hidden && ! ref_is_a_name x.'
expect_out "and the refusal says in one sentence what a stage ref looks like" \
  '^GODSPEED_STAGE_REF should be the name of a branch or a tag, like beta or candidate/2\.0\.0-beta\.7, and it is \.\./x\. Nothing was changed\.$' \
  lib 'GODSPEED_STAGE_REF=../x; stage_setup'
check "beta is the stage by default, and GODSPEED_STAGE_REF picks another" bash -c "
  { out=\$(GODSPEED_INSTALL_LIB=1 GODSPEED_STAGE_RAW=https://example.test/kit bash -c \"source '$ROOT/docker/server/install.sh'; stage_setup; printf '%s %s' \\\"\\\$GODSPEED_RAW\\\" \\\"\\\$GODSPEED_SELF_URL\\\"\")
    [ \"\$out\" = 'https://example.test/kit/beta https://example.test/kit/beta/docker/server/install.sh' ]; } &&
  [ \"\$(GODSPEED_INSTALL_LIB=1 GODSPEED_STAGE_RAW=https://example.test/kit GODSPEED_STAGE_REF=$CANDIDATE_REF bash -c \"source '$ROOT/docker/server/install.sh'; stage_setup; printf '%s' \\\"\\\$GODSPEED_RAW\\\"\")\" = https://example.test/kit/$CANDIDATE_REF ]"

run_stage clean - - - >/dev/null 2>&1
check "the image in .env is the stage file's" bash -c "
  $(declare -f env_line)
  WORK='$WORK'
  env_line 'GODSPEED_SERVER_IMAGE=$STAGE_IMG' && env_line 'GODSPEED_HOST=localhost' &&
  env_line 'GODSPEED_SETUP_CODE=$CODE' && ! grep -q '^GODSPEED_IMAGE=' '$WORK/run/.env'"
run_stage clean "$CANDIDATE_REF" - - >/dev/null 2>&1
check "and the stage file of the ref asked for decides it" bash -c "
  $(declare -f env_line)
  WORK='$WORK'
  env_line 'GODSPEED_SERVER_IMAGE=$OTHER_IMG'"
check "the downloaded compose file is left exactly as it is" bash -c "
  ! grep -q 'pin_image' docker/server/install.sh &&
  ! grep -qE 'sed -i' docker/server/install.sh docker/server/install-browser.sh &&
  [ \"\$(grep -c '^    image: ghcr' docker/hostinger/compose.yaml docker/server/browser-compose-traefik.yaml | grep -c ':0$')\" = 2 ] &&
  grep -qF 'image: \${GODSPEED_SERVER_IMAGE:-$STAGE_IMG}' docker/hostinger/compose.yaml &&
  grep -qF 'image: \${GODSPEED_SERVER_IMAGE:-$STAGE_IMG}' docker/server/browser-compose-traefik.yaml"

run_stage clean - "$TRY_IMG" - >/dev/null 2>&1
kept="$(cat "$WORK/run/.env" 2>/dev/null)"
check "GODSPEED_IMAGE still wins and is kept for later runs" bash -c "
  $(declare -f env_line)
  WORK='$WORK'
  env_line 'GODSPEED_SERVER_IMAGE=$TRY_IMG' && env_line 'GODSPEED_IMAGE=$TRY_IMG'"
run_stage clean - - "$kept" >/dev/null 2>&1
check "and a later run without it stays on that version" bash -c "
  $(declare -f env_line)
  WORK='$WORK'
  env_line 'GODSPEED_SERVER_IMAGE=$TRY_IMG' && env_line 'GODSPEED_IMAGE=$TRY_IMG'"
run_stage clean - release "$kept" >/dev/null 2>&1
check "GODSPEED_IMAGE=release goes back to the stage's image" bash -c "
  $(declare -f env_line)
  WORK='$WORK'
  env_line 'GODSPEED_SERVER_IMAGE=$STAGE_IMG' && ! grep -q '^GODSPEED_IMAGE=' '$WORK/run/.env'"
expect_out "a GODSPEED_IMAGE that names something else stops the run in one sentence" \
  'GODSPEED_IMAGE should name one version of Godspeed Mission Control' \
  run_stage clean - docker.io/evil/image:latest -

refused "a version on the stage's own withdrawn list is refused, nothing changed" \
  "^Godspeed Mission Control $STAGE_VER was taken back and cannot be installed\. .*nothing was changed\.$" own-withdrawn
refused "a version on the public stage's withdrawn list is refused, nothing changed" \
  "^Godspeed Mission Control $CANDIDATE_VER was taken back and cannot be installed\. .*nothing was changed\.$" public-withdrawn "$CANDIDATE_REF"
refused "a malformed stage file is refused, nothing changed" \
  '^Which version to install could not be read: .* Nothing was changed\.$' malformed
refused "a missing stage file is refused, nothing changed" \
  '^Could not read which version to install from file.*stage\.json\. .*nothing was changed\.$' no-stage

# The two compose files the installers download, rendered by Docker itself with the settings the
# installer wrote: the godspeed service runs the stage's image, Caddy stays as pinned. Needs Docker
# (not every machine has it); the e2e part below renders them on a server that does.
if docker compose version >/dev/null 2>&1; then
  run_stage clean - - - >/dev/null 2>&1
  for f in docker/hostinger/compose.yaml docker/server/browser-compose-traefik.yaml; do
    rendered="$(docker compose -f "$f" --env-file "$WORK/run/.env" config 2>&1)"
    check "docker compose config of $f names the stage's image for godspeed, Caddy as pinned" \
      bash -c "printf '%s\n' \"\$1\" | grep -qF 'image: $STAGE_IMG' && printf '%s\n' \"\$1\" | grep -qE 'image: caddy:[0-9.]+-alpine@sha256:[0-9a-f]{64}' && ! printf '%s\n' \"\$1\" | grep -q 'GODSPEED_SERVER_IMAGE'" _ "$rendered"
  done
else
  echo "SKIP  docker compose config of the two compose files (no Docker here)"
fi

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
docker_from() { lib "APT_LOCKS='$WORK/missing'; DOCKER_URL='$(file_url "$WORK")/$1'; DOCKER_PAUSE=0; install_docker"; }
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
# The reader's own way, with one thing pointed elsewhere: the stage lives in a folder here instead
# of on github.com. "beta" is this checkout, so the stage file is the real stage.json and the
# compose file, the helper files and the image all come from the one stage, as on a real server.
mkdir -p "$WORK/remote" && ln -sfn "$ROOT" "$WORK/remote/beta"
export GODSPEED_HOST=localhost GODSPEED_STAGE_RAW="$(file_url "$WORK/remote")"
E2E_STAGE_IMG="$(sh stage/stage.sh stage.json get serverEditions.server.image)"
command -v docker >/dev/null 2>&1 && had_docker=yes || had_docker=no
echo "Docker before the first run: $had_docker"
echo "The stage this install reads: $GODSPEED_STAGE_RAW/beta/stage.json, naming $E2E_STAGE_IMG"
curl -fsSL "$GODSPEED_STAGE_RAW/beta/docker/server/install.sh" | bash > "$WORK/run1.txt" 2>&1; rc1=$?   # the way the book prints it
echo "----- what the reader sees, first run -----"; cat "$WORK/run1.txt"; echo "-------------------------------------------"
check "the first run succeeds" test "$rc1" -eq 0
check "Docker is there afterwards" docker info
check ".env holds the address and a 64-character setup code, readable by root only" \
  bash -c "grep -qx 'GODSPEED_HOST=localhost' $DIR/.env && grep -qE '^GODSPEED_SETUP_CODE=[a-f0-9]{64}$' $DIR/.env && [ \"\$(stat -c %a $DIR/.env)\" = 600 ]"
check "compose.yaml is Hostinger's, byte for byte" cmp -s "$DIR/compose.yaml" docker/hostinger/compose.yaml
check ".env names the image the stage file names" grep -qx "GODSPEED_SERVER_IMAGE=$E2E_STAGE_IMG" "$DIR/.env"
check "and no version to try, since none was asked for" bash -c "! grep -q '^GODSPEED_IMAGE=' $DIR/.env"
check "docker compose config of the install names that image for godspeed, Caddy as pinned" bash -c "
  out=\"\$(docker compose -p godspeed-mission-control --project-directory '$DIR' -f '$DIR/compose.yaml' --env-file '$DIR/.env' config)\"
  printf '%s\n' \"\$out\" | grep -qF 'image: $E2E_STAGE_IMG' &&
  printf '%s\n' \"\$out\" | grep -qE 'image: caddy:[0-9.]+-alpine@sha256:[0-9a-f]{64}'"
link="$(grep -oE 'https://localhost/setup#invite=[a-f0-9]{64}' "$WORK/run1.txt" | head -1)"
check "it prints one private link" test -n "$link"
cid="$(docker compose -p godspeed-mission-control ps -q godspeed)"
check "the app is healthy" test "$(docker inspect -f '{{.State.Health.Status}}' "$cid")" = healthy
ran_image="$(docker inspect -f '{{index .RepoDigests 0}}' "$(docker inspect -f '{{.Image}}' "$cid")" 2>/dev/null)"
echo "The running container's image: $ran_image"
check "the container really runs the image the stage file names" test "$ran_image" = "$E2E_STAGE_IMG"
check "HTTPS answers" curl -fsSk https://localhost/health
invite_status() { curl -sk -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -d "{\"invite\":\"${1##*#invite=}\"}" https://localhost/api/auth/invite; }
check "the server accepts the printed link" test "$(invite_status "$link")" = 200

# Run again before the account exists: a fresh link, and the first one stops working.
curl -fsSL "$GODSPEED_STAGE_RAW/beta/docker/server/install.sh" | bash > "$WORK/run-again.txt" 2>&1; rc=$?
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
curl -fsSL "$GODSPEED_STAGE_RAW/beta/docker/server/install.sh" | bash > "$WORK/run-busy.txt" 2>&1; rc=$?
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
curl -fsSL "$GODSPEED_STAGE_RAW/beta/docker/server/install.sh" | bash > "$WORK/run2.txt" 2>&1; rc2=$?
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
