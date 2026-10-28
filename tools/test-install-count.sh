#!/usr/bin/env bash
# The gate for "no install count" (27 October 2026). From 30 September the installers ended with
# one opt-in question, whether the computer may report that the install worked, and on a server a
# yes also put mc-install-count on the clock to report the first morning brief. It brought
# nothing and is gone. This checks that no installer here asks it or sends anything, that nothing
# reads an old answer, and that a server set up before then loses the job on its next run
# (retire_install_count in server/install.sh), every other line on its clock and every other
# entry in its procedures.md kept. Runs in a throwaway home with a crontab that keeps its table
# in a file, so it never touches the real schedule.
# Usage: bash tools/test-install-count.sh
set -uo pipefail
. "$(dirname "$0")/test-guard.bash"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP" "$TEST_GUARD_HOME"' EXIT

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
check() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (want [$3], got [$2])"; fi; }

echo "no install count"

# --- What the installers say and send -------------------------------------------------------
INSTALLERS="$ROOT/server/install.sh $ROOT/docker/server/install.sh $ROOT/install-godspeed.sh $ROOT/install-godspeed-dev.sh"
INSTALLERS="$INSTALLERS $(find "$ROOT/docker/rootfs" -type f | tr '\n' ' ')"
# shellcheck disable=SC2086
check "no installer asks the question, on a server, in Docker or on a computer" \
  "$(cat $INSTALLERS | grep -c -i -E 'anonymous note|One last question|install worked[?]')" "0"
# shellcheck disable=SC2086
check "and none sends anything to the counter" \
  "$(cat $INSTALLERS | grep -c -e 'signal/v1' -e 'kb_choose_install_count' -e 'kb_install_count_send' -e 'count_install')" "0"
# shellcheck disable=SC2086
check "nothing reads an earlier answer or DO_NOT_TRACK, so an old yes sends nothing either" \
  "$(cat $INSTALLERS | grep -v '^ *#' | grep -c -e 'GODSPEED_INSTALL_COUNT' -e 'GODSPEED_INSTALL_ID' -e 'DO_NOT_TRACK')" "0"
check "the program that reported the first morning brief is gone from the kit" \
  "$([ -e "$HERE/mc-install-count" ] && echo there || echo gone)" "gone"
# The server installer runs kit-bootstrap's setup-godspeed.sh at its pin. Until 28 October 2026
# that was the tag v2.18, whose last step was still the question, and KB_INSTALL_COUNT_SKIP=1 kept
# it from asking. The pin is now past kit-bootstrap's own removal of the question (8ac85e0), so
# the setting is gone, and the pin must not go back to v2.18 or another v2.x tag from before it.
check "the server installer runs the shared setup at its pin" \
  "$(grep -c '^KB_BRANCH="$KB_PIN" bash "$BOOTSTRAP_DIR/setup-godspeed.sh"' "$ROOT/server/install.sh")" "1"
check "and that pin is past the removal of the question (no tag from before it)" \
  "$(sed -n 's/^KB_PIN="\(.*\)"$/\1/p' "$ROOT/server/install.sh" "$ROOT/server/open-the-door.sh" | grep -c -E '^v2\.([0-9]|1[0-8])$')" "0"

# --- A server set up before 27 October 2026 loses the job on its next run -------------------
FN="$(sed -n '/^retire_install_count() {$/,/^}$/p' "$ROOT/server/install.sh")"
check "server/install.sh has retire_install_count" "$([ -n "$FN" ] && echo yes || echo no)" "yes"
check "and runs it on its own procedures.md" \
  "$(grep -c '^retire_install_count "$GODSPEED/procedures.md"$' "$ROOT/server/install.sh")" "1"

mkdir -p "$TMP/bin"
# A crontab that keeps its table in a file and writes down every time the table is replaced.
cat > "$TMP/bin/crontab" <<'EOF'
#!/bin/sh
case "$1" in
  -l) [ -f "$FAKE_TAB" ] && cat "$FAKE_TAB" || exit 1 ;;
  -)  cat > "$FAKE_TAB"; echo replaced >> "$FAKE_TAB.writes" ;;
esac
EOF
chmod +x "$TMP/bin/crontab"

# A procedures.md as an old server has it: the installer's entry between two of the reader's own.
PROCS_OLD='# Procedures

## Morning brief

Does: writes the brief.
Last checked: 2026-10-01.

## Install count

Does: once, after my first morning brief arrived, sends one anonymous note that it did to godspeedmissioncontrol.com, which counts it.
Rhythm: daily, 07:17, until it has sent once; then it takes itself off the clock.
Lives: this account'"'"'s clock, mc-install-count.
Last checked: 2026-10-02.

