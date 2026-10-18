#!/usr/bin/env bash
# build-exe.sh <product commit>: the release files for that product commit, as built for the first
# beta on 18 October 2026. Publishes nothing.
#
#   1. BUILD, a product worktree, is detached at the commit; npm ci + npm run build in notebook/ui with
#      Node 22.19.0 (the build refuses another Node)
#   2. kit-bootstrap's windows/build-full-alpha.ps1 from KB, a kit-bootstrap worktree whose HEAD is the
#      bootstrap commit the setup will pin, run with Windows PowerShell 5.1 (Inno Setup 6 installed)
#   3. OUT/assets-<short>/: GodspeedSetup.exe, windows-manifest.json (the build's manifest as two-space
#      JSON with a final newline, checked to name both commits) and the source archive
#      (git archive --prefix=godspeed-mission-control/ of the commit). install-godspeed.sh and
#      SHA256SUMS are added after the installer's pins are moved (README.md here, "How it was built").
#
# Run from Git Bash: BUILD=<product worktree> KB=<kit-bootstrap worktree> OUT=<scratch folder> bash build-exe.sh <commit>
# The first beta was built with BUILD detached at 725f6f6 and KB at 86da1dd.
set -euo pipefail
BUILD=${BUILD:?a product worktree to build in}; KB=${KB:?a kit-bootstrap worktree at the bootstrap commit}; OUT=${OUT:?a scratch folder}
unset GODSPEED_DIR GODSPEED_ROOT GODSPEED_WORKSPACE || true
P=$(git -C "$BUILD" rev-parse "${1:?product commit}^{commit}"); S=${P:0:7}
B=$(git -C "$KB" rev-parse HEAD)
git -C "$BUILD" checkout -q --detach "$P"
[ -z "$(git -C "$BUILD" status --porcelain --untracked-files=no)" ] || { echo "the build checkout is not clean"; exit 1; }
[ -z "$(git -C "$KB" status --porcelain --untracked-files=no)" ] || { echo "kit-bootstrap's worktree is not clean"; exit 1; }
echo "product $P, kit-bootstrap $B, node $(node --version)"
[ "$(node --version)" = v22.19.0 ] || { echo "not Node 22.19.0"; exit 1; }
mkdir -p "$OUT"
( cd "$BUILD/notebook/ui" && npm ci --no-audit --no-fund && npm run build ) > "$OUT/ui-build-$S.log" 2>&1 || { echo "UI build failed: $OUT/ui-build-$S.log"; exit 1; }
echo "UI built"
rm -f "$KB/windows/dist/GodspeedSetup-Full-Alpha.exe" "$KB/windows/dist/candidate-manifest.json"
( cd "$OUT" && powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(cygpath -w "$KB/windows/build-full-alpha.ps1")" -KitCheckout "$(cygpath -w "$BUILD")" ) > "$OUT/exe-build-$S.log" 2>&1 || { echo "exe build failed: $OUT/exe-build-$S.log"; exit 1; }
ls -la "$KB/windows/dist/"
A=$OUT/assets-$S; mkdir -p "$A"
cp "$KB/windows/dist/GodspeedSetup-Full-Alpha.exe" "$A/GodspeedSetup.exe"
node -e '
const fs=require("fs");const [src,dst,p,b]=process.argv.slice(1);
const m=JSON.parse(fs.readFileSync(src,"utf8").replace(/^\uFEFF/,""));
if(m.kitCommit!==p||m.bootstrapCommit!==b){console.error("manifest names",m.kitCommit,m.bootstrapCommit);process.exit(1)}
fs.writeFileSync(dst,JSON.stringify(m,null,2)+"\n");console.log("manifest",m.version,m.kitCommit.slice(0,7),m.bootstrapCommit.slice(0,7),m.files.length,"files")' \
  "$(cygpath -w "$KB/windows/dist/candidate-manifest.json")" "$(cygpath -w "$A/windows-manifest.json")" "$P" "$B"
git -C "$BUILD" archive --format=tar.gz --prefix=godspeed-mission-control/ -o "$A/Godspeed-v2-integrated-source.tar.gz" "$P"
echo "BUILD DONE $S"
