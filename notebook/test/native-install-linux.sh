#!/usr/bin/env bash
# The Linux installer for real, on a fresh machine that has systemd and sudo (a GitHub
# runner): install one version, upgrade to another without naming the machine again,
# and come back after the notebook is killed. Until 6 October 2026 nothing ran it before
# a reader did, and its upgrade had never once started the new version.
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
install() { GODSPEED_PRODUCT_REPOSITORY="file://$work/product" GODSPEED_PRODUCT_REF="$1" bash "$here/notebook/scripts/install-native-notebook.sh" "$root"; }
answers() { for _ in $(seq 1 30); do curl -fsS http://127.0.0.1:47831/health >/dev/null 2>&1 && return 0; sleep 2; done; return 1; }

echo '== a first installation, as the server called production'
GODSPEED_DEVICE=production install "$first"
systemctl is-active --quiet "$service" || fail 'the notebook is not running after installation'
grep -qx "User=$(id -un)" "/etc/systemd/system/$service" || fail 'the service does not run as the installing account'
[ "$(cat "$state/version")" = "$first" ] || fail 'the installed version is not the one named'
grep -q '"GODSPEED_DEVICE":"production"' "$state/start.mjs" || fail 'the machine name was not kept'
answers || fail 'the notebook does not answer'
before=$(systemctl show -p MainPID --value "$service")

echo '== an upgrade that does not name the machine again'
GODSPEED_SKIP_UI=1 install "$second"
[ "$(cat "$state/version")" = "$second" ] || fail 'the upgrade did not switch to the new version'
[ "$(cat "$state/previous-version")" = "$first" ] || fail 'the version before was not kept as the previous one'
grep -q "versions/$second/" "$state/start.mjs" || fail 'the service still starts the old version'
grep -q '"GODSPEED_DEVICE":"production"' "$state/start.mjs" || fail 'the upgrade renamed the machine'
[ "$(systemctl show -p MainPID --value "$service")" != "$before" ] || fail 'the notebook was not restarted'
answers || fail 'the upgraded notebook does not answer'
[ -d "$state/versions/$first" ] || fail 'the previous version was removed'

echo '== a notebook killed from outside comes back'
sudo systemctl kill -s KILL "$service"
sleep 8
systemctl is-active --quiet "$service" || fail 'systemd did not restart a killed notebook'
answers || fail 'the restarted notebook does not answer'
echo 'Installed, upgraded with the machine name kept, and restarted after a kill.'
