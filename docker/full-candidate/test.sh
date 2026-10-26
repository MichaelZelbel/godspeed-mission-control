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
docker run -d --name "$name" --network "$network" --memory=2g --cpus=2 \
  --label com.docker.compose.project=godspeed-mission-control --label com.docker.compose.service=godspeed \
  --label com.docker.compose.config-hash=addon-model-verification \
  --label com.docker.compose.container-number=1 --label com.docker.compose.oneoff=False \
  --mount "type=volume,src=$volume,dst=/opt/data/full-candidate" \
  -e "GODSPEED_ACCESS_TOKEN=$GODSPEED_VERIFY_SETUP_CODE" -e GODSPEED_TELEGRAM_API=http://127.0.0.1:8081 \
  -e GODSPEED_PROMPT_HARVEST_FIRST=3 -e GODSPEED_PROMPT_HARVEST_EVERY=5 "$image" >/dev/null
for attempt in $(seq 1 90); do
  if docker exec "$name" node -e "fetch('http://127.0.0.1:47831/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then break; fi
  sleep 2
done
docker exec "$name" node -e "fetch('http://127.0.0.1:47831/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
docker exec "$name" /opt/hermes/.venv/bin/python3 -c 'import faster_whisper; print("Packaged local dictation dependency verified.")'
# The free voice that answers voice notes, as the assistant's own account loads it through Hermes:
# Hermes' first-use installer may not put back the edge-tts Microsoft refuses (Dockerfile says why).
docker exec -u hermes -w /opt/hermes "$name" /opt/hermes/.venv/bin/python3 -c 'from tools.tts_tool import _importable, _import_edge_tts; import edge_tts.constants as c, importlib.metadata as m; assert _importable(_import_edge_tts); v = m.version("edge-tts"); assert v == "7.3.1" and c.SEC_MS_GEC_VERSION.startswith("2-"), v; print("The free voice (edge-tts " + v + ") is the one Hermes loads.")'
# Understanding a voice note with ElevenLabs needs no package this image lacks: Hermes posts the sound
# with requests, which it always has, and reads the model at stt.elevenlabs.model_id (scribe_v2). This
# is that, in this image's own Hermes, as the assistant's account: nothing is installed for it, so if
# a later Hermes moved the key or the default, this says so instead of a server transcribing nothing.
docker exec -u hermes -w /opt/hermes "$name" /opt/hermes/.venv/bin/python3 -c 'import requests
from tools.transcription_cloud import _transcribe_elevenlabs
from tools.transcription_common import DEFAULT_ELEVENLABS_STT_MODEL as model
from tools.transcription_tools import _BUILTIN_MODEL_KEYS as keys
assert callable(_transcribe_elevenlabs) and model == "scribe_v2", model
assert keys["elevenlabs"][0] == "elevenlabs" and keys["elevenlabs"][1] == "model_id", keys["elevenlabs"]
print("Understanding voice notes with ElevenLabs (" + model + " at stt.elevenlabs.model_id, requests " + requests.__version__ + ") needs nothing added to this image.")'
# The image's own init collects every finished program, with no --init from the host (this
# container runs without one): a program whose parent has gone, as git's background maintenance
# after every fetch is, must not stay behind (Dockerfile says why).
docker exec "$name" ps -o args= -p 1 | grep -q "^/usr/local/sbin/tini-static " || { echo "Process 1 is not the image's init."; exit 1; }
docker exec "$name" sh -c 'for i in 1 2 3 4 5; do sh -c "sleep 0.2 &"; done; sleep 2'
left=$(docker exec "$name" sh -c 'ps -eo stat= | grep -c "^Z" || true')
[ "$left" = 0 ] || { echo "$left finished programs were never collected."; exit 1; }
echo "Finished programs are collected by the image's own init."
docker exec -u hermes "$name" node /opt/godspeed/kit/docker/full-candidate/test-addon-model.mjs | tee "$evidence/addon-model.log"
# A backup AI the person connected, against this image's own Hermes (test-backup-ai.mjs): the
# chain the notebook writes is the one Hermes reads, and godspeed-model, Hermes' chat and the
# Settings check go to the backup only when the main AI fails, and never without one.
docker exec -u hermes "$name" node /opt/godspeed/kit/docker/full-candidate/test-backup-ai.mjs | tee "$evidence/backup-ai.log"
# The add-on may run on the Linux host while Godspeed runs in its existing
# container. Exercise that exact boundary against another local fake request.
docker exec -d -u hermes "$name" node /opt/godspeed/kit/docker/full-candidate/test-addon-model.mjs --serve
for attempt in $(seq 1 50); do
  docker exec "$name" test -f /tmp/godspeed-addon-model-ready.json && break
  sleep 0.2
