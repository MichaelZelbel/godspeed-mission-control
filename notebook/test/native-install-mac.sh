#!/usr/bin/env bash
# The Mac installer for real, on a Mac with launchd (GitHub's macOS runner): install one version,
# check it is a LaunchAgent that starts at login and comes back after it is killed, upgrade to
# another, take over from a notebook started by hand in Terminal (how a Mac ran it before 18
# October 2026), and remove it with mc-uninstall while the mission control folder stays. Until
# 18 October 2026 the notebook on a Mac ran only while its Terminal window was open.
set -euo pipefail
here=$(cd "$(dirname "$0")/../.." && pwd)
work=$(mktemp -d)
root="$HOME/godspeed-native-test"
label=com.godspeedmissioncontrol.notebook
plist="$HOME/Library/LaunchAgents/$label.plist"
log="$HOME/Library/Logs/Godspeed Mission Control/notebook.log"
state="$root/.godspeed/integrated-runtime"
uid=$(id -u)
fail() { echo "FAILED: $*" >&2; tail -n 60 "$log" >&2 2>/dev/null || true; exit 1; }
cleanup() {
  launchctl bootout "gui/$uid/$label" >/dev/null 2>&1 || true
  launchctl bootout "user/$uid/$label" >/dev/null 2>&1 || true
  rm -f "$plist"
}
trap cleanup EXIT

# Where launchd holds the agent: the desktop session on a runner, or the background one.
domain() { for d in "gui/$uid" "user/$uid"; do launchctl print "$d/$label" >/dev/null 2>&1 && { echo "$d"; return 0; }; done; return 1; }
agent_pid() { launchctl print "$(domain)/$label" 2>/dev/null | awk '$1 == "pid" && $2 == "=" { print $3; exit }'; }

# What the original installer leaves behind, as far as this step reads it: the folder with its
# manual and rules, and Hermes (a stand-in that answers every cron command).
mkdir -p "$root/rules" "$work/bin" "$work/hermes"
echo '# Test mission control' > "$root/AGENTS.md"
printf '#!/bin/sh\nexit 0\n' > "$work/bin/hermes"; chmod +x "$work/bin/hermes"
export PATH="$work/bin:$PATH" HERMES_HOME="$work/hermes"

# Two versions with the same files and different names, as in native-install-linux.sh.
mkdir -p "$work/product"
git -C "$here" archive HEAD | tar -x -C "$work/product"
git -C "$work/product" init -q
git -C "$work/product" -c user.name=test -c user.email=test@example.invalid add -A
git -C "$work/product" -c user.name=test -c user.email=test@example.invalid commit -q -m 'version one'
first=$(git -C "$work/product" rev-parse HEAD)
git -C "$work/product" -c user.name=test -c user.email=test@example.invalid commit -q --allow-empty -m 'version two'
second=$(git -C "$work/product" rev-parse HEAD)
git -C "$work/product" config uploadpack.allowAnySHA1InWant true
git -C "$work/product" config uploadpack.allowFilter true
install() { GODSPEED_FOOD_TABLE=off GODSPEED_PRODUCT_REPOSITORY="file://$work/product" GODSPEED_PRODUCT_REF="$1" /bin/bash "$here/notebook/scripts/install-native-notebook.sh" "$root"; }
answers() { for _ in $(seq 1 45); do curl -fsS http://127.0.0.1:47831/health >/dev/null 2>&1 && return 0; sleep 2; done; return 1; }

echo '== a first installation'
install "$first" | tee "$work/first.out"
[ -f "$plist" ] || fail 'no LaunchAgent was written'
plutil -lint "$plist" >/dev/null || fail 'the LaunchAgent is not a valid property list'
[ "$(plutil -extract RunAtLoad raw "$plist")" = true ] || fail 'the LaunchAgent does not start at login'
[ "$(plutil -extract KeepAlive.SuccessfulExit raw "$plist")" = false ] || fail 'the LaunchAgent is not started again after an error'
[ "$(plutil -extract ProgramArguments.1 raw "$plist")" = "$state/start.mjs" ] || fail 'the LaunchAgent does not start the notebook'
d=$(domain) || fail 'launchd does not hold the notebook'
echo "launchd holds it in $d"
answers || fail 'the notebook does not answer'
grep -q 'starts by itself whenever you log in' "$work/first.out" || fail 'the installer did not say the notebook starts by itself'
if grep -q 'Start the notebook with' "$work/first.out"; then fail 'the installer still asks the reader to start the notebook by hand'; fi
[ "$(cat "$state/version")" = "$first" ] || fail 'the installed version is not the one named'

echo '== a notebook killed from outside comes back'
before=$(agent_pid); [ -n "$before" ] || fail 'launchd shows no running notebook'
kill -KILL "$before"
sleep 15
after=$(agent_pid)
[ -n "$after" ] && [ "$after" != "$before" ] || fail 'launchd did not start a killed notebook again'
answers || fail 'the restarted notebook does not answer'

echo '== an upgrade'
install "$second" >/dev/null
[ "$(cat "$state/version")" = "$second" ] || fail 'the upgrade did not switch to the new version'
grep -q "versions/$second/" "$state/start.mjs" || fail 'the agent still starts the old version'
[ "$(agent_pid)" != "$after" ] || fail 'the notebook was not restarted'
answers || fail 'the upgraded notebook does not answer'

echo '== a notebook started by hand in Terminal, as before 18 October 2026'
launchctl bootout "$(domain)/$label"
node=$(plutil -extract ProgramArguments.0 raw "$plist")
"$node" "$state/start.mjs" >/dev/null 2>&1 &
by_hand=$!
answers || fail 'the notebook started by hand does not answer'
GODSPEED_SKIP_UI=1 install "$second" >/dev/null
if kill -0 "$by_hand" 2>/dev/null; then fail 'the notebook started by hand was left running'; fi
domain >/dev/null || fail 'the LaunchAgent was not loaded again'
answers || fail 'the notebook does not answer after taking over'

echo '== mc-uninstall'
GODSPEED_DIR="$root" sh "$here/tools/mc-uninstall" --yes > "$work/uninstall.out" || { cat "$work/uninstall.out"; fail 'mc-uninstall failed'; }
cat "$work/uninstall.out"
if domain >/dev/null; then fail 'launchd still holds the notebook after mc-uninstall'; fi
[ ! -f "$plist" ] || fail 'the LaunchAgent file is still there'
if curl -fsS http://127.0.0.1:47831/health >/dev/null 2>&1; then fail 'the notebook still answers after mc-uninstall'; fi
[ -f "$root/AGENTS.md" ] && [ -d "$state" ] || fail 'mc-uninstall touched the mission control folder'
echo 'Installed as a LaunchAgent, restarted after a kill, upgraded, took over from a notebook started by hand, and removed with the folder kept.'
