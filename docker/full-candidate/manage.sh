#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
compose=(docker compose --env-file candidate.env -f compose.yaml)
case "${1:-status}" in
 status) "${compose[@]}" ps ;;
 restart) "${compose[@]}" restart notebook ;;
 backup) "${compose[@]}" exec -T notebook node /opt/godspeed/kit/notebook/bin/godspeed.mjs backup "/opt/data/full-candidate/backups/$(date -u +%Y%m%d-%H%M%S)" ;;
 stop) "${compose[@]}" stop ;;
 computer-code) "${compose[@]}" exec -T notebook node /opt/godspeed/kit/computer/godspeed-computer pair ;;
 computer-status) "${compose[@]}" exec -T notebook node /opt/godspeed/kit/computer/godspeed-computer status ;;
 setup-link|login-link)
   token=$(sed -n 's/^GODSPEED_CANDIDATE_TOKEN=//p' candidate.env)
   setup=${GODSPEED_SETUP_CODE:-$(sed -n 's/^GODSPEED_SETUP_CODE=//p' candidate.env)}
   "${compose[@]}" exec -T -e "SETUP_CODE=${setup:-$token}" notebook node --input-type=module -e 'const origin="http://127.0.0.1:47831";const response=await fetch(origin+"/api/auth/bootstrap",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:process.env.SETUP_CODE})});const data=await response.json();if(!response.ok)throw new Error(data.error);console.log(data.path)' ;;
 *) echo 'Commands: status, restart, backup, stop, setup-link. Setup links expire after 24 hours and can only create the first account. After setup, sign in with your username and password. Updating requires a verified new bundle, backup first, and retaining the prior bundle for rollback.' >&2; exit 1 ;;
esac
