#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
compose=(docker compose --env-file candidate.env -f compose.yaml)
case "${1:-status}" in
 status) "${compose[@]}" ps ;;
 restart) "${compose[@]}" restart notebook ;;
 backup) "${compose[@]}" exec -T notebook node /opt/godspeed/kit/notebook/bin/godspeed.mjs backup "/opt/data/full-candidate/backups/$(date -u +%Y%m%d-%H%M%S)" ;;
 stop) "${compose[@]}" stop ;;
 login-link)
   token=$(sed -n 's/^GODSPEED_CANDIDATE_TOKEN=//p' candidate.env)
   "${compose[@]}" exec -T -e "CANDIDATE_TOKEN=$token" notebook node -e 'const origin="http://127.0.0.1:47831";const a=await fetch(origin+"/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:process.env.CANDIDATE_TOKEN})});if(!a.ok)throw new Error("Login failed");const b=await fetch(origin+"/api/login-link",{method:"POST",headers:{Cookie:a.headers.get("set-cookie").split(";")[0]}});console.log("https://localhost:48443"+(await b.json()).path)' ;;
 *) echo 'Commands: status, restart, backup, stop, login-link. Updating requires a verified new bundle, backup first, and retaining the prior bundle for rollback.' >&2; exit 1 ;;
esac
