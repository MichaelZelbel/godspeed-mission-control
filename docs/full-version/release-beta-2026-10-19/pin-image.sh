#!/usr/bin/env bash
# pin-image.sh <digest sha256:...> <image commit, full> : after main has become the release commit and
# "Integrated Godspeed v2" on main has published, signed and scanned v2-sha-<image commit>, this pins
# that image for Hostinger and the one-line server (docker/hostinger/compose.yaml and
# docker/hostinger/installer/compose.mjs), commits, then points the Hostinger README's purchase link at
# that commit and commits again. Run it in a product worktree whose HEAD is the head of
# release/beta-2026-10-18 (the release commit or a docs-only commit on it). Pushes nothing.
set -euo pipefail
NEW=${1:?digest sha256:...}; IMG=${2:?image commit}; S=${IMG:0:7}; D8=${NEW:7:8}
OLD=sha256:ceb11a103fbc4ee7d45c015397b14cb3886e22eb9f878e07bee8735f14e39b64
OLDLINK=8fc62411be3fd3f2d0148c7eb34bb57b1b944808
[[ "$NEW" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "not a digest: $NEW"; exit 1; }
[[ "$IMG" =~ ^[0-9a-f]{40}$ ]] || { echo "not a full commit: $IMG"; exit 1; }
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "this worktree has changes; commit or stash them first"; exit 1; }
sed -i "s#godspeed-mission-control@$OLD#godspeed-mission-control@$NEW#" docker/hostinger/compose.yaml docker/hostinger/installer/compose.mjs
grep -c "$NEW" docker/hostinger/compose.yaml docker/hostinger/installer/compose.mjs
! grep -rn "$OLD" docker/ || { echo "the old digest is still named"; exit 1; }
git add docker/hostinger/compose.yaml docker/hostinger/installer/compose.mjs
git commit -q -F - <<MSG
Hostinger and the one-line server installer install the image built from $S (v2-sha-$S, digest $D8...)

Integrated Godspeed v2 on main built, tested (a fresh installed server in a browser, the native
Linux install), published, signed and scanned it; its tag v2-sha-$IMG resolves on ghcr.io to
$NEW. It carries the first beta, godspeed-v2-integrated-2026-10-19-1 (2.0.0-beta.1).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
Y=$(git rev-parse HEAD)
sed -i "s#%2F$OLDLINK%2F#%2F$Y%2F#" docker/hostinger/README.md
[ "$(grep -c "$Y" docker/hostinger/README.md)" -ge 1 ] || { echo "the purchase link was not changed"; exit 1; }
python3 - docker/hostinger/README.md "$S" "$D8" <<'PY'
import sys
p, s, d8 = sys.argv[1:4]
t = open(p, encoding='utf-8').read()
old = "(`v2-sha-54f72d3`, digest `ceb11a10…`, since the release of 18 October 2026, Hermes installs in a terminal and the assistant gets its notebook; before that `v2-sha-1a9261a`, digest `87ab520b…`, from the release of 17 October 2026, a first goal starts its routines, then "
new = "(`v2-sha-%s`, digest `%s…`, since the release of 19 October 2026, the first beta; before that `v2-sha-54f72d3`, digest `ceb11a10…`, from the release of 18 October 2026, Hermes installs in a terminal and the assistant gets its notebook, then `v2-sha-1a9261a`, digest `87ab520b…`, from the release of 17 October 2026, a first goal starts its routines, then " % (s, d8)
assert t.count(old) == 1, "the sentence naming the current image was not found"
open(p, 'w', encoding='utf-8', newline='\n').write(t.replace(old, new))
PY
git add docker/hostinger/README.md
git commit -q -F - <<MSG
Hostinger README: the purchase link names ${Y:0:7}, which pins the image built from $S

Guide-Reviewed: server-commands
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
git log --oneline -3 | cat
echo "PIN COMMIT $Y"
echo "README COMMIT $(git rev-parse HEAD)"
