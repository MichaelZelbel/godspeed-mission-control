#!/usr/bin/env bash
# add-ons.sh: adding an add-on (#1162), first part. Run as the account Godspeed runs under, on an install
# the server installer made (GODSPEED_WORKSPACE is its mission control folder).
#
# The add-on's repository comes from a setting, so the same script proves a local test add-on and,
# before the go, the real Wingman:
#   ADDON_ID=wingman ADDON_NAME="the Wingman" add-ons.sh --real          (catalog and GitHub as shipped)
#   add-ons.sh                                                            (a local test add-on that follows the Wingman's contract)
# Ends with "ACCEPTANCE PASSED" (exit 0) or "ACCEPTANCE FAILED: ..." (exit 1).
set -uo pipefail
main() {
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cli="${GODSPEED_CLI:-$here/../../bin/godspeed.mjs}"
: "${GODSPEED_WORKSPACE:?set GODSPEED_WORKSPACE to the mission control folder}"
fail() { echo "ACCEPTANCE FAILED: $*"; exit 1; }
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
id="${ADDON_ID:-teston}"

if [ "${1:-}" != "--real" ]; then
  repo="$work/remote/acme/teston.git"; mkdir -p "$work/src/bin" "$repo"
  cat > "$work/src/bin/teston.mjs" <<'JS'
#!/usr/bin/env node
import fs from 'node:fs'; import path from 'node:path';
const marker = path.join(process.env.GODSPEED_WORKSPACE, '.godspeed', 'teston-setups');
if (process.argv[2] === 'setup') { fs.appendFileSync(marker, 'x'); process.exit(0); }   // safe to repeat
if (process.argv[2] === 'check') { console.log('Start: Open the Teston page.'); process.exit(fs.existsSync(marker) ? 0 : 3); }
process.exit(2);
JS
  ( cd "$work/src" && git init -q && git add . && git -c user.name=t -c user.email=t@t commit -qm test && git clone -q --bare . "$repo" ) || fail "could not make the test add-on"
  cat > "$work/catalog.json" <<JSON
[{"id":"teston","name":"the Teston","aliases":["teston"],"repository":"acme/teston","setup":["bin/teston.mjs","setup"],"check":["bin/teston.mjs","check"],"description":"A test add-on.","start":"Open the Teston page."}]
JSON
  export GODSPEED_ADDON_CATALOG="$work/catalog.json" GODSPEED_ADDON_BASE="file://$work/remote/"
  name="the Teston"
else
  name="${ADDON_NAME:-the Wingman}"
fi

before="$(node "$cli" addon list)"; echo "$before" | grep -q "\"id\": \"$id\"" || fail "$id is not listed"
echo "$before" | grep -A4 "\"id\": \"$id\"" | grep -q '"added": false' || fail "$id already added on a fresh install"

out="$(node "$cli" addon add "$name")" || fail "add failed: $out"
echo "$out" | grep -q '"state":"added"' || fail "first add did not say added: $out"
if [ "$id" = teston ]; then echo "$out" | grep -q 'Open the Teston page' || fail "the reply lacks the check's Start line: $out"; fi
echo "$out" | grep -qE 'godspeed|node |\.mjs|bin/' && fail "the reply names a command: $out"
node "$cli" addon list | grep -A4 "\"id\": \"$id\"" | grep -q '"added": true' || fail "Settings list does not show $id added"
[ -f "$GODSPEED_WORKSPACE/.godspeed/addons/$id/.git/HEAD" ] || fail "no copy in .godspeed/addons/$id"

out="$(node "$cli" addon add "$name")" || fail "second add failed: $out"
echo "$out" | grep -q '"state":"added"' || fail "second add asked or failed instead of updating: $out"
echo "$out" | grep -q 'confirm\|Add it?' && fail "second add asked a question"
if [ "$id" = teston ]; then
  [ "$(wc -c < "$GODSPEED_WORKSPACE/.godspeed/teston-setups")" -ge 2 ] || fail "setup did not run again on the second add"
fi
echo "ACCEPTANCE PASSED"
}
main "$@"
