#!/usr/bin/env bash
# The Linux installer for real, on a fresh machine that has systemd and sudo (a GitHub
# runner): install one version, upgrade to another without naming the machine again,
# and come back after the notebook is killed. Until 6 October 2026 nothing ran it before
# a reader did, and its upgrade had never once started the new version. Since 15 October 2026
# also: an update that worked keeps the copy it made before it (the newest three until 21 October
# 2026) and one whose notebook does not answer is undone and removes none; since 21 October 2026
# the copy holds what an update can change and never work/. Since 26 October 2026: an update that
# finds a Hermes this account cannot load keeps the one that works, and add-ons still reach it.
# Since 2.0.0-beta.11: the upgrade renames the folder's note FULL-ALPHA.md to NOTEBOOK.md.
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
# with its manual and rules, and Hermes: a stand-in that answers every cron command, in a source
# folder with the parts of Hermes the add-on connection loads and a venv whose Python is this
# machine's, so the installer's check of it (scripts/choose-assistant.mjs) runs for real. One more,
# whose source needs a module that is not there, plays a Hermes this account cannot load.
fake_hermes() {
  local dir=$1 needs=${2:-}
  mkdir -p "$dir/hermes_cli" "$dir/agent" "$dir/venv/bin"
  : > "$dir/hermes_cli/__init__.py"; : > "$dir/agent/__init__.py"
  { [ -z "$needs" ] || echo "import $needs"; printf 'def load_config_readonly():\n    return {"model": {"provider": "test-provider", "default": "test-model"}}\n'; } > "$dir/hermes_cli/config.py"
  echo 'resolve_runtime_provider = _get_named_custom_provider = expand_direct_api_alias = None' > "$dir/hermes_cli/runtime_provider.py"
  echo 'resolve_provider_client = _normalize_aux_provider = None' > "$dir/agent/auxiliary_client.py"
  ln -s "$(command -v python3)" "$dir/venv/bin/python3"
  printf '#!/bin/sh\nexit 0\n' > "$dir/venv/bin/hermes"; chmod +x "$dir/venv/bin/hermes"
}
mkdir -p "$root/rules" "$work/bin" "$work/hermes" "$work/broken-bin"
echo '# Test mission control' > "$root/AGENTS.md"
fake_hermes "$work/hermes-agent"; ln -s "$work/hermes-agent/venv/bin/hermes" "$work/bin/hermes"
fake_hermes "$work/broken-hermes" godspeed_test_missing_dependency; ln -s "$work/broken-hermes/venv/bin/hermes" "$work/broken-bin/hermes"
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
GODSPEED_DEVICE=production install "$first" 2>&1 | tee "$work/first.log"
! grep -q 'does not load for this account' "$work/first.log" || fail 'a Hermes that loads was reported as one that does not'
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
# The owner's work in progress, which no update writes and no copy before one holds.
mkdir -p "$root/work" && head -c 1048576 /dev/zero > "$root/work/recording.bin"
copies() { local n=0 dir; for dir in "$state"/backups/2*/; do [ -f "$dir/backup.json" ] && n=$((n+1)); done; echo "$n"; }
# The folder's note under the name every version before 2.0.0-beta.11 gave it, with the same text.
[ -f "$root/NOTEBOOK.md" ] && [ ! -e "$root/FULL-ALPHA.md" ] || fail 'a new installation does not have NOTEBOOK.md alone'
mv "$root/NOTEBOOK.md" "$root/FULL-ALPHA.md"

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
grep -q '"kind": "update-copy"' "$state/backups/$made/backup.json" || fail 'the copy made before the update is not the copy of what an update can change'
[ -d "$state/backups/$made/notebook" ] && [ ! -e "$state/backups/$made/work" ] || fail 'the copy made before the update holds work/ or not the notebook'
[ -f "$root/NOTEBOOK.md" ] && [ ! -e "$root/FULL-ALPHA.md" ] || fail 'the upgrade did not rename FULL-ALPHA.md to NOTEBOOK.md'
grep -q 'Notebook records live in notebook/' "$root/NOTEBOOK.md" || fail 'the renamed note does not say what the notebook writes'
[ -f "$state/backups/$made/FULL-ALPHA.md" ] || fail 'the copy made before the update does not hold the note as it was'
[ "$(copies)" = 1 ] || fail "the upgrade kept $(copies) copies made before updates, not only its own"
for day in 01 02 03 04; do [ ! -e "$state/backups/202610$day-120000-$first" ] || fail 'an older copy made before updates was kept'; done
[ ! -e "$state/backups/.partial-20261001-110000-$first" ] || fail 'a copy that stopped part-way was kept'
[ -d "$state/backups/my own folder" ] || fail 'a folder no installer made was removed'