## My own job

Does: something of mine.'
PROCS_NEW='# Procedures

## Morning brief

Does: writes the brief.
Last checked: 2026-10-01.

## My own job

Does: something of mine.'

# case <name> <crontab table or empty for none>
setup() {
  H="$TMP/$1"; mkdir -p "$H/.local/bin" "$H/.godspeed" "$H/godspeed"
  if [ -n "$2" ]; then printf '%s\n' "$2" > "$H/tab"; fi
  printf '#!/bin/sh\n' > "$H/.local/bin/mc-install-count"; chmod +x "$H/.local/bin/mc-install-count"
  printf 'sent the note\n' > "$H/.godspeed/install-count.log"
  printf '%s\n' "$PROCS_OLD" > "$H/godspeed/procedures.md"
  printf 'GODSPEED_INSTALL_COUNT=1\nGODSPEED_INSTALL_ID=0123456789abcdef0123456789abcdef\n' > "$H/.godspeed/device.env"
}
run() {
  HOME="$H" PATH="$TMP/bin:$PATH" FAKE_TAB="$H/tab" bash -c "$FN"'
retire_install_count "$HOME/godspeed/procedures.md"' > "$H/said" 2>&1
  echo "rc=$?" > "$H/rc"
}
writes() { [ -f "$H/tab.writes" ] && grep -c . "$H/tab.writes" || echo 0; }

OLD_LINE='17 7 * * * "/home/ai/.local/bin/mc-install-count" first-brief --hermes-home "/home/ai/.hermes" >> "/home/ai/.godspeed/install-count.log" 2>&1'
setup today "0 * * * * other-job
# Count once that the first morning brief arrived; removes itself after (mc-install-count)
$OLD_LINE
30 6 * * * hermes cron tick"
run
check "the job and its comment come off the clock, every other line kept in order" \
  "$(cat "$H/tab")" "0 * * * * other-job
30 6 * * * hermes cron tick"
check "the program and its log are gone" \
  "$([ -e "$H/.local/bin/mc-install-count" ] && echo prog)$([ -e "$H/.godspeed/install-count.log" ] && echo log)" ""
check "its entry leaves procedures.md, every other entry kept with no gap" \
  "$(cat "$H/godspeed/procedures.md")" "$PROCS_NEW"
check "it says nothing and never fails the install" "$(cat "$H/said")|$(cat "$H/rc")" "|rc=0"
check "the old answer in device.env is left alone, and nothing reads it" \
  "$(grep -c '^GODSPEED_INSTALL' "$H/.godspeed/device.env")" "2"
run
check "a second run changes nothing more" \
  "$(writes):$(cat "$H/godspeed/procedures.md" | grep -c .)" "1:$(printf '%s\n' "$PROCS_NEW" | grep -c .)"

# Servers installed before 18 October 2026 carry the comment in older words.
setup older "# Tell Michael once that the first morning brief arrived; removes itself after (mc-install-count)
$OLD_LINE"
run
check "the older words go too, and a clock with nothing else on it is left empty" "$(cat "$H/tab")" ""

setup untouched "0 * * * * other-job"
run
check "a clock without the job is never rewritten" "$(writes):$(cat "$H/tab")" "0:0 * * * * other-job"

setup noclock ""
run
check "a server with no crontab at all still loses the program and the entry" \
  "$([ -e "$H/.local/bin/mc-install-count" ] && echo prog):$(grep -c '^## Install count' "$H/godspeed/procedures.md"):$(cat "$H/rc")" ":0:rc=0"

setup last "0 * * * * other-job"
printf '%s\n' '# Procedures' '' '## Mine' '' 'Does: mine.' '' '## Install count' '' 'Does: it.' 'Last checked: 2026-10-02.' > "$H/godspeed/procedures.md"
run
check "an entry at the end of the file leaves no blank line behind" \
  "$(cat "$H/godspeed/procedures.md"; echo END)" "# Procedures

## Mine

Does: mine.
END"

setup noentry "0 * * * * other-job"
printf '%s\n' '# Procedures' '' '## Mine' '' '' 'Does: mine.' '' > "$H/godspeed/procedures.md"
cp "$H/godspeed/procedures.md" "$H/before.md"
run
check "a procedures.md without the entry is not touched, blank lines and all" \
  "$(cmp -s "$H/before.md" "$H/godspeed/procedures.md" && echo same || echo changed)" "same"

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
