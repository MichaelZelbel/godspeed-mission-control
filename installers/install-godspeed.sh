#!/usr/bin/env bash
# Godspeed Mission Control v2: integrated notebook, isolated from version 1.
set -euo pipefail
revision=1555e804fdadc59a8e4febba74ff33648dde8177
digest=7a559c2cfac7abad8bfb579f3e13b4c68aecaf25e4681c5c161eddb5e257ed3f
url=https://github.com/MichaelZelbel/godspeed-mission-control/releases/download/godspeed-v2-integrated-2026-10-04-2/Godspeed-v2-integrated-source.tar.gz
root=${GODSPEED_V2_INSTALL_DIR:-$HOME/GodspeedMissionControl-v2}
host=${GODSPEED_HOST:-}
if [ "${1:-}" = --help ]; then
  echo 'Requires Docker with Compose. GODSPEED_V2_INSTALL_DIR sets the folder; GODSPEED_HOST enables HTTPS on a fresh VPS.'; exit 0
fi
[ "$#" = 0 ] || { echo 'Use the documented environment settings, without command arguments.' >&2; exit 1; }
command -v docker >/dev/null || { echo 'Install Docker with Compose, then run this installer again.' >&2; exit 1; }
docker compose version >/dev/null
docker info >/dev/null
command -v curl >/dev/null
if command -v sha256sum >/dev/null; then checksum=(sha256sum); else checksum=(shasum -a 256); fi
if [ -n "$host" ] && ! [[ "$host" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]+$ ]]; then
  echo 'GODSPEED_HOST must be a hostname without a URL, path or port.' >&2; exit 1
fi
umask 077
mkdir -p "$root"
cd -- "$root"
if [ -n "$(ls -A .)" ] && [ ! -f .godspeed-v2-install ]; then
  echo 'Choose an empty GODSPEED_V2_INSTALL_DIR. Existing files were preserved.' >&2; exit 1
fi
if [ -f .godspeed-v2-install ] && [ "$(cat .godspeed-v2-install)" != "$revision" ]; then
  echo 'A different version is installed here. Back it up before upgrading.' >&2; exit 1
fi
printf '%s\n' "$revision" > .godspeed-v2-install
archive="source-$revision.tar.gz"
if [ ! -f "$archive" ]; then
  curl -fL --retry 3 "$url" -o "$archive.download"
  printf '%s  %s\n' "$digest" "$archive.download" | "${checksum[@]}" -c -
  mv -- "$archive.download" "$archive"
fi
printf '%s  %s\n' "$digest" "$archive" | "${checksum[@]}" -c -
mkdir -p "source-$revision"
tar -xzf "$archive" -C "source-$revision"
image="godspeed-mission-control-v2:$revision"
if ! docker image inspect "$image" >/dev/null 2>&1; then
  docker build --build-arg "REVISION=$revision" --build-arg USE_VERIFIED_FRONTEND=1 \
    -f "source-$revision/docker/full-candidate/Dockerfile" -t "$image" "source-$revision"
fi
if [ ! -f compose.yaml ]; then
  cat > compose.yaml <<'COMPOSE'
name: godspeed-mission-control-v2
services:
  notebook:
    image: ${GODSPEED_V2_IMAGE:?Missing installation image}
    restart: unless-stopped
    environment:
      GODSPEED_ACCESS_TOKEN: ${GODSPEED_V2_SETUP_CODE:?Missing private setup code}
      GODSPEED_DEVICE: vps
      GODSPEED_COMPUTER: "off"
      GODSPEED_TELEGRAM: "off"
    volumes: ["godspeed-v2-data:/opt/data/full-candidate"]
    ports: ["127.0.0.1:47831:47831"]
    cpus: 1.0
    mem_limit: 2g
volumes:
  godspeed-v2-data: {}
COMPOSE
fi
if [ ! -f installation.env ]; then
  token=$(docker run --rm --entrypoint node "$image" -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')
  printf 'GODSPEED_V2_IMAGE=%s\nGODSPEED_V2_SETUP_CODE=%s\nGODSPEED_HOST=%s\n' "$image" "$token" "$host" > installation.env
fi
host=$(sed -n 's/^GODSPEED_HOST=//p' installation.env)
compose=(docker compose --env-file installation.env -f compose.yaml)
origin=http://127.0.0.1:47831
if [ -n "$host" ]; then
  if [ ! -f https.yaml ]; then
    cat > https.yaml <<'HTTPS'
services:
  https:
    image: caddy:2.10.2-alpine@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d
    restart: unless-stopped
    command: ["caddy", "reverse-proxy", "--from", "${GODSPEED_HOST}", "--to", "notebook:47831"]
    ports: ["80:80", "443:443"]
    volumes: ["godspeed-v2-certificates:/data", "godspeed-v2-proxy:/config"]
    depends_on:
      notebook:
        condition: service_healthy
volumes:
  godspeed-v2-certificates: {}
  godspeed-v2-proxy: {}
HTTPS
  fi
  compose+=(-f https.yaml)
  origin="https://$host"
fi
"${compose[@]}" up -d
ready=false
for attempt in $(seq 1 60); do
  if "${compose[@]}" exec -T notebook node -e 'fetch("http://127.0.0.1:47831/health").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' >/dev/null 2>&1; then ready=true; break; fi
  sleep 2
done
[ "$ready" = true ] || { echo 'Godspeed Mission Control has not started. Inspect Docker Compose logs in its installation folder.' >&2; exit 1; }
if "${compose[@]}" exec -T notebook node -e 'fetch("http://127.0.0.1:47831/api/auth/status").then(r=>r.json()).then(d=>process.exit(d.configured?0:1))' >/dev/null 2>&1; then
  printf 'Godspeed Mission Control v2 is ready. Sign in at %s/dashboard\n' "$origin"
else
  token=$(sed -n 's/^GODSPEED_V2_SETUP_CODE=//p' installation.env)
  invitation=$("${compose[@]}" exec -T -e "SETUP_CODE=$token" notebook node --input-type=module -e 'const r=await fetch("http://127.0.0.1:47831/api/auth/bootstrap",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:process.env.SETUP_CODE})});const d=await r.json();if(!r.ok)throw Error(d.error);console.log(d.path)')
  printf 'Godspeed Mission Control v2 is ready. Open this private link to choose your username and password:\n%s%s\nSave the recovery code shown during setup.\n' "$origin" "$invitation"
fi
