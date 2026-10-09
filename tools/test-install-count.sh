#!/usr/bin/env bash
# The gate for mc-install-count: it sends "first-brief" only after a yes, only once Hermes
# records the morning brief as delivered, only once, and then takes its own line off the clock
# and leaves every other line alone. Every send goes to a fake curl; nothing reaches the
# real receiver. Runs in a throwaway home.
# Usage: bash tools/test-install-count.sh
set -uo pipefail
. "$(dirname "$0")/test-guard.bash"
HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP" "$TEST_GUARD_HOME"' EXIT
mkdir -p "$TMP/bin"
cat > "$TMP/bin/curl" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >> "$FAKE_CURL_LOG"
exit "${FAKE_CURL_EXIT:-0}"
EOF
# A crontab that keeps its table in a file, so the test never touches the real schedule.
cat > "$TMP/bin/fakecron" <<'EOF'
#!/bin/sh
case "$1" in
  -l) [ -s "$FAKE_TAB" ] && cat "$FAKE_TAB" || exit 1 ;;
  -)  cat > "$FAKE_TAB" ;;
esac
EOF
chmod +x "$TMP/bin/curl" "$TMP/bin/fakecron"

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
check() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (want [$3], got [$2])"; fi; }

# case <name> <device.env lines> <brief job json or empty>
setup() {
  H="$TMP/$1"; mkdir -p "$H/.godspeed" "$H/.hermes/cron"
  printf '%s\n' "$2" > "$H/.godspeed/device.env"
  [ -n "$3" ] && printf '{"jobs":[%s]}\n' "$3" > "$H/.hermes/cron/jobs.json"
  printf '0 * * * * other-job\n# Tell Michael once that the first morning brief arrived; removes itself after (mc-install-count)\n17 7 * * * mc-install-count first-brief\n' > "$H/tab"
}
run() {
  HOME="$H" PATH="$TMP/bin:$PATH" FAKE_CURL_LOG="$H/curl.log" FAKE_TAB="$H/tab" KB_CRONTAB=fakecron \
    DO_NOT_TRACK="${DNT:-}" HERMES_HOME="" sh "$HERE/mc-install-count" first-brief >/dev/null 2>&1
}
sends() { [ -f "$H/curl.log" ] && grep -c . "$H/curl.log" || echo 0; }
sent_list() { sed -n 's/^GODSPEED_INSTALL_COUNT_SENT=//p' "$H/.godspeed/device.env"; }
on_clock() { grep -c 'mc-install-count' "$H/tab"; }
others() { grep -c 'other-job' "$H/tab"; }

ID=0123456789abcdef0123456789abcdef
YES="GODSPEED_INSTALL_COUNT=1
GODSPEED_INSTALL_ID=$ID
GODSPEED_INSTALL_COUNT_SENT=installed"
DELIVERED='{"name":"morning-brief","last_run_at":"2026-10-01T06:00:05+00:00","last_status":"ok","last_delivery_error":null}'

echo "mc-install-count gate"

setup waiting "$YES" '{"name":"morning-brief","last_run_at":null,"last_status":null,"last_delivery_error":null}'
run
check "no brief yet: nothing sent, and it stays on the clock for tomorrow" "$(sends):$(on_clock)" "0:2"

setup failed "$YES" '{"name":"morning-brief","last_run_at":"2026-10-01T06:00:05+00:00","last_status":"ok","last_delivery_error":"Telegram: chat not found"}'
run
check "a brief that ran but never reached the phone does not count" "$(sends)" "0"

setup arrived "$YES" "$DELIVERED"
run
check "a delivered brief sends one word with the install's own number" \
  "$(sends):$(grep -o '{.*}' "$H/curl.log")" "1:{\"product\":\"mission-control\",\"event\":\"first-brief\",\"install\":\"$ID\"}"
check "and it is written down beside installed" "$(sent_list)" "installed,first-brief"
check "and its line is off the clock, every other line kept" "$(on_clock):$(others)" "0:1"
run
check "a second run sends nothing more" "$(sends)" "1"

setup down "$YES" "$DELIVERED"
FAKE_CURL_EXIT=7 HOME="$H" PATH="$TMP/bin:$PATH" FAKE_CURL_LOG="$H/curl.log" FAKE_TAB="$H/tab" KB_CRONTAB=fakecron \
  HERMES_HOME="" sh "$HERE/mc-install-count" first-brief >/dev/null 2>&1
check "a receiver that cannot be reached: nothing written down, still on the clock" "$(sent_list):$(on_clock)" "installed:2"

setup no "GODSPEED_INSTALL_COUNT=0" "$DELIVERED"
run
check "after a no it sends nothing and takes itself off the clock" "$(sends):$(on_clock):$(others)" "0:0:1"

setup dnt "$YES" "$DELIVERED"
DNT=1 run
check "DO_NOT_TRACK stops it and takes it off the clock" "$(sends):$(on_clock)" "0:0"

setup nohermes "$YES" ""
run
check "no Hermes here yet: nothing sent, asked again tomorrow" "$(sends):$(on_clock)" "0:2"

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
