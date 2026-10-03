#!/usr/bin/env bash
set -euo pipefail
compose=(docker compose -f docker/hostinger/compose.yaml)
evidence="$PWD/docker/hostinger/evidence"
mkdir -p "$evidence"
cleanup() {
  "${compose[@]}" logs > "$evidence/containers.log" 2>&1 || true
  "${compose[@]}" down --volumes >/dev/null 2>&1 || true
}
# Required fields must prevent an accidentally public, unclaimed deployment.
if env -u GODSPEED_SETUP_CODE -u GODSPEED_HOST "${compose[@]}" config --quiet 2>/dev/null; then
  echo 'Missing setup fields were accepted.' >&2; exit 1
fi
export GODSPEED_HOST=localhost
export GODSPEED_SETUP_CODE
GODSPEED_SETUP_CODE=$(openssl rand -hex 32)
export GODSPEED_VERIFY_SETUP_CODE="$GODSPEED_SETUP_CODE"
export GODSPEED_VERIFY_ORIGIN=https://localhost
trap cleanup EXIT
"${compose[@]}" config --quiet
"${compose[@]}" up -d --wait --wait-timeout 240
name=$("${compose[@]}" ps -q godspeed)
for attempt in $(seq 1 60); do
  if curl --silent --fail --insecure https://localhost/health >/dev/null; then break; fi
  sleep 2
done
curl --silent --fail --insecure https://localhost/health >/dev/null
test "$(curl --silent -o /dev/null -w '%{http_code}' http://localhost/dashboard)" = 308
runtime=$(mktemp -d)
npm install --prefix "$runtime" --no-audit --no-fund playwright@1.56.1 >/dev/null
"$runtime/node_modules/.bin/playwright" install --with-deps chromium >/dev/null
export NODE_PATH="$runtime/node_modules"
node docker/full-candidate/test-browser.cjs "$name" "$evidence"
"${compose[@]}" restart godspeed >/dev/null
node docker/full-candidate/test-browser.cjs "$name" "$evidence" resumed
echo 'Self-contained public Compose: HTTPS, first account, 30-day session, return path, persistence, and logout verified.'
