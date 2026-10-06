#!/usr/bin/env bash
set -euo pipefail
image=${1:?Supply the freshly built image}
name=godspeed-image-verification
volume=godspeed-image-verification-data
network=godspeed-image-verification
evidence="$PWD/docker/full-candidate/evidence"
mkdir -p "$evidence"
cleanup() {
  docker logs "$name" > "$evidence/container.log" 2>&1 || true
  docker rm -f "$name" "$name-https" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT
export GODSPEED_VERIFY_SETUP_CODE
GODSPEED_VERIFY_SETUP_CODE=$(openssl rand -hex 32)
docker network create "$network" >/dev/null
docker volume create "$volume" >/dev/null
docker run -d --init --name "$name" --network "$network" --memory=2g --cpus=2 \
  --mount "type=volume,src=$volume,dst=/opt/data/full-candidate" \
  -e "GODSPEED_ACCESS_TOKEN=$GODSPEED_VERIFY_SETUP_CODE" -e GODSPEED_TELEGRAM_API=http://127.0.0.1:8081 "$image" >/dev/null
for attempt in $(seq 1 90); do
  if docker exec "$name" node -e "fetch('http://127.0.0.1:47831/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then break; fi
  sleep 2
done
docker exec "$name" node -e "fetch('http://127.0.0.1:47831/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
docker exec "$name" /opt/hermes/.venv/bin/python3 -c 'import faster_whisper; print("Packaged local dictation dependency verified.")'
# Run the actual modules shipped in this image, with small synthetic fixtures.
# A failure names its tests in the build log; the whole log stays in the evidence.
docker exec -e GODSPEED_ORIGINAL_RUNTIME=off -w /opt/godspeed/kit/notebook "$name" sh -c 'node --test test/*.test.mjs' > "$evidence/server-tests.log" 2>&1 || { grep -E '^not ok|^# (tests|pass|fail)' "$evidence/server-tests.log"; grep -E -A12 '^not ok' "$evidence/server-tests.log" | grep -E 'error|expected|actual|Error|FAIL|assert' | head -60; exit 1; }
# A stand-in Telegram inside the container (docker/test/fake-telegram.py), so the browser check can
# connect a bot from the web page and press Start with the page's one-time code.
export GODSPEED_VERIFY_TELEGRAM_KEY=123456789:AAHstandInKeyForTheImageTest_0123456789
printf '{"users":{"111":{"first_name":"Anna"},"999":{"first_name":"Eve"}},"start":[],"rules":[]}' > "$evidence/telegram-scenario.json"
docker cp "$evidence/telegram-scenario.json" "$name:/tmp/telegram-scenario.json"
docker exec -d -u hermes "$name" python3 /opt/godspeed/kit/docker/test/fake-telegram.py --port 8081 --token "$GODSPEED_VERIFY_TELEGRAM_KEY" --scenario /tmp/telegram-scenario.json --record /tmp/telegram-record.json
printf 'localhost {\n tls internal\n reverse_proxy %s:47831\n}\n' "$name" > "$evidence/Caddyfile"
docker run -d --name "$name-https" --network "$network" --memory=256m --cpus=1 \
  -p 127.0.0.1:48443:443 -v "$evidence/Caddyfile:/etc/caddy/Caddyfile:ro" \
  caddy:2.10.2-alpine@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d >/dev/null
runtime=$(mktemp -d)
npm install --prefix "$runtime" --no-audit --no-fund playwright@1.56.1 >/dev/null
"$runtime/node_modules/.bin/playwright" install --with-deps chromium >/dev/null
export NODE_PATH="$runtime/node_modules"
node docker/full-candidate/test-browser.cjs "$name" "$evidence"
# One browser check per screen defect found walking the real notebook (test-screens.cjs).
node docker/full-candidate/test-screens.cjs https://localhost:48443 "$evidence/session.json" | tee "$evidence/screens.log"
docker restart "$name" >/dev/null
node docker/full-candidate/test-browser.cjs "$name" "$evidence" resumed
du -sm "$evidence" > "$evidence/evidence-size.txt"
