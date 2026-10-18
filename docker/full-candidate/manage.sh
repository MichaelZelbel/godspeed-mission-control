#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
compose=(docker compose --env-file candidate.env -f compose.yaml)
files=(image.tar.gz source.tar.gz compose.yaml Caddyfile install.sh manage.sh manifest.json SHA256SUMS)
case "${1:-status}" in
 status) "${compose[@]}" ps ;;
 restart) "${compose[@]}" restart notebook ;;
 backup) "${compose[@]}" exec -T notebook node /opt/godspeed/kit/notebook/bin/godspeed.mjs backup "/opt/data/full-candidate/backups/$(date -u +%Y%m%d-%H%M%S)" ;;
 stop) "${compose[@]}" stop ;;
 computer-code) "${compose[@]}" exec -T notebook node /opt/godspeed/kit/computer/godspeed-computer pair ;;
 computer-status) "${compose[@]}" exec -T notebook node /opt/godspeed/kit/computer/godspeed-computer status ;;
 # A new package, checked against its own checksums before anything here changes, then
 # installed by its own install.sh, which keeps the settings and backs up the data first.
 upgrade)
   package=${2:?Name the new package: bash manage.sh upgrade Godspeed-VPS-Full-Alpha-REVISION.tar.gz}
   staging=$(mktemp -d)
   tar -xzf "$package" -C "$staging" "${files[@]}"
   (cd "$staging" && sha256sum -c --quiet SHA256SUMS) || { rm -rf "$staging"; echo 'The new package does not match its own checksums, so nothing was changed.' >&2; exit 1; }
   for file in "${files[@]}"; do mv -f "$staging/$file" "./$file"; done
   rm -rf "$staging"
   exec bash ./install.sh ;;
 setup-link|login-link)
   token=$(sed -n 's/^GODSPEED_CANDIDATE_TOKEN=//p' candidate.env)
   setup=${GODSPEED_SETUP_CODE:-$(sed -n 's/^GODSPEED_SETUP_CODE=//p' candidate.env)}
   # The code goes in on standard input. On a command line (docker exec -e) every account
   # on this server could read it in the process list while the command ran.
   printf '%s' "${setup:-$token}" | "${compose[@]}" exec -T notebook node --input-type=module -e 'let code="";for await(const chunk of process.stdin)code+=chunk;const origin="http://127.0.0.1:47831";const response=await fetch(origin+"/api/auth/bootstrap",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:code.trim()})});const data=await response.json();if(!response.ok)throw new Error(data.error);console.log(data.path)' ;;
 *) echo 'Commands: status, restart, backup, stop, setup-link, upgrade PACKAGE. Setup links expire after 24 hours and can only create the first account. After setup, sign in with your username and password. upgrade checks the new package, keeps your settings, backs up your data first and keeps the previous image and settings (candidate.env.before-...) to go back to.' >&2; exit 1 ;;
esac