done
docker exec "$name" test -f /tmp/godspeed-addon-model-ready.json
model_host=$(mktemp -d)
mkdir -p "$model_host/.godspeed"
cp notebook/bin/godspeed-docker-model.mjs "$model_host/.godspeed/model.mjs"
printf '%s\n' '{"format":1,"kind":"godspeed-docker","service":"godspeed","workspace":"/opt/data/full-candidate/workspace"}' > "$model_host/.godspeed/model-host.json"
printf 'name: godspeed-mission-control\nservices:\n  godspeed:\n    image: %s\n' "$image" > "$model_host/compose.yaml"
: > "$model_host/.env"
printf '%s\n' '{"system":"Return a fictional verdict only.","prompt":"A wholly invented profile.","timeout_ms":20000,"max_tokens":128}' \
  | node "$model_host/.godspeed/model.mjs" --workspace "$model_host" > "$evidence/addon-host-model.json"
node -e 'const r=require(process.argv[1]);if(r.provider!=="custom"||r.model!=="fictional-addon-model"||JSON.parse(r.text).verdict!=="like")process.exit(1)' "$evidence/addon-host-model.json"
docker exec -u hermes "$name" node -e 'const fs=require("fs"),p=JSON.parse(fs.readFileSync("/tmp/godspeed-addon-model-ready.json"));process.kill(p.pid,"SIGTERM")'
for attempt in $(seq 1 50); do
  if ! docker exec "$name" test -f /tmp/godspeed-addon-model-ready.json; then break; fi
  sleep 0.2
done
rm -rf "$model_host"
echo 'A host add-on used the fixed-service Docker model proxy and the selected local endpoint.'
# The mail tool on this server (18 October 2026): the assistant has it and it answers, and the
# command handed out for connecting Gmail is one the server's own terminal can run. Until then the
# server had no mail tool, and the command named a node path that exists only in the container.
docker exec -u hermes "$name" node /opt/godspeed/kit/tools/mc-mail.js setup --check > "$evidence/mail-setup.log" 2>&1 || true
grep -q '^Hermes: the mail tool answers' "$evidence/mail-setup.log" || { cat "$evidence/mail-setup.log"; echo "The assistant on this server has no working mail tool."; exit 1; }
docker exec -u hermes "$name" node /opt/godspeed/kit/tools/mc-mail.js connect gmail-imap > "$evidence/mail-connect.log" 2>&1 || true
line=$(sed -n 's/^  \(docker exec -it -u hermes .*connect gmail-imap\)$/\1/p' "$evidence/mail-connect.log" | head -1)
[ -n "$line" ] || { cat "$evidence/mail-connect.log"; echo "Connecting Gmail does not hand out a line for the server's own terminal."; exit 1; }
target=$(printf '%s\n' "$line" | awk '{ print $6 }')
docker exec -u hermes "$target" test -f /opt/godspeed/kit/tools/mc-mail.js || { echo "The Gmail line names $target, which is not this container."; exit 1; }
echo "The mail tool answers, and Gmail is connected from the server's own terminal with: $line"
# Run the actual modules shipped in this image, with small synthetic fixtures.
# A failure names its tests in the build log; the whole log stays in the evidence.
docker exec -e GODSPEED_ORIGINAL_RUNTIME=off -w /opt/godspeed/kit/notebook "$name" sh -c 'node scripts/run-tests.mjs test/*.test.mjs' > "$evidence/server-tests.log" 2>&1 || { grep -E '^not ok|^# (tests|pass|fail)' "$evidence/server-tests.log"; grep -E -A12 '^not ok' "$evidence/server-tests.log" | grep -E 'error|expected|actual|Error|FAIL|assert' | head -60; exit 1; }
# The hourly conversation archive, run every few seconds here: a Telegram exchange reaches the
# archive with its answer, the backup and a second machine (test-prompt-archive.sh).
bash docker/full-candidate/test-prompt-archive.sh "$name" | tee "$evidence/prompt-archive.log"; [ "${PIPESTATUS[0]}" -eq 0 ] || exit 1
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
