# What the image's server-test step shows while the tests run (sourced by test.sh, and by notebook/test/image-test-progress.test.mjs).
# Reads the TAP output on stdin: the whole of it goes to the log file given as the argument; the failures and the summary are shown
# the moment they are printed, so a hang right after a failure still names the failing test (grep is line-buffered because its output
# is a pipe when CI captures it, and a block-buffered grep would show nothing until the process ended).
TAP_SELECT='^not ok|^# (tests|pass|fail|cancelled)'
server_test_progress() {
  tee "$1" | grep --line-buffered -E "$TAP_SELECT"
}
# When the run failed: the failures and the summary again from the kept log, then the error lines under each failure.
server_test_failure_summary() {
  grep -E "$TAP_SELECT" "$1" || true
  grep -E -A12 '^not ok' "$1" | grep -E 'error|expected|actual|Error|FAIL|assert' | head -60 || true
}
