#!/usr/bin/env bash
set -euo pipefail
evidence="$PWD/docker/hostinger/evidence"
mkdir -p "$evidence"
export GODSPEED_TEST_INSTALL_STATE
GODSPEED_TEST_INSTALL_STATE=$(mktemp -d)
node --test docker/hostinger/installer/test.mjs
node docker/hostinger/installer/runner.mjs &
coordinator=$!
compose=(docker compose -f "$GODSPEED_TEST_INSTALL_STATE/compose.yaml")
cleanup() {
  "${compose[@]}" logs > "$evidence/containers.log" 2>&1 || true
  "${compose[@]}" down --volumes >/dev/null 2>&1 || true
  kill "$coordinator" 2>/dev/null || true
}
trap cleanup EXIT
for attempt in $(seq 1 20); do
  if curl --silent --fail http://localhost:8794/godspeed-install/health >/dev/null; then break; fi
  sleep 1
done
node docker/hostinger/installer/prepare-test.mjs
"${compose[@]}" config --quiet
# No user environment fields are allowed in the generated deployment.
"${compose[@]}" config --variables --format json | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{const names=Object.keys(JSON.parse(s)||{});if(names.length){console.error("Unexpected installation fields:",names.join(", "));process.exit(1);}})'
"${compose[@]}" up -d --wait --wait-timeout 240
name=$("${compose[@]}" ps -q godspeed)
for attempt in $(seq 1 90); do
  if node docker/hostinger/installer/verify-test.mjs 2>/dev/null; then break; fi
  sleep 2
done
test -s "$GODSPEED_TEST_INSTALL_STATE/invitation.txt"
export GODSPEED_VERIFY_INVITATION_URL
GODSPEED_VERIFY_INVITATION_URL=$(cat "$GODSPEED_TEST_INSTALL_STATE/invitation.txt")
export GODSPEED_VERIFY_ORIGIN=https://localhost
test "$(curl --silent -o /dev/null -w '%{http_code}' http://localhost/dashboard)" = 308
runtime=$(mktemp -d)
npm install --prefix "$runtime" --no-audit --no-fund playwright@1.56.1 >/dev/null
"$runtime/node_modules/.bin/playwright" install --with-deps chromium >/dev/null
export NODE_PATH="$runtime/node_modules"
node docker/full-candidate/test-browser.cjs "$name" "$evidence"
"${compose[@]}" restart godspeed >/dev/null
node docker/full-candidate/test-browser.cjs "$name" "$evidence" resumed
echo 'Private prepared deployment: zero setup fields, automatic account link, HTTPS, owner creation, return path, persistence and logout verified.'
