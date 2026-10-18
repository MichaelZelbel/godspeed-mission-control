#!/usr/bin/env bash
# The agent cage's wiring, checked without root and without a server:
#   - install.sh pins a kit-bootstrap tag and a SHA-256, and the two describe the same
#     file (checked against the sibling kit-bootstrap clone when it is there)
#   - install.sh verifies the hash before it runs anything, then runs install,
#     watch-unit for the gateway and the dashboard, and selftest
#   - the watchdog's two AI lines in root's crontab go through agent-cage, the floor
#     does not, and root's whole crontab never gets a SHELL=
#   - the manual path (setup.md) carries the same tag and hash
set -uo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
INSTALL="$ROOT/install.sh"
WATCHDOG="$ROOT/install-watchdog.sh"
SETUP="$ROOT/setup.md"
BOOTSTRAP="${KIT_BOOTSTRAP_DIR:-$ROOT/../../kit-bootstrap}"

pass=0
fail=0
check() {
  local name="$1"
  shift
  if "$@"; then
    printf 'PASS: %s\n' "$name"
    pass=$((pass + 1))
  else
    printf 'FAIL: %s\n' "$name"
    fail=$((fail + 1))
  fi
}

PIN="$(sed -n 's/^AGENT_CAGE_PIN="\([^"]*\)"$/\1/p' "$INSTALL" | head -1)"
SHA="$(sed -n 's/^AGENT_CAGE_SHA256="\([0-9a-f]*\)"$/\1/p' "$INSTALL" | head -1)"

check "install.sh pins an agent-cage tag" [ -n "$PIN" ]
check "install.sh pins a 64-character SHA-256" [ "${#SHA}" -eq 64 ]
check "the download URL uses the pinned tag" \
  grep -q 'kit-bootstrap/$AGENT_CAGE_PIN/agent-cage.sh' "$INSTALL"

if git -C "$BOOTSTRAP" rev-parse --git-dir >/dev/null 2>&1; then
  if git -C "$BOOTSTRAP" rev-parse -q --verify "refs/tags/$PIN" >/dev/null 2>&1; then
    REAL="$(git -C "$BOOTSTRAP" show "$PIN:agent-cage.sh" | sha256sum | cut -d' ' -f1)"
    check "the pinned SHA-256 matches agent-cage.sh at $PIN in kit-bootstrap" [ "$REAL" = "$SHA" ]
  else
    check "the tag $PIN exists in the kit-bootstrap clone at $BOOTSTRAP" false
  fi
else
  printf 'SKIP: no kit-bootstrap clone at %s, so the hash is not compared with the real file\n' "$BOOTSTRAP"
fi

# The order inside install.sh: hash check, then install, watch-unit, selftest.
line_of() { grep -n -- "$1" "$INSTALL" | head -1 | cut -d: -f1; }
L_SHA="$(line_of 'sha256sum "$CAGE_TMP"')"
L_INSTALL="$(line_of 'agent-cage.sh install')"
L_WATCH_GW="$(line_of "agent-cage.sh watch-unit 'hermes-gateway\*.service'")"
L_WATCH_DB="$(line_of "agent-cage.sh watch-unit 'hermes-dashboard\*.service'")"
L_SELF="$(line_of 'agent-cage.sh selftest >')"
L_WD="$(line_of 'WATCHDOG_INSTALL_URL=')"
check "install.sh compares the hash" [ -n "$L_SHA" ]
check "install.sh runs install" [ -n "$L_INSTALL" ]
check "install.sh watches the gateway" [ -n "$L_WATCH_GW" ]
check "install.sh watches the dashboard" [ -n "$L_WATCH_DB" ]
check "install.sh runs selftest" [ -n "$L_SELF" ]
check "the hash is checked before anything runs" [ "${L_SHA:-0}" -lt "${L_INSTALL:-0}" ]
ordered() { [ "${L_INSTALL:-0}" -lt "${L_WATCH_GW:-0}" ] && [ "${L_WATCH_GW:-0}" -lt "${L_SELF:-0}" ]; }
check "install comes before watch-unit and selftest" ordered
check "the cage is installed before the watchdog" [ "${L_SELF:-0}" -lt "${L_WD:-0}" ]
selftest_warns() {
  sed -n "${L_SELF:-1},$(( ${L_SELF:-1} + 6 ))p" "$INSTALL" | grep -q "warn \"the agent cage's self-test"
}
check "a failed selftest warns and does not stop the install" selftest_warns

# The watchdog's crontab block, rendered the way install-watchdog.sh renders it.
block_line() { grep -- "$1" "$WATCHDOG" | grep -v '^#' | head -1; }
SELFTEST_LINE="$(block_line 'templates/selftest.sh$')"
DEEP_LINE="$(block_line 'templates/run-prompt.sh six-hour-deep-check$')"
FLOOR_LINE="$(block_line 'floor/quick-check.sh$')"
check "the self-check line goes through the cage" \
  bash -c "printf '%s' '$SELFTEST_LINE' | grep -q '^\$SELFTEST_EVERY \$CAGE_SELFTEST '"
check "the deep-check line goes through the cage" \
  bash -c "printf '%s' '$DEEP_LINE' | grep -q '^\$DEEP_CHECK_AT \$CAGE_DEEP '"
check "the cage prefixes are agent-cage with a time limit" \
  bash -c "grep -q '^  CAGE_SELFTEST=\"/usr/local/bin/agent-cage --max 10m --\"' '$WATCHDOG' && grep -q '^  CAGE_DEEP=\"/usr/local/bin/agent-cage --max 30m --\"' '$WATCHDOG'"
check "the floor stays uncaged" \
  bash -c "printf '%s' '$FLOOR_LINE' | grep -q '^\*/5 \* \* \* \* \$WATCHDOG_DIR/floor/quick-check.sh'"
check "root's crontab never gets a SHELL= line" bash -c "! grep -q '^SHELL=' '$WATCHDOG'"

# The by-hand path carries the same pin.
check "setup.md downloads the same tag" grep -q "kit-bootstrap/$PIN/agent-cage.sh" "$SETUP"
check "setup.md checks the same hash" grep -q "$SHA  /usr/local/sbin/agent-cage.sh" "$SETUP"

check "install.sh parses" bash -n "$INSTALL"
check "install-watchdog.sh parses" bash -n "$WATCHDOG"

printf '\n%s passed, %s failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
