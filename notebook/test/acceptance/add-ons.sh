#!/usr/bin/env bash
# add-ons.sh: adding an add-on (#1162) and its page through the notebook (#1166). Run as the account Godspeed runs under, on an install
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
  cat > "$work/src/bin/teston-page.mjs" <<'JS'
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
fs.writeFileSync(path.join(path.dirname(process.argv[1]), '..', 'page-wrote'), 'x');   // in the add-on's own folder
http.createServer((req, res) => res.end('Teston page ' + req.url + ' ' + req.headers['x-forwarded-prefix'])).listen(Number(process.argv[2]), '127.0.0.1');
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

# Third part: the add-on's page through the notebook (needs the install's https address).
address="${GODSPEED_NOTEBOOK_URL:-}"
if [ -z "$address" ]; then echo "NOT RUN: no notebook address (set GODSPEED_NOTEBOOK_URL), so the page part did not run"; exit 2; fi
address="${address%/}"; local_api="${GODSPEED_LOCAL_URL:-http://127.0.0.1:${GODSPEED_PORT:-47831}}"
if [ "$id" = teston ]; then
  port="$(node -e 'const s=require("net").createServer().listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')"
  mkdir -p "$GODSPEED_WORKSPACE/.godspeed/addons/teston"
  printf '{"command":["%s","%s","%s"],"port":%s,"title":"Teston"}' "$(command -v node)" "$GODSPEED_WORKSPACE/.godspeed/addons/teston/bin/teston-page.mjs" "$port" "$port" > "$GODSPEED_WORKSPACE/.godspeed/addons/teston/page.json"
fi
want="/addons/$id/"; ok=""
# Sign in as the owner would: through a one-time link from the local door, or, on an install whose owner has not made an
# account yet (a fresh server), by making one with the private setup link. The session cookie is sent by hand, because it is
# marked Secure and the address this script is given may be plain http inside the machine.
sid() { sed -n 's/^[Ss]et-[Cc]ookie: godspeed_session=\([^;]*\).*/\1/p' "$1" | tail -n 1 | tr -d '\r'; }
path="$(curl -fsS -X POST -H 'Content-Type: application/json' -d '{}' "$local_api/api/login-link" | node -e 'let t="";process.stdin.on("data",d=>t+=d).on("end",()=>console.log(JSON.parse(t).path))')" || fail "no sign-in link from the local door"
case "$path" in
  /setup#invite=*) curl -sS -D "$work/hdr" -o /dev/null -X POST -H "Origin: $address" -H 'Content-Type: application/json' \
      -d "{\"invite\":\"${path#/setup#invite=}\",\"username\":\"scenario-owner\",\"password\":\"scenario-owner-password-1\"}" "$address/api/auth/setup" || fail "could not make the owner's account at $address" ;;
  *) curl -sS -D "$work/hdr" -o /dev/null -X POST -H "Origin: $address" "$address$path" || fail "could not sign in at $address" ;;
esac
cookie="godspeed_session=$(sid "$work/hdr")"; [ "$cookie" != "godspeed_session=" ] || fail "signing in at $address gave no session: $(head -n 1 "$work/hdr")"
for _ in $(seq 1 45); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' -H "Cookie: $cookie" "$address$want")" = 200 ] && { ok=1; break; }; sleep 2
done
[ -n "$ok" ] || fail "the page did not answer at $address$want when signed in"
[ "$id" != teston ] || curl -s -H "Cookie: $cookie" "$address$want" | grep -q "Teston page / /addons/teston" || fail "the page did not see the stripped path and prefix"
if [ "$id" = teston ]; then
  curl -fsS -H "Cookie: $cookie" "$address/api/addons" | node -e 'let t="";process.stdin.on("data",d=>t+=d).on("end",()=>{const a=(JSON.parse(t).addons||[]).find(x=>x.id==="teston");process.exit(a&&a.page&&a.page.path==="/addons/teston/"&&a.page.title==="Teston"?0:1)})' \
    || fail "a signed-in GET /api/addons does not carry the page (path /addons/teston/, title Teston) for teston"
fi
unsigned="$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$address$want")"
case "$unsigned" in "303 "*"/setup?next="*) ;; *) fail "an unsigned visit was not sent to sign-in: $unsigned";; esac
if [ "$id" = teston ]; then
  [ "$(stat -c %U "$GODSPEED_WORKSPACE/.godspeed/addons/teston/page-wrote")" = "$(id -un)" ] || fail "the page's file does not belong to the assistant's account"
fi
echo "ACCEPTANCE PASSED"
}
main "$@"
