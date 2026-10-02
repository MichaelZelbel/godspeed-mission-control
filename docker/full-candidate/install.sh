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
printf 'Candidate installed separately. Open https://localhost:48443 through your test host or an SSH tunnel.\nThe access token is saved in candidate.env.\n'
