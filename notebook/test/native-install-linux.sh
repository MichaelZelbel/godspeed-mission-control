#!/usr/bin/env bash
# The Linux installer for real, on a fresh machine that has systemd and sudo (a GitHub
# runner): install one version, upgrade to another without naming the machine again,
# and come back after the notebook is killed. Until 6 October 2026 nothing ran it before
# a reader did, and its upgrade had never once started the new version. Since 15 October 2026
# also: an update that worked keeps the newest three copies made before updates, and one whose
# notebook does not answer is undone and removes none.
set -euo pipefail
here=$(cd "$(dirname "$0")/../.." && pwd)
work=$(mktemp -d)
root="$HOME/godspeed-native-test"
service=godspeed-integrated-notebook.service
state="$root/.godspeed/integrated-runtime"
fail() { echo "FAILED: $*" >&2; sudo journalctl -u "$service" -n 60 --no-pager >&2 || true; exit 1; }
cleanup() { sudo systemctl disable --now "$service" >/dev/null 2>&1 || true; sudo rm -f "/etc/systemd/system/$service"; sudo systemctl daemon-reload || true; }
trap cleanup EXIT

# What the original installer leaves behind, as far as this step reads it: the folder
# with its manual and rules, and Hermes (a stand-in that answers every cron command).
mkdir -p "$root/rules" "$work/bin" "$work/hermes"
echo '# Test mission control' > "$root/AGENTS.md"
printf '#!/bin/sh\nexit 0\n' > "$work/bin/hermes"; chmod +x "$work/bin/hermes"
export PATH="$work/bin:$PATH" HERMES_HOME="$work/hermes"

# Two versions with the same files and different names: this commit's tree, and one
# more commit on top of it. The installer fetches by name from a repository; here a
# local one that, like GitHub, gives out any commit it holds.
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
install() { GODSPEED_FOOD_TABLE=off GODSPEED_PRODUCT_REPOSITORY="file://$work/product" GODSPEED_PRODUCT_REF="$1" bash "$here/notebook/scripts/install-native-notebook.sh" "$root"; }
answers() { for _ in $(seq 1 30); do curl -fsS http://127.0.0.1:47831/health >/dev/null 2>&1 && return 0; sleep 2; done; return 1; }

echo '== a first installation, as the server called production'
GODSPEED_DEVICE=production install "$first"
systemctl is-active --quiet "$service" || fail 'the notebook is not running after installation'
grep -qx "User=$(id -un)" "/etc/systemd/system/$service" || fail 'the service does not run as the installing account'
[ "$(cat "$state/version")" = "$first" ] || fail 'the installed version is not the one named'
grep -q '"GODSPEED_DEVICE":"production"' "$state/start.mjs" || fail 'the machine name was not kept'
answers || fail 'the notebook does not answer'
before=$(systemctl show -p MainPID --value "$service")

# Copies earlier updates left (notebook/core/upgrade-copies.mjs): four whole ones, one that
# stopped part-way, and a folder of the owner's own that no installer made.
plant() { mkdir -p "$state/backups/$1" && echo '{"format":1,"files":[]}' > "$state/backups/$1/backup.json"; }
for day in 01 02 03 04; do plant "202610$day-120000-$first"; done
mkdir -p "$state/backups/.partial-20261001-110000-$first" "$state/backups/my own folder"
copies() { local n=0 dir; for dir in "$state"/backups/2*/; do [ -f "$dir/backup.json" ] && n=$((n+1)); done; echo "$n"; }

echo '== an upgrade that does not name the machine again'
GODSPEED_SKIP_UI=1 install "$second"
[ "$(cat "$state/version")" = "$second" ] || fail 'the upgrade did not switch to the new version'
[ "$(cat "$state/previous-version")" = "$first" ] || fail 'the version before was not kept as the previous one'
grep -q "versions/$second/" "$state/start.mjs" || fail 'the service still starts the old version'
grep -q '"GODSPEED_DEVICE":"production"' "$state/start.mjs" || fail 'the upgrade renamed the machine'
[ "$(systemctl show -p MainPID --value "$service")" != "$before" ] || fail 'the notebook was not restarted'
answers || fail 'the upgraded notebook does not answer'
[ -d "$state/versions/$first" ] || fail 'the previous version was removed'
made=$(cd "$state/backups" && ls -d 2*-"$first" | sort | tail -1)
[[ "$made" > 20261005 ]] && [ -f "$state/backups/$made/backup.json" ] || fail 'the upgrade made no copy before it'
[ "$(copies)" = 3 ] || fail "the upgrade kept $(copies) copies made before updates, not the newest three"
[ -d "$state/backups/20261004-120000-$first" ] && [ -d "$state/backups/20261003-120000-$first" ] || fail 'a newest copy made before updates was removed'
[ ! -e "$state/backups/20261001-120000-$first" ] && [ ! -e "$state/backups/20261002-120000-$first" ] || fail 'an older copy made before updates was kept'
[ ! -e "$state/backups/.partial-20261001-110000-$first" ] || fail 'a copy that stopped part-way was kept'
[ -d "$state/backups/my own folder" ] || fail 'a folder no installer made was removed'

echo '== an update whose notebook never answers'
printf 'process.exit(1);\n' > "$work/product/notebook/scripts/supervise.mjs"
git -C "$work/product" -c user.name=test -c user.email=test@example.invalid commit -q -am 'version three, which never answers'
third=$(git -C "$work/product" rev-parse HEAD)
ls -A "$state/backups" > "$work/kept"
if GODSPEED_SKIP_UI=1 install "$third"; then fail 'an update whose notebook never answered was reported as done'; fi
[ "$(cat "$state/version")" = "$second" ] || fail 'the version that ran before was not put back'
answers || fail 'the notebook that ran before does not answer again'
while IFS= read -r name; do [ -e "$state/backups/$name" ] || fail "the failed update removed $name"; done < "$work/kept"
[ "$(copies)" = 4 ] || fail "after a failed update there are $(copies) copies, not the three before it and the one it made"

echo '== a notebook killed from outside comes back'
sudo systemctl kill -s KILL "$service"
sleep 8
systemctl is-active --quiet "$service" || fail 'systemd did not restart a killed notebook'
answers || fail 'the restarted notebook does not answer'
echo 'Installed, upgraded with the machine name kept and the newest three copies made before updates, a failed update undone with every copy kept, and restarted after a kill.'
