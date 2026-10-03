#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
command -v docker >/dev/null || { echo 'Docker with Compose is required.' >&2; exit 1; }
test -f manifest.json || { echo 'Run from the extracted candidate package.' >&2; exit 1; }
sha256sum -c SHA256SUMS
if [ ! -f candidate.env ]; then
  umask 077
  image=$(python3 -c 'import json;print(json.load(open("manifest.json"))["image"])')
  caddy=$(python3 -c 'import json;print(json.load(open("manifest.json"))["caddy"])')
  token=$(python3 -c 'import secrets;print(secrets.token_hex(32))')
  printf 'GODSPEED_CANDIDATE_IMAGE=%s\nGODSPEED_CADDY_IMAGE=%s\nGODSPEED_CANDIDATE_TOKEN=%s\n' "$image" "$caddy" "$token" > candidate.env
fi
docker load -i image.tar.gz
docker compose --env-file candidate.env -f compose.yaml up -d
for attempt in $(seq 1 30); do
  if docker compose --env-file candidate.env -f compose.yaml exec -T notebook node --input-type=module -e 'const r=await fetch("http://127.0.0.1:47831/health");process.exit(r.ok?0:1)' >/dev/null 2>&1; then break; fi
  sleep 2
done
if path=$(bash ./manage.sh setup-link); then
  public_host=${GODSPEED_CANDIDATE_HOST:-$(sed -n 's/^GODSPEED_CANDIDATE_HOST=//p' candidate.env)}
  public_port=${GODSPEED_CANDIDATE_HTTPS_PORT:-$(sed -n 's/^GODSPEED_CANDIDATE_HTTPS_PORT=//p' candidate.env)}
  origin="${GODSPEED_BROWSER_ORIGIN:-https://${public_host:-localhost}:${public_port:-48443}}"
  printf '\nGodspeed Mission Control is ready.\nOpen this private link to choose your username and password:\n%s%s\nSave the recovery code offered during setup. Keep this link private; it expires in 24 hours.\n' "$origin" "$path"
else
  if docker compose --env-file candidate.env -f compose.yaml exec -T notebook node --input-type=module -e 'const r=await fetch("http://127.0.0.1:47831/api/auth/status");process.exit((await r.json()).configured?0:1)' >/dev/null 2>&1; then
    printf 'Godspeed Mission Control is installed. Open its address and sign in with your existing username and password.\n'
  else
    printf 'The server has not completed its access setup. Run this installer again after checking the connection. No account has been created.\n' >&2
    exit 1
  fi
fi