echo '== an update that finds a Hermes this account cannot load keeps the one that works'
# As on a server updated as root on 26 October 2026: the first hermes on the PATH is another one,
# which cannot load Hermes for this account. Until then the update wrote it over the one that worked.
model() { "$(ls -d "$state"/runtime/node-v*/bin/node | head -1)" "$root/.godspeed/model.mjs" --workspace "$root" --check; }
said=$(PATH="$work/broken-bin:$PATH" GODSPEED_SKIP_UI=1 install "$second" 2>&1) || fail "the update stopped: $said"
grep -qF "\"executable\":\"$work/bin/hermes\"" "$root/.godspeed/assistant.json" || fail "the update replaced a Hermes that loads with one that does not: $(cat "$root/.godspeed/assistant.json")"
grep -qF "The Hermes found at $work/broken-bin/hermes does not load for this account (the Python module godspeed_test_missing_dependency is missing), so Godspeed keeps using the one at $work/bin/hermes, which does." <<<"$said" || fail "the update did not say why it kept the Hermes it had: $said"
answers || fail 'the notebook does not answer after that update'
[ "$(model)" = '{"configured":true,"provider":"test-provider","model":"test-model"}' ] || fail "an add-on's connection check does not pass after that update: $(model 2>&1)"
# With no Hermes that loads, the update says so and goes on, and an add-on hears why.
cp "$work/hermes-agent/hermes_cli/config.py" "$work/config.py"; cp "$work/broken-hermes/hermes_cli/config.py" "$work/hermes-agent/hermes_cli/config.py"
said=$(GODSPEED_SKIP_UI=1 install "$second" 2>&1) || fail "an update with no Hermes that loads stopped: $said"
grep -qF "Hermes, the AI program Godspeed uses, does not load for this account at $work/bin/hermes (the Python module godspeed_test_missing_dependency is missing)." <<<"$said" || fail "the update did not say that no Hermes loads: $said"
! model 2>"$work/model.err" || fail 'the connection check passed with no Hermes that loads'
grep -qF 'Godspeed could not load its AI program (Hermes) on this computer: the Python module godspeed_test_missing_dependency is missing.' "$work/model.err" || fail "an add-on is not told why: $(cat "$work/model.err")"
cp "$work/config.py" "$work/hermes-agent/hermes_cli/config.py"
answers || fail 'the notebook does not answer after an update with no Hermes that loads'

echo '== an update whose notebook never answers'
printf 'process.exit(1);\n' > "$work/product/notebook/scripts/supervise.mjs"
git -C "$work/product" -c user.name=test -c user.email=test@example.invalid commit -q -am 'version three, which never answers'
third=$(git -C "$work/product" rev-parse HEAD)
ls -A "$state/backups" > "$work/kept"
if GODSPEED_SKIP_UI=1 install "$third"; then fail 'an update whose notebook never answered was reported as done'; fi
[ "$(cat "$state/version")" = "$second" ] || fail 'the version that ran before was not put back'
answers || fail 'the notebook that ran before does not answer again'
while IFS= read -r name; do [ -e "$state/backups/$name" ] || fail "the failed update removed $name"; done < "$work/kept"
[ "$(copies)" = 2 ] || fail "after a failed update there are $(copies) copies, not the one before it and the one it made"

echo '== a notebook killed from outside comes back'
sudo systemctl kill -s KILL "$service"
sleep 8
systemctl is-active --quiet "$service" || fail 'systemd did not restart a killed notebook'
answers || fail 'the restarted notebook does not answer'
echo 'Installed, upgraded with the machine name kept, the note in the folder renamed and only its own copy made before the update, a Hermes that loads kept over one that does not, a failed update undone with every copy kept, and restarted after a kill.'
