#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
command -v docker >/dev/null || { echo 'Docker with Compose is required.' >&2; exit 1; }
test -f manifest.json || { echo 'Run from the extracted candidate package.' >&2; exit 1; }
sha256sum -c SHA256SUMS
umask 077
image=$(python3 -c 'import json;print(json.load(open("manifest.json"))["image"])')
caddy=$(python3 -c 'import json;print(json.load(open("manifest.json"))["caddy"])')
compose=(docker compose --env-file candidate.env -f compose.yaml)
# Run again in the same folder, this installs the package that is here now. Until
# 6 October 2026 candidate.env was written only the first time, so a new package was
# loaded and the old image kept running. The setup code and every other setting stay,
# the two image lines follow the manifest, and the settings before are kept beside it
# (candidate.env.before-<time>), with the old image still loaded, to go back to.
if [ -f candidate.env ]; then
  if [ "$(sed -n 's/^GODSPEED_CANDIDATE_IMAGE=//p' candidate.env)" != "$image" ]; then
    stamp=$(date -u +%Y%m%d-%H%M%S)
    cp -p candidate.env "candidate.env.before-$stamp"
    # The data first: a checked backup in the data volume, made by the version that wrote it.
    if [ -n "$("${compose[@]}" ps -q notebook 2>/dev/null)" ]; then
      echo 'Saving a backup before the update...' >&2
      "${compose[@]}" exec -T notebook node /opt/godspeed/kit/notebook/bin/godspeed.mjs backup "/opt/data/full-candidate/backups/before-update-$stamp" >/dev/null \
        || { echo 'The backup before the update did not finish, so nothing was changed. Run this again when the server answers.' >&2; exit 1; }
    else
      echo 'The server was not running, so no backup was made before this update. Your data stays where it was.' >&2
    fi
  fi
  grep -v -e '^GODSPEED_CANDIDATE_IMAGE=' -e '^GODSPEED_CADDY_IMAGE=' candidate.env > candidate.env.new || true
else
  token=$(python3 -c 'import secrets;print(secrets.token_hex(32))')
  printf 'GODSPEED_CANDIDATE_TOKEN=%s\n' "$token" > candidate.env.new
fi
printf 'GODSPEED_CANDIDATE_IMAGE=%s\nGODSPEED_CADDY_IMAGE=%s\n' "$image" "$caddy" >> candidate.env.new
mv candidate.env.new candidate.env
docker load -i image.tar.gz
"${compose[@]}" up -d
for attempt in $(seq 1 30); do
  if "${compose[@]}" exec -T notebook node --input-type=module -e 'const r=await fetch("http://127.0.0.1:47831/health");process.exit(r.ok?0:1)' >/dev/null 2>&1; then break; fi
  sleep 2
done
if path=$(bash ./manage.sh setup-link); then
  public_host=${GODSPEED_CANDIDATE_HOST:-$(sed -n 's/^GODSPEED_CANDIDATE_HOST=//p' candidate.env)}
  public_port=${GODSPEED_CANDIDATE_HTTPS_PORT:-$(sed -n 's/^GODSPEED_CANDIDATE_HTTPS_PORT=//p' candidate.env)}
  origin="${GODSPEED_BROWSER_ORIGIN:-https://${public_host:-localhost}:${public_port:-48443}}"
  printf '\nGodspeed Mission Control is ready.\nOpen this private link to choose your username and password:\n%s%s\nSave the recovery code offered during setup. Keep this link private; it expires in 24 hours.\n' "$origin" "$path"
else
  if "${compose[@]}" exec -T notebook node --input-type=module -e 'const r=await fetch("http://127.0.0.1:47831/api/auth/status");process.exit((await r.json()).configured?0:1)' >/dev/null 2>&1; then
    printf 'Godspeed Mission Control is installed. Open its address and sign in with your existing username and password.\n'
  else
    printf 'The server has not completed its access setup. Run this installer again after checking the connection. No account has been created.\n' >&2
    exit 1
  fi
fi
