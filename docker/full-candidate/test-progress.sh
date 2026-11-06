# What the image's server-test step shows while the tests run (sourced by test.sh, and by notebook/test/image-test-progress.test.mjs).
# Reads the TAP output on stdin: the whole of it goes to the log file given as the argument; the failures and the summary are shown
# the moment they are printed, so a hang right after a failure still names the failing test (grep is line-buffered because its output
# is a pipe when CI captures it, and a block-buffered grep would show nothing until the process ended).
TAP_SELECT='^not ok|^# (tests|pass|fail|cancelled)'
server_test_progress() {
  tee "$1" | grep --line-buffered -E "$TAP_SELECT"
}
# When the run failed: the failures and the summary again from the kept log, then the error lines under each failure. A run that
# failed before it printed any test result (docker exec: "container is not running") has none of those, so the last lines of its output
# are shown instead; the live stage stays TAP-only for normal runs.
server_test_failure_summary() {
  if grep -qE "$TAP_SELECT" "$1" 2>/dev/null; then
    grep -E "$TAP_SELECT" "$1" || true
    grep -E -A12 '^not ok' "$1" | grep -E 'error|expected|actual|Error|FAIL|assert' | head -60 || true
  else
    echo "The server tests printed no test results. The last lines of their output:"
    tail -n 40 "$1" 2>/dev/null || echo "(no output was kept)"
  fi
}

# The image's server-test run: every test has SERVER_TEST_EACH_LIMIT_MS and the whole run SERVER_TEST_OVERALL_LIMIT seconds, so a hang
# ends with the test's name instead of silently using up the job (6 November 2026: 35 minutes of nothing). The limits are variables
# only so that a test can use short ones; the TAP reporter is asked for by name because Node's default is the spec reporter on a terminal; the defaults are the real ones. SERVER_TEST_DOCKER is the docker command (a test's stand-in).
run_server_tests() { # <container> <evidence log>
  "${SERVER_TEST_DOCKER:-docker}" exec -e GODSPEED_ORIGINAL_RUNTIME=off -w /opt/godspeed/kit/notebook "$1" \
    sh -c "timeout ${SERVER_TEST_OVERALL_LIMIT:-1800} node scripts/run-tests.mjs --test-reporter=tap --test-timeout=${SERVER_TEST_EACH_LIMIT_MS:-180000} test/*.test.mjs" 2>&1 \
    | server_test_progress "$2"
}
