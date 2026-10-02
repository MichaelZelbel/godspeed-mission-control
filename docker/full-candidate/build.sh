#!/usr/bin/env bash
set -euo pipefail
root=${GODSPEED_BUILD_ROOT:-$(git rev-parse --show-toplevel)}
cd "$root"
if [ -z "${GODSPEED_BUILD_REVISION:-}" ]; then test -z "$(git status --porcelain --untracked-files=no)" || { echo 'Commit candidate source before packaging.' >&2; exit 1; }; fi
revision=${GODSPEED_BUILD_REVISION:-$(git rev-parse HEAD)}
image="godspeed-full-candidate:$revision"
output="$root/notebook/dist/vps-$revision"
mkdir -p "$output"
docker build --build-arg "REVISION=$revision" -f docker/full-candidate/Dockerfile -t "$image" . > "$output/build.log" 2>&1
docker save "$image" | gzip -1 > "$output/image.tar.gz"
cp docker/full-candidate/{compose.yaml,Caddyfile,install.sh,manage.sh} "$output/"
if [ -n "${GODSPEED_SOURCE_ARCHIVE:-}" ]; then cp "$GODSPEED_SOURCE_ARCHIVE" "$output/source.tar.gz"; else git archive --format=tar.gz --output="$output/source.tar.gz" "$revision"; fi
image_id=$(docker image inspect "$image" --format '{{.Id}}')
python3 - "$output" "$revision" "$image" "$image_id" <<'PY'
import json,sys,pathlib
dest,revision,image,imageid=sys.argv[1:]
manifest={'channel':'full-alpha','version':'0.1.0-alpha.1','format':1,'revision':revision,'image':image,'imageId':imageid,'caddy':'caddy:2.10.2-alpine@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d','productionDeployment':False}
pathlib.Path(dest,'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
PY
(cd "$output" && sha256sum image.tar.gz source.tar.gz compose.yaml Caddyfile install.sh manage.sh manifest.json > SHA256SUMS)
tar -czf "$root/notebook/dist/Godspeed-VPS-Full-Alpha-$revision.tar.gz" -C "$output" image.tar.gz source.tar.gz compose.yaml Caddyfile install.sh manage.sh manifest.json SHA256SUMS
printf '%s\n' "$root/notebook/dist/Godspeed-VPS-Full-Alpha-$revision.tar.gz"
